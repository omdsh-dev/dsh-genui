// @vitest-environment jsdom
// v2.9 polish batch regressions:
// 1) chart hover tooltips (title attrs on bars / grouped bars / donut arcs,
//    SVG <title> on line dots);
// 2) slider form node (default + durable value + submit fields collection);
// 3) table local sorting (asc / desc / reset, numeric-aware);
// 4) plot series kinds (line default, area polygon, scatter dots);
// 5) asset prefetch links injected at boot.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock, GENUI_ACTION_DEBOUNCE_MS } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})
beforeEach(() => {
  vi.useFakeTimers()
})

function renderBlock(spec: unknown, actions: Array<[string, Record<string, unknown>]> = []) {
  return render(
    <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
      <GenuiBlock spec={repairGenuiSpec(spec)!} />
    </GenuiActionContext.Provider>,
  )
}

describe('v3: stat sparkline', () => {
  it('renders one polyline point per spark value', () => {
    const { container } = renderBlock({
      items: [{ type: 'stat', label: 'P95', value: '42ms', spark: [3, 5, 4, 8, 6] }],
    })
    const spark = container.querySelector('svg[class*="statSpark"]')
    expect(spark).not.toBeNull()
    expect(spark!.querySelector('polyline')!.getAttribute('points')!.split(' ')).toHaveLength(5)
  })

  it('drops a spark that cannot draw a line', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'stat', label: 'P95', value: '42ms', spark: [1] }] })!
    expect(spec.items[0]).toMatchObject({ type: 'stat' })
    expect((spec.items[0] as { spark?: number[] }).spark).toBeUndefined()
  })
})

describe('v2.9: chart hover tooltips', () => {
  it('bars carry title attrs with label and value', () => {
    const { container } = renderBlock({
      items: [{ type: 'chart', data: [{ label: '一', value: 42 }] }],
    })
    // v3: the title moved from the column to the bar itself (the column now
    // hosts an absolutely positioned fill and value label).
    expect(container.querySelector('[class*="barFill"]')!.getAttribute('title')).toBe('一: 42')
  })

  it('grouped bars name the series in the tooltip', () => {
    const { container } = renderBlock({
      items: [{ type: 'chart', series: [
        { label: '本月', data: [{ label: 'Q1', value: 3 }] },
      ] }],
    })
    const bar = [...container.querySelectorAll('[class*="groupedBar"]')].find(el => el.hasAttribute('title'))
    expect(bar).toBeDefined()
    expect(bar!.getAttribute('title')).toBe('本月 · Q1: 3')
  })

  it('donut arcs carry title elements', () => {
    const { container } = renderBlock({
      items: [{ type: 'chart', kind: 'donut', data: [{ label: 'A', value: 30 }] }],
    })
    const titles = [...container.querySelectorAll('svg title')].map(t => t.textContent ?? '')
    expect(titles.join(' ')).toContain('A: 30')
  })

  it('line dots carry SVG title elements', () => {
    const { container } = renderBlock({
      items: [{ type: 'chart', kind: 'line', data: [
        { label: '周一', value: 8 }, { label: '周二', value: 12 },
      ] }],
    })
    const titles = [...container.querySelectorAll('svg title')].map(t => t.textContent)
    expect(titles).toContain('周一: 8')
    expect(titles).toContain('周二: 12')
  })
})

describe('v2.9: slider form node', () => {
  it('renders with the default value and fires a debounced action with id', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = renderBlock({
      items: [{ type: 'slider', label: '音量', min: 0, max: 10, value: 4, action: 'vol', id: 'v' }],
    }, actions)
    const input = container.querySelector('input[type="range"]') as HTMLInputElement
    expect(input.value).toBe('4')
    fireEvent.change(input, { target: { value: '7' } })
    act(() => { vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS) })
    expect(actions).toEqual([['vol', { type: 'slider', value: 7, id: 'v' }]])
    // value readout follows the drag
    expect(container.textContent).toContain('7')
  })

  it('collects the value into a sibling submit fields payload', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = renderBlock({
      items: [
        { type: 'slider', label: '音量', min: 0, max: 10, value: 2, action: 'vol', id: 'v' },
        { type: 'submit', label: '提交', action: 'send' },
      ],
    }, actions)
    fireEvent.change(container.querySelector('input[type="range"]')!, { target: { value: '9' } })
    fireEvent.click(container.querySelector('[class*="submitRow"] button')!)
    act(() => { vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS) })
    const send = actions.find(([name]) => name === 'send')!
    expect(send[1]).toMatchObject({ type: 'submit', fields: { v: '9' } })
  })
})

describe('v2.9: table local sorting', () => {
  const spec = {
    items: [{ type: 'table', columns: ['名称', '数量'], rows: [
      ['香蕉', '10'], ['苹果', '25'], ['橙', 5],
    ] }],
  }

  const bodyRows = (container: HTMLElement): string[] =>
    [...container.querySelectorAll('tbody tr')].map(tr => tr.textContent ?? '')

  it('sorts ascending, then descending, then restores the spec order (numeric-aware)', () => {
    const { container } = renderBlock(spec)
    const headers = container.querySelectorAll('thead th button')
    expect(bodyRows(container)).toEqual(['香蕉10', '苹果25', '橙5'])
    // numeric-aware ascending on the 数量 column (5 < 10 < 25, not "10" < "25" < "5")
    fireEvent.click(headers[1]!)
    expect(bodyRows(container)).toEqual(['橙5', '香蕉10', '苹果25'])
    expect(headers[1]!.closest('th')!.getAttribute('aria-sort')).toBe('ascending')
    // descending
    fireEvent.click(headers[1]!)
    expect(bodyRows(container)).toEqual(['苹果25', '香蕉10', '橙5'])
    expect(headers[1]!.closest('th')!.getAttribute('aria-sort')).toBe('descending')
    // third click restores the spec order
    fireEvent.click(headers[1]!)
    expect(bodyRows(container)).toEqual(['香蕉10', '苹果25', '橙5'])
    expect(headers[1]!.closest('th')!.getAttribute('aria-sort')).toBe('none')
  })
})

describe('v2.9: plot series kinds', () => {
  const base = { xMin: 0, xMax: 1 }

  it('renders a line by default', () => {
    const { container } = renderBlock({ items: [{ type: 'plot', ...base, series: [{ expr: 'x' }] }] })
    expect(container.querySelectorAll('polyline').length).toBeGreaterThan(0)
    expect(container.querySelector('polygon')).toBeNull()
  })

  it('renders an area polygon to the baseline', () => {
    const { container } = renderBlock({ items: [{ type: 'plot', ...base, series: [{ expr: 'x', kind: 'area' }] }] })
    expect(container.querySelector('polygon')).not.toBeNull()
    expect(container.querySelectorAll('polyline').length).toBe(0)
  })

  it('renders scatter dots without a polyline', () => {
    const { container } = renderBlock({ items: [{ type: 'plot', ...base, series: [{ expr: 'x', kind: 'scatter' }] }] })
    expect(container.querySelectorAll('circle').length).toBeGreaterThan(10)
    expect(container.querySelectorAll('polyline').length).toBe(0)
  })
})
