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
const ISSUE_200 = '{"type":"keyvalue","items":[{"label":"a","value":"b"}]}'

function reply(...bodies: string[]): string {
  return bodies.map(body => `说明文字\n\`\`\`dsh-ui\n${body}\n\`\`\`\n`).join('\n')
}

interface Harness {
  ctx: Context
  emitSession: (event: unknown) => void
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
    expect(failures[0]!.fingerprint).toBe(fenceFingerprint(BROKEN))
  })

  it('reports unparseable and unterminated bodies distinctly', () => {
    expect(fenceFailures('```dsh-ui\n{ not json\n```')[0]!.detail).toContain('不是合法 JSON')
    expect(fenceFailures('```dsh-ui\n{"items":[]}')[0]!.detail).toContain('未闭合')
  })

  it('accepts bodies repaired by the settled renderer pipeline', () => {
    expect(fenceFailures(reply(REPAIRABLE))).toEqual([])
  })

  it('accepts the issue #200 keyvalue alias shape', () => {
    expect(fenceFailures(reply(ISSUE_200))).toEqual([])
  })

  it('ignores JSON fences and prose', () => {
    expect(fenceFailures('```json\n{"items":[{"type":"stat"}]}\n```\n正文 dsh-ui')).toEqual([])
  })
})

describe('planFenceFeedback: the bounds that prevent a retry storm', () => {
  const base = { text: reply(BROKEN), turn: 1, lastCorrectedTurn: undefined, corrected: new Set<string>(), aborted: false }

  it('plans one correction for a rejected fence', () => {
    const plan = planFenceFeedback(base)
    expect(plan).not.toBeNull()
    expect(plan!.turn).toBe(1)
    expect(plan!.fingerprints).toEqual([fenceFingerprint(BROKEN)])
    expect(plan!.text).toContain('只重发修正后的 dsh-ui 围栏')
  })

  it('checks the final reply body even when an earlier validated body was valid', () => {
    expect(fenceFailures(reply(STAT_GROUP))).toEqual([])
    const finalReply = planFenceFeedback({ ...base, text: reply(BROKEN) })
    expect(finalReply).not.toBeNull()
    expect(finalReply!.text).toContain("type 'stat' requires label")
  })

  it('stays silent for the same turn (at most one correction per turn)', () => {
    expect(planFenceFeedback({ ...base, lastCorrectedTurn: 1 })).toBeNull()
    expect(planFenceFeedback({ ...base, lastCorrectedTurn: 0 })).not.toBeNull()
  })

  it('stays silent for a fence body already corrected', () => {
    expect(planFenceFeedback({ ...base, corrected: new Set([fenceFingerprint(BROKEN)]) })).toBeNull()
  })

  it('corrects only the new fences when a reply repeats an old broken one', () => {
    const plan = planFenceFeedback({ ...base, text: reply(BROKEN, STAT_GROUP), corrected: new Set([fenceFingerprint(BROKEN)]) })
    expect(plan).toBeNull()
    const other = planFenceFeedback({ ...base, text: reply(BROKEN, '{"items":[{"type":"table"}]}'), corrected: new Set([fenceFingerprint(BROKEN)]) })
    expect(other!.fingerprints).toEqual([fenceFingerprint('{"items":[{"type":"table"}]}')])
  })

  it('stays silent when the turn is aborted or the reply renders', () => {
    expect(planFenceFeedback({ ...base, aborted: true })).toBeNull()
    expect(planFenceFeedback({ ...base, text: reply(STAT_GROUP) })).toBeNull()
    expect(planFenceFeedback({ ...base, text: '   ' })).toBeNull()
  })
})

describe('the steered correction message', () => {
  it('is a plugin-sourced notice with a stable marker and the failure detail', () => {
    const failures = fenceFailures(reply(BROKEN))
    const text = fenceCorrectionText(failures)
    expect(text).toContain(`[genui 自修 #${failures[0]!.fingerprint}]`)
    expect(text).toContain("type 'stat' requires label")
    const message = createFeedbackMessage(text)
    expect(message.role).toBe('user')
    expect(typeof message.id).toBe('string')
    expect(message.source).toMatchObject({ kind: 'plugin', plugin: FEEDBACK_PLUGIN_NAME, form: 'notice' })
    expect(Object.isFrozen(message)).toBe(true)
    // No triple backticks: the notice renders as markdown in the transcript.
    expect(text).not.toContain('```')
  })

  it('numbers each broken fence when a reply has several', () => {
    const failures = fenceFailures(reply(BROKEN, '{"items":[{"type":"table"}]}'))
    expect(failures).toHaveLength(2)
    const text = fenceCorrectionText(failures)
    expect(text).toContain('第 1 个围栏')
    expect(text).toContain('第 2 个围栏')
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
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 4, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
    const message = h.steer.mock.calls[0]![0] as { source: { plugin: string } }
    expect(message.source.plugin).toBe(FEEDBACK_PLUGIN_NAME)
    // A second boundary of the same turn must not steer again.
    h.boundary({ agent: { session: { id: 'sess-1', header: { id: 'sess-1' } }, steer: h.steer }, turn: 4, signal: new AbortController().signal })
    expect(h.steer).toHaveBeenCalledTimes(1)
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
        source: { kind: 'plugin', plugin: FEEDBACK_PLUGIN_NAME, form: 'notice', summary: 'x' },
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
})
