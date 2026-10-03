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
 * - **Bounded.** At most two corrections per turn (the second is reserved for
 *   the case where the first is answered with another reasoning-only turn) AND
 *   at most one per fence body per process, so a correction that is itself
 *   wrong cannot loop.
 * - **Reasoning-only recovery.** A turn whose body carries no fence but whose
 *   reasoning block composed one gets a correction that hands the body back
 *   verbatim; one real session had five such turns (the model kept ending the
 *   turn with the fence only in its thinking).
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
/** Source kind persisted by this plugin in Session format v4. */
export const FEEDBACK_SOURCE_KIND = `plugin:${FEEDBACK_PLUGIN_NAME}` as const

/** Marker prefix inside the correction text: `[genui-fence-repair #<fingerprint>]`. */
const MARKER_PREFIX = '[genui-fence-repair #'
/**
 * Corrections a single turn may receive. Two, not one: when the first (a fence
 * that failed to RENDER) is answered with another reasoning-only turn, the
 * second is the only chance to get it into the body. Bounded, and the per-fence
 * fingerprint ledger still prevents any repeat for the same fence body.
 */
export const MAX_CORRECTIONS_PER_TURN = 2

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
 * @param sessionFormatVersion - the format recorded by the active session.
 * @returns a frozen user message attributed to this plugin as a notice.
 */
export function createFeedbackMessage(text: string, sessionFormatVersion: number): UserMessage {
  const source = sessionFormatVersion >= 4
    ? {
        kind: FEEDBACK_SOURCE_KIND,
        form: 'notice' as const,
        summary: 'genui fence repair requested',
      }
    : {
        kind: 'plugin' as const,
        plugin: FEEDBACK_PLUGIN_NAME,
        form: 'notice' as const,
        summary: 'genui fence repair requested',
      }
  const message = {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source,
  }
  Object.freeze(message.content)
  return Object.freeze(message) as unknown as UserMessage
}

/** Per-session bookkeeping for the loop (process lifetime). */
interface SessionFeedback {
  /** Latest assistant reply text of the current turn (fences are read from here). */
  text: string
  /**
   * A `validate_dsh_ui` call happened in this turn. This is the FORMAL signal
   * that the turn is GenUI-related — the loop never guesses intent by scanning
   * the reasoning block.
   */
  validatedThisTurn: boolean
  /**
   * The turn delivered something formal: a non-empty body text or a `render_ui`
   * call. "No fence in the body" is NOT "no answer".
   */
  deliveredThisTurn: boolean
  /** Fence fingerprints already corrected for a RENDER failure. */
  correctedSpec: Set<string>
  /**
   * Turns already given the "nothing was delivered" reminder. Kept separate from
   * {@link correctedSpec}: a missing delivery must not consume the render-failure
   * ledger (nor the other way round).
   */
  deliveryRemindedTurns: Set<number>
  /** Corrections already steered in {@link correctionsTurn}. */
  correctionsThisTurn: number
  /** Turn {@link correctionsThisTurn} counts. */
  correctionsTurn: number | undefined
}

/** What the pure planner needs to decide whether a correction may be sent. */
export interface FenceFeedbackPlanInput {
  /** Latest assistant reply text of the current turn. */
  readonly text: string
  readonly turn: number
  /** Fence bodies already corrected for a render failure. */
  readonly correctedSpec: ReadonlySet<string>
  /** Turns already given the delivery reminder. */
  readonly deliveryRemindedTurns?: ReadonlySet<number> | undefined
  /** A `validate_dsh_ui` call happened this turn (formal GenUI signal). */
  readonly validatedThisTurn?: boolean | undefined
  /** The turn already delivered a body or a `render_ui` card. */
  readonly deliveredThisTurn?: boolean | undefined
  readonly aborted: boolean
  /** Corrections already steered in this turn (shared hard cap). */
  readonly correctionsThisTurn?: number | undefined
  /** Turn {@link correctionsThisTurn} counts (stale counts are ignored). */
  readonly correctionsTurn?: number | undefined
}

