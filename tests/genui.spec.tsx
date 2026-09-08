// @vitest-environment jsdom
// GenUI fence rendering: a ```dsh-ui fence in assistant markdown renders as
// interactive components (GenuiBlock) once settled; a malformed body falls
// back to the code block, and streaming renders plain (settled-only contract).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { hasFenceRegistry } from './setup'
import { MarkdownText } from './markdown-labels.tsx'

afterEach(cleanup)

const SPEC = {
  title: '订单概览',
  gap: 12,
  items: [
    { type: 'grid', cols: 3, items: [
      { type: 'stat', label: '总收入', value: '¥128,430', delta: '+12.4%' },
      { type: 'stat', label: '订单数', value: '1,024', delta: '-3.1%' },
      { type: 'stat', label: '转化率', value: '3.7%' },
    ] },
    { type: 'card', title: '近 7 日收入', items: [
      { type: 'chart', data: [
        { label: '一', value: 42 }, { label: '二', value: 58 }, { label: '三', value: 49 },
      ] },
    ] },
    { type: 'tabs', tabs: [
      { label: '订单', items: [
        { type: 'table', columns: ['订单', '金额'], rows: [['#1042', '¥4,200'], ['#1043', '¥1,850']] },
      ] },
      { label: '退款', items: [
        { type: 'list', items: ['无待处理退款'] },
      ] },
    ] },
    { type: 'row', items: [
      { type: 'button', label: '导出', tone: 'primary' },
      { type: 'button', label: '删除', tone: 'danger' },
      { type: 'badge', label: '实时', tone: 'success' },
    ] },
  ],
}

function fenced(spec: unknown): string {
  return `说明文字在前。\n\n\`\`\`dsh-ui\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\n说明文字在后。`
}

describe('GenUI fence rendering', () => {
  it.skipIf(!hasFenceRegistry)('renders a dsh-ui fence as interactive components between prose', () => {
    const { container } = render(<MarkdownText text={fenced(SPEC)} />)
    const block = container.querySelector('[data-genui]')
    expect(block).not.toBeNull()
    // The banner title comes from the spec.
    expect(block?.textContent).toContain('订单概览')
    // Prose still surrounds the block.
    expect(container.textContent).toContain('说明文字在前')
    expect(container.textContent).toContain('说明文字在后')
    // Stats rendered.
    expect(screen.getByText('¥128,430')).toBeTruthy()
    expect(screen.getByText('+12.4%')).toBeTruthy()
    // Chart bars rendered (3 data points).
    expect(container.querySelectorAll('[class*="barFill"]')).toHaveLength(3)
    // Buttons rendered and interactive.
    const exportBtn = screen.getByRole('button', { name: '导出' })
    expect(exportBtn).toBeTruthy()
  })

  it.skipIf(!hasFenceRegistry)('switches tabs locally', () => {
    const { container } = render(<MarkdownText text={fenced(SPEC)} />)
    const tabs = container.querySelectorAll('[role="tab"]')
    expect(tabs).toHaveLength(2)
    expect(container.textContent).toContain('#1042')
    fireEvent.click(tabs[1]!)
    expect(container.textContent).toContain('无待处理退款')
    expect(container.textContent).not.toContain('#1042')
  })

  it.skipIf(!hasFenceRegistry)('does not leak the raw fence into prose when rendered', () => {
    const { container } = render(<MarkdownText text={fenced(SPEC)} />)
    expect(container.textContent).not.toContain('"items"')
    expect(container.textContent).not.toContain('type')
  })

  it('falls back to a code block on a malformed fence body', () => {
    const { container } = render(<MarkdownText text={'```dsh-ui\n{ not json\n```'} />)
    expect(container.querySelector('[data-genui]')).toBeNull()
    expect(container.querySelector('pre')).not.toBeNull()
  })

  it('falls back to a code block when the body is not a spec shape', () => {
    const { container } = render(<MarkdownText text={'```dsh-ui\n{"hello":"world"}\n```'} />)
    expect(container.querySelector('[data-genui]')).toBeNull()
    expect(container.querySelector('pre')).not.toBeNull()
  })

  it.skipIf(!hasFenceRegistry)('renders a complete fence as components even while streaming', () => {
    // A closed ```dsh-ui fence renders as components mid-stream: the closing
    // fence is the completion point, so the UI appears before the reply ends.
    const { container } = render(<MarkdownText text={fenced(SPEC)} streaming />)
    expect(container.querySelector('[data-genui]')).not.toBeNull()
    expect(container.querySelector('pre')).toBeNull()
  })

  it('keeps an incomplete fence as code while streaming', () => {
    // A fence whose body is still growing (no closing ``` yet) parses as an
    // incomplete spec and stays a code block until it closes.
    const { container } = render(<MarkdownText text={'```dsh-ui\n{"title":"还在写' } streaming />)
    expect(container.querySelector('[data-genui]')).toBeNull()
    expect(container.querySelector('pre')).not.toBeNull()
  })
})

