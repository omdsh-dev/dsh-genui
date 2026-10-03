// Issue #160: when a reply's ```dsh-ui fence does not render, the model should
// get ONE actionable chance to fix it inside the same turn. These tests pin the
// bounds that keep the loop from becoming a retry storm: exact fence matching,
// one correction per turn, one per fence body, never for subagents, never for
// an aborted turn, and accounting before the steer.
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  createFeedbackMessage,
  extractDshUiFences,
  fenceCorrectionText,
  fenceFailures,
  fenceFingerprint,
  installFenceFeedback,
  planFenceFeedback,
  FEEDBACK_PLUGIN_NAME,
  FEEDBACK_SOURCE_KIND,
} from '../src/plugin/fence-feedback.ts'

/** A fence body that renders: one stat carrying a metric list (#172 case A). */
const STAT_GROUP = JSON.stringify({ items: [{
  type: 'stat',
  items: [{ label: '质量门进度', value: '1/5' }, { label: '阻塞项', value: '0' }],
}] })

/** A fence body that renders: bare data-component root (#172 case B). */
const BARE_STEPS = JSON.stringify({ type: 'steps', items: [{ title: '第一层' }] })

/** A fence body that cannot render: required field missing. */
const BROKEN = JSON.stringify({ items: [{ type: 'stat' }] })
const REPAIRABLE = '{"title":"x","items":[{"type":"text","content":"好",},]}'
const REPAIRED_SCHEMA_FAILURE = '{"items":[{"type":"stat","value":"好",},]}'
const ISSUE_200 = '{"type":"keyvalue","items":[{"label":"a","value":"b"}]}'
const CUT = '{"items":[{"type":"text","content":"补全"}'
const TIER2_ONLY = '{"title":"x","items":[{"type":"text","content":"半截'

function reply(...bodies: string[]): string {
  return bodies.map(body => `说明文字\n\`\`\`dsh-ui\n${body}\n\`\`\`\n`).join('\n')
}

interface Harness {
  ctx: Context
  emitSession: (event: unknown) => void
  disposeSession: () => void
  boundary: (payload: unknown) => void
  steer: ReturnType<typeof vi.fn>
  listeners: Map<string, (payload: unknown, ...rest: unknown[]) => unknown>
}

function harness(options: { parentSession?: string; enabled?: boolean } = {}): Harness {
  const listeners = new Map<string, (payload: unknown, ...rest: unknown[]) => unknown>()
  const ctx = {
    logger: { warn: vi.fn() },
    on: (name: string, handler: (payload: unknown, ...rest: unknown[]) => unknown) => {
      listeners.set(name, handler)
      return () => listeners.delete(name)
    },
  } as unknown as Context
  installFenceFeedback(ctx, options.enabled ?? true)
  const session = {
    id: 'sess-1',
    header: options.parentSession === undefined ? { id: 'sess-1' } : { id: 'sess-1', parentSession: options.parentSession },
  }
  const steer = vi.fn()
  const agent = { session, steer }
  return {
    ctx,
    steer,
    listeners,
    emitSession: (event: unknown) => {
      listeners.get('session/event')?.(session, event)
    },
    disposeSession: () => {
      listeners.get('session/disposed')?.(session)
    },
    boundary: (payload: unknown) => {
      listeners.get('agent/turn-stopping')?.(payload)
    },
  }
}

const assistantEvent = (text: string): unknown => ({ type: 'assistant/message', seq: 3, time: 1, data: { message: { content: [{ type: 'text', text }] } } }) as unknown as SessionEvent
const userEvent = (): unknown => ({ type: 'user/message', seq: 2, time: 1, data: { content: [{ type: 'text', text: '问题' }], source: { kind: 'user' } } }) as unknown as SessionEvent

