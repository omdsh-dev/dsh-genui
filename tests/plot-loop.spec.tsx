// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlotBlock } from '../src/client/PlotBlock.tsx'

describe('PlotBlock loop animation', () => {
  let rafTime = 0
  let nextId = 1
  let callbacks: Map<number, FrameRequestCallback>

  beforeEach(() => {
    rafTime = 0
    nextId = 1
    callbacks = new Map()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextId++
      callbacks.set(id, cb)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      callbacks.delete(id)
    })
    vi.stubGlobal('performance', { now: () => rafTime })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  function tick(ms: number): void {
    rafTime += ms
    const current = [...callbacks.entries()]
    for (const [id] of current) callbacks.delete(id)
    for (const [, callback] of current) callback(rafTime)
  }

  it('starts a second cycle when loop is true', () => {
    const { container } = render(<PlotBlock series={[{
      expr: 'a*x',
      params: [{ name: 'a', value: 1, min: 0, max: 5, animateTo: 3, durationMs: 100, loop: true }],
    }]} />)

    const play = container.querySelector('[class*="playBtn"]') as HTMLButtonElement
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement

    fireEvent.click(play)
    expect(play.textContent).toContain('暂停')

    act(() => { tick(100) })
    expect(Number(slider.value)).toBe(1)
    expect(play.textContent).toContain('暂停')
    expect(callbacks.size).toBe(1)

    act(() => { tick(50) })
    expect(Number(slider.value)).toBeGreaterThan(1)
    expect(Number(slider.value)).toBeLessThan(3)
    expect(play.textContent).toContain('暂停')
  })

  it('cancels the RAF chain when paused', () => {
    const { container } = render(<PlotBlock series={[{
      expr: 'a*x',
      params: [{ name: 'a', value: 1, min: 0, max: 5, animateTo: 3, durationMs: 100, loop: true }],
    }]} />)

    const play = container.querySelector('[class*="playBtn"]') as HTMLButtonElement
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement

    fireEvent.click(play)
    act(() => { tick(50) })
    const pausedAt = Number(slider.value)

    fireEvent.click(play)
    expect(play.textContent).toContain('播放')
    expect(callbacks.size).toBe(0)

    act(() => { tick(200) })
    expect(Number(slider.value)).toBe(pausedAt)
  })
})
