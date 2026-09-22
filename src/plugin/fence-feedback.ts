/**
 * Fence feedback loop (issue #160): a reply whose ```dsh-ui fence the guard
 * cannot render should not stay broken for the reader. The host's
 * `agent/turn-stopping` boundary lets a plugin steer input into the SAME turn —
 * the machine re-reads its inbox and runs another step instead of closing
 * (see the `dsh-agent` runtime contract) — so the model can resend a corrected
 * fence while the user is still looking at the raw JSON.
 *
 * The loop is deliberately narrow, matching the contract agreed on the issue:
 * - **默认开启。** 插件配置中的 `fenceFeedback: false` 可以关闭回合转向。
 * - **Bounded.** At most one correction per turn AND at most one per fence
 *   body per process, so a correction that is itself wrong cannot loop.
 * - **Never for subagents.** A child session's fence belongs to a parent reply.
 * - **Exact fence matching.** Only an info string of exactly `dsh-ui` opens a
 *   fence, so ` ```dsh-ui-dark `, indented prose, or a mention of the name is
 *   never rewritten.
 * - **Accounted before sending.** The fingerprint is recorded before `steer`,
 *   so a re-entrant boundary cannot deliver the same correction twice.
 * - **Cancellation-aware.** An aborted turn or a missing session is left alone.
 *
 * 检查会复用 renderer 在回合结束后的流程，包括 JSON 修复和坏节点清理；
 * 已经可以渲染的最终回复不会收到修正请求。
 * @module @changfenhuang/dsh-genui/plugin/fence-feedback
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { createHash, randomUUID } from 'node:crypto'
import { droppedNodeFailure } from './genui-diagnostic.ts'
import { resolveFence } from '../shared/fence-resolve.ts'

/** Plugin name recorded on every message this loop steers. */
export const FEEDBACK_PLUGIN_NAME = '@changfenhuang/dsh-genui'

/** Marker prefix inside the correction text: `[genui-fence-repair #<fingerprint>]`. */
const MARKER_PREFIX = '[genui-fence-repair #'
/** Marker prefix written by older plugin versions. */
const LEGACY_MARKER_PREFIX = '[genui 自修 #'

/** A fence opener is an info string of exactly `dsh-ui` (≤3 spaces indent). */
const FENCE_OPEN = /^ {0,3}```[ \t]*dsh-ui[ \t]*$/u
/** Any fence closer (the renderer never nests fences in one body). */
const FENCE_CLOSE = /^ {0,3}```[ \t]*$/u
/** Upper bound on fences inspected per reply — a reply is text, not a corpus. */
const MAX_FENCES = 40

/** One ```dsh-ui fence found in an assistant reply. */
export interface ExtractedFence {
  /** Raw body between the fences (no delimiters). */
  readonly raw: string
  /** False when the reply ended before the closing fence. */
  readonly closed: boolean
  /** 1-based position among this reply's fences. */
  readonly index: number
}

/**
 * Extract every ```dsh-ui fence from one assistant reply.
 *
 * @param text - the assistant message text.
 * @returns the fences in document order (at most {@link MAX_FENCES}).
 */
export function extractDshUiFences(text: string): ExtractedFence[] {
  const lines = text.split('\n')
  const fences: ExtractedFence[] = []
  let open: { start: number; index: number } | null = null
  for (let line = 0; line < lines.length; line++) {
    const current = lines[line] ?? ''
    if (open === null) {
      if (FENCE_OPEN.test(current)) open = { start: line + 1, index: fences.length + 1 }
      continue
    }
    if (!FENCE_CLOSE.test(current)) continue
    fences.push({ raw: lines.slice(open.start, line).join('\n'), closed: true, index: open.index })
    open = null
    if (fences.length >= MAX_FENCES) return fences
  }
  if (open !== null && fences.length < MAX_FENCES) {
    fences.push({ raw: lines.slice(open.start).join('\n'), closed: false, index: open.index })
  }
  return fences
}

/** Stable, log-safe identity of one fence body (same body → same fingerprint). */
export function fenceFingerprint(raw: string): string {
  return createHash('sha256').update(raw.trim()).digest('hex').slice(0, 12)
}

