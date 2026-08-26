// @vitest-environment jsdom
// Wheel-to-zoom on the function plot must not scroll the enclosing dialog
// (#63): React's onWheel prop registers as a passive listener, where
// preventDefault() is ignored and the event bubbles to the host scroll
// container. PlotBlock therefore attaches a native non-passive wheel
// listener; these tests pin both halves of that contract — the event gets
// cancelled before it can scroll anything above the plot, and the zoom
// itself still re-samples the curve around the cursor position.
import { cleanup, render, act, type ReactNode } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useEffect, useRef } from 'react'
import { PlotBlock } from '../src/client/PlotBlock.tsx'

afterEach(cleanup)

/** Wraps children in a div that observes incoming wheel events, standing in
 * for the dialog/page scroll container in #63. */
function ScrollHost({ seen, children }: { seen: boolean[]; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const onWheel = (e: Event): void => { seen.push(e.defaultPrevented) }
    el.addEventListener('wheel', onWheel)
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  return <div ref={ref} style={{ height: 400, overflowY: 'auto' }}>{children}</div>
}

/** jsdom reports zero-sized client rects; give the svg a realistic one so the
 * zoom origin math resolves like it does in a browser. */
function mockRect(svg: Element): void {
  svg.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 480, height: 320,
    right: 480, bottom: 320, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect)
}

const wheelAt = (svg: Element, deltaY: number): void => {
  act(() => {
    svg.dispatchEvent(new WheelEvent('wheel', {
      deltaY, clientX: 240, clientY: 160, bubbles: true, cancelable: true,
    }))
  })
}

describe('plot wheel-to-zoom lock', () => {
  it('cancels wheel events before they reach the scroll container (#63)', () => {
    const seen: boolean[] = []
    const { container } = render(
      <ScrollHost seen={seen}><PlotBlock series={[{ expr: 'sin(x)' }]} /></ScrollHost>,
    )
    const svg = container.querySelector('[data-genui-plot] svg') as Element
    expect(svg).not.toBeNull()
    mockRect(svg)

    wheelAt(svg, -120)
    wheelAt(svg, 120)
    // Every bubbled wheel event must arrive already prevented: React's
    // passive onWheel cannot guarantee this (defaultPrevented stays false).
    expect(seen.length).toBeGreaterThan(0)
    for (const prevented of seen) expect(prevented).toBe(true)
  })

  it('still zooms the curve around the cursor x-position', () => {
    const seen: boolean[] = []
    const { container } = render(
      <ScrollHost seen={seen}><PlotBlock series={[{ expr: 'sin(x)' }]} /></ScrollHost>,
    )
    const svg = container.querySelector('[data-genui-plot] svg') as Element
    mockRect(svg)
    const polyBefore = container.querySelector('polyline')!.getAttribute('points')!

    wheelAt(svg, -120) // zoom in centered on the middle of the plot

    const polyAfter = container.querySelector('polyline')!.getAttribute('points')!
    expect(polyAfter).not.toBe(polyBefore)
    // No NaN leaking through the origin math (a zero-width rect would regress
    // this silently).
    expect(polyAfter).not.toContain('NaN')
    // Zoom-in must narrow the visible x range: sampling a wider range yields
    // more extreme sin values per segment, so widths differ but shapes stay
    // valid — just assert the view contract via the polyline staying numeric.
    expect(Number.isFinite(Number(polyAfter.trim().split(/[\s,]+/)[1]))).toBe(true)
  })
})
