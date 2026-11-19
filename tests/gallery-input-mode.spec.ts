import { afterEach, describe, expect, it, vi } from 'vitest'
import { galleryErrorDetails, readGalleryInputCapabilities } from '../scripts/gallery-input-mode.mjs'

const desktop = { points: 0, hover: true, hoverNone: false, coarsePointer: false, finePointer: true }
const touch = { points: 1, hover: false, hoverNone: true, coarsePointer: true, finePointer: false }
function fixture(actual = desktop) {
  return { url: () => 'http://127.0.0.1:3190/', evaluate: vi.fn(async () => ({ ...actual })) }
}
afterEach(() => vi.useRealTimers())
describe('fixed input evidence (synthetic contract, not browser acceptance)', () => {
  it.each([['desktop', desktop], ['touch', touch]] as const)('reads %s without protocol or app mutation', async (profile, actual) => {
    const page = fixture(actual)
    const observations: unknown[] = []
    expect(await readGalleryInputCapabilities(page, profile, { phase: 'after-resize', observations }))
      .toEqual({ profile, ...actual })
    expect(observations).toEqual([{ phase: 'after-resize', profile, ...actual }])
    expect(page.evaluate).toHaveBeenCalledOnce()
  })
  it.each([
    ['desktop', touch], ['touch', desktop], ['touch', { ...touch, coarsePointer: false }],
    ['desktop', { ...desktop, hover: false }],
  ] as const)('records actual values before rejecting inconsistent %s capability', async (profile, actual) => {
    const observations: unknown[] = []
    await expect(readGalleryInputCapabilities(fixture(actual), profile, { phase: 'after-screenshot', observations }))
      .rejects.toThrow(`Fixed ${profile} capability mismatch at after-screenshot: ${JSON.stringify(actual)}`)
    expect(observations).toEqual([{ phase: 'after-screenshot', profile, ...actual }])
  })
  it('rejects non-loopback and invalid profiles before evaluating', async () => {
    for (const url of ['https://example.com/', 'http://localhost/', 'file:///tmp/test.html']) {
      const page = fixture(); page.url = () => url
      await expect(readGalleryInputCapabilities(page, 'desktop')).rejects.toThrow()
      expect(page.evaluate).not.toHaveBeenCalled()
    }
    const page = fixture()
    await expect(readGalleryInputCapabilities(page, 'dynamic')).rejects.toThrow('explicit fixed input profile')
    expect(page.evaluate).not.toHaveBeenCalled()
  })
  it('bounds a failed browser read to eight seconds', async () => {
    vi.useFakeTimers()
    const page = fixture(); page.evaluate = vi.fn(() => new Promise(() => {})) as typeof page.evaluate
    const result = expect(readGalleryInputCapabilities(page, 'desktop')).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(8000)
    await result
    expect(vi.getTimerCount()).toBe(0)
  })
  it('retains original nested failure detail while removing ready-URL tokens', () => {
    const original = new Error('input changed: points=0 hover=false; http://127.0.0.1:3190/?token=synthetic_secret')
    const report = galleryErrorDetails(new AggregateError([original], 'Gallery failed'))
    expect(report.errors[0].message).toContain('input changed: points=0 hover=false')
    expect(JSON.stringify(report)).not.toContain('synthetic_secret')
    expect(report.errors[0].message).toContain('?token=[redacted]')
  })
})
