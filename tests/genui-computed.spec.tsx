import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { buildComputedGraph, evaluateComputed, resolveComputedSpec } from '../src/client/computed.ts'
import { processGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

afterEach(cleanup)

describe('Computed evaluation', () => {
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
    expect((resolved.items[4] as { rows: Array<Array<number>> }).rows[0]?.[0]).toBe(48000)
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
    expect(validateGenuiSpec({
      computed: Array.from({ length: 51 }, (_unused, index) => ({ id: `field${index}`, expr: '1' })),
      items: [],
    }).errors).toContain('spec.computed exceeds 50 fields')
    const validId = 'a'.repeat(64)
    expect(validateGenuiSpec({ computed: [{ id: validId, expr: '1+2' }], items: [
      { type: 'table', columns: ['总计'], rows: [[{ $computed: `${validId}b` }]] },
    ] }).ok).toBe(false)
  })

  it('keeps multi-series chart labels aligned and omits out-of-range chart values', () => {
    const spec: GenuiSpec = {
      computed: [{ id: 'large', expr: '1e13' }, { id: 'small', expr: '2' }],
      items: [{ type: 'chart', kind: 'line', series: [
        { label: 'A', data: [{ label: 'X', value: { $computed: 'small' } }, { label: 'Y', value: { $computed: 'large' } }] },
        { label: 'B', data: [{ label: 'X', value: 3 }, { label: 'Y', value: 4 }] },
      ] }],
    }
    const chart = resolveComputedSpec(spec, evaluateComputed(spec, {})).items[0] as {
      series: Array<{ data: Array<{ label: string; value: number }> }>
    }
    expect(chart.series.map(entry => entry.data.map(point => point.label))).toEqual([['X'], ['X']])
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
})
