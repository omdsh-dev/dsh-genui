// @vitest-environment jsdom
// Plot param slider must re-sample the curve live (the v2 headline feature).
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { hasFenceRegistry } from './helpers/fence-host'
import { MarkdownText } from './markdown-labels.tsx'

afterEach(cleanup)

function fenced(spec: unknown): string {
  return `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
}

describe.skipIf(!hasFenceRegistry)('plot slider live re-render', () => {
  it('redraws the curve when a parameter slider changes', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      { type: 'plot', title: '可调', series: [{ expr: 'a*x', label: 'line', params: [{ name: 'a', value: 1, min: 0, max: 5 }] }] },
    ] })} />)
    const path = container.querySelector('[data-genui-plot] polyline')!
    const before = path.getAttribute('d')!
    const slider = container.querySelector('[data-genui-plot] input[type="range"]')!
    fireEvent.change(slider, { target: { value: '3' } })
    const after = path.getAttribute('points')
    expect(after).not.toBe(before)
    expect((container.querySelector('[data-genui-plot] input[type="range"]') as HTMLInputElement).value).toBe('3')
  })
})

describe.skipIf(!hasFenceRegistry)('plot implicit parameters', () => {
  it('renders a plot with undeclared single-letter params (defaults to 1)', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      // a*sin(b*x) 没带 params 声明 —— 应该能画（a=1, b=1）
      { type: 'plot', title: '隐式参数', series: [{ expr: 'a*sin(b*x)' }] },
    ] })} />)
    expect(container.querySelector('[data-genui-plot]')).not.toBeNull()
    const poly = container.querySelector('[data-genui-plot] polyline')
    expect(poly).not.toBeNull()
    expect(poly!.getAttribute('points')).not.toBe('')
    // 不显示滑块（没有显式 params 声明）
    expect(container.querySelector('[data-genui-plot] input[type="range"]')).toBeNull()
  })

  it('still rejects multi-letter unknown identifiers', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      { type: 'plot', series: [{ expr: 'bogus(x)' }] },
    ] })} />)
    expect(container.querySelector('[data-genui-plot]')).not.toBeNull()
    expect(container.querySelector('[data-genui-plot] polyline')).toBeNull()
    expect(container.textContent).toContain('无法绘制')
  })
})