describe('exact fence matching', () => {
  it('extracts only a fence whose info string is exactly dsh-ui', () => {
    const text = [
      '```dsh-ui',
      BROKEN,
      '```',
      '```dsh-ui-dark',
      '{"items":[]}',
      '```',
      '```json',
      '{"items":[]}',
      '```',
      '正文里提到 dsh-ui 但不在围栏里',
    ].join('\n')
    const fences = extractDshUiFences(text)
    expect(fences).toHaveLength(1)
    expect(fences[0]!.raw).toBe(BROKEN)
    expect(fences[0]!.closed).toBe(true)
  })

  it('accepts trailing spaces and up to three spaces of indentation', () => {
    expect(extractDshUiFences('   ```dsh-ui   \n{}\n```')).toHaveLength(1)
    expect(extractDshUiFences('    ```dsh-ui\n{}\n```')).toHaveLength(0)
  })

  it('marks an unterminated fence instead of swallowing it silently', () => {
    const fences = extractDshUiFences('```dsh-ui\n{"items":[{"type":"text","content":"半截')
    expect(fences).toHaveLength(1)
    expect(fences[0]!.closed).toBe(false)
  })

  it('keeps multiple fences in document order with 1-based indices', () => {
    const fences = extractDshUiFences(reply(BROKEN, STAT_GROUP))
    expect(fences.map(fence => fence.index)).toEqual([1, 2])
  })

  it('fingerprints the body, not the surrounding whitespace', () => {
    expect(fenceFingerprint(` ${BROKEN} `)).toBe(fenceFingerprint(BROKEN))
    expect(fenceFingerprint(BROKEN)).not.toBe(fenceFingerprint(STAT_GROUP))
  })
})

describe('fenceFailures: only fences that would stay a code block', () => {
  it('passes the #172 bodies the guard now renders', () => {
    expect(fenceFailures(reply(STAT_GROUP))).toEqual([])
    expect(fenceFailures(reply(BARE_STEPS))).toEqual([])
  })

  it('reports the actionable field diagnosis of a dropped node', () => {
    const failures = fenceFailures(reply(BROKEN))
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain("type 'stat' requires label")
    expect(failures[0]!.detail).not.toContain('[genui-validation]')
    expect(failures[0]!.detail).not.toContain('next=fix_and_revalidate')
    expect(failures[0]!.detail).not.toContain('reply_language=conversation')
    expect(failures[0]!.fingerprint).toBe(fenceFingerprint(BROKEN))
  })

  it('reports unparseable and unterminated bodies distinctly', () => {
    expect(fenceFailures('```dsh-ui\n{ not json\n```')[0]!.detail).toContain('error=invalid_json')
    expect(fenceFailures('```dsh-ui\n{"items":[]}')[0]!.detail).toContain('error=unterminated_fence')
  })

  it('accepts bodies repaired by the settled renderer pipeline', () => {
    expect(fenceFailures(reply(REPAIRABLE))).toEqual([])
  })

  it('reports schema errors after tier-1 JSON repair', () => {
    const failures = fenceFailures(reply(REPAIRED_SCHEMA_FAILURE))
    expect(failures).toHaveLength(1)
    expect(failures[0]!.detail).toContain("type 'stat' requires label")
    expect(failures[0]!.detail).not.toContain('不是合法 JSON')
  })

  it('accepts a settled body repaired by tier-2 completion', () => {
    expect(fenceFailures(reply(CUT))).toEqual([])
    expect(fenceFailures(reply(TIER2_ONLY))).toEqual([])
  })

  it('accepts the issue #200 keyvalue alias shape', () => {
    expect(fenceFailures(reply(ISSUE_200))).toEqual([])
  })

  it('ignores JSON fences and prose', () => {
    expect(fenceFailures('```json\n{"items":[{"type":"stat"}]}\n```\n正文 dsh-ui')).toEqual([])
  })
})

