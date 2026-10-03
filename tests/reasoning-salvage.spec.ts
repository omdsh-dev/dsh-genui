// @vitest-environment jsdom
// Reasoning salvage (从思考块抢救界面): the model sometimes composes a complete
// `dsh-ui` fence inside its reasoning block and ends the turn with an EMPTY
// body. `fence-feedback` retries the same turn twice, but a degenerate context
// can answer both retries with a byte-identical replay (real session: notices
// DID reach the model — inputTokens 189 → 1016 → 944 — output stayed 802
// reasoning tokens with zero text, md5 unchanged all three times).
//
// The client fallback reads the fence from the ChatSnapshot's reasoning blocks
// and mounts the same spec back INTO THE MESSAGE LIST (inline, right where the
// answer should have been); the session panel is only the fallback when the
// host row cannot be found. These tests pin the decision and the placement.
import { afterEach, describe, expect, it } from 'vitest'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import { mountSalvage, planReasoningSalvage, salvageRowFor } from '../src/client/reasoning-salvage.tsx'
import { sourceFencesOfReasoning } from '../src/client/source-fence.ts'

/** A fence body that renders (one stat carrying a metric list). */
const GOOD = JSON.stringify({ title: '两张落库卡完成', items: [{
  type: 'keyvalue',
  pairs: [{ key: '采集→博文', value: '已接通' }],
}] })

/** A fence body that cannot render (required field missing). */
const BROKEN = JSON.stringify({ items: [{ type: 'stat' }] })

const text = (body: string): AssistantBlock => ({ kind: 'text', text: `说明\n\`\`\`dsh-ui\n${body}\n\`\`\`\n` } as AssistantBlock)
const reasoning = (body: string): AssistantBlock => ({ kind: 'reasoning', text: `  \`\`\`dsh-ui\n${body}\n\`\`\`   ` } as AssistantBlock)

const base = { status: 'settled' as const, alreadySalvaged: false }

describe('sourceFencesOfReasoning', () => {
  it('reads code fences out of reasoning blocks only', () => {
    const fences = sourceFencesOfReasoning([text(GOOD), reasoning(GOOD), { kind: 'tool-call' } as unknown as AssistantBlock])
    expect(fences).toHaveLength(1)
    expect(fences[0]!.lang).toBe('dsh-ui')
  })
})

describe('planReasoningSalvage', () => {
  it('salvages the fence the model left in its thinking block', () => {
    const plan = planReasoningSalvage({ ...base, blocks: [reasoning(GOOD)] })
    expect(plan).not.toBeNull()
    expect(plan!.title).toBe('两张落库卡完成')
    // The published spec carries its provenance first, then the salvaged nodes.
    expect(plan!.spec.items[0]!.type).toBe('callout')
    expect(plan!.spec.items).toHaveLength(2)
  })

  it('stays out of the way when the body already rendered a fence', () => {
    expect(planReasoningSalvage({ ...base, blocks: [text(GOOD), reasoning(GOOD)] })).toBeNull()
  })

  it('ignores a body fence that cannot render, but salvages a good reasoning fence', () => {
    const plan = planReasoningSalvage({ ...base, blocks: [text(BROKEN), reasoning(GOOD)] })
    expect(plan).not.toBeNull()
  })

  it('never treats an unrenderable reasoning fence as salvageable', () => {
    expect(planReasoningSalvage({ ...base, blocks: [reasoning(BROKEN)] })).toBeNull()
    expect(planReasoningSalvage({ ...base, blocks: [] })).toBeNull()
  })

  it('waits for the step to settle', () => {
    expect(planReasoningSalvage({ ...base, status: 'running', blocks: [reasoning(GOOD)] })).toBeNull()
    expect(planReasoningSalvage({ ...base, status: 'interrupted', blocks: [reasoning(GOOD)] })).not.toBeNull()
    expect(planReasoningSalvage({ ...base, status: undefined, blocks: [reasoning(GOOD)] })).toBeNull()
  })

  it('still salvages when the panel already has content (inline is not the panel)', () => {
    // Regression: the old gate treated "panel taken" as "do not salvage at all",
    // so a single earlier panel publication disabled every later inline recovery
    // in the session. Panel occupancy may only stop the PANEL FALLBACK.
    expect(planReasoningSalvage({ ...base, blocks: [reasoning(GOOD)] })).not.toBeNull()
    expect(planReasoningSalvage({ ...base, alreadySalvaged: true, blocks: [reasoning(GOOD)] })).toBeNull()
  })

  it('prefers the LAST renderable reasoning fence', () => {
    const older = JSON.stringify({ title: '旧的一份', items: [{ type: 'text', content: 'old' }] })
    const plan = planReasoningSalvage({ ...base, blocks: [reasoning(older), reasoning(GOOD)] })
    expect(plan!.title).toBe('两张落库卡完成')
  })
})

describe('inline placement (内联优先，找不到行才退回面板)', () => {
  /** host assistant row fixture: data-chat-node-key carries the context key. */
  function row(key: string, part?: string): HTMLElement {
    const el = document.createElement('div')
    el.setAttribute('data-chat-flow-kind', 'assistant-step')
    el.setAttribute('data-chat-node-key', key)
    if (part !== undefined) el.setAttribute('data-chat-group-part', part)
    const inner = document.createElement('div')
    inner.textContent = 'body'
    el.append(inner)
    document.body.append(el)
    return el
  }

  afterEach(() => { document.body.innerHTML = '' })

  it('prefers the body row and falls back to the reasoning row', () => {
    const key = '14:assistant-step9:0'
    const reasoning = row(key, 'reasoning')
    expect(salvageRowFor(key)?.dataset.chatGroupPart).toBe('reasoning')
    const body = row(key)
    expect(salvageRowFor(key)).toBe(body)
    expect(salvageRowFor('nope')).toBeNull()
    reasoning.remove()
    expect(salvageRowFor(key)).toBe(body)
  })

  it('mounts the salvage right after the row and cleans up on dispose', () => {
    const key = '14:assistant-step9:0'
    const target = row(key)
    const classes: string[] = []
    let disposed = false
    const mount = mountSalvage(target, { items: [{ type: 'text', content: 'x' }] } as never, (container) => {
      classes.push(container.className)
      return () => { disposed = true }
    })
    expect(mount.container.previousElementSibling).toBe(target)
    expect(mount.container.getAttribute('data-genui-salvage')).toBe('')
    expect(classes[0]).toContain('genui-reasoning-salvage')
    mount.dispose()
    expect(disposed).toBe(true)
    expect(mount.container.isConnected).toBe(false)
  })
})
