// Panel incremental append: mergePanelSpecs rules (tab-label merge / tail
// append) and the settled-fence append behavior (complete bodies merge once,
// incomplete/partial bodies never merge, non-append replaces).
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderGenuiFence } from '../src/client/fence-render.tsx'
import { applyPanelOperation, clearSessionPanel, getPanelSpec, mergePanelSpecs } from '../src/client/panel-store.ts'
import { evaluateComputed } from '../src/client/computed.ts'
import { GENUI_LIMITS } from '../src/client/genui-runtime/index.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

afterEach(() => {
  cleanup()
  clearSessionPanel('p1')
  // panel persistence writes localStorage — wipe it so a reused session id
  // never hydrates stale storage from an earlier test.
  localStorage.clear()
})

const text = (content: string) => ({ type: 'text', content })

const tabsSpec = (tabs: Array<{ label: string; items: unknown[] }>) => ({
  title: 'T',
  items: [{ type: 'tabs', tabs }],
})

/** Host-style settled fence context: message seq + block/fence indices. */
const ctx = (seq: number, block = 0, fence = 0) => ({
  sessionId: 'p1',
  source: { id: JSON.stringify(['assistant', seq, block, fence]), order: [seq, block, fence] as const },
})

describe('mergePanelSpecs', () => {
  it('keeps appended computations and dependencies on earlier panel fields', () => {
    const prev: GenuiSpec = {
      computed: [{ id: 'base', expr: 'amount*2' }],
      items: [{ type: 'input', id: 'amount', inputType: 'number', value: '3' }],
    }
    const next: GenuiSpec = {
      computed: [{ id: 'answer', expr: 'base+1' }],
      items: [{ type: 'text', content: '{{answer}}' }],
    }
    const merged = mergePanelSpecs(prev, next)
    expect(evaluateComputed(merged, {}).values).toEqual({ base: 6, answer: 7 })
    expect(evaluateComputed(mergePanelSpecs({ computed: [{ id: 'base', expr: '6' }], items: [] }, next), {}).values)
      .toEqual({ base: 6, answer: 7 })
  })

  it('keeps duplicate computed IDs visible to the existing graph validation', () => {
    const merged = mergePanelSpecs({ computed: [{ id: 'answer', expr: '1' }], items: [text('seed')] }, {
      computed: [{ id: 'answer', expr: '2' }], items: [text('{{answer}}')],
    })
    expect(evaluateComputed(merged, {}).errors.answer).toContain('计算字段 ID 重复')
    expect(evaluateComputed(merged, {}).values).not.toHaveProperty('answer')
  })

  it('merges tabs by label, appending items to same-labelled tabs', () => {
    const prev = tabsSpec([{ label: 'A', items: [text('a1')] }, { label: 'B', items: [text('b1')] }])
    const next = tabsSpec([{ label: 'B', items: [text('b2')] }, { label: 'C', items: [text('c1')] }])
    const merged = mergePanelSpecs(prev as never, next as never)
    const tabs = (merged.items[0] as { tabs: Array<{ label: string; items: unknown[] }> }).tabs
    expect(tabs.map(t => t.label)).toEqual(['A', 'B', 'C'])
    expect(tabs[0]!.items).toEqual([text('a1')])
    expect(tabs[1]!.items).toEqual([text('b1'), text('b2')])
    expect(tabs[2]!.items).toEqual([text('c1')])
  })

  it('appends plain item lists to the tail', () => {
    const prev = { title: 'P', items: [text('x')] }
    const merged = mergePanelSpecs(prev, { title: 'Q', items: [text('y'), text('z')] })
    expect(merged.title).toBe('P') // previous title wins
    expect(merged.items).toEqual([text('x'), text('y'), text('z')])
  })

  it('returns next as-is when there is no previous panel', () => {
    const next = { title: 'N', items: [text('n')] }
    expect(mergePanelSpecs(null, next)).toBe(next)
  })
})

