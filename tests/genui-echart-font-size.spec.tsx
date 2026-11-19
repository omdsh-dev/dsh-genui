// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { init, setPlatformAPI, type ECharts, type EChartsOption } from 'echarts'
import { EChartNode } from '../src/client/EChartNode.tsx'
import { createChart } from '../src/client/echarts-lazy.ts'

vi.mock('../src/client/echarts-lazy.ts', () => ({ createChart: vi.fn() }))

// This suite exercises the real option/state merger. Text measurement is
// irrelevant to those assertions, and jsdom has no canvas implementation.
setPlatformAPI({ measureText: text => ({ width: text.length * 8 }) })

beforeEach(() => {
  vi.mocked(createChart).mockReset()
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  document.body.style.setProperty('--dsh-content-font-size', '17px')
  const computedStyle = globalThis.getComputedStyle
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation(element => {
    const result = computedStyle(element)
    // CSS-variable calculation is covered by the real-browser font fixtures;
    // supply their resolved token values for the component's probe in jsdom.
    if (element instanceof HTMLElement) {
      const token = element.style.fontSize.match(/^var\(--dsl-g-font-(data|meta|display)\)$/)?.[1]
      if (token !== undefined) {
        const original = token === 'data' ? 12 : token === 'meta' ? 12.5 : 28
        const hostSize = Number.parseFloat(document.body.style.getPropertyValue('--dsh-content-font-size'))
        result.fontSize = `${original * Math.max(1, hostSize / 17)}px`
      }
    }
    return result
  })
})

afterEach(() => {
  cleanup()
  document.body.style.removeProperty('--dsh-content-font-size')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('EChartNode: host content font changes', () => {
  it('updates font sizes while preserving legend selections and data zoom', async () => {
    const chart: ECharts = init(null, null, { renderer: 'svg', ssr: true, width: 600, height: 300 })
    const setOption = vi.fn((option: unknown, notMerge?: boolean) => chart.setOption(option as EChartsOption, notMerge))
    vi.mocked(createChart).mockImplementation((_element, option) => {
      setOption(option)
      return Promise.resolve({ setOption, resize: () => chart.resize(), dispose: () => chart.dispose() })
    })
    render(<EChartNode node={{ type: 'echart', preset: 'bigline', series: [
      { label: 'A', data: [{ label: 'one', value: 1 }, { label: 'two', value: 2 }, { label: 'three', value: 3 }] },
      { label: 'B', data: [{ label: 'one', value: 3 }, { label: 'two', value: 2 }, { label: 'three', value: 1 }] },
    ] }} />)
    await vi.waitFor(() => expect(setOption).toHaveBeenCalledTimes(2))
    chart.dispatchAction({ type: 'legendUnSelect', name: 'A' })
    chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: 20, end: 70 })
    expect(chart.getOption()).toMatchObject({
      legend: [{ selected: { A: false, B: true }, textStyle: { fontSize: 12 } }],
      dataZoom: [{ start: 20, end: 70 }, { start: 20, end: 70 }],
    })

    document.body.style.setProperty('--dsh-content-font-size', '22px')
    await vi.waitFor(() => expect(setOption).toHaveBeenCalledTimes(3))
    expect(chart.getOption()).toMatchObject({
      legend: [{ selected: { A: false, B: true }, textStyle: { fontSize: expect.closeTo(12 * 22 / 17, 5) } }],
      dataZoom: [{ start: 20, end: 70 }, { start: 20, end: 70, textStyle: { fontSize: expect.closeTo(12 * 22 / 17, 5) } }],
      xAxis: [{ axisLabel: { fontSize: expect.closeTo(12 * 22 / 17, 5) } }],
      yAxis: [{ axisLabel: { fontSize: expect.closeTo(12 * 22 / 17, 5) } }],
    })
  })

  it('updates the word-cloud font range without replaying its words', async () => {
    const setOption = vi.fn()
    vi.mocked(createChart).mockResolvedValue({ setOption, resize: vi.fn(), dispose: vi.fn() })
    render(<EChartNode node={{ type: 'echart', preset: 'wordCloud', data: [{ label: 'A', value: 3 }] }} />)
    await vi.waitFor(() => expect(setOption).toHaveBeenCalledTimes(1))

    document.body.style.setProperty('--dsh-content-font-size', '22px')
    await vi.waitFor(() => expect(setOption).toHaveBeenCalledTimes(2))
    expect(setOption).toHaveBeenLastCalledWith(expect.objectContaining({
      series: [{ sizeRange: [expect.closeTo(16 * 22 / 17, 5), expect.closeTo(64 * 22 / 17, 5)] }],
    }))
  })
})
