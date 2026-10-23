import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStandaloneHtmlDocument } from '../src/client/artifact/html.ts'
import { createGenuiArtifact } from '../src/client/artifact/create.ts'
import { artifactFromDocument, bundleNames, bundleText, cspFromDocument, parseHtml } from './helpers/standalone.ts'

afterEach(() => {
  document.head.innerHTML = ''
  delete (window as unknown as Record<string, unknown>).__GenuiAssets__
})
describe('map engine delivery contract', () => {
  it('loads exactly one map asset, resolving host/embed base and revision via the shared loader', async () => {
    vi.resetModules()
    const loader = await import('../src/client/asset-loader.ts')
    loader.setGenuiAssetBase('https://example.test/genui-assets/')
    const first = loader.loadGenuiAsset('maplibre')
    const second = loader.loadGenuiAsset('maplibre')
    expect(first).toBe(second)
    const script = document.head.querySelector('script')!
    expect(script.src).toBe('https://example.test/genui-assets/maplibre.js')
    expect(document.head.querySelectorAll('script')).toHaveLength(1)
    const api = { mountMap: vi.fn() }
    ;(window as unknown as Record<string, unknown>).__GenuiAssets__ = { maplibre: api }
    script.dispatchEvent(new Event('load'))
    await expect(first).resolves.toBe(api)
  })
  it('embeds worker-bearing engine bytes, preserves CSP and selection, and excludes host config', () => {
    const artifact = createGenuiArtifact({ items: [{ type: 'map', id: 'place', locations: [{ id: 'a', label: 'A', coordinates: [0, 0] }] }] }, { fields: { place: 'a' } })
    const html = createStandaloneHtmlDocument(artifact, new Map([
      ['standalone-runtime.js', new TextEncoder().encode('runtime')],
      ['maplibre.js', new TextEncoder().encode('/* inert bundled worker bytes */ engine')],
    ]))
    const doc = parseHtml(html)
    expect(bundleNames(doc)).toEqual(['maplibre', 'runtime'])
    expect(bundleText(doc, 'maplibre')).toContain('inert bundled worker')
    expect(cspFromDocument(doc)['connect-src']).toEqual(["'none'"])
    expect(cspFromDocument(doc)['script-src']).toEqual(["'unsafe-inline'", 'blob:'])
    expect(artifactFromDocument(doc).state?.fields).toEqual({ place: 'a' })
    expect(html).not.toContain('https://example.test')
    expect(artifactFromDocument(doc).spec.items[0]).not.toHaveProperty('style')
  })
  it('uses preloaded standalone map API without script injection', async () => {
    const api = { mountMap: vi.fn() }
    ;(window as unknown as Record<string, unknown>).__GenuiAssets__ = { maplibre: api }
    const { loadGenuiAsset } = await import('../src/client/standalone/asset-loader.ts')
    await expect(loadGenuiAsset('maplibre')).resolves.toBe(api)
    expect(document.head.querySelector('script')).toBeNull()
  })
})