/** One fence the guard refuses to render, with its model-facing reason. */
export interface FenceFailure {
  readonly index: number
  readonly fingerprint: string
  /** Actionable diagnosis, in the same wording the validator tool uses. */
  readonly detail: string
}

/**
 * Validate every fence in a reply the way the DOM channel would render it.
 *
 * @param text - the assistant message text.
 * @returns the fences that would stay a raw code block, in document order.
 */
export function fenceFailures(text: string): FenceFailure[] {
  const failures: FenceFailure[] = []
  for (const fence of extractDshUiFences(text)) {
    const detail = fenceFailureDetail(fence)
    if (detail !== null) failures.push({ index: fence.index, fingerprint: fenceFingerprint(fence.raw), detail })
  }
  return failures
}

/** `null` when this fence renders; otherwise the reason it does not. */
function fenceFailureDetail(fence: ExtractedFence): string | null {
  if (!fence.closed) return 'error=unterminated_fence\nrequired=closing_fence'
  const resolution = resolveFence(fence.raw, { settled: true })
  if (resolution.spec !== null) return null
  if (resolution.processed !== null) {
    const dropped = droppedNodeFailure(resolution.processed, resolution.value)
    return dropped?.join('\n')
      ?? ['error=invalid_spec', ...resolution.processed.errors.map(error => `diagnostic=${JSON.stringify(error)}`)].join('\n')
  }
  return 'error=invalid_json\nrepair=failed'
}

/**
 * Build the correction input for a reply with unrenderable fences.
 *
 * @param failures - fences {@link fenceFailures} rejected.
 * @returns the message text to steer into the running turn.
 */
export function fenceCorrectionText(failures: readonly FenceFailure[]): string {
  const body = failures
    .map(failure => `fence=${failure.index}\nfingerprint=${failure.fingerprint}\n${failure.detail}`)
    .join('\n\n')
  const marker = failures.map(failure => `${MARKER_PREFIX}${failure.fingerprint}]`).join(' ')
  return `${marker}\n\n[genui-fence-repair]\nstatus=render_failed\nfences=${failures.length}\nnext=resend_corrected_fence_only\nrepeat_rendered_content=false\nreply_language=conversation\n\n${body}\n`
}

/**
 * Create the identified user-role message this loop steers.
 *
 * Mirrors `createUserMessage` from `@deepseek-ai/dsh-llm` (id + role + frozen)
 * without a runtime dependency on that package: the node half of this plugin
 * deliberately imports no `@deepseek-ai/*` values, so a linked or npm-installed
 * copy resolves identically on every host.
 *
 * @param text - the correction text.
 * @returns a frozen user message attributed to this plugin as a notice.
 */
export function createFeedbackMessage(text: string): UserMessage {
  const message = {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: 'plugin',
      plugin: FEEDBACK_PLUGIN_NAME,
      form: 'notice',
      summary: 'genui fence repair requested',
    },
  }
  Object.freeze(message.content)
  return Object.freeze(message) as unknown as UserMessage
}

/** Per-session bookkeeping for the loop (process lifetime). */
interface SessionFeedback {
  /** Latest assistant reply text of the current turn. */
  text: string
  /** Fence fingerprints already corrected in this process. */
  corrected: Set<string>
  /** Turn that already received its one correction. */
  lastCorrectedTurn: number | undefined
}

/** What the pure planner needs to decide whether a correction may be sent. */
export interface FenceFeedbackPlanInput {
  readonly text: string
  readonly turn: number
  readonly lastCorrectedTurn: number | undefined
  readonly corrected: ReadonlySet<string>
  readonly aborted: boolean
}

/** A correction the caller must account for before steering. */
export interface FenceFeedbackPlan {
  readonly text: string
  readonly fingerprints: readonly string[]
  readonly turn: number
}

/**
 * Decide whether this turn boundary should steer a fence correction — the pure
 * core of the loop, so every bound (one per turn, one per fence, cancellation)
 * is testable without a host.
 *
 * @param input - reply text, turn identity, and the session's accounting.
 * @returns the correction to send, or null when the loop must stay silent.
 */
export function planFenceFeedback(input: FenceFeedbackPlanInput): FenceFeedbackPlan | null {
  if (input.aborted) return null
  if (input.lastCorrectedTurn === input.turn) return null
  if (input.text.trim() === '') return null
  const failures = fenceFailures(input.text).filter(failure => !input.corrected.has(failure.fingerprint))
  if (failures.length === 0) return null
  return {
    text: fenceCorrectionText(failures),
    fingerprints: failures.map(failure => failure.fingerprint),
    turn: input.turn,
  }
}

