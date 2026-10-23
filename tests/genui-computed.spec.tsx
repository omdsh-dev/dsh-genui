import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { buildComputedGraph, evaluateComputed, resolveComputedSpec } from '../src/client/computed.ts'
import { processGenuiSpec, repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

afterEach(cleanup)

describe('Computed evaluation', () => {
  it('preserves JSON data that happens to contain component-shaped objects', () => {
    const value = {
      type: 'chart',
      data: [{ label: 'a', value: null }, { label: 'b', value: { $computed: 'answer' } }],
      child: { type: 'text', content: 'raw {{missing}}' },
    }
    const spec = repairGenuiSpec({
      computed: [{ id: 'answer', expr: '42' }],
      items: [{ type: 'json', value }],
    })!
    expect(validateGenuiSpec(spec).ok).toBe(true)
    expect(resolveComputedSpec(spec, evaluateComputed(spec, {})).items[0]).toEqual({ type: 'json', value })
    const noComputed: GenuiSpec = { items: [{ type: 'json', value }] }
    expect(resolveComputedSpec(noComputed, evaluateComputed(noComputed, {})).items[0]).toEqual({ type: 'json', value })
  })

  it('treats objects inside ECharts options as chart data rather than GenUI nodes', () => {
    const spec: GenuiSpec = {
      computed: [{ id: 'answer', expr: '42' }],
      items: [{ type: 'echart', option: {
        graphic: [{ type: 'text', style: { text: 'raw {{missing}}' } }],
        metadata: { type: 'chart', data: [{ value: null }, { value: { $computed: 'answer' } }] },
      } }],
    }
    expect(validateGenuiSpec(spec).ok).toBe(true)
    expect(resolveComputedSpec(spec, evaluateComputed(spec, {})).items[0]).toMatchObject({ option: {
      graphic: [{ type: 'text', style: { text: 'raw {{missing}}' } }],
      metadata: { type: 'chart', data: [{ value: null }, { value: 42 }] },
    } })
  })

  it('updates dependent formulas and applies locale-aware formatting', () => {
    const spec: GenuiSpec = {
      computed: [
        { id: 'annual', expr: 'monthly*12', format: { locale: 'zh-CN', style: 'currency', currency: 'CNY', maximumFractionDigits: 0 } },
        { id: 'tax', expr: 'annual*rate', format: { locale: 'zh-CN', style: 'currency', currency: 'CNY', maximumFractionDigits: 0 } },
      ],
      title: '预估税额 {{tax}}',
      items: [
        { type: 'input', id: 'monthly', inputType: 'number', value: '10000' },
        { type: 'input', id: 'rate', inputType: 'number', value: '0.1' },
        { type: 'text', content: '年收入 {{annual}}，预估税额 {{tax}}' },
        { type: 'chart', kind: 'bars', data: [{ label: '年收入', value: { $computed: 'annual' } }] },
        { type: 'table', columns: ['金额'], rows: [[{ $computed: 'tax' }]] },
        { type: 'echart', option: { series: [{ data: [{ value: { $computed: 'tax' } }] }] } },
      ],
    }
    const initial = evaluateComputed(spec, {})
    expect(initial.values).toEqual({ annual: 120000, tax: 12000 })
    expect(initial.formatted.annual).toContain('120,000')
    expect(initial.errors).toEqual({})

    const updated = evaluateComputed(spec, { monthly: '20000', rate: '0.2' })
    const resolved = resolveComputedSpec(spec, updated)
    expect(updated.values).toEqual({ annual: 240000, tax: 48000 })
    expect((resolved.items[3] as { data: Array<{ value: number }> }).data[0]?.value).toBe(240000)
    expect((resolved.items[4] as { rows: Array<Array<{ value: number; formatted: string }>> }).rows[0]?.[0]).toMatchObject({
      value: 48000,
      formatted: updated.formatted.tax,
    })
    expect((resolved.items[2] as { content: string }).content).toContain('48,000')
    expect(resolved.title).toContain('48,000')
    expect((resolved.items[5] as { option: { series: Array<{ data: Array<{ value: number }> }> } }).option.series[0]?.data[0]?.value).toBe(48000)
  })

  it('reports unknown fields, cycles, invalid input, and non-finite results', () => {
    const graph = buildComputedGraph([
      { id: 'unknown', expr: 'missing+1' },
      { id: 'first', expr: 'second+1' },
      { id: 'second', expr: 'first+1' },
      { id: 'divided', expr: 'amount/0' },
    ], new Set(['amount']))
    expect(graph.errors.unknown).toContain('未声明字段')
    expect(graph.errors.first).toBe('存在循环依赖')
    expect(graph.errors.second).toBe('存在循环依赖')

    const spec: GenuiSpec = {
      title: '总计 {{total}}',
      computed: [{ id: 'divided', expr: 'amount/0' }, { id: 'dependent', expr: 'divided+1' }],
      items: [{ type: 'input', id: 'amount', inputType: 'number', value: '2' }],
    }
    const invalidInput = evaluateComputed(spec, { amount: '' })
    expect(invalidInput.errors.divided).toContain('需要有效数值')
    expect(Object.hasOwn(invalidInput.values, 'divided')).toBe(false)
    const invalidResult = evaluateComputed(spec, { amount: '2' })
    expect(invalidResult.errors.divided).toContain('有效数值范围')
    const unsetPrototypeField = evaluateComputed({
      computed: [{ id: 'total', expr: 'toString+1' }],
      items: [{ type: 'input', id: 'toString', inputType: 'number' }],
    }, {})
    expect(unsetPrototypeField.errors.total).toContain('需要有效数值')
  })

  it('rejects non-decimal numeric field strings', () => {
    const spec: GenuiSpec = {
      computed: [{ id: 'double', expr: 'amount*2' }],
      items: [{ type: 'input', id: 'amount', inputType: 'number' }],
    }
    for (const amount of ['0x10', '0b10', '0o10']) {
      expect(evaluateComputed(spec, { amount }).errors.double).toBe('字段 amount 需要有效数值')
    }
    expect(evaluateComputed(spec, { amount: '1.25e2' }).values.double).toBe(250)
  })

  it('interpolates the remaining accessible and navigation labels', () => {
    const spec: GenuiSpec = {
      computed: [{ id: 'total', expr: '12' }],
      items: [
        { type: 'arrow', label: '共 {{total}} 项' },
        { type: 'icon', name: 'Check', label: '共 {{total}} 项' },
        { type: 'avatar', name: '用户 {{total}}' },
        { type: 'copy', label: '复制 {{total}} 项', text: 'raw {{total}}' },
        { type: 'breadcrumb', items: ['项目', '第 {{total}} 项'] },
      ],
    }
    const result = resolveComputedSpec(spec, evaluateComputed(spec, {}))

    expect(result.items).toMatchObject([
      { label: '共 12 项' },
      { label: '共 12 项' },
      { name: '用户 12' },
      { label: '复制 12 项', text: 'raw {{total}}' },
      { items: ['项目', '第 12 项'] },
    ])
    expect(validateGenuiSpec(spec).ok).toBe(true)
  })

  it('preserves template syntax inside code, SVG, and Mermaid source', () => {
    const spec: GenuiSpec = {
      items: [
        { type: 'code', lang: 'javascript', code: "const template = '{{name}}';" },
        { type: 'svg', code: '<svg><text>{{name}}</text></svg>' },
        { type: 'mermaid', code: 'flowchart TD\n  A[{{name}}] --> B' },
      ],
    }
    expect(validateGenuiSpec(spec).ok).toBe(true)
    const resolved = resolveComputedSpec(spec, evaluateComputed(spec, {}))
    expect((resolved.items[0] as { code: string }).code).toBe("const template = '{{name}}';")
    expect((resolved.items[1] as { code: string }).code).toBe('<svg><text>{{name}}</text></svg>')
    expect((resolved.items[2] as { code: string }).code).toBe('flowchart TD\n  A[{{name}}] --> B')
  })

  it('uses the same template scope for validation and resolution', () => {
    const invalidTemplate: GenuiSpec = { items: [{ type: 'text', content: '{{missing}}' }] }
    expect(validateGenuiSpec(invalidTemplate).ok).toBe(false)
    expect((resolveComputedSpec(invalidTemplate, evaluateComputed(invalidTemplate, {})).items[0] as { content: string }).content)
      .toBe('无效输入')

    const rawOptions: GenuiSpec = { items: [{ type: 'select', options: ['{{name}}'] }] }
    expect(validateGenuiSpec(rawOptions).ok).toBe(true)
    expect((resolveComputedSpec(rawOptions, evaluateComputed(rawOptions, {})).items[0] as { options: string[] }).options)
      .toEqual(['{{name}}'])

    const rawJson: GenuiSpec = {
      items: [{ type: 'list', items: [{ type: 'json', value: { template: '{{name}}' } }] }],
    }
    expect(validateGenuiSpec(rawJson).ok).toBe(true)
    expect(resolveComputedSpec(rawJson, evaluateComputed(rawJson, {})).items[0]).toMatchObject({
      items: [{ type: 'json', value: { template: '{{name}}' } }],
    })

    const nestedDisplays: GenuiSpec = {
      computed: [{ id: 'total', expr: '1' }],
      items: [
        { type: 'accordion', items: [{ title: '分组 {{total}}', items: [] }] },
        { type: 'tabs', tabs: [{ label: '页面 {{total}}', items: [] }] },
      ],
    }
    expect(validateGenuiSpec(nestedDisplays).ok).toBe(true)
    const resolvedNested = resolveComputedSpec(nestedDisplays, evaluateComputed(nestedDisplays, {}))
    expect(resolvedNested.items[0]).toMatchObject({ items: [{ title: '分组 1' }] })
    expect(resolvedNested.items[1]).toMatchObject({ tabs: [{ label: '页面 1' }] })

    const blockText: GenuiSpec = {
      computed: [{ id: 'total', expr: '12' }],
      items: [{ type: 'blocks', rows: [{
        label: '{{total}}',
        color: '{{total}}',
        cells: ['{{total}}', { text: '{{total}}', sub: '{{total}}', color: '{{total}}' }],
      }] }],
    }
    const resolvedBlocks = resolveComputedSpec(blockText, evaluateComputed(blockText, {})).items[0] as {
      rows: Array<{ label: string; color: string; cells: Array<string | { text: string; sub?: string; color?: string }> }>
    }
    expect(resolvedBlocks.rows[0]).toEqual({
      label: '12', color: '{{total}}', cells: ['12', { text: '12', sub: '12', color: '{{total}}' }],
    })

    const radioText: GenuiSpec = {
      computed: [{ id: 'total', expr: '12' }],
      items: [{ type: 'radio', options: ['A'], explanation: '总数 {{total}}' }],
    }
    expect(validateGenuiSpec(radioText).ok).toBe(true)
    expect(resolveComputedSpec(radioText, evaluateComputed(radioText, {})).items[0]).toMatchObject({ explanation: '总数 12' })
    expect(validateGenuiSpec({
      computed: [{ id: 'total', expr: '12' }],
      items: [{ type: 'radio', options: ['A'], explanation: '总数 {{missing}}' }],
    }).ok).toBe(false)
  })

  it('invalidates formulas that depend on a computed field conflicting with an input', () => {
    const spec: GenuiSpec = {
      computed: [{ id: 'amount', expr: '100' }, { id: 'double', expr: 'amount*2' }],
      items: [
        { type: 'input', id: 'amount', inputType: 'number', value: '10' },
        { type: 'text', content: '结果：{{double}}' },
      ],
    }
    const graph = buildComputedGraph(spec.computed!, new Set(['amount']))
    expect(graph.errors.amount).toContain('计算字段 ID 重复')
    expect(graph.errors.double).toContain('依赖字段 amount 无效')
    expect(graph.order.map(definition => definition.id)).not.toContain('double')
    const result = evaluateComputed(spec, { amount: '10' })
    expect(result.values).not.toHaveProperty('double')
    expect(resolveComputedSpec(spec, result).items[1]).toMatchObject({ content: '结果：无效输入' })
  })

  it('supports field IDs that match JavaScript prototype names', () => {
    const spec: GenuiSpec = {
      computed: [{ id: 'total', expr: '__proto__*2' }],
      items: [{ type: 'input', id: '__proto__', inputType: 'number', value: '4' }],
    }
    expect(evaluateComputed(spec, {}).values.total).toBe(8)
    expect(evaluateComputed(spec, Object.fromEntries([['__proto__', '6']])).values.total).toBe(12)
  })

  it('uses the slider minimum when a direct spec omits its value', () => {
    const spec: GenuiSpec = {
      computed: [{ id: 'double', expr: 'amount*2' }],
      items: [{ type: 'slider', id: 'amount', min: 3, max: 9 }],
    }
    expect(evaluateComputed(spec, {}).values.double).toBe(6)
  })

  it('detects duplicate formula IDs and repairs bounded declarations', () => {
    const spec = processGenuiSpec({
      computed: [{ id: 'total', expr: 'left+right' }, { id: 'total', expr: '2' }],
      items: [
        { type: 'input', id: 'left', inputType: 'number', value: '2' },
        { type: 'input', id: 'right', inputType: 'number', value: '3' },
        { type: 'input', id: 'password', inputType: 'password', value: '9' },
      ],
    })
    expect(spec.spec?.computed).toHaveLength(2)
    expect(spec.errors.some(error => error.includes('计算字段 ID 重复'))).toBe(true)
    expect(buildComputedGraph(Array.from({ length: 51 }, (_unused, index) => ({ id: `field${index}`, expr: '1' })), new Set()).errors.field50)
      .toContain('超过 50 个')
    expect(validateGenuiSpec({ computed: [{ id: 'privateValue', expr: 'password+1' }], items: [
      { type: 'input', id: 'password', inputType: 'password', value: '9' },
    ] }).ok).toBe(false)
    expect(validateGenuiSpec({ computed: [{ id: 'total', expr: '1+2' }], items: [
      { type: 'table', columns: ['总计'], rows: [[{ $computed: 'missing' }]] },
    ] }).ok).toBe(false)
    expect(validateGenuiSpec({ computed: [{ id: 'total', expr: '1+2', format: { locale: 'en-US-US' } }], items: [] }).ok).toBe(false)
    expect(validateGenuiSpec({ computed: [{ id: 'total', expr: '1+2', format: { locale: 'en-US-u-nu-latn' } }], items: [] }).ok).toBe(true)
    expect(validateGenuiSpec({ computed: [{ id: 'total', expr: '1+2' }], title: '总额 {{totla}}', items: [] }).ok).toBe(false)
    expect(validateGenuiSpec({ computed: [{ id: 'total', expr: '1+2' }], items: [
      { type: 'text', content: '总额 {{totla}}' },
    ] }).errors.some(error => error.includes('unknown computed field'))).toBe(true)
    expect(validateGenuiSpec({
      computed: Array.from({ length: 51 }, (_unused, index) => ({ id: `field${index}`, expr: '1' })),
      items: [],
    }).errors).toContain('spec.computed exceeds 50 fields')
    const validId = 'a'.repeat(64)
    expect(validateGenuiSpec({ computed: [{ id: validId, expr: '1+2' }], items: [
      { type: 'table', columns: ['总计'], rows: [[{ $computed: `${validId}b` }]] },
    ] }).ok).toBe(false)
  })

  it('keeps independent multi-series data and leaves gaps for invalid computed values', () => {
    const spec: GenuiSpec = {
      computed: [{ id: 'large', expr: '1e13' }, { id: 'small', expr: '2' }],
      items: [{ type: 'chart', kind: 'line', data: [], series: [
        { label: 'A', data: [
          { label: 'X', value: { $computed: 'small' } },
          { label: 'Y', value: { $computed: 'large' } },
          { label: 'Z', value: { $computed: 'small' } },
        ] },
        { label: 'B', data: [{ label: 'X', value: 3 }, { label: 'Y', value: 4 }] },
      ] }],
    }
    const chart = resolveComputedSpec(spec, evaluateComputed(spec, {})).items[0] as {
      series: Array<{ data: Array<{ label: string; value: number | null }> }>
    }
    expect(chart.series.map(entry => entry.data.map(point => point.label))).toEqual([['X', 'Y', 'Z'], ['X', 'Y']])
    expect(chart.series.map(entry => entry.data.map(point => point.value))).toEqual([[2, null, 2], [3, 4]])
    const out = render(<GenuiBlock spec={spec} />)
    expect(within(out.container).getByRole('img').querySelectorAll('circle')).toHaveLength(4)
  })

  it('preserves different multi-series lengths when no Computed fields are declared', () => {
    const spec: GenuiSpec = {
      items: [
        { type: 'chart', kind: 'line', data: [], series: [
          { label: 'A', data: [{ label: 'X', value: 1 }, { label: 'Y', value: 2 }] },
          { label: 'B', data: [{ label: 'X', value: 4 }, { label: 'Y', value: 5 }, { label: 'Z', value: 6 }] },
        ] },
        { type: 'chart', data: [], series: [
          { label: 'A', data: [{ label: 'X', value: 1 }, { label: 'Y', value: 2 }] },
          { label: 'B', data: [{ label: 'X', value: 4 }, { label: 'Y', value: 5 }, { label: 'Z', value: 6 }] },
        ] },
      ],
    }
    const resolved = resolveComputedSpec(spec, evaluateComputed(spec, {}))
    const chart = resolved.items[0] as {
      series: Array<{ data: Array<{ label: string; value: number }> }>
    }
    expect(chart.series.map(entry => entry.data.map(point => point.value))).toEqual([[1, 2], [4, 5, 6]])
    const out = render(<GenuiBlock spec={spec} />)
    const charts = within(out.container).getAllByRole('img')
    expect(charts[0]!.querySelectorAll('circle')).toHaveLength(5)
    expect(charts[0]!.querySelector('svg')?.textContent).toContain('Z')
    expect(within(charts[1]!).getByText('Z')).toBeTruthy()
  })

  it('matches multi-series chart points by category label', () => {
    const spec: GenuiSpec = {
      items: [
        { type: 'chart', kind: 'line', data: [], series: [
          { label: 'A', data: [{ label: 'North', value: 1 }, { label: 'South', value: 2 }] },
          { label: 'B', data: [{ label: 'South', value: 3 }, { label: 'West', value: 4 }] },
        ] },
        { type: 'chart', kind: 'line', data: [], series: [
          { label: 'A', data: [{ label: 'X', value: 1 }, { label: 'Z', value: 2 }] },
          { label: 'B', data: [{ label: 'X', value: 3 }, { label: 'Y', value: 4 }, { label: 'Z', value: 5 }] },
        ] },
      ],
    }
    const out = render(<GenuiBlock spec={spec} />)
    const [chart, reorderedChart] = within(out.container).getAllByRole('img')
    const labels = [...chart!.querySelectorAll('svg text')].map(node => node.textContent)
    expect(labels).toEqual(expect.arrayContaining(['North', 'South', 'West']))
    expect(chart!.querySelectorAll('circle')).toHaveLength(4)
    const categoryLabels = [...reorderedChart!.querySelectorAll('svg text[y="168"]')].map(node => node.textContent)
    expect(categoryLabels).toEqual(['X', 'Y', 'Z'])
  })

  it('keeps up to the per-series chart point limit across distinct categories', () => {
    const spec: GenuiSpec = {
      items: [{ type: 'chart', kind: 'line', data: [], series: [
        { label: 'A', data: Array.from({ length: 60 }, (_unused, index) => ({ label: `A${index}`, value: index })) },
        { label: 'B', data: Array.from({ length: 60 }, (_unused, index) => ({ label: `B${index}`, value: index })) },
      ] }],
    }
    const out = render(<GenuiBlock spec={spec} />)
    expect(within(out.container).getByRole('img').querySelectorAll('circle')).toHaveLength(120)
  })

  it('rejects duplicate input IDs and prevents ambiguous formulas from rendering a value', () => {
    const spec: GenuiSpec = {
      computed: [{ id: 'double', expr: 'amount*2' }],
      items: [
        { type: 'input', id: 'amount', label: '金额一', inputType: 'number', value: '10' },
        { type: 'input', id: 'amount', label: '金额二', inputType: 'number', value: '20' },
        { type: 'text', content: '结果 {{double}}' },
      ],
    }
    const validation = validateGenuiSpec(spec)
    expect(validation.ok).toBe(false)
    expect(validation.errors).toContain("spec.items contains duplicate input field ID 'amount'")
    expect(evaluateComputed(spec, { amount: '20' }).errors.double).toContain('输入字段 amount ID 重复')
    const out = render(<GenuiBlock spec={spec} />)
    expect(out.container.textContent).toContain('结果 无效输入')
  })

  it('keeps formulas that do not reference duplicate input IDs valid', () => {
    const spec: GenuiSpec = {
      computed: [
        { id: 'total', expr: 'price*quantity' },
        { id: 'noteLength', expr: 'note+1' },
        { id: 'noteResult', expr: 'noteLength*2' },
      ],
      items: [
        { type: 'input', id: 'price', inputType: 'number', value: '10' },
        { type: 'input', id: 'quantity', inputType: 'number', value: '3' },
        { type: 'input', id: 'note', value: '1' },
        { type: 'input', id: 'note', value: '2' },
        { type: 'stat', label: '总额', value: '{{total}}' },
        { type: 'text', content: '重复字段计算 {{noteResult}}' },
      ],
    }

    const result = evaluateComputed(spec, { price: '10', quantity: '3', note: '2' })
    expect(result.values.total).toBe(30)
    expect(result.errors.noteLength).toContain('输入字段 note ID 重复')
    expect(result.errors.noteResult).toContain('依赖字段 noteLength 无效')

    const out = render(<GenuiBlock spec={spec} />)
    expect(out.container.textContent).toContain('总额30')
    expect(out.container.textContent).toContain('重复字段计算 无效输入')
  })

  it('resolves an invalid chart reference by removing its point', () => {
    const spec: GenuiSpec = {
      computed: [{ id: 'large', expr: '1e13' }],
      items: [{ type: 'chart', kind: 'bars', data: [{ label: '超出范围', value: { $computed: 'large' } }] }],
    }
    const chart = resolveComputedSpec(spec, evaluateComputed(spec, {})).items[0] as { data: unknown[] }
    expect(chart.data).toEqual([])
  })

  it('leaves a null gap for invalid values in full ECharts options', () => {
    const spec: GenuiSpec = {
      computed: [{ id: 'amount', expr: '2' }],
      items: [{ type: 'echart', option: { series: [{ data: [1, { $computed: 'missing' }, { $computed: 'amount' }] }] } }],
    }
    const option = (resolveComputedSpec(spec, evaluateComputed(spec, {})).items[0] as {
      option: { series: Array<{ data: unknown[] }> }
    }).option
    expect(option.series[0]?.data).toEqual([1, null, 2])
  })
})

describe('Computed rendering', () => {
  it('refreshes text, stats, charts, and tables when a numeric input changes', () => {
    const spec: GenuiSpec = {
      title: '总计 {{total}}',
      computed: [{ id: 'total', expr: 'price*quantity', format: { maximumFractionDigits: 0 } }],
      items: [
        { type: 'input', id: 'price', label: '单价', inputType: 'number', value: '12' },
        { type: 'input', id: 'quantity', label: '数量', inputType: 'number', value: '3' },
        { type: 'text', content: '总计 {{total}}' },
        { type: 'stat', label: '总计', value: '{{total}}' },
        { type: 'chart', kind: 'bars', horizontal: true, data: [{ label: '总计', value: { $computed: 'total' } }] },
        { type: 'table', columns: ['总计'], rows: [[{ $computed: 'total' }]] },
      ],
    }
    const out = render(<GenuiBlock spec={spec} />)
    expect(out.container.textContent).toContain('36')
    expect(out.container.querySelector('[class*="banner"]')?.textContent).toContain('总计 36')
    expect(within(out.container).getByRole('table').textContent).toContain('36')
    expect(within(out.container).getByRole('img').textContent).toContain('36')
    fireEvent.change(within(out.container).getByLabelText('单价'), { target: { value: '20' } })
    expect(out.container.textContent).toContain('60')
    expect(out.container.textContent).not.toContain('36')
    expect(out.container.querySelector('[class*="banner"]')?.textContent).toContain('总计 60')
    expect(within(out.container).getByRole('table').textContent).toContain('60')
    expect(within(out.container).getByRole('img').textContent).toContain('60')
  })

  it('tracks prototype-named input IDs as ordinary fields', () => {
    const spec: GenuiSpec = {
      computed: [{ id: 'total', expr: '__proto__*2' }],
      items: [
        { type: 'input', id: '__proto__', label: '数量', inputType: 'number', value: '4' },
        { type: 'stat', label: '总计', value: '{{total}}' },
      ],
    }
    const out = render(<GenuiBlock spec={spec} />)
    expect(out.container.textContent).toContain('8')
    fireEvent.change(within(out.container).getByLabelText('数量'), { target: { value: '6' } })
    expect(out.container.textContent).toContain('12')
    expect(out.container.textContent).not.toContain('8')
  })

  it('keeps numeric drafts local until parsing succeeds and treats clearing as invalid input', () => {
    const spec: GenuiSpec = {
      computed: [{ id: 'double', expr: 'amount*2' }],
      items: [
        { type: 'input', id: 'amount', label: '金额', inputType: 'number', value: '2' },
        { type: 'text', content: '结果 {{double}}' },
      ],
    }
    const out = render(<GenuiBlock spec={spec} />)
    const input = within(out.container).getByLabelText('金额')
    expect(input.getAttribute('type')).toBe('text')
    expect(input.getAttribute('inputmode')).toBe('decimal')
    fireEvent.change(input, { target: { value: '-' } })
    expect((input as HTMLInputElement).value).toBe('-')
    expect(out.container.textContent).toContain('结果 4')
    fireEvent.change(input, { target: { value: '1.' } })
    expect((input as HTMLInputElement).value).toBe('1.')
    expect(out.container.textContent).toContain('结果 2')
    fireEvent.change(input, { target: { value: '' } })
    expect(out.container.textContent).toContain('结果 无效输入')
  })

  it('shows currency, percentage, and decimal formatting in tables while sorting by raw values', () => {
    const spec: GenuiSpec = {
      computed: [
        { id: 'money', expr: '120000', format: { locale: 'en-US', style: 'currency', currency: 'USD', maximumFractionDigits: 0 } },
        { id: 'ratio', expr: '0.125', format: { style: 'percent', maximumFractionDigits: 1 } },
        { id: 'fraction', expr: '1/3', format: { maximumFractionDigits: 2 } },
        { id: 'high', expr: '20', format: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } },
        { id: 'low', expr: '3', format: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } },
      ],
      items: [
        { type: 'table', columns: ['金额', '比例', '小数'], rows: [[{ $computed: 'money' }, { $computed: 'ratio' }, { $computed: 'fraction' }]] },
        { type: 'table', columns: ['金额', '名称'], rows: [[{ $computed: 'high' }, '较高'], [{ $computed: 'low' }, '较低']] },
        { type: 'table', columns: ['分组', '金额'], types: ['group', 'num'], rows: [[{ $computed: 'money' }, ''], ['项目', 1]] },
      ],
    }
    const result = evaluateComputed(spec, {})
    const out = render(<GenuiBlock spec={spec} />)
    const tables = within(out.container).getAllByRole('table')
    expect(tables[0]?.textContent).toContain(result.formatted.money)
    expect(tables[0]?.textContent).toContain(result.formatted.ratio)
    expect(tables[0]?.textContent).toContain(result.formatted.fraction)
    fireEvent.click(within(tables[1]!).getByRole('button', { name: '金额' }))
    expect(Array.from(tables[1]!.querySelectorAll('tbody tr')).map(row => row.textContent)).toEqual([
      `${result.formatted.low}较低`,
      `${result.formatted.high}较高`,
    ])
    expect(tables[2]?.textContent).toContain(result.formatted.money)
    expect(tables[2]?.textContent).not.toContain('[object Object]')
  })
})
