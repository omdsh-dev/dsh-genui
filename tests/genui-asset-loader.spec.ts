// @vitest-environment jsdom
// Asset-bundle loader: URL resolution (rev from the boot graph), memoized
// script injection, engine handoff, and the failure path.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assetUrl, loadGenuiAsset } from '../src/client/asset-loader.ts'
import { FENCE_MOUNTED_EVENT, prefetchGenuiAssets, prefetchOnFirstFence } from '../src/client/index.tsx'

afterEach(() => {
  document.head.innerHTML = ''
  delete (window as unknown as Record<string, unknown>).__DSH_BOOT__
  delete (window as unknown as Record<string, unknown>).__GenuiAssets__
})

const PLUGIN_ID = '@changfenhuang/dsh-genui'

describe('assetUrl', () => {
  it('returns the asset path without a query when the boot graph is absent', () => {
    expect(assetUrl('mermaid.js')).toBe(`/plugins/${PLUGIN_ID}/assets/mermaid.js`)
  })

  it('appends the plugin row rev from the boot graph', () => {
    ;(window as unknown as Record<string, unknown>).__DSH_BOOT__ = {
      entries: [
        { id: 'other-plugin', rev: 'aaaaaaaaaaaa' },
        { id: PLUGIN_ID, rev: 'bbbbbbbbbbbb' },
      ],
    }
    expect(assetUrl('three.js')).toBe(`/plugins/${PLUGIN_ID}/assets/three.js?rev=bbbbbbbbbbbb`)
  })
})

describe('loadGenuiAsset', () => {
  it('injects one script per file and resolves the registered engine', async () => {
    const api = { hello: 'engine' }
    const promise = loadGenuiAsset<typeof api>('mermaid')
    const scripts = document.head.querySelectorAll('script')
    expect(scripts).toHaveLength(1)
    expect(scripts[0]!.getAttribute('src')).toBe(`/plugins/${PLUGIN_ID}/assets/mermaid.js`)
    // Simulate the bundle having executed and registered its engine.
    ;(window as unknown as Record<string, unknown>).__GenuiAssets__ = { mermaid: api }
    scripts[0]!.dispatchEvent(new Event('load'))
    await expect(promise).resolves.toBe(api)
    // Memoized: a second request reuses the same promise, no new script tag.
    await loadGenuiAsset('mermaid')
    expect(document.head.querySelectorAll('script')).toHaveLength(1)
  })

  it('rejects when the script fails to load (old host without the route)', async () => {
    const promise = loadGenuiAsset('three')
    const script = document.head.querySelector('script')!
    script.dispatchEvent(new Event('error'))
    await expect(promise).rejects.toThrow(/failed to load/)
  })

  it('rejects when the script loads but registers no engine', async () => {
    // Fresh module instance: the memoized map in the static import already
    // holds this file's promise from the previous test.
    vi.resetModules()
    const fresh = await import('../src/client/asset-loader.ts')
    const promise = fresh.loadGenuiAsset('three')
    const script = document.head.querySelector('script')!
    ;(window as unknown as Record<string, unknown>).__GenuiAssets__ = {}
    script.dispatchEvent(new Event('load'))
    await expect(promise).rejects.toThrow(/registered no 'three' engine/)
  })
})

describe('idle prefetch', () => {
  it('injects one low-priority prefetch link per engine asset', () => {
    prefetchGenuiAssets()
    const links = [...document.head.querySelectorAll('link[rel="prefetch"]')]
    expect(links.map(l => l.getAttribute('href'))).toEqual([
      `/plugins/@changfenhuang/dsh-genui/assets/mermaid.js`,
      `/plugins/@changfenhuang/dsh-genui/assets/three.js`,
    ])
    expect(links.every(l => (l as HTMLLinkElement).as === 'script')).toBe(true)
    // idempotent: a second call adds nothing
    prefetchGenuiAssets()
    expect(document.head.querySelectorAll('link[rel="prefetch"]').length).toBe(2)
  })
})

describe('prefetch on first fence', () => {
  it('adds no prefetch link at boot and none until a fence mounts', () => {
    vi.useFakeTimers()
    const dispose = prefetchOnFirstFence()
    vi.advanceTimersByTime(10_000)
    expect(document.head.querySelectorAll('link[rel="prefetch"]').length).toBe(0)
    dispose()
    vi.useRealTimers()
  })
  it('prefetches the engines once, after the first fence mounts', () => {
    vi.useFakeTimers()
    const dispose = prefetchOnFirstFence()
    document.dispatchEvent(new Event(FENCE_MOUNTED_EVENT))
    document.dispatchEvent(new Event(FENCE_MOUNTED_EVENT))
    vi.advanceTimersByTime(10_000)
    expect(document.head.querySelectorAll('link[rel="prefetch"]').length).toBe(2)
    dispose()
    vi.useRealTimers()
  })
  it('the disposer removes the pending listener', () => {
    vi.useFakeTimers()
    prefetchOnFirstFence()()
    document.dispatchEvent(new Event(FENCE_MOUNTED_EVENT))
    vi.advanceTimersByTime(10_000)
    expect(document.head.querySelectorAll('link[rel="prefetch"]').length).toBe(0)
    vi.useRealTimers()
  })
  it('the disposer also cancels a prefetch that is already scheduled', () => {
    vi.useFakeTimers()
    const dispose = prefetchOnFirstFence()
    document.dispatchEvent(new Event(FENCE_MOUNTED_EVENT))
    dispose()
    vi.advanceTimersByTime(10_000)
    expect(document.head.querySelectorAll('link[rel="prefetch"]').length).toBe(0)
    vi.useRealTimers()
  })
})
