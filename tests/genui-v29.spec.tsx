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

describe('v13: hero 封面块与 bento 跨列', () => {
  it('renders a hero with its metric, title, subtitle and tone', () => {
    const { container } = renderBlock({
      items: [{ type: 'hero', label: '可用率', value: '99.96%', delta: '+0.02%', tone: 'success', title: '服务健康', subtitle: '近 30 天' }],
    })
    const hero = container.querySelector('[class*="hero"]') as HTMLElement
    expect(hero).not.toBeNull()
    expect(hero.className).toContain('heroSuccess')
    expect(container.textContent).toContain('可用率')
    expect(container.textContent).toContain('服务健康')
    expect(container.textContent).toContain('近 30 天')
  })

  it('spans grid columns for bento layouts', () => {
    const { container } = renderBlock({
      items: [{ type: 'grid', cols: 3, items: [
        { type: 'card', span: 2, title: '宽卡', items: [{ type: 'text', content: 'a' }] },
        { type: 'card', title: '窄卡', items: [{ type: 'text', content: 'b' }] },
      ] }],
    })
    const spanned = container.querySelector('[class*="gridSpan"]') as HTMLElement
    expect(spanned).not.toBeNull()
    expect(spanned.style.gridColumn).toBe('span 2')
    expect(container.querySelectorAll('[class*="gridSpan"]')).toHaveLength(1)
  })
})

describe('v12: 本地数据绑定（就地筛选）', () => {
  it('filters table rows from a bound input, live', () => {
    const { container } = renderBlock({
      items: [
        { type: 'input', id: 'q', label: '搜索' },
        { type: 'table', columns: ['服务', 'P95'], filter: 'q', rows: [['API 网关', '128'], ['搜索', '190'], ['推荐', '250']] },
      ],
    })
    const rows = () => container.querySelectorAll('tbody tr')
    expect(rows()).toHaveLength(3)
    fireEvent.change(container.querySelector('input')!, { target: { value: '搜索' } })
    expect(rows()).toHaveLength(1)
    expect(container.querySelector('tbody')?.textContent).toContain('190')
    expect(container.textContent).toContain('筛选后 1 / 3 行')
    fireEvent.change(container.querySelector('input')!, { target: { value: '' } })
    expect(rows()).toHaveLength(3)
  })

  it('restricts the filter to one column when filterColumn is set', () => {
    const { container } = renderBlock({
      items: [
        { type: 'input', id: 'q' },
        { type: 'table', columns: ['服务', '备注'], filter: 'q', filterColumn: 0, rows: [['API', '网关'], ['搜索', 'API']] },
      ],
    })
    fireEvent.change(container.querySelector('input')!, { target: { value: 'api' } })
    const body = container.querySelector('tbody')?.textContent ?? ''
    expect(body).toContain('API')
    expect(body).not.toContain('搜索')
  })

  it('sorts by a bound select value', () => {
    const { container } = renderBlock({
      items: [
        { type: 'select', id: 'sort', options: ['P95'] },
        { type: 'table', columns: ['服务', 'P95'], sortField: 'sort', rows: [['A', '250'], ['B', '128']] },
      ],
    })
    fireEvent.change(container.querySelector('select')!, { target: { value: 'P95' } })
    const first = container.querySelector('tbody tr')?.textContent ?? ''
    expect(first).toContain('B')
  })

  it('filters chart categories and list items', () => {
    const chart = renderBlock({
      items: [
        { type: 'input', id: 'q' },
        { type: 'chart', filter: 'q', data: [{ label: '搜索', value: 82 }, { label: '社交', value: 41 }] },
      ],
    })
    fireEvent.change(chart.container.querySelector('input')!, { target: { value: '搜索' } })
    expect(chart.container.querySelectorAll('[class*="barCol"]')).toHaveLength(1)
    chart.unmount()

    const list = renderBlock({
      items: [
        { type: 'input', id: 'q' },
        { type: 'list', filter: 'q', items: ['苹果', '香蕉', '苹果派'] },
      ],
    })
    fireEvent.change(list.container.querySelector('input')!, { target: { value: '苹果' } })
    expect(list.container.querySelectorAll('[class*="li"]').length).toBeGreaterThanOrEqual(2)
    expect(list.container.textContent).toContain('匹配 2 / 3 项')
  })
})

