// Issue #186: one defective node must no longer degrade the WHOLE fence to a
// raw code block. The strict gate (isRenderableProcess) keeps its exact
// semantics — validate_dsh_ui and render_ui still refuse and diagnose — while
// the FENCE channel gains one bounded retry that drops the erroring nodes and
// renders whatever survives cleanly.
import { describe, expect, it } from 'vitest'
import { isRenderableProcess, partialRepairGenuiSpec, processGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'
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
    // A defective bare root has no surviving content after pruning.
    expect(fenceSpec('{"type":"steps","items":[{"desc":"no title"}]}')).toBeNull()
  })

  it('passes a clean spec through untouched', () => {
    const raw = '{"items":[{"type":"text","content":"好"}]}'
    expect(partialRepairGenuiSpec(processGenuiSpec(JSON.parse(raw)))).toEqual(fenceSpec(raw))
  })

  it('renders the only declared node next to undeclared junk siblings (issue #254)', () => {
    // 真实样本：模型漏了 keyvalue 包装，把两个 pair 对象直接放进 items。杂项
    // 没有 type，不计入 declaredNativeCount —— 部分修复剪掉的是杂项，唯一合法
    // 的 table 必须存活，不能被「声明数 ≤ 1」连坐（#253 已删该早退）。
    const raw = '{"items":[{"type":"table","columns":["Item","Qty"],"rows":[["a","1"],["b","2"]]},{"key":"k1","value":"v1"},{"key":"k2","value":"v2"}]}'
    const processed = processGenuiSpec(JSON.parse(raw))
    expect(processed.declaredNativeCount).toBe(1)
    expect(processed.errors).toEqual(["items[1]: missing string 'type'", "items[2]: missing string 'type'"])
    const spec = fenceSpec(raw)
    expect(spec).not.toBeNull()
    expect(spec!.items).toEqual([{ type: 'table', columns: ['Item', 'Qty'], rows: [['a', '1'], ['b', '2']] }])
  })
})