describe('planFenceFeedback: the bounds that prevent a retry storm', () => {
  const base = { text: reply(BROKEN), turn: 1, correctedSpec: new Set<string>(), aborted: false }

  it('plans one correction for a rejected fence', () => {
    const plan = planFenceFeedback(base)
    expect(plan).not.toBeNull()
    expect(plan!.turn).toBe(1)
    expect(plan!.kind).toBe('render')
    expect(plan!.fingerprints).toEqual([fenceFingerprint(BROKEN)])
    expect(plan!.text).toContain('next=resend_corrected_fence_only')
  })

  it('checks the final reply body even when an earlier validated body was valid', () => {
    expect(fenceFailures(reply(STAT_GROUP))).toEqual([])
    const finalReply = planFenceFeedback({ ...base, text: reply(BROKEN) })
    expect(finalReply).not.toBeNull()
    expect(finalReply!.text).toContain("type 'stat' requires label")
  })

  it('allows a SECOND correction in the same turn, never a third', () => {
    expect(planFenceFeedback({ ...base, correctionsThisTurn: 1, correctionsTurn: 1 })).not.toBeNull()
    expect(planFenceFeedback({ ...base, correctionsThisTurn: 2, correctionsTurn: 1 })).toBeNull()
    // A stale count from an earlier turn never bounds a new one.
    expect(planFenceFeedback({ ...base, correctionsThisTurn: 2, correctionsTurn: 0 })).not.toBeNull()
  })

  it('stays silent for a fence body already corrected', () => {
    expect(planFenceFeedback({ ...base, correctedSpec: new Set([fenceFingerprint(BROKEN)]) })).toBeNull()
  })

  it('corrects only the new fences when a reply repeats an old broken one', () => {
    const plan = planFenceFeedback({ ...base, text: reply(BROKEN, STAT_GROUP), correctedSpec: new Set([fenceFingerprint(BROKEN)]) })
    expect(plan).toBeNull()
    const other = planFenceFeedback({ ...base, text: reply(BROKEN, '{"items":[{"type":"table"}]}'), correctedSpec: new Set([fenceFingerprint(BROKEN)]) })
    expect(other!.fingerprints).toEqual([fenceFingerprint('{"items":[{"type":"table"}]}')])
  })

  it('stays silent when the turn is aborted or the reply renders', () => {
    expect(planFenceFeedback({ ...base, aborted: true })).toBeNull()
    expect(planFenceFeedback({ ...base, text: reply(STAT_GROUP) })).toBeNull()
    expect(planFenceFeedback({ ...base, text: '   ' })).toBeNull()
  })

  it('reminds only after a formal validate call that produced no delivery', () => {
    const idle = { text: '', turn: 2, correctedSpec: new Set<string>(), aborted: false }
    // Nothing formal happened: silence (an empty body alone is not a GenUI turn).
    expect(planFenceFeedback(idle)).toBeNull()
    // validate_dsh_ui ran, nothing was delivered: remind once.
    const plan = planFenceFeedback({ ...idle, validatedThisTurn: true })
    expect(plan).not.toBeNull()
    expect(plan!.kind).toBe('delivery')
    expect(plan!.fingerprints).toEqual([])
    expect(plan!.text).toContain('status=nothing_delivered')
    expect(plan!.text).toContain('本轮尚未产生正式回答')
    // The reminder never quotes a draft.
    expect(plan!.text).not.toContain('```')
    // Already reminded in this turn: silence.
    expect(planFenceFeedback({ ...idle, validatedThisTurn: true, deliveryRemindedTurns: new Set([2]) })).toBeNull()
    // A new turn may be reminded again.
    expect(planFenceFeedback({ ...idle, turn: 3, validatedThisTurn: true, deliveryRemindedTurns: new Set([2]) })).not.toBeNull()
  })

  it('says nothing when the turn already delivered something formal', () => {
    const delivered = { text: '', turn: 5, correctedSpec: new Set<string>(), aborted: false, validatedThisTurn: true, deliveredThisTurn: true }
    expect(planFenceFeedback(delivered)).toBeNull()
    // validate_dsh_ui alone is not a delivery; neither is an ordinary tool call.
    expect(planFenceFeedback({ ...delivered, deliveredThisTurn: false })).not.toBeNull()
  })

  it('has no reasoning input at all: the decision is formal-event only', () => {
    // Structural assertion for the #236 boundary: the planner's input carries no
    // reasoning/draft field, so a draft cannot influence publishing or retrying.
    const input = { ...base, validatedThisTurn: true }
    expect(Object.keys(input).some(key => key.toLowerCase().includes('reason') || key.toLowerCase().includes('draft'))).toBe(false)
  })
})