/** A correction the caller must account for before steering. */
export interface FenceFeedbackPlan {
  readonly text: string
  readonly fingerprints: readonly string[]
  readonly turn: number
  /**
   * `render` corrects a fence that failed to resolve; `delivery` reminds the
   * model that the turn produced nothing formal. They share the per-turn budget
   * but keep separate ledgers.
   */
  readonly kind: 'render' | 'delivery'
}

/**
 * Decide whether this turn boundary should steer a correction — the pure core of
 * the loop, so every bound (per-turn cap, per-fence ledger, cancellation) is
 * testable without a host.
 *
 * The decision is driven by FORMAL events only: fences in the reply body, a
 * `validate_dsh_ui` call, a delivered body or `render_ui`. The reasoning block is
 * never read here — a draft inside the thinking block is not proof that the model
 * chose to deliver it, so it must not change any decision.
 *
 * @param input - reply text, turn identity, formal signals, and the accounting.
 * @returns the correction to send, or null when the loop must stay silent.
 */
export function planFenceFeedback(input: FenceFeedbackPlanInput): FenceFeedbackPlan | null {
  if (input.aborted) return null
  const used = input.correctionsTurn === input.turn ? (input.correctionsThisTurn ?? 0) : 0
  if (used >= MAX_CORRECTIONS_PER_TURN) return null
  const failures = fenceFailures(input.text).filter(failure => !input.correctedSpec.has(failure.fingerprint))
  if (failures.length > 0) {
    return {
      text: fenceCorrectionText(failures),
      fingerprints: failures.map(failure => failure.fingerprint),
      turn: input.turn,
      kind: 'render',
    }
  }
  // No un-corrected render failure. If the turn formally validated a spec and
  // then delivered nothing, remind the model once for this turn.
  if (input.validatedThisTurn !== true || input.deliveredThisTurn === true) return null
  if (input.deliveryRemindedTurns?.has(input.turn) === true) return null
  return { text: missingBodyCorrectionText(input.turn, used + 1), fingerprints: [], turn: input.turn, kind: 'delivery' }
}

/**
 * Correction for "the fence is in the reasoning block only".
 *
 * @param fingerprint - fingerprint of that fence body.
 * @returns the message text to steer into the running turn.
 */
