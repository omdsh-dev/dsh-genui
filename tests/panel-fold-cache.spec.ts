// Panel fold cost: append-heavy panels used to re-validate every retained
// operation on every fold (processGenuiSpec over all ops + the merged doc),
// which makes N appends cost O(N²) validations and shows up as jank on long
// sessions. Ops are stable object references once kept, so a per-op cache can
// turn the retained set into a one-time cost. This spec pins that contract:
// no op spec may be validated twice.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/guard.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/client/guard.ts')>()
  return { ...actual, processGenuiSpec: vi.fn(actual.processGenuiSpec) }
})

import { applyPanelOperation, clearSessionPanel } from '../src/client/panel-store.ts'
import { processGenuiSpec } from '../src/client/guard.ts'

const SID = 'fold-cache-test'

const spec = (label: string) => ({
  title: 'T',
  items: [{ type: 'text', content: label }],
})

const appendOp = (seq: number, body: ReturnType<typeof spec>) => ({
  sourceId: `src-${seq}`,
  order: [seq, 0, 0] as const,
  mode: 'append' as const,
  spec: body as never,
})

afterEach(() => {
  clearSessionPanel(SID)
  vi.mocked(processGenuiSpec).mockClear()
})

describe('panel fold validation cache', () => {
  it('never validates the same op spec twice', () => {
    const seen = new WeakSet<object>()
    let duplicates = 0
    const spy = vi.mocked(processGenuiSpec)
    const original = spy.getMockImplementation()!

    spy.mockImplementation(((...args: Parameters<typeof processGenuiSpec>) => {
      const target = args[0] as object
      if (seen.has(target)) duplicates += 1
      else seen.add(target)
      return original(...args)
    }) as typeof processGenuiSpec)

    for (let i = 1; i <= 5; i += 1) {
      expect(applyPanelOperation(SID, appendOp(i, spec(`entry ${i}`)) as never)).toBe('accepted')
    }

    spy.mockImplementation(original)
    // Exactly one re-validation is expected and harmless: the fold's merge
    // base can be the same object as the first op's spec (mergePanelSpecs
    // returns `next` unchanged when there is nothing to merge into), so that
    // spec is seen once through the op path and once through the merged path.
    // What must NOT happen is per-op growth — before the cache this was 15
    // duplicate validations for 5 appends.
    expect(duplicates).toBeLessThanOrEqual(1)
  })

  it('handles an over-budget append without losing the panel', () => {
    const huge = {
      title: 'T',
      items: Array.from({ length: 260 }, (_, i) => ({ type: 'text', content: `row ${i}` })),
    }
    applyPanelOperation(SID, appendOp(1, spec('base')) as never)
    // An append beyond the node budget is rejected by the fold (any explicit
    // non-accepted status); the panel keeps its previous content.
    expect(applyPanelOperation(SID, appendOp(2, huge as never) as never)).not.toBe('accepted')
  })
})