describe('GenUI nested list rendering', () => {
  it.skipIf(!hasFenceRegistry)('renders row/text/badge children inside a list', () => {
    const spec = {
      items: [
        {
          type: 'list',
          items: [
            'src',
            {
              type: 'row',
              items: [
                { type: 'text', text: 'app.ts' },
                { type: 'badge', text: 'TS' },
                { type: 'badge', value: '42 lines' },
              ],
            },
          ],
        },
      ],
    }
    const { container } = render(<MarkdownText text={fenced(spec)} />)
    expect(container.textContent).toContain('src')
    expect(container.textContent).toContain('app.ts')
    expect(container.textContent).toContain('TS')
    expect(container.textContent).toContain('42 lines')
  })
})

describe('GenUI chart skeleton (design system v2)', () => {
  it.skipIf(!hasFenceRegistry)('gives bar charts a plot area with baseline + 25/50/75% gridlines and a separate label row', () => {
    const spec = {
      items: [{ type: 'chart', data: [
        { label: '一', value: 42 }, { label: '二', value: 58 }, { label: '三', value: 49 },
      ] }],
    }
    const { container } = render(<MarkdownText text={fenced(spec)} />)
    const plot = container.querySelector('[class*="chartPlot"]')
    expect(plot).not.toBeNull()
    // 1 baseline + 3 gridlines inside the plot area.
    expect(plot?.querySelectorAll('[class*="baseline"]')).toHaveLength(1)
    expect(plot?.querySelectorAll('[class*="gridline"]')).toHaveLength(3)
    // Value annotations live inside the plot; category labels moved to the
    // dedicated label row below the axis (never crossing the lines).
    expect(plot?.querySelectorAll('[class*="barValue"]')).toHaveLength(3)
    expect(plot?.querySelectorAll('[class*="barLabel"]')).toHaveLength(0)
    const labels = container.querySelector('[class*="chartLabels"]')
    expect(labels?.querySelectorAll('[class*="barLabel"]')).toHaveLength(3)
    expect(container.querySelectorAll('[class*="barFill"]')).toHaveLength(3)
  })

  it.skipIf(!hasFenceRegistry)('renders per-bar values in grouped charts inside the plot', () => {
    const spec = {
      items: [{ type: 'chart', kind: 'bars', series: [
        { label: 'A', data: [{ label: '一', value: 30 }, { label: '二', value: 40 }] },
        { label: 'B', data: [{ label: '一', value: 60 }, { label: '二', value: 20 }] },
      ] }],
    }
    const { container } = render(<MarkdownText text={fenced(spec)} />)
    const plot = container.querySelector('[class*="chartPlot"]')
    expect(plot).not.toBeNull()
    expect(plot?.querySelectorAll('[class*="baseline"]')).toHaveLength(1)
    // 2 groups × 2 series = 4 per-bar value annotations.
    expect(plot?.querySelectorAll('[class*="groupValue"]')).toHaveLength(4)
    expect(plot?.querySelectorAll('[class*="groupedFill"]')).toHaveLength(4)
    const labels = container.querySelector('[class*="chartLabels"]')
    expect(labels?.querySelectorAll('[class*="barLabel"]')).toHaveLength(2)
  })

  it.skipIf(!hasFenceRegistry)('renders a Y axis with four ticks and gridlines on line charts', () => {
    const spec = {
      items: [{ type: 'chart', kind: 'line', data: [
        { label: '一', value: 10 }, { label: '二', value: 30 }, { label: '三', value: 20 },
      ] }],
    }
    const { container } = render(<MarkdownText text={fenced(spec)} />)
    const svg = container.querySelector('[class*="lineChart"] svg')
    expect(svg).not.toBeNull()
    // 4 ticks (0/1/2/3 → min..max) each with a gridline + label; the axis
    // line (tick 0) uses the stronger class.
    expect(svg?.querySelectorAll('[class*="lineGrid"]')).toHaveLength(4)
    expect(svg?.querySelectorAll('[class*="lineGridAxis"]')).toHaveLength(1)
    expect(svg?.querySelectorAll('[class*="lineTick"]')).toHaveLength(4)
    expect(svg?.querySelectorAll('[class*="linePath"]')).toHaveLength(1)
  })
})
