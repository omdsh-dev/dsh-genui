import { expect, it } from 'vitest'
import { presetOption } from '../src/client/EChartNode.tsx'
import { evaluateComputed, resolveComputedSpec } from '../src/client/computed.ts'
import type { GenuiEChart } from '../src/client/spec.ts'
import { resolveFence } from '../src/shared/fence-resolve.ts'

const points = [{ label: 'A', value: 0 }, { label: 'B', value: { $computed: 'total' } }, { label: 'C', value: 3 }]

/** 从围栏的计算结果生成图表 option，检查缺失值与真实零值。 */
function chartOption(preset: string, amount: string, withSeries = true): Record<string, unknown> {
  const spec = resolveFence(JSON.stringify({ computed: [{ id: 'total', expr: 'amount*2' }], items: [
    { type: 'input', id: 'amount', inputType: 'number', label: 'Amount', value: '2' },
    { type: 'echart', preset, data: points, ...(withSeries ? { series: [{ label: 'result', data: points }] } : {}) },
  ] }), { settled: true }).spec
  expect(spec).not.toBeNull()
  const resolved = resolveComputedSpec(spec!, evaluateComputed(spec!, { amount }))
  return presetOption(resolved.items[1] as GenuiEChart)
}

it('omits missing heatmap cells without moving categories or removing real zeroes', () => {
  expect(chartOption('heatmap', '')).toMatchObject({ xAxis: { data: ['A', 'B', 'C'] }, series: [{ data: [[0, 0, 0], [2, 0, 3]] }] })
  expect(chartOption('heatmap', '0')).toMatchObject({ series: [{ data: [[0, 0, 0], [1, 0, 0], [2, 0, 3]] }] })
})

it.each([true, false])('omits incomplete radar polygons and restores actual zeroes (series=%s)', withSeries => {
  expect(chartOption('radar', '', withSeries)).toMatchObject({ radar: { indicator: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }, series: [{ data: [] }] })
  expect(chartOption('radar', '0', withSeries)).toMatchObject({ series: [{ data: [{ value: [0, 0, 3] }] }] })
})

it.each(['bar', 'line', 'area', 'bigline', 'scatter'])('keeps missing %s data aligned to categories', preset => {
  expect(chartOption(preset, '')).toMatchObject({ xAxis: { data: ['A', 'B', 'C'] }, series: [{ data: [0, null, 3] }] })
})

it.each(['gauge', 'funnel', 'treemap', 'pie', 'wordCloud'])('omits missing %s marks while retaining real zeroes', preset => {
  const series = chartOption(preset, '', false).series as Array<{ data: Array<{ name: string; value: number }> }>
  const marks = series.flatMap(entry => entry.data)
  expect(marks.map(mark => mark.name)).toEqual(['A', 'C'])
  expect(marks[0].value).toBe(0)
})
