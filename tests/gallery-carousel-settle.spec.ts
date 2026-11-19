import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readGalleryCarouselPosition, settleGalleryCarousel } from '../scripts/gallery-browser-checks.mjs'
import { galleryErrorDetails, gallerySafeError } from '../scripts/gallery-input-mode.mjs'

const state = (left = 0, previousCount = 0, nextCount = 1, maximum = 600) => ({ left, maximum,
  snapDistance: 0, previousCount, nextCount })
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren() })

describe('carousel readiness (async synthetic controls, not Chromium acceptance)', () => {
  it('waits for delayed React Next removal after scrolling reaches the final snap', async () => {
    vi.useFakeTimers()
    let actual = state(600, 1, 1)
    const read = vi.fn(async () => ({ ...actual }))
    let resolved = false
    const result = settleGalleryCarousel(read, value => value.left >= value.maximum - 1, 'Next reaches final edge')
      .then(value => { resolved = true; return value })
    await vi.advanceTimersByTimeAsync(100)
    expect(resolved).toBe(false)
    actual = state(600, 1, 0)
    await vi.advanceTimersByTimeAsync(50)
    expect(resolved).toBe(false) // One coherent sample is not sufficient.
    await vi.advanceTimersByTimeAsync(50)
    expect((await result).nextCount).toBe(0)
  })
  it('waits for Previous removal before the caller can issue another Enter', async () => {
    vi.useFakeTimers()
    let actual = state(0, 1, 1)
    let enters = 1
    const result = settleGalleryCarousel(async () => ({ ...actual }), value => value.left < 100, 'Keyboard Previous')
      .then(value => { if (value.previousCount) enters++; return value })
    await vi.advanceTimersByTimeAsync(100)
    expect(enters).toBe(1)
    actual = state(0, 0, 1)
    await vi.advanceTimersByTimeAsync(100)
    expect((await result).previousCount).toBe(0)
    expect(enters).toBe(1)
  })
  it('does not complete at an intermediate coherent snap followed by more movement', async () => {
    vi.useFakeTimers()
    const values = [state(300, 1, 1), { ...state(340, 1, 1), snapDistance: 40 }, state(600, 1, 0), state(600, 1, 0)]
    let index = 0
    let resolved = false
    const result = settleGalleryCarousel(async () => values[Math.min(index++, values.length - 1)], value => value.left > 2, 'Moving track')
      .then(value => { resolved = true; return value })
    await vi.advanceTimersByTimeAsync(100)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(50)
    expect((await result).left).toBe(600)
  })
  it.each([
    state(0, 0, 1), state(1, 0, 1), state(1.1, 1, 1), state(599, 1, 0), state(598.9, 1, 1),
    state(0, 0, 0, 1), state(0, 0, 0, 0),
  ])('matches exact overflow and one-pixel DOM thresholds: %j', async actual => {
    vi.useFakeTimers()
    const read = vi.fn(async () => ({ ...actual }))
    const result = settleGalleryCarousel(read, () => true, 'Boundary')
    await vi.advanceTimersByTimeAsync(50)
    expect(await result).toEqual(actual)
    expect(read).toHaveBeenCalledTimes(2)
  })
  it.each([state(0, 1, 1), state(600, 1, 1), state(300, 0, 1), state(300, 1, 0)])(
    'fails stale or missing controls within the eight-second bound: %j', async actual => {
      vi.useFakeTimers()
      const result = expect(settleGalleryCarousel(async () => ({ ...actual }), () => true, 'Stale edges'))
        .rejects.toThrow(/Stale edges: scroll\/snap and edge DOM did not settle; actual=.*previousCount.*expected=/)
      await vi.advanceTimersByTimeAsync(8000)
      await result
      expect(vi.getTimerCount()).toBe(0)
    })
  it('does not accept the old two-pixel End boundary while Next legitimately remains', async () => {
    vi.useFakeTimers()
    let actual = state(598.5, 1, 1)
    let resolved = false
    const result = settleGalleryCarousel(async () => ({ ...actual }), value => value.left >= value.maximum - 1, 'End edge')
      .then(value => { resolved = true; return value })
    await vi.advanceTimersByTimeAsync(100)
    expect(resolved).toBe(false)
    actual = state(600, 1, 0)
    await vi.advanceTimersByTimeAsync(100)
    expect((await result).nextCount).toBe(0)
  })
  it('bounds an unresponsive DOM read without retrying or faking readiness', async () => {
    vi.useFakeTimers()
    const read = vi.fn(() => new Promise(() => {}))
    const result = expect(settleGalleryCarousel(read, () => true, 'Stalled browser')).rejects.toThrow('read scroll/snap/edge state; last=null')
    await vi.advanceTimersByTimeAsync(8000)
    await result
    expect(read).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('counts CSS-hidden controls in the same scoped DOM snapshot, excluding another track', () => {
    const wrap = document.createElement('div')
    wrap.innerHTML = '<button aria-controls="track" aria-label="Previous cards" style="display:none"></button>'
      + '<button aria-controls="track" aria-label="下一组卡片" style="display:none"></button>'
      + '<button aria-controls="other-track" aria-label="Previous cards"></button>'
      + '<button aria-controls="track" aria-label="Not navigation"></button>'
      + '<div id="track"><div></div><div></div><div></div></div>'
    document.body.append(wrap)
    const track = wrap.querySelector('#track') as HTMLElement
    Object.defineProperties(track, { scrollWidth: { value: 1000 }, clientWidth: { value: 400 } })
    track.scrollLeft = 300
    track.getBoundingClientRect = () => ({ left: 20 } as DOMRect)
    Array.from(track.children).forEach((slide, index) => { slide.getBoundingClientRect = () => ({ left: -280 + index * 300 } as DOMRect) })
    expect(readGalleryCarouselPosition(track)).toEqual(state(300, 1, 1))
    wrap.querySelector('[aria-label="Previous cards"]')!.remove()
    expect(readGalleryCarouselPosition(track).previousCount).toBe(0)
  })
  it('retains only an allowlisted gallery basename and location, never a raw stack or URL', () => {
    const error = new Error('assertion failed at http://127.0.0.1:3190/?token=synthetic_secret')
    error.stack = 'Error: secret stack\n at method (/private/root/gallery-browser-checks.mjs:225:20)\n at https://host/?token=raw_secret'
    const detail = galleryErrorDetails(error)
    expect(detail.location).toBe('gallery-browser-checks.mjs:225:20')
    expect(JSON.stringify(detail)).not.toMatch(/private|raw_secret|synthetic_secret|secret stack/)
    expect(gallerySafeError(error).message).toContain('gallery-browser-checks.mjs:225:20')
    error.stack = 'Error\n at /private/gallery-untrusted.mjs:1:2'
    expect(galleryErrorDetails(error)).not.toHaveProperty('location')
  })
  it('keeps separate focus assertions and adds no focus repair or fixed settling wait', async () => {
    const main = await readFile(join(process.cwd(), 'scripts/gallery-browser-checks.mjs'), 'utf8')
    expect(main.match(/await track\.focus\(/g)).toHaveLength(1)
    expect(main).toContain("assert.ok(await active(track), 'Removed Next hands focus to the track')")
    expect(main).toContain("assert.ok(await active(track), 'Removed Previous hands focus to the track')")
    expect(main).toContain("'Next disappears at the last edge after trusted Next click'")
    expect(main).toContain("value => value.left >= value.maximum - 1")
    expect(main).not.toMatch(/waitForTimeout|force:\s*true|element\.click\(/)
  })
})
