// Issue #186: one defective node must no longer degrade the WHOLE fence to a
// raw code block. The strict gate (isRenderableProcess) keeps its exact
// semantics — validate_dsh_ui and render_ui still refuse and diagnose — while
// the FENCE channel gains one bounded retry that drops the erroring nodes and
// renders whatever survives cleanly.
import { describe, expect, it } from 'vitest'
import { isRenderableProcess, partialRepairGenuiSpec, processGenuiSpec } from '../src/client/guard.ts'
import { resolveGenuiSpec } from '../src/client/fence-render.tsx'

/** The render decision the fence channels make (parse → strict → partial). */
function fenceSpec(raw: string): ReturnType<typeof resolveGenuiSpec> {
  return resolveGenuiSpec(raw)
}

describe('partial fence rendering (issue #186)', () => {
  it('keeps the strict gate strict for diagnostics and tools', () => {
    const raw = '{"items":[{"type":"stat","label":42,"value":"1/5"},{"type":"callout","content":"说明"}]}'
    const processed = processGenuiSpec(JSON.parse(raw))
    expect(isRenderableProcess(processed)).toBe(false)
    expect(processed.errors.join('\n')).toContain('stat')
  })

  it('drops one bad node and renders the surviving siblings', () => {
    const raw = '{"title":"进度","items":[{"type":"stat","label":42,"value":"1/5"},{"type":"callout","content":"说明"}]}'
    const spec = fenceSpec(raw)
    expect(spec).not.toBeNull()
    expect(spec!.items).toEqual([{ type: 'callout', content: '说明' }])
  })

  it('drops an undrawable chart instead of repairing it into a blank canvas', () => {
    const raw = '{"items":[{"type":"chart","kind":"line","data":[]},{"type":"text","content":"结论"}]}'
    const processed = processGenuiSpec(JSON.parse(raw))
    expect(isRenderableProcess(processed)).toBe(false)
    const spec = fenceSpec(raw)
    expect(spec).not.toBeNull()
    expect(spec!.items).toEqual([{ type: 'text', content: '结论' }])
  })

  it('prunes a bad nested node and keeps its container siblings', () => {
    const raw = '{"items":[{"type":"col","items":[{"type":"stat","label":"a","value":"1"},{"type":"progress","value":200}]},{"type":"text","content":"尾注"}]}'
    const spec = fenceSpec(raw)
    expect(spec).not.toBeNull()
    expect(spec!.items).toEqual([
      { type: 'col', items: [{ type: 'stat', label: 'a', value: '1' }] },
      { type: 'text', content: '尾注' },
    ])
  })

  it('still degrades when every node fails or the retry is not clean', () => {
    // All nodes bad: nothing would survive the prune.
    expect(fenceSpec('{"items":[{"type":"progress","value":200},{"type":"stat","label":1,"value":2}]}')).toBeNull()
    // A single-node fence has no siblings to keep.
    expect(fenceSpec('{"items":[{"type":"progress","value":200}]}')).toBeNull()
    // A bare component root keeps its wrap-relative paths out of reach.
    expect(fenceSpec('{"type":"steps","items":[{"desc":"no title"}]}')).toBeNull()
  })

  it('passes a clean spec through untouched', () => {
    const raw = '{"items":[{"type":"text","content":"好"}]}'
    expect(partialRepairGenuiSpec(processGenuiSpec(JSON.parse(raw)))).toEqual(fenceSpec(raw))
  })
})

describe('partial fence pruning with multiple bad siblings (issue #190)', () => {
  it('drops two bad siblings and renders the good tail node', () => {
    const raw = '{"items":[{"type":"stat","label":42,"value":"1/5"},{"type":"stat","label":43,"value":"2/5"},{"type":"callout","content":"kept"}]}'
    const spec = fenceSpec(raw)
    expect(spec).not.toBeNull()
    expect(spec!.items).toEqual([{ type: 'callout', content: 'kept' }])
  })

  it('drops two bad tail siblings when the good node comes first', () => {
    const raw = '{"items":[{"type":"callout","content":"kept"},{"type":"stat","label":42,"value":"1/5"},{"type":"stat","label":43,"value":"2/5"}]}'
    const spec = fenceSpec(raw)
    expect(spec).not.toBeNull()
    expect(spec!.items).toEqual([{ type: 'callout', content: 'kept' }])
  })

  it('drops two bad nested siblings under one container without touching the container', () => {
    const raw = '{"items":[{"type":"col","items":[{"type":"stat","label":"a","value":"1"},{"type":"progress","value":200},{"type":"progress","value":300}]},{"type":"text","content":"tail"}]}'
    const spec = fenceSpec(raw)
    expect(spec).not.toBeNull()
    expect(spec!.items).toEqual([
      { type: 'col', items: [{ type: 'stat', label: 'a', value: '1' }] },
      { type: 'text', content: 'tail' },
    ])
  })
})
