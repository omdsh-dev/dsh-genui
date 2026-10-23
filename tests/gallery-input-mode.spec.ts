import { describe, expect, it, vi } from 'vitest'
import { createGalleryInputMode } from '../scripts/gallery-input-mode.mjs'

function fixture(original = { points: 0, hover: true, coarse: false }) {
  const calls: unknown[] = []
  let current = { ...original }
  const session = {
    async send(method: string, params: { enabled: boolean; maxTouchPoints?: number }) {
      calls.push([method, params])
      current = { points: params.enabled ? params.maxTouchPoints ?? 1 : 0, hover: !params.enabled, coarse: params.enabled }
    },
    async detach() { current = { points: 0, hover: true, coarse: false }; calls.push('detach') },
  }
  const page = {
    url: () => 'http://127.0.0.1:3190/',
    evaluate: async () => ({ ...original }),
    context: () => ({ async newCDPSession() { calls.push('attach'); return session } }),
    async waitForFunction(_predicate: unknown, expected: boolean | typeof original, options: { timeout: number }) {
      expect(options.timeout).toBe(8000)
      vi.stubGlobal('navigator', { maxTouchPoints: current.points })
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(hover: none)' ? !current.hover
        : query === '(hover: hover)' ? current.hover : query === '(pointer: coarse)' ? current.coarse : false }))
      try { expect((_predicate as (value: unknown) => boolean)(expected)).toBe(true) }
      finally { vi.unstubAllGlobals() }
      if (typeof expected === 'boolean') expect(current).toEqual({ points: expected ? 1 : 0, hover: !expected, coarse: expected })
      else expect(current).toEqual(expected)
      calls.push(['verified', expected])
    },
  }
  return { page, session, calls }
}

describe('owned-page input capability lifecycle (synthetic contract, not browser acceptance)', () => {
  it('checks desktop/touch transitions and verifies original desktop mode after detach', async () => {
    const f = fixture()
    const mode = await createGalleryInputMode(f.page)
    expect(await mode.set(false)).toEqual({ touch: false, hover: true, coarsePointer: false })
    expect(await mode.set(true)).toEqual({ touch: true, hover: false, coarsePointer: true })
    await mode.restore()
    expect(f.calls).toContain('detach')
    expect(f.calls.at(-1)).toEqual(['verified', { points: 0, hover: true, coarse: false }])
    expect(f.calls.filter(c => Array.isArray(c) && c[0] === 'Emulation.setTouchEmulationEnabled')).toHaveLength(3)
  })
  it.each([1, 5])('rejects an initially touch-enabled page (%s points) before attaching', async points => {
    const f = fixture({ points, hover: false, coarse: true })
    await expect(createGalleryInputMode(f.page)).rejects.toThrow('must start in desktop mode')
    expect(f.calls).toEqual([])
  })
  it('rejects external and non-loopback pages before connecting', async () => {
    for (const url of ['https://example.com/', 'http://localhost/', 'file:///tmp/test.html']) {
      const f = fixture(); f.page.url = () => url
      await expect(createGalleryInputMode(f.page)).rejects.toThrow()
      expect(f.calls).toEqual([])
    }
  })
  it('does not turn a failed media check into a successful mode transition', async () => {
    const f = fixture(); const mode = await createGalleryInputMode(f.page)
    f.page.waitForFunction = async () => { throw new Error('synthetic media mismatch') }
    await expect(mode.set(false)).rejects.toThrow('synthetic media mismatch')
    await expect(mode.restore()).rejects.toThrow('Restore gallery input mode failed')
    expect(f.calls).toContain('detach')
  })
  it('detaches even if restoring capability fails', async () => {
    const f = fixture(); const mode = await createGalleryInputMode(f.page)
    f.session.send = async () => { throw new Error('synthetic restore rejection') }
    await expect(mode.restore()).rejects.toThrow('Restore gallery input mode failed')
    expect(f.calls).toContain('detach')
  })
  it('detects capability changes caused by detach instead of trusting pre-detach state', async () => {
    const f = fixture(); const mode = await createGalleryInputMode(f.page)
    f.session.detach = async () => { await f.session.send('synthetic detach side-effect', { enabled: true, maxTouchPoints: 1 }) }
    await expect(mode.restore()).rejects.toThrow('Restore gallery input mode failed')
  })
  it('reports detach failures instead of declaring successful cleanup', async () => {
    const f = fixture(); const mode = await createGalleryInputMode(f.page)
    f.session.detach = async () => { throw new Error('synthetic detach rejection') }
    await expect(mode.restore()).rejects.toThrow('Restore gallery input mode failed')
  })
})