describe('v11: table master-detail rows', () => {
  it('expands a row into its detail panel and folds it back', () => {
    const { container } = renderBlock({
      items: [{
        type: 'table',
        columns: ['服务', 'P95'],
        rows: [['API 网关', '128'], ['搜索', '190']],
        details: [[{ type: 'text', content: '详情内容' }], null],
      }],
    })
    // Only the row that carries details gets a toggle.
    const toggles = container.querySelectorAll('[class*="detailToggle"]')
    expect(toggles).toHaveLength(1)
    expect(toggles[0]!.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[class*="detailRow"]')).toBeNull()

    fireEvent.click(toggles[0]!)
    expect(container.querySelector('[class*="detailToggle"]')!.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[class*="detailRow"]')?.textContent).toContain('详情内容')

    fireEvent.click(container.querySelector('[class*="detailToggle"]')!)
    expect(container.querySelector('[class*="detailRow"]')).toBeNull()
  })

  it('drops a details array whose entries all repair away', () => {
    const spec = repairGenuiSpec({
      items: [{
        type: 'table',
        columns: ['A'],
        rows: [['1']],
        // A known type missing its required fields repairs away; unknown types
        // are opaque by policy and would be kept, so this uses the former.
        details: [[{ type: 'stat' }]],
      }],
    })!
    const table = spec.items[0] as { details?: unknown }
    expect(table.details).toBeUndefined()
  })
})

describe('v7: table sections/totals, stacked bars, card tones', () => {
  it('renders a group header row spanning every column', () => {
    const { container } = renderBlock({
      items: [{
        type: 'table',
        columns: ['区域', 'Q1', 'Q2'],
        types: ['group', 'num', 'num'],
        rows: [['华东', '', ''], ['上海', '120', '138']],
      }],
    })
    const groupCell = container.querySelector('[class*="groupRow"] td')
    // v10: the header is a toggle with a chevron and the child count.
    expect(groupCell?.textContent).toBe('▾华东1')
    expect(groupCell?.getAttribute('colspan')).toBe('3')
    expect(container.querySelector('[class*="groupToggle"]')?.getAttribute('aria-expanded')).toBe('true')
    // Children are indented under the section.
    expect(container.querySelectorAll('tr[class*="groupChild"]')).toHaveLength(1)
  })

  it('folds a section away and back', () => {
    const { container } = renderBlock({
      items: [{
        type: 'table',
        columns: ['区域', 'Q1'],
        types: ['group', 'num'],
        rows: [['华东', ''], ['上海', '120'], ['杭州', '96']],
      }],
    })
    expect(container.querySelectorAll('tr[class*="groupChild"]')).toHaveLength(2)
    fireEvent.click(container.querySelector('[class*="groupToggle"]')!)
    expect(container.querySelectorAll('tr[class*="groupChild"]')).toHaveLength(0)
    expect(container.querySelector('[class*="groupToggle"]')?.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(container.querySelector('[class*="groupToggle"]')!)
    expect(container.querySelectorAll('tr[class*="groupChild"]')).toHaveLength(2)
  })

  it('sums numeric columns into a footer row', () => {
    const { container } = renderBlock({
      items: [{
        type: 'table',
        columns: ['区域', 'Q1', 'Q2'],
        types: ['group', 'num', 'num'],
        total: true,
        rows: [['华东', '', ''], ['上海', '120', '138'], ['杭州', '96', '104']],
      }],
    })
    const footer = [...container.querySelectorAll('tfoot td')].map(td => td.textContent)
    expect(footer[0]).toBe('合计')
    expect(footer[1]).toBe('216')
    expect(footer[2]).toBe('242')
  })

  it('stacks series segments instead of grouping them', () => {
    const { container } = renderBlock({
      items: [{
        type: 'chart',
        data: [],
        stacked: true,
        series: [
          { label: '已完成', data: [{ label: 'Q1', value: 30 }] },
          { label: '进行中', data: [{ label: 'Q1', value: 10 }] },
        ],
      }],
    })
    const segments = container.querySelectorAll('[class*="stackSeg"]')
    expect(segments).toHaveLength(2)
    // 30/40 of the total height -> 75%.
    expect((segments[0] as HTMLElement).style.height).toBe('75%')
  })

  it('shows an instant tooltip with the segment breakdown on hover', () => {
    const { container } = renderBlock({
      items: [{
        type: 'chart',
        data: [],
        stacked: true,
        series: [
          { label: '已完成', data: [{ label: 'Q1', value: 30 }] },
          { label: '进行中', data: [{ label: 'Q1', value: 10 }] },
        ],
      }],
    })
    const segments = container.querySelectorAll('[class*="stackSeg"]')
    fireEvent.mouseEnter(segments[0]!)
    const tip = container.querySelector('[class*="chartTip"]')
    expect(tip?.textContent).toContain('已完成')
    expect(tip?.textContent).toContain('30')
    expect(tip?.textContent).toContain('合计')
    fireEvent.mouseLeave(container.querySelector('[data-genui-chart]')!)
    expect(container.querySelector('[class*="chartTip"]')).toBeNull()
  })

  it('tints a card by tone', () => {
    const { container } = renderBlock({
      items: [{ type: 'card', tone: 'success', title: '已通过', items: [{ type: 'text', content: 'ok' }] }],
    })
    expect(container.querySelector('[class*="cardSuccess"]')).not.toBeNull()
  })
})

describe('v6: rich table columns', () => {
  it('renders spark, ring and index cells', () => {
    const { container } = renderBlock({
      items: [{
        type: 'table',
        columns: ['#', '服务', '趋势', '可用率'],
        types: ['index', 'text', 'spark', 'ring'],
        rows: [['1', 'API', '3,5,4,8,6', '99.96']],
      }],
    })
    expect(container.querySelector('[class*="cellIndex"]')?.textContent).toBe('1')
    const spark = container.querySelector('svg[class*="cellSpark"]')
    expect(spark?.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(5)
    expect(container.querySelector('[class*="cellRing"]')?.textContent).toContain('99.96')
  })

  it('falls back to text when a spark cell has no number list', () => {
    const { container } = renderBlock({
      items: [{ type: 'table', columns: ['趋势'], types: ['spark'], rows: [['n/a']] }],
    })
    expect(container.querySelector('svg[class*="cellSpark"]')).toBeNull()
    expect(container.textContent).toContain('n/a')
  })
})

describe('v5: progress ring, target marker, stat unit split', () => {
  it('renders a ring gauge with the value in the middle', () => {
    const { container } = renderBlock({
      items: [{ type: 'progress', variant: 'ring', value: 72, label: '完成度' }],
    })
    const ring = container.querySelector('[role="progressbar"]')
    expect(ring).not.toBeNull()
    expect(ring!.querySelector('svg')).not.toBeNull()
    expect(ring!.textContent).toContain('72%')
    expect(ring!.textContent).toContain('完成度')
  })

  it('marks the target on a bar track', () => {
    const { container } = renderBlock({
      items: [{ type: 'progress', value: 64, target: 80 }],
    })
    const mark = container.querySelector('[class*="targetMark"]') as HTMLElement
    expect(mark).not.toBeNull()
    expect(mark.style.left).toBe('80%')
  })

  it('splits a stat value into number and unit for the baseline typography', () => {
    const { container } = renderBlock({
      items: [{ type: 'stat', label: '内存', value: '6.8 GB' }],
    })
    const unit = container.querySelector('[class*="statUnit"]')
    expect(unit?.textContent).toBe('GB')
    expect(container.querySelector('[class*="statValue"]')?.textContent).toBe('6.8GB')
  })
})

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

describe('v2.9/v8: chart hover tooltips', () => {
  it('bars show the label and value in the instant tooltip', () => {
    const { container } = renderBlock({
      items: [{ type: 'chart', data: [{ label: '一', value: 42 }] }],
    })
    fireEvent.mouseEnter(container.querySelector('[class*="barFill"]')!)
    const tip = container.querySelector('[class*="chartTip"]')
    expect(tip?.textContent).toContain('一')
    expect(tip?.textContent).toContain('42')
  })

  it('grouped bars name the series and the category total', () => {
    const { container } = renderBlock({
      items: [{ type: 'chart', series: [
        { label: '本月', data: [{ label: 'Q1', value: 3 }] },
        { label: '上月', data: [{ label: 'Q1', value: 5 }] },
      ] }],
    })
    fireEvent.mouseEnter(container.querySelector('[class*="groupedFill"]')!)
    const tip = container.querySelector('[class*="chartTip"]')
    expect(tip?.textContent).toContain('本月')
    expect(tip?.textContent).toContain('3')
    expect(tip?.textContent).toContain('合计')
  })

  it('donut arcs show label, value and share', () => {
    const { container } = renderBlock({
      items: [{ type: 'chart', kind: 'donut', data: [{ label: 'A', value: 30 }] }],
    })
    fireEvent.mouseEnter(container.querySelector('[class*="donutSeg"]')!)
    const tip = container.querySelector('[class*="chartTip"]')
    expect(tip?.textContent).toContain('A')
    expect(tip?.textContent).toContain('30')
    expect(tip?.textContent).toContain('100.0%')
  })

  it('line dots show the point value', () => {
    const { container } = renderBlock({
      items: [{ type: 'chart', kind: 'line', data: [
        { label: '周一', value: 8 }, { label: '周二', value: 12 },
      ] }],
    })
    fireEvent.mouseEnter(container.querySelectorAll('[class*="lineDot"]')[0]!)
    expect(container.querySelector('[class*="chartTip"]')?.textContent).toContain('周一')
    fireEvent.mouseEnter(container.querySelectorAll('[class*="lineDot"]')[1]!)
    expect(container.querySelector('[class*="chartTip"]')?.textContent).toContain('12')
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