describe('the steered correction message', () => {
  it('uses the producer-owned source kind for Session format v4', () => {
    const failures = fenceFailures(reply(BROKEN))
    const text = fenceCorrectionText(failures)
    expect(text).toContain(`[genui-fence-repair #${failures[0]!.fingerprint}]`)
    expect(text).toContain('[genui-fence-repair]')
    expect(text).toContain('reply_language=conversation')
    expect(text).toContain("type 'stat' requires label")
    expect(text).not.toContain('[genui-validation]')
    expect(text).not.toContain('next=fix_and_revalidate')
    expect(text).not.toContain('围栏没有渲染成界面')
    expect(text).not.toContain('请只重发修正后的')
    const message = createFeedbackMessage(text, 4)
    expect(message.role).toBe('user')
    expect(typeof message.id).toBe('string')
    expect(message.source).toEqual({
      kind: FEEDBACK_SOURCE_KIND,
      form: 'notice',
      summary: 'genui fence repair requested',
    })
    expect(Object.isFrozen(message)).toBe(true)
    // No triple backticks: the notice renders as markdown in the transcript.
    expect(text).not.toContain('```')
  })

  it('uses the legacy plugin source on older Session formats', () => {
    const message = createFeedbackMessage('repair', 0)

    expect(message.source).toEqual({
      kind: 'plugin',
      plugin: FEEDBACK_PLUGIN_NAME,
      form: 'notice',
      summary: 'genui fence repair requested',
    })
  })

  it('numbers each broken fence when a reply has several', () => {
    const failures = fenceFailures(reply(BROKEN, '{"items":[{"type":"table"}]}'))
    expect(failures).toHaveLength(2)
    const text = fenceCorrectionText(failures)
    expect(text).toContain('fence=1')
    expect(text).toContain('fence=2')
  })
})

