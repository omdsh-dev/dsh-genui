// Standalone export: embed the same-origin images the page can read, and keep
// everything else external. Issue #453 — an exported file opened from file://
// has no host process, no cookie, and no token, so /api/file images showed the
// "图片无法加载" fallback.
import { createServer, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectGenuiMediaRefs,
  inlineStandaloneMedia,
} from '../src/client/artifact/media.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

/** 1×1 transparent PNG. */
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), character => character.charCodeAt(0))

let closers: Array<() => Promise<void>> = []

/** Start a local origin that answers with the given handler. */
async function originOf(handler: (url: URL, response: ServerResponse) => void): Promise<string> {
  const server = createServer((request, response) => handler(new URL(request.url ?? '/', 'http://127.0.0.1'), response))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('local test server did not bind to a TCP port')
  closers.push(() => new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))))
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  for (const closer of closers) await closer()
  closers = []
})

describe('collectGenuiMediaRefs', () => {
  it('reaches media fields that are not nodes', () => {
    const spec = {
      items: [
        { type: 'image', src: '/a.png' },
        { type: 'image-group', items: [{ src: '/b.png' }, { src: '/c.png' }] },
        { type: 'compare', before: { src: '/d.png' }, after: { src: '/e.png' } },
        { type: 'entity-card', name: 'n', image: '/f.png' },
        { type: 'video', src: '/clip.mp4', poster: '/g.png' },
        { type: 'card', items: [{ type: 'image', src: '/nested.png' }] },
      ],
    } as unknown as GenuiSpec

    const refs = collectGenuiMediaRefs(spec)
    expect(refs.map(ref => ref.src)).toEqual(['/a.png', '/b.png', '/c.png', '/d.png', '/e.png', '/f.png', '/clip.mp4', '/g.png', '/nested.png'])
    expect(refs.filter(ref => ref.image).map(ref => ref.src)).toEqual(['/a.png', '/b.png', '/c.png', '/d.png', '/e.png', '/f.png', '/g.png', '/nested.png'])
  })

  it('writes replacements back into the spec tree', () => {
    const spec = { items: [{ type: 'compare', before: { src: '/d.png' }, after: { src: '/e.png' } }] } as unknown as GenuiSpec
    for (const ref of collectGenuiMediaRefs(spec)) ref.set(`https://example.com${ref.src}`)
    expect(JSON.stringify(spec)).toContain('https://example.com/d.png')
    expect(JSON.stringify(spec)).toContain('https://example.com/e.png')
  })
})

describe('inlineStandaloneMedia', () => {
  it('embeds a same-origin image as a data URL', async () => {
    const origin = await originOf((_url, response) => {
      response.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from(PNG))
    })
    const spec = { items: [{ type: 'image', src: `${origin}/api/file?path=%2Fa.png` }] } as unknown as GenuiSpec

    const media = await inlineStandaloneMedia(spec, `${origin}/`)
    const embedded = media.get(`${origin}/api/file?path=%2Fa.png`)

    expect(embedded?.startsWith('data:image/png;base64,')).toBe(true)
    expect(atob(embedded!.split(',')[1]!)).toBe(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='))
  })

  it('reads a shared source once', async () => {
    let requests = 0
    const origin = await originOf((_url, response) => {
      requests += 1
      response.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from(PNG))
    })
    const spec = { items: [
      { type: 'image', src: `${origin}/shot.png` },
      { type: 'image-group', items: [{ src: `${origin}/shot.png` }] },
    ] } as unknown as GenuiSpec

    await inlineStandaloneMedia(spec, `${origin}/`)
    expect(requests).toBe(1)
  })

  it('keeps another origin external', async () => {
    const origin = await originOf((_url, response) => {
      response.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from(PNG))
    })
    const spec = { items: [{ type: 'image', src: 'https://cdn.example.com/a.png' }] } as unknown as GenuiSpec

    const media = await inlineStandaloneMedia(spec, `${origin}/`)
    expect(media.size).toBe(0)
  })

  it('keeps a rejected request external instead of failing the export', async () => {
    const origin = await originOf((_url, response) => {
      response.writeHead(401).end('unauthorized')
    })
    const spec = { items: [{ type: 'image', src: `${origin}/api/file?path=%2Fa.png` }] } as unknown as GenuiSpec

    const media = await inlineStandaloneMedia(spec, `${origin}/`)
    expect(media.size).toBe(0)
  })

  it('keeps a non-image response external', async () => {
    const origin = await originOf((_url, response) => {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<html>not an image</html>')
    })
    const spec = { items: [{ type: 'image', src: `${origin}/login` }] } as unknown as GenuiSpec

    const media = await inlineStandaloneMedia(spec, `${origin}/`)
    expect(media.size).toBe(0)
  })

  it('embeds an authenticated Desktop source without changing its relative key', async () => {
    const fetchImage = vi.fn(async () => new Response(PNG, { headers: { 'content-type': 'image/png' } }))
    const src = '/api/file?path=%2Fa.png'
    const spec: GenuiSpec = { items: [{ type: 'image', src }] }
    const media = await inlineStandaloneMedia(spec, 'dsh-app://app/', fetchImage)
    expect(fetchImage).toHaveBeenCalledWith('dsh-app://app' + src, { credentials: 'same-origin' })
    expect(media.get(src)).toMatch(/^data:image\/png;base64,/)
  })
})