export function missingBodyCorrectionText(turn: number, attempt = 1): string {
  const head = `${MARKER_PREFIX}turn-${turn}]\n\n[genui-fence-repair]\nstatus=nothing_delivered\nfences=0\nnext=emit_fence_in_body\nrepeat_rendered_content=false\nreply_language=conversation\n\n`
  // NEVER quote a draft: a fence in the reasoning block is not proof that the
  // model chose to deliver it (there may be several candidates, or a later one
  // may supersede it). The reminder only says "nothing has been delivered yet".
  const emphasis = attempt <= 1 ? '' : `（第 ${attempt} 次提醒）`
  return `${head}本轮尚未产生正式回答，也没有通过支持的通道交付结果${emphasis}。请根据用户当前请求完成正式答复；需要 UI 时，在回答正文输出你最终选定的 dsh-ui 围栏，或明确调用 render_ui。可以修改或放弃此前候选；不能完成时，请在正文说明原因。\n`
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

/** Tool whose successful call IS a formal delivery. */
const DELIVERY_TOOL = 'render_ui'

/**
 * Whether one assistant message already delivered something formal.
 *
 * Deliberately narrow: a non-empty text block, or a `render_ui` call. Other
 * tools (validate_dsh_ui, bash, …) may succeed without producing any answer, so
 * they are NOT counted as delivery.
 *
 * @param content - assistant content blocks.
 * @returns true when this message delivered a body or a UI.
 */
function deliveredSomething(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some(block => {
    if (typeof block !== 'object' || block === null) return false
    const record = block as { type?: unknown; text?: unknown; name?: unknown }
    if (record.type === 'text') return typeof record.text === 'string' && record.text.trim() !== ''
    if (record.type === 'tool-call') return record.name === DELIVERY_TOOL
    return false
  })
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

/** Identify this plugin's source across current and migrated session shapes. */
function isFeedbackSource(source: { kind?: unknown; plugin?: unknown } | undefined): boolean {
  return source?.kind === FEEDBACK_SOURCE_KIND
    || (source?.kind === 'plugin' && source.plugin === FEEDBACK_PLUGIN_NAME)
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
      state = {
        text: '',
        validatedThisTurn: false,
        deliveredThisTurn: false,
        correctedSpec: new Set(),
        deliveryRemindedTurns: new Set(),
        correctionsThisTurn: 0,
        correctionsTurn: undefined,
      }
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
      const content = (event.data as { message?: { content?: unknown } }).message?.content
      const text = textOfContent(content)
      const state = stateOf(sessionId)
      // Fences are read from the BODY only: a draft in the reasoning block is not
      // a delivery and must not become one.
      state.text = extractDshUiFences(text).length > 0 ? text : ''
      // Delivery is sticky for the turn: once a body or a render_ui card exists,
      // the turn has answered and must never be corrected into publishing again.
      state.deliveredThisTurn = state.deliveredThisTurn || deliveredSomething(content)
      return
    }
    if (event.type === 'tool/call') {
      // validate_dsh_ui is the FORMAL signal that this turn is GenUI-related.
      const name = (event.data as { name?: unknown }).name
      if (name === 'validate_dsh_ui') stateOf(sessionId).validatedThisTurn = true
      return
    }
    if (event.type !== 'user/message') return
    const data = event.data as { content?: unknown; source?: { kind?: unknown; plugin?: unknown } }
    if (isFeedbackSource(data.source)) {
      // Our own correction (re-observed after a plugin reload): adopt its
      // render-failure fingerprints so a second boundary cannot repeat it.
      const fingerprints = markersIn(textOfContent(data.content))
      if (fingerprints.length === 0) return
      const state = stateOf(sessionId)
      for (const fingerprint of fingerprints) state.correctedSpec.add(fingerprint)
      return
    }
    // A genuine user prompt starts a new turn: the previous reply is settled.
    const state = sessions.get(sessionId)
    if (state !== undefined) {
      state.text = ''
      state.validatedThisTurn = false
      state.deliveredThisTurn = false
    }
  })

  ctx.on('agent/turn-stopping', ({ agent, turn, signal }): void => {
    // A child session's fence belongs to a parent reply, and an aborted turn is
    // on its way out: never steer into either.
    if (agent.session.header.parentSession !== undefined) return
    const state = sessions.get(String(agent.session.id))
    if (state === undefined) return
    const usedThisTurn = state.correctionsTurn === turn ? state.correctionsThisTurn : 0
    const plan = planFenceFeedback({
      text: state.text,
      turn,
      correctedSpec: state.correctedSpec,
      deliveryRemindedTurns: state.deliveryRemindedTurns,
      validatedThisTurn: state.validatedThisTurn,
      deliveredThisTurn: state.deliveredThisTurn,
      aborted: signal.aborted,
      correctionsThisTurn: usedThisTurn,
      correctionsTurn: state.correctionsTurn,
    })
    if (plan === null) return
    // Account BEFORE sending: a re-entrant boundary must not deliver twice.
    for (const fingerprint of plan.fingerprints) state.correctedSpec.add(fingerprint)
    if (plan.kind === 'delivery') state.deliveryRemindedTurns.add(plan.turn)
    state.correctionsTurn = plan.turn
    state.correctionsThisTurn = usedThisTurn + 1
    try {
      agent.steer(createFeedbackMessage(plan.text, agent.session.header.version))
    } catch (error) {
      ctx.logger?.warn?.(`dsh-genui: fence feedback steering failed (${error instanceof Error ? error.message : String(error)})`)
    }
  })
}