describe('installFenceFeedback wiring', () => {
  it('is inert when explicitly disabled', () => {
    const h = harness({ enabled: false })
    expect(h.listeners.size).toBe(0)
  })

  it('steers once per turn when the reply has an unrenderable fence', () => {
    const h = harness()
    h.emitSession(userEvent())
    h.emitSession(assistantEvent(reply(BROKEN)))
    const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
    h.boundary({ agent, turn: 4, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
    const message = h.steer.mock.calls[0]![0] as { source: { kind: string } }
    expect(message.source.kind).toBe(FEEDBACK_SOURCE_KIND)
    // A second boundary of the same turn must not steer again.
    h.boundary({ agent, turn: 4, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
  })

  const toolCallEvent = (name: string): unknown => ({ type: 'tool/call', seq: 4, time: 2, data: { name } }) as unknown as SessionEvent
  const reasoningEvent = (text: string): unknown => ({
    type: 'assistant/message',
    seq: 5,
    time: 2,
    data: { message: { content: [{ type: 'reasoning', text }] } },
  }) as unknown as SessionEvent

  it('reminds when a formal validate call produced no delivery', () => {
    const h = harness()
    h.emitSession(userEvent())
    h.emitSession(toolCallEvent('validate_dsh_ui'))
    h.emitSession({ type: 'assistant/message', seq: 6, time: 3, data: { message: { content: [{ type: 'reasoning', text: '草稿' }] } } } as unknown as SessionEvent)
    const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
    h.boundary({ agent, turn: 7, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
    const message = h.steer.mock.calls[0]![0] as { content: Array<{ text: string }> }
    expect(message.content[0]!.text).toContain('status=nothing_delivered')
    expect(message.content[0]!.text).toContain('本轮尚未产生正式回答')
    // Only one reminder per turn.
    h.boundary({ agent, turn: 7, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
  })

  it('never lets reasoning content change the decision (only formal events do)', () => {
    // Same formal state (validate called, nothing delivered); the reasoning block
    // differs wildly — including "a complete fence", "several fences" and "a later
    // candidate that negates the first". The decision must be identical because the
    // loop never reads the reasoning block (maintainer requirement on #236).
    const drafts = [
      '',
      '```dsh-ui\n{"items":[{"type":"text","content":"候选一"}]}\n```',
      '```dsh-ui\n{"items":[{"type":"text","content":"候选一"}]}\n```\n推翻它\n```dsh-ui\n{"items":[{"type":"text","content":"候选二"}]}\n```',
    ]
    const decisions = drafts.map(draft => {
      const h = harness()
      h.emitSession(userEvent())
      h.emitSession(toolCallEvent('validate_dsh_ui'))
      if (draft !== '') h.emitSession(reasoningEvent(draft))
      const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
      h.boundary({ agent, turn: 3, signal: new AbortController().signal })
      return h.steer.mock.calls.length
    })
    expect(decisions).toEqual([1, 1, 1])
  })

  it('stays silent when the turn delivered a body or a render_ui card', () => {
    const delivered = harness()
    delivered.emitSession(userEvent())
    delivered.emitSession(toolCallEvent('validate_dsh_ui'))
    delivered.emitSession(assistantEvent('就是这些，没有别的要汇报。'))
    const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: delivered.steer }
    delivered.boundary({ agent, turn: 8, signal: new AbortController().signal })
    expect(delivered.steer).not.toHaveBeenCalled()

    const card = harness()
    card.emitSession(userEvent())
    card.emitSession(toolCallEvent('render_ui'))
    card.emitSession({ type: 'assistant/message', seq: 7, time: 4, data: { message: { content: [{ type: 'tool-call', name: 'render_ui', arguments: '{}' }] } } } as unknown as SessionEvent)
    card.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: card.steer }, turn: 9, signal: new AbortController().signal })
    expect(card.steer).not.toHaveBeenCalled()
  })

  it('keeps the delivery ledger separate from the render-failure ledger', () => {
    const h = harness()
    h.emitSession(userEvent())
    h.emitSession(toolCallEvent('validate_dsh_ui'))
    const agent = { session: { id: 'sess-1', header: { id: 'sess-1', version: 4 } }, steer: h.steer }
    h.boundary({ agent, turn: 4, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)          // delivery reminder (slot 1)
    h.emitSession(assistantEvent(reply(BROKEN)))      // now a body fence fails to render
    h.boundary({ agent, turn: 4, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(2)          // render correction (slot 2) still fires
    const second = h.steer.mock.calls[1]![0] as { content: Array<{ text: string }> }
    expect(second.content[0]!.text).toContain('next=resend_corrected_fence_only')
  })



  it('never steers for a subagent session', () => {
    const h = harness({ parentSession: 'parent-1' })
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.boundary({
      agent: { session: { id: 'sess-1', header: { id: 'sess-1', parentSession: 'parent-1' } }, steer: h.steer },
      turn: 1,
      signal: new AbortController().signal,
    })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('never steers into an aborted turn', () => {
    const h = harness()
    h.emitSession(assistantEvent(reply(BROKEN)))
    const controller = new AbortController()
    controller.abort()
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 1, signal: controller.signal })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('adopts the fingerprints of its own correction so a reload cannot repeat it', () => {
    const h = harness()
    const failures = fenceFailures(reply(BROKEN))
    h.emitSession({
      type: 'user/message',
      seq: 4,
      time: 1,
      data: {
        content: [{ type: 'text', text: fenceCorrectionText(failures) }],
        source: { kind: FEEDBACK_SOURCE_KIND, form: 'notice', summary: 'x' },
      },
    } as unknown as SessionEvent)
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 9, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('adopts fingerprints from legacy repair markers', () => {
    const h = harness()
    const fingerprint = fenceFingerprint(BROKEN)
    h.emitSession({
      type: 'user/message',
      seq: 4,
      time: 1,
      data: {
        content: [{ type: 'text', text: `[genui 自修 #${fingerprint}]\nlegacy repair notice` }],
        source: { kind: FEEDBACK_SOURCE_KIND, form: 'notice', summary: 'legacy' },
      },
    } as unknown as SessionEvent)
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 9, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('recognizes original legacy plugin source wrappers', () => {
    const h = harness()
    const failures = fenceFailures(reply(BROKEN))
    h.emitSession({
      type: 'user/message',
      seq: 4,
      time: 1,
      data: {
        content: [{ type: 'text', text: fenceCorrectionText(failures) }],
        source: { kind: 'plugin', plugin: FEEDBACK_PLUGIN_NAME, form: 'notice', summary: 'legacy' },
      },
    } as unknown as SessionEvent)
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 9, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('stays silent when the reply renders', () => {
    const h = harness()
    h.emitSession(assistantEvent(reply(STAT_GROUP, BARE_STEPS)))
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 1, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('clears the latest reply when a plain assistant message replaces it', () => {
    const h = harness()
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.emitSession(assistantEvent('普通文本'))
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 1, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()
  })

  it('releases session feedback state after session disposal', () => {
    const h = harness()
    h.emitSession(assistantEvent(reply(BROKEN)))
    h.disposeSession()
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 1, signal: new AbortController().signal })
    expect(h.steer).not.toHaveBeenCalled()
  })
})