/** Text of one assistant message's text blocks, in order. */
function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (typeof block !== 'object' || block === null) return ''
      const record = block as { type?: unknown; text?: unknown }
      return record.type === 'text' && typeof record.text === 'string' ? record.text : ''
    })
    .filter(part => part !== '')
    .join('\n')
}

/** Fingerprints this loop already recorded inside a steered correction. */
function markersIn(text: string): string[] {
  const out: string[] = []
  let cursor = 0
  while (cursor < text.length) {
    const current = text.indexOf(MARKER_PREFIX, cursor)
    const legacy = text.indexOf(LEGACY_MARKER_PREFIX, cursor)
    if (current < 0 && legacy < 0) break
    const useLegacy = legacy >= 0 && (current < 0 || legacy < current)
    const prefix = useLegacy ? LEGACY_MARKER_PREFIX : MARKER_PREFIX
    const index = useLegacy ? legacy : current
    const end = text.indexOf(']', index + prefix.length)
    if (end < 0) break
    out.push(text.slice(index + prefix.length, end))
    cursor = end + 1
  }
  return out
}

/**
 * 根据插件配置启用围栏反馈流程。
 *
 * @param ctx - the host context.
 * @param enabled - the plugin config flag; the loop is inert when false.
 */
export function installFenceFeedback(ctx: Context, enabled: boolean): void {
  if (!enabled) return
  const sessions = new Map<string, SessionFeedback>()
  const stateOf = (sessionId: string): SessionFeedback => {
    let state = sessions.get(sessionId)
    if (state === undefined) {
      state = { text: '', corrected: new Set(), lastCorrectedTurn: undefined }
      sessions.set(sessionId, state)
    }
    return state
  }

  ctx.on('session/disposed', (session): void => {
    sessions.delete(String(session.id))
  })

  ctx.on('session/event', (session, event: SessionEvent) => {
    const sessionId = String(session.id)
    if (event.type === 'assistant/message') {
      const text = textOfContent((event.data as { message?: { content?: unknown } }).message?.content)
      if (extractDshUiFences(text).length === 0) {
        const state = sessions.get(sessionId)
        if (state !== undefined) state.text = ''
        return
      }
      stateOf(sessionId).text = text
      return
    }
    if (event.type !== 'user/message') return
    const data = event.data as { content?: unknown; source?: { kind?: unknown; plugin?: unknown } }
    if (data.source?.kind === 'plugin' && data.source.plugin === FEEDBACK_PLUGIN_NAME) {
      // Our own correction (re-observed after a plugin reload): adopt its
      // fingerprints so a second boundary cannot repeat it.
      const fingerprints = markersIn(textOfContent(data.content))
      if (fingerprints.length === 0) return
      const state = stateOf(sessionId)
      for (const fingerprint of fingerprints) state.corrected.add(fingerprint)
      return
    }
    // A genuine user prompt starts a new turn: the previous reply is settled.
    const state = sessions.get(sessionId)
    if (state !== undefined) state.text = ''
  })

  ctx.on('agent/turn-stopping', ({ agent, turn, signal }): void => {
    // A child session's fence belongs to a parent reply, and an aborted turn is
    // on its way out: never steer into either.
    if (agent.session.header.parentSession !== undefined) return
    const state = sessions.get(String(agent.session.id))
    if (state === undefined) return
    const plan = planFenceFeedback({
      text: state.text,
      turn,
      lastCorrectedTurn: state.lastCorrectedTurn,
      corrected: state.corrected,
      aborted: signal.aborted,
    })
    if (plan === null) return
    // Account BEFORE sending: a re-entrant boundary must not deliver twice.
    for (const fingerprint of plan.fingerprints) state.corrected.add(fingerprint)
    state.lastCorrectedTurn = plan.turn
    try {
      agent.steer(createFeedbackMessage(plan.text))
    } catch (error) {
      ctx.logger?.warn?.(`dsh-genui: fence feedback steering failed (${error instanceof Error ? error.message : String(error)})`)
    }
  })
}