describe('panel append fence (settled source)', () => {
  it('resolves computed references through the real fence and panel pipeline', () => {
    render(renderGenuiFence(JSON.stringify({
      panel: true,
      computed: [{ id: 'base', expr: 'amount*2' }],
      items: [{ type: 'input', id: 'amount', inputType: 'number', value: '3' }],
    }), 'base', ctx(1)))
    render(renderGenuiFence(JSON.stringify({
      panel: true, append: true,
      computed: [{ id: 'answer', expr: 'base+1' }],
      items: [text('{{answer}}')],
    }), 'append', ctx(2)))
    expect(evaluateComputed(getPanelSpec('p1')!, {}).values).toEqual({ base: 6, answer: 7 })
  })

  it('rejects an append exceeding the shared computed-field budget without truncating the panel', () => {
    const seed: GenuiSpec = {
      computed: Array.from({ length: GENUI_LIMITS.maxComputedFields - 1 }, (_, index) => ({ id: `field${index}`, expr: '1' })),
      items: [text('seed')],
    }
    expect(applyPanelOperation('p1', { sourceId: 'seed', order: [0, 0, 0], mode: 'replace', spec: seed })).toBe('accepted')
    expect(applyPanelOperation('p1', { sourceId: 'fit', order: [1, 0, 0], mode: 'append', spec: {
      computed: [{ id: 'last', expr: '2' }], items: [text('{{last}}')],
    } })).toBe('accepted')
    expect(applyPanelOperation('p1', { sourceId: 'overflow', order: [2, 0, 0], mode: 'append', spec: {
      computed: [{ id: 'excess', expr: '3' }], items: [text('{{excess}}')],
    } })).toBe('overflow')
    expect(getPanelSpec('p1')?.computed).toHaveLength(GENUI_LIMITS.maxComputedFields)
    expect(getPanelSpec('p1')?.items).toHaveLength(2)
    expect(evaluateComputed(getPanelSpec('p1')!, {}).values.last).toBe(2)
  })

  it('merges a complete append fence into the existing panel', () => {
    applyPanelOperation('p1', { sourceId: 'seed', order: [0, -1, 0], mode: 'replace', spec: tabsSpec([{ label: 'A', items: [text('a1')] }]) })
    render(renderGenuiFence(JSON.stringify({ panel: true, append: true, title: 'X', items: [{ type: 'tabs', tabs: [{ label: 'A', items: [text('a2')] }, { label: 'B', items: [text('b1')] }] }] }), 'k1', ctx(1)) as never)
    const spec = getPanelSpec('p1')!
    const tabs = (spec.items[0] as { tabs: Array<{ label: string; items: unknown[] }> }).tabs
    expect(tabs.map(t => t.label)).toEqual(['A', 'B'])
    expect(tabs[0]!.items).toHaveLength(2)
    expect(tabs[1]!.items).toHaveLength(1)
  })

  it('never merges an incomplete append body (streaming partial)', () => {
    applyPanelOperation('p1', { sourceId: 'seed', order: [0, -1, 0], mode: 'replace', spec: tabsSpec([{ label: 'A', items: [text('a1')] }]) })
    // Truncated JSON: parse-partial yields a partial spec, but the append
    // gate (complete JSON) must reject it — no partial merge.
    const partial = JSON.stringify({ panel: true, append: true, items: [{ type: 'tabs', tabs: [{ label: 'B', items: [{ type: 'text', content: 'b' }] }] }] }).slice(0, -5)
    render(renderGenuiFence(partial, 'k2', ctx(1)) as never)
    const spec = getPanelSpec('p1')!
    const tabs = (spec.items[0] as { tabs: Array<{ label: string }> }).tabs
    expect(tabs.map(t => t.label)).toEqual(['A'])
  })

  it('merges a completed append fence exactly once per source (renderer re-invokes)', () => {
    applyPanelOperation('p1', { sourceId: 'seed', order: [0, -1, 0], mode: 'replace', spec: tabsSpec([{ label: 'A', items: [text('a1')] }]) })
    const body = JSON.stringify({ panel: true, append: true, items: [{ type: 'tabs', tabs: [{ label: 'B', items: [text('b1')] }] }] })
    // The same settled fence (same source) is re-invoked on settle/re-render.
    render(renderGenuiFence(body, 'same-key', ctx(1)) as never)
    render(renderGenuiFence(body, 'same-key', ctx(1)) as never)
    render(renderGenuiFence(body, 'same-key', ctx(1)) as never)
    const spec = getPanelSpec('p1')!
    const tabs = (spec.items[0] as { tabs: Array<{ label: string; items: unknown[] }> }).tabs
    expect(tabs.map(t => t.label)).toEqual(['A', 'B'])
    expect(tabs[1]!.items).toHaveLength(1) // merged once, not three times
    // A DIFFERENT source (new message) with new content merges again.
    render(renderGenuiFence(JSON.stringify({ panel: true, append: true, items: [{ type: 'tabs', tabs: [{ label: 'B', items: [text('b2')] }, { label: 'C', items: [text('c1')] }] }] }), 'new-key', ctx(2)) as never)
    const spec2 = getPanelSpec('p1')!
    const tabs2 = (spec2.items[0] as { tabs: Array<{ label: string; items: unknown[] }> }).tabs
    expect(tabs2.map(t => t.label)).toEqual(['A', 'B', 'C'])
    expect(tabs2[1]!.items).toHaveLength(2) // b1 + b2
  })

  it('non-append panel fence still replaces the whole panel', () => {
    applyPanelOperation('p1', { sourceId: 'seed', order: [0, -1, 0], mode: 'replace', spec: tabsSpec([{ label: 'A', items: [text('a1')] }]) })
    render(renderGenuiFence(JSON.stringify({ panel: true, title: 'R', items: [text('fresh')] }), 'k3', ctx(3)) as never)
    const spec = getPanelSpec('p1')!
    expect(spec.title).toBe('R')
    expect(spec.items).toEqual([text('fresh')])
  })
})
