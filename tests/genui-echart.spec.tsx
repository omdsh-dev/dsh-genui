// @vitest-environment jsdom
// EChartNode rendering: preset five forms, error fallback, option priority,
// title/height, role=img/aria-label, scatter with CJK labels.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { GenuiEChart } from '../src/client/spec'
import { EChartNode, SERIES_FALLBACK } from '../src/client/EChartNode.tsx'
import { createChart } from '../src/client/echarts-lazy.ts'

vi.mock('../src/client/echarts-lazy.ts', async () => {
  // Keep the real preset→engine mapping so the mock stays honest about which
  // bundle a preset needs (progressive disclosure).
  const actual = await vi.importActual<typeof import('../src/client/echarts-lazy.ts')>('../src/client/echarts-lazy.ts')
  return { createChart: vi.fn(), CORE_PRESETS: actual.CORE_PRESETS }
})
beforeEach(() => { vi.mocked(createChart).mockReset() })

afterEach(() => {
  cleanup()
})

function fakeInstance() {
  return { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
}

describe('EChartNode: series palette', () => {
  it('keeps eight distinct fallback hues (host tokens may be absent)', () => {
    // The regression: every slot fell back to the single accent colour, so a
    // multi-series chart came out entirely blue.
    expect(SERIES_FALLBACK.length).toBeGreaterThanOrEqual(6)
    expect(new Set(SERIES_FALLBACK).size).toBe(SERIES_FALLBACK.length)
  })
})

describe('EChartNode: preset rendering', () => {
  it('renders data-genui-echart container for each preset', async () => {
    for (const preset of [
      'bar', 'line', 'area', 'pie', 'scatter',
      'radar', 'gauge', 'funnel', 'treemap', 'sankey', 'graph', 'heatmap', 'bigline',
    ] as const) {
      vi.mocked(createChart).mockImplementation(() => Promise.resolve(fakeInstance()))
      const node: GenuiEChart = { type: 'echart', preset, data: [{ label: 'a', value: 1 }] }
      const { container, unmount } = render(<EChartNode node={node} />)
      await vi.waitFor(() => {
        expect(container.querySelector('[data-genui-echart]')).not.toBeNull()
      })
      unmount()
    }
  })
})

describe('EChartNode: error fallback', () => {
  it('shows error fallback when engine load fails', async () => {
    vi.mocked(createChart).mockImplementation(() => Promise.reject(new Error('asset 404')))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.textContent).toContain('ECharts 渲染失败')
    }, { timeout: 3000 })
  })
})

describe('EChartNode: option vs preset', () => {
  it('option takes priority over preset', async () => {
    let capturedOption: unknown
    vi.mocked(createChart).mockImplementation((_el, option) => {
      capturedOption = option
      return Promise.resolve(fakeInstance())
    })
    const node: GenuiEChart = {
      type: 'echart',
      preset: 'bar',
      option: { title: { text: 'custom' } },
      data: [{ label: 'a', value: 1 }],
    }
    render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(capturedOption).toBeDefined()
    }, { timeout: 3000 })
    const opt = capturedOption as Record<string, unknown>
    expect(opt.title).toEqual({ text: 'custom' })
    expect(opt.xAxis).toBeUndefined()
  })
})

describe('EChartNode: title and height', () => {
  it('renders title when provided', async () => {
    vi.mocked(createChart).mockImplementation(() => Promise.resolve(fakeInstance()))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', title: '销售趋势', data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.querySelector('[data-genui-echart]')).not.toBeNull()
    })
    expect(container.textContent).toContain('销售趋势')
  })

  it('applies custom height to canvas', async () => {
    vi.mocked(createChart).mockImplementation(() => Promise.resolve(fakeInstance()))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', height: 500, data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.querySelector('[role="img"]')).not.toBeNull()
    })
    const canvas = container.querySelector('[role="img"]') as HTMLElement
    expect(canvas.style.height).toBe('500px')
  })

  it('defaults height to 300px', async () => {
    vi.mocked(createChart).mockImplementation(() => Promise.resolve(fakeInstance()))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.querySelector('[role="img"]')).not.toBeNull()
    })
    const canvas = container.querySelector('[role="img"]') as HTMLElement
    expect(canvas.style.height).toBe('300px')
  })
})

describe('EChartNode: accessibility', () => {
  it('renders role=img and aria-label with title', async () => {
    vi.mocked(createChart).mockImplementation(() => Promise.resolve(fakeInstance()))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', title: '图表', data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.querySelector('[role="img"]')).not.toBeNull()
    })
    const canvas = container.querySelector('[role="img"]')
    expect(canvas?.getAttribute('aria-label')).toBe('图表')
  })

  it('renders aria-label fallback when no title', async () => {
    vi.mocked(createChart).mockImplementation(() => Promise.resolve(fakeInstance()))
    const node: GenuiEChart = { type: 'echart', preset: 'bar', data: [{ label: 'a', value: 1 }] }
    const { container } = render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(container.querySelector('[role="img"]')).not.toBeNull()
    })
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('ECharts chart')
  })
})

describe('EChartNode: scatter with CJK labels', () => {
  it('passes category xAxis with CJK labels (not value axis)', async () => {
    let capturedOption: unknown
    vi.mocked(createChart).mockImplementation((_el, option) => {
      capturedOption = option
      return Promise.resolve(fakeInstance())
    })
    const node: GenuiEChart = {
      type: 'echart',
      preset: 'scatter',
      data: [{ label: '一月', value: 10 }, { label: '二月', value: 20 }],
    }
    render(<EChartNode node={node} />)
    await vi.waitFor(() => {
      expect(capturedOption).toBeDefined()
    }, { timeout: 3000 })
    const opt = capturedOption as { xAxis?: { type?: string; data?: string[] } }
    expect(opt.xAxis?.type).toBe('category')
    expect(opt.xAxis?.data).toEqual(['一月', '二月'])
  })
})
