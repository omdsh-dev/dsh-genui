// @vitest-environment jsdom
// Plot view affordances: an accidental zoom used to be a one-way door (the
// wheel was swallowed unconditionally and nothing showed the new domain).
import { cleanup, fireEvent, render, act } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PlotBlock } from '../src/client/PlotBlock.tsx'

afterEach(cleanup)

function mockRect(svg: Element): void {
  svg.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 480, height: 320, right: 480, bottom: 320, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect)
}

describe('plot view affordances', () => {
  it('shows the zoom hint, reveals the domain after a zoom, and resets', () => {
    const { container } = render(
      <PlotBlock xMin={-6.28} xMax={6.28} series={[{ expr: 'sin(x)', label: 'sin(x)' }]} />,
    )
    const svg = container.querySelector('[data-genui-plot] svg') as Element
    mockRect(svg)
    // Initial state: hint only, no reset affordance.
    expect(container.textContent).toContain('滚轮缩放')
    expect(container.querySelector('[class*="plotReset"]')).toBeNull()

    act(() => {
      svg.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -120, clientX: 240, clientY: 160, bubbles: true, cancelable: true, metaKey: true,
      }))
    })
    // Zoomed: the domain is surfaced and the way back exists.
    expect(container.textContent).toContain('x ∈ [')
    const reset = container.querySelector('[class*="plotReset"]') as HTMLButtonElement
    expect(reset).not.toBeNull()

    fireEvent.click(reset)
    expect(container.textContent).toContain('滚轮缩放')
    expect(container.querySelector('[class*="plotReset"]')).toBeNull()
  })
})
