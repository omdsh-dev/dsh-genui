// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlotBlock } from '../src/client/PlotBlock.tsx'

beforeEach(() => { vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function setup(width: number) {
  const result = render(<PlotBlock xMin={-5} xMax={5} series={[{ expr: 'sin(x)' }]} />)
  const svg = result.container.querySelector('svg')!
  svg.getBoundingClientRect = () => ({
    x: 100, y: 20, left: 100, top: 20, width, height: width * 220 / 480,
    right: 100 + width, bottom: 20 + width * 220 / 480, toJSON: () => ({}),
  } as DOMRect)
  const points = () => result.container.querySelector('polyline')!.getAttribute('points')!
  const hint = () => result.container.querySelector('[class*="plotHint"]')!.textContent
  const yTicks = () => Array.from(svg.querySelectorAll('text[text-anchor="end"]'), el => el.textContent)
  return { ...result, svg, points, hint, yTicks }
}

function drag(target: Element, from: number, to: number): void {
  fireEvent.pointerDown(target, { clientX: from, clientY: 100, pointerId: 1 })
  fireEvent.pointerMove(target, { clientX: to, clientY: 100, pointerId: 1 })
  fireEvent.pointerUp(target, { clientX: to, clientY: 100, pointerId: 1 })
}

describe('responsive plot panning', () => {
  it.each([240, 480, 960, 1099])('pans one tenth of the domain for one tenth of the painted plot at width %s', width => {
    const plot = setup(width)
    const before = plot.points()
    const yBefore = plot.yTicks()
    drag(plot.svg, 150, 150 + width * 436 / 480 / 10)
    expect(plot.hint()).toBe('x ∈ [-6, 4]')
    expect(plot.points()).not.toBe(before)
    expect(plot.points()).not.toMatch(/NaN|Infinity/)
    expect(plot.yTicks()).toEqual(yBefore)
  })

  it.each([
    [240, 'x ∈ [-7, 3]'],
    [480, 'x ∈ [-6, 4]'],
    [960, 'x ∈ [-5.5, 4.5]'],
  ])('converts the same CSS-pixel drag at width %s', (width, expected) => {
    const plot = setup(Number(width))
    drag(plot.svg, 150, 193.6)
    expect(plot.hint()).toBe(expected)
  })

  it('preserves leftward direction and resets the original curve and domain', () => {
    const plot = setup(960)
    const before = plot.points()
    drag(plot.svg, 250, 162.8)
    expect(plot.hint()).toBe('x ∈ [-4, 6]')
    fireEvent.click(plot.getByRole('button', { name: '↺ 回到初始区间' }))
    expect(plot.hint()).toBe('⌘/Ctrl + 滚轮缩放 · 拖拽平移')
    expect(plot.points()).toBe(before)
  })

  it('uses the SVG width when the pointer event starts on a curve child', () => {
    const plot = setup(960)
    const child = plot.svg.querySelector('polyline')!
    child.getBoundingClientRect = () => ({ width: 120 } as DOMRect)
    drag(child, 150, 237.2)
    expect(plot.hint()).toBe('x ∈ [-6, 4]')
  })

  it('calculates every move from the drag start rather than accumulating drift', () => {
    const plot = setup(960)
    fireEvent.pointerDown(plot.svg, { clientX: 150, clientY: 100 })
    fireEvent.pointerMove(plot.svg, { clientX: 193.6, clientY: 100 })
    expect(plot.hint()).toBe('x ∈ [-5.5, 4.5]')
    fireEvent.pointerMove(plot.svg, { clientX: 237.2, clientY: 100 })
    expect(plot.hint()).toBe('x ∈ [-6, 4]')
    fireEvent.pointerMove(plot.svg, { clientX: 237.2, clientY: 100 })
    expect(plot.hint()).toBe('x ∈ [-6, 4]')
  })

  it.each([240, 480, 960])('keeps the initial four CSS-pixel drag threshold at width %s', width => {
    const plot = setup(width)
    const before = plot.points()
    drag(plot.svg, 150, 153)
    expect(plot.points()).toBe(before)
    expect(plot.hint()).toContain('滚轮缩放')
  })

  it.each(['pointerUp', 'pointerLeave'] as const)('ends a drag on %s', endEvent => {
    const plot = setup(960)
    fireEvent.pointerDown(plot.svg, { clientX: 150, clientY: 100 })
    fireEvent.pointerMove(plot.svg, { clientX: 237.2, clientY: 100 })
    fireEvent[endEvent](plot.svg, { clientX: 237.2, clientY: 100 })
    fireEvent.pointerMove(plot.svg, { clientX: 324.4, clientY: 100 })
    expect(plot.hint()).toBe('x ∈ [-6, 4]')
  })

  it.each([0, -1, NaN, Infinity, -Infinity])('ignores an unmeasurable SVG width %s without losing the curve', width => {
    const plot = setup(width)
    const before = plot.points()
    drag(plot.svg, 150, 237.2)
    expect(plot.points()).toBe(before)
    expect(plot.hint()).toContain('滚轮缩放')
    expect(plot.container.textContent).not.toContain('无法绘制')
  })

  it.each([240, 960])('leaves modifier-wheel zoom centered on the same SVG position at width %s', width => {
    const plot = setup(width)
    const event = new WheelEvent('wheel', {
      deltaY: -120, clientX: 100 + 252 / 480 * width,
      clientY: 100, ctrlKey: true, bubbles: true, cancelable: true,
    })
    fireEvent(plot.svg, event)
    expect(event.defaultPrevented).toBe(true)
    expect(plot.hint()).toBe('x ∈ [-4.35, 4.35]')
  })
})