describe('empty tabs (issue #215)', () => {
  const raw = JSON.stringify({
    items: [{
      type: 'tabs',
      tabs: [
        { label: 'A', items: [{ type: 'text', content: 'a' }] },
        { label: 'B' },
      ],
    }],
  })

  it('reports missing tab items instead of inventing an empty tab, while repair keeps valid tabs', () => {
    const processed = processGenuiSpec(JSON.parse(raw))

    expect(processed.errors).toContain('items[0].tabs[1].items must be an array')
    expect(validateGenuiSpec(processed.normalized).ok).toBe(false)
    expect(processed.repaired?.items[0]).toEqual({
      type: 'tabs',
      tabs: [
        { label: 'A', items: [{ type: 'text', content: 'a' }] },
      ],
    })
  })

  it('renders explicitly empty tabs but leaves a missing-items-only root for correction', () => {
    expect(fenceSpec(raw)).toBeNull()
    const explicit = JSON.parse(raw)
    explicit.items[0].tabs[1].items = []
    expect(fenceSpec(JSON.stringify(explicit))).toEqual({
      items: [{
        type: 'tabs',
        tabs: [
          { label: 'A', items: [{ type: 'text', content: 'a' }] },
          { label: 'B', items: [] },
        ],
      }],
    })
  })

  it('keeps the content alias for tab content', () => {
    const processed = processGenuiSpec({
      items: [{ type: 'tabs', tabs: [{ label: 'A', content: { type: 'text', content: 'a' } }] }],
    })

    expect(processed.errors).toEqual([])
    expect(processed.repaired?.items[0]).toEqual({
      type: 'tabs',
      tabs: [{ label: 'A', items: [{ type: 'text', content: 'a' }] }],
    })
  })

  it('continues to report an explicitly invalid tab items value', () => {
    const processed = processGenuiSpec({
      items: [{ type: 'tabs', tabs: [{ label: 'A', items: 123 }] }],
    })

    expect(processed.errors.join('\n')).toContain('tabs[0].items[0]')
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

describe('partial table detail repair (issue #248)', () => {
  const text = (content: string) => ({ type: 'text', content })
  const table = (details: unknown) => ({ type: 'table', columns: ['Item'], rows: [['A'], ['B'], ['C']], details })

  it('nulls malformed detail slots without shifting later rows or dropping the table', () => {
    const value = { items: [table([text('bad A'), [text('B detail')], 42]), text('sibling')] }
    const processed = processGenuiSpec(value)
    expect(processed.errors).toEqual([
      'items[0].details[0] must be an array or null',
      'items[0].details[2] must be an array or null',
    ])
    expect(isRenderableProcess(processed)).toBe(false)
    expect(partialRepairGenuiSpec(processed)?.items).toEqual([
      table([null, [text('B detail')], null]), text('sibling'),
    ])
    expect(processed.value).toEqual(value)
  })

  it('drops bad detail children and keeps their healthy siblings on the same row', () => {
    const value = { items: [table([
      [{ type: 'text' }, text('A detail'), { type: 'progress', value: 200 }],
      [text('B detail')],
      null,
    ])] }
    expect(fenceSpec(JSON.stringify(value))?.items).toEqual([
      table([[text('A detail')], [text('B detail')], null]),
    ])
  })

  it('repairs malformed details when the table is the only declared native node', () => {
    const node = table([text('not a detail list')])
    const processed = processGenuiSpec({ items: [node] })
    expect(processed.declaredNativeCount).toBe(1)
    expect(partialRepairGenuiSpec(processed)?.items).toEqual([
      { type: 'table', columns: ['Item'], rows: [['A'], ['B'], ['C']] },
    ])
  })

  it('keeps a single table when every detail child is defective', () => {
    const node = table([[{ type: 'text' }, { type: 'chart', kind: 'line', data: [] }]])
    const expected = { items: [{ type: 'table', columns: ['Item'], rows: [['A'], ['B'], ['C']] }] }
    expect(partialRepairGenuiSpec(processGenuiSpec({ items: [node] }))).toEqual(expected)
    expect(partialRepairGenuiSpec(processGenuiSpec(node))).toEqual(expected)
  })

  it('repairs a bare table root using the same wrap-relative validation paths', () => {
    const value = { ...table([text('bad A'), [text('B detail')]]), title: 'Items', panel: true }
    const processed = processGenuiSpec(value)
    expect(partialRepairGenuiSpec(processed)).toEqual({
      title: 'Items', panel: true,
      items: [table([null, [text('B detail')], null])],
    })
    expect(fenceSpec(JSON.stringify(value))).toEqual(partialRepairGenuiSpec(processed))
  })

  it('truncates excess detail slots and keeps both a single table and its siblings', () => {
    const node = { type: 'table', columns: ['Item'], rows: [['A']], details: [[text('A detail')], [{ type: 'chart', kind: 'line', data: [] }]] }
    const expected = { ...node, details: [[text('A detail')]] }
    for (const [value, expectedItems] of [
      [node, [expected]],
      [{ items: [node] }, [expected]],
      [{ items: [node, text('sibling')] }, [expected, text('sibling')]],
    ] as const) {
      const processed = processGenuiSpec(value)
      expect(processed.errors).toEqual(['items[0].details must not contain more entries than rows'])
      expect(isRenderableProcess(processed)).toBe(false)
      expect(partialRepairGenuiSpec(processed)?.items).toEqual(expectedItems)
    }
  })

  it('resolves nested details paths through tabs and containers', () => {
    const nested = { type: 'col', items: [
      { type: 'tabs', tabs: [{ label: 'Nested', items: [table([
        [{ type: 'col', items: [{ type: 'text' }, text('nested survivor')] }],
        [text('B detail')],
        null,
      ])] }] },
    ] }
    const spec = partialRepairGenuiSpec(processGenuiSpec({ items: [nested] }))
    expect(spec?.items).toEqual([{ type: 'col', items: [
      { type: 'tabs', tabs: [{ label: 'Nested', items: [table([
        [{ type: 'col', items: [text('nested survivor')] }],
        [text('B detail')],
        null,
      ])] }] },
    ] }])
  })

  it('repairs a nested table overhang and child errors together', () => {
    const nested = { type: 'table', columns: ['Nested'], rows: [['N']], details: [
      [{ type: 'text' }, text('nested detail')],
      [text('unreachable detail')],
    ] }
    const value = { items: [table([[nested]])] }
    expect(partialRepairGenuiSpec(processGenuiSpec(value))?.items).toEqual([
      table([[{ ...nested, details: [[text('nested detail')]] }], null, null]),
    ])
  })

  it('drops undrawable charts in details instead of exposing repaired blank charts', () => {
    const value = { items: [table([
      [{ type: 'chart', kind: 'line', data: [] }, text('A detail')],
      [text('B detail')],
      null,
    ])] }
    expect(fenceSpec(JSON.stringify(value))?.items).toEqual([
      table([[text('A detail')], [text('B detail')], null]),
    ])
  })

  it('rejects a retry with newly exposed submission errors or invalid root fields', () => {
    const node = table([[{ type: 'input', id: 'lost', label: 42 }]])
    expect(partialRepairGenuiSpec(processGenuiSpec({ items: [
      node, { type: 'submit', label: 'Send', action: 'send', groups: ['lost'] },
    ] }))).toBeNull()
    expect(partialRepairGenuiSpec(processGenuiSpec({ title: 42, items: [node] }))).toBeNull()
  })

  it('continues to reject a defective single component itself', () => {
    for (const node of [
      { type: 'stat', label: 42, value: '1' },
      { type: 'table', columns: ['Item'], rows: 42, details: [[text('detail')]] },
      { type: 'chart', kind: 'line', data: [] },
    ]) {
      expect(partialRepairGenuiSpec(processGenuiSpec(node))).toBeNull()
      expect(partialRepairGenuiSpec(processGenuiSpec({ items: [node] }))).toBeNull()
    }
  })
})
