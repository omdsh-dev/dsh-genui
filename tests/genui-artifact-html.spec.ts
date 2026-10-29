import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { createStandaloneHtmlDocument } from '../src/client/artifact/html.ts'
import { createGenuiArtifact } from '../src/client/artifact/create.ts'
import { buildStandaloneHtml } from '../src/client/artifact/html.ts'
import { setGenuiAssetBase } from '../src/client/asset-loader.ts'
import type { GenuiSpec } from '../src/client/spec.ts'
import {
  artifactFromDocument,
  bundleNames,
  bundleText,
  cspFromDocument,
  parseHtml,
} from './helpers/standalone.ts'

describe('standalone HTML serialization', () => {
  it('keeps artifact text and bundles inside base64 payloads under a restrictive CSP', () => {
    const attack = '</script><script>window.pwned=true</script>'
    const artifact = createGenuiArtifact({ title: 'Offline view', items: [{ type: 'text', content: attack }] } as GenuiSpec)
    const bundles = new Map([
      ['standalone-runtime.js', new TextEncoder().encode('data:font/woff2;base64,AA==;window.runtimeReady=true;')],
    ])
    const html = createStandaloneHtmlDocument(artifact, bundles)
    const doc = parseHtml(html)
    const csp = cspFromDocument(doc)

    expect(doc.doctype?.name).toBe('html')
    expect(doc.querySelector('meta[charset]')?.getAttribute('charset')).toBe('utf-8')
    expect(doc.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe('width=device-width,initial-scale=1')
    expect(doc.querySelector('#genui-root')).not.toBeNull()
    expect(doc.querySelector('#genui-artifact')).not.toBeNull()
    expect(doc.querySelector('style')?.textContent).toContain('--dsw-alias-bg-base')
    expect(csp['default-src']).toEqual(["'none'"])
    expect(csp['connect-src']).toEqual(["'none'"])
    expect(csp['object-src']).toEqual(["'none'"])
    expect(csp['base-uri']).toEqual(["'none'"])
    expect(csp['form-action']).toEqual(["'none'"])
    expect(csp['script-src']).toEqual(["'unsafe-inline'", 'blob:'])
    expect(html).not.toContain(attack)
    expect(html).not.toContain('window.pwned=true')
    expect(artifactFromDocument(doc)).toEqual(artifact)
    expect(bundleNames(doc)).toEqual(['runtime'])
    expect(bundleText(doc, 'runtime')).toBe('data:font/woff2;base64,AA==;window.runtimeReady=true;')
    expect(doc.querySelectorAll('script')).toHaveLength(3)
  })

  it('embeds only required engine payloads', () => {
    const artifact = createGenuiArtifact({ items: [{ type: 'mermaid', code: 'graph TD; A-->B' }] } as unknown as GenuiSpec)
    const html = createStandaloneHtmlDocument(artifact, new Map([
      ['standalone-runtime.js', new TextEncoder().encode('runtime')],
      ['mermaid.js', new TextEncoder().encode('mermaid-engine')],
    ]))
    const doc = parseHtml(html)

    expect(new Set(bundleNames(doc))).toEqual(new Set(['mermaid', 'runtime']))
    expect(bundleText(doc, 'mermaid')).toBe('mermaid-engine')
    expect(bundleText(doc, 'runtime')).toBe('runtime')
  })

  it('preserves UTF-8 artifact content', () => {
    const artifact = createGenuiArtifact({ title: '服务状态', items: [{ type: 'text', content: '正常运行' }] })
    const html = createStandaloneHtmlDocument(artifact, new Map([
      ['standalone-runtime.js', new TextEncoder().encode('runtime')],
    ]))

    expect(artifactFromDocument(parseHtml(html))).toEqual(artifact)
  })

  it('rejects duplicate artifact and bundle nodes', () => {
    const duplicateArtifact = parseHtml('<script id="genui-artifact"></script><script id="genui-artifact"></script>')
    const duplicateBundle = parseHtml('<script data-genui-bundle="runtime"></script><script data-genui-bundle="runtime"></script>')

    expect(() => artifactFromDocument(duplicateArtifact)).toThrow('expected one #genui-artifact, found 2')
    expect(() => bundleNames(duplicateBundle)).toThrow('duplicate standalone bundle')
    expect(() => bundleText(duplicateBundle, 'runtime')).toThrow('expected one standalone bundle runtime, found 2')
  })

  it('resolves relative media in HTML while preserving JSON artifact values', () => {
    const artifact = createGenuiArtifact({ items: [
      { type: 'image', src: '/attachments/foo.png' },
      { type: 'video', src: 'media/demo.mp4', poster: 'media/poster.png' },
    ] } as GenuiSpec)
    const html = createStandaloneHtmlDocument(artifact, new Map([['standalone-runtime.js', new TextEncoder().encode('runtime')]]), 'https://example.com/reports/page')
    const doc = parseHtml(html)
    const exported = artifactFromDocument(doc) as { spec: { items: Array<{ src: string; poster?: string }> } }
    expect(exported.spec.items.map((item: { src: string }) => item.src)).toEqual(['https://example.com/attachments/foo.png', 'https://example.com/reports/media/demo.mp4'])
    expect(exported.spec.items[1].poster).toBe('https://example.com/reports/media/poster.png')
    expect(artifact.spec.items[0]).toMatchObject({ src: '/attachments/foo.png' })
  })

  it('rejects unsupported components as invalid artifacts before fetching bundles', async () => {
    // Bypass the creation gate to check the standalone loader's own boundary.
    const artifact = createGenuiArtifact({ items: [{ type: 'text', content: 'valid' }] })
    artifact.spec = { items: [{ type: 'weather', temp: 20 }] } as unknown as GenuiSpec
    await expect(buildStandaloneHtml(artifact)).rejects.toMatchObject({ code: 'artifact-invalid' })
  })

  it('retries bundle fetching after a failed request', async () => {
    let requestCount = 0
    const server = createServer((_request, response) => {
      requestCount += 1
      if (requestCount === 1) {
        response.writeHead(503).end('temporarily unavailable')
        return
      }
      response.writeHead(200, { 'content-type': 'application/javascript' }).end('globalThis.standaloneRuntimeLoaded = true;')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('local test server did not bind to a TCP port')
    setGenuiAssetBase(`http://127.0.0.1:${address.port}/`)

    try {
      const artifact = createGenuiArtifact({ items: [{ type: 'text', content: 'retry' }] })
      await expect(buildStandaloneHtml(artifact)).rejects.toMatchObject({ code: 'runtime-fetch-failed' })
      const html = await buildStandaloneHtml(artifact)
      const doc = parseHtml(html)

      expect(requestCount).toBe(2)
      expect(bundleNames(doc)).toEqual(['runtime'])
      expect(bundleText(doc, 'runtime')).toBe('globalThis.standaloneRuntimeLoaded = true;')
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
    }
  })
})
