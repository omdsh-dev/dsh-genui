import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { resolveFence } from '../src/shared/fence-resolve.ts'
import { createChart } from '../src/client/echarts-lazy.ts'

vi.mock('../src/client/echarts-lazy.ts', () => ({ createChart: vi.fn() }))
const setOption = vi.fn()
beforeEach(() => {
  setOption.mockClear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.mocked(createChart).mockResolvedValue({ setOption, dispose: vi.fn(), resize: vi.fn() })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const points = [{ label: 'A', value: 0 }, { label: 'B', value: { $computed: 'total' } }, { label: 'C', value: 3 }]

async function mount(preset: string, withSeries = true) {
  const spec = resolveFence(JSON.stringify({ computed: [{ id: 'total', expr: 'amount*2' }], items: [
    { type: 'input', id: 'amount', inputType: 'number', label: 'Amount', value: '2' },
    { type: 'echart', preset, data: points, ...(withSeries ? { series: [{ label: 'result', data: points }] } : {}) },
  ] }), { settled: true }).spec
  expect(spec).not.toBeNull()
  const view = render(<GenuiBlock spec={spec!} />)
  await waitFor(() => expect(setOption).toHaveBeenCalled())
  return view
}

it('omits missing heatmap cells without moving categories or removing real zeroes', async () => {
  const view = await mount('heatmap')
  fireEvent.change(view.getByLabelText('Amount'), { target: { value: '' } })
  const option = setOption.mock.calls.at(-1)![0]
  expect(option.xAxis.data).toEqual(['A', 'B', 'C'])
  expect(option.series[0].data).toEqual([[0, 0, 0], [2, 0, 3]])
  fireEvent.change(view.getByLabelText('Amount'), { target: { value: '0' } })
  expect(setOption.mock.calls.at(-1)![0].series[0].data).toEqual([[0, 0, 0], [1, 0, 0], [2, 0, 3]])
})

it.each([true, false])('omits incomplete radar polygons and restores actual zeroes (series=%s)', async withSeries => {
  const view = await mount('radar', withSeries)
  fireEvent.change(view.getByLabelText('Amount'), { target: { value: '' } })
  const option = setOption.mock.calls.at(-1)![0]
  expect(option.radar.indicator.map((axis: { name: string }) => axis.name)).toEqual(['A', 'B', 'C'])
  expect(option.series[0].data).toEqual([])
  fireEvent.change(view.getByLabelText('Amount'), { target: { value: '0' } })
  expect(setOption.mock.calls.at(-1)![0].series[0].data[0].value).toEqual([0, 0, 3])
})

it.each(['bar', 'line', 'area', 'bigline', 'scatter'])('keeps missing %s data aligned to categories', async preset => {
  const view = await mount(preset)
  fireEvent.change(view.getByLabelText('Amount'), { target: { value: '' } })
  const option = setOption.mock.calls.at(-1)![0]
  expect(option.xAxis.data).toEqual(['A', 'B', 'C'])
  expect(option.series[0].data).toEqual([0, null, 3])
})

it.each(['gauge', 'funnel', 'treemap', 'pie', 'wordCloud'])('omits missing %s marks while retaining real zeroes', async preset => {
  const view = await mount(preset, false)
  fireEvent.change(view.getByLabelText('Amount'), { target: { value: '' } })
  const option = setOption.mock.calls.at(-1)![0]
  const marks = option.series.flatMap((series: { data: Array<{ name: string; value: number }> }) => series.data)
  expect(marks.map((mark: { name: string }) => mark.name)).toEqual(['A', 'C'])
  expect(marks[0].value).toBe(0)
})
