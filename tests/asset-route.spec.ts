// @vitest-environment jsdom
// Asset route cache contract: content-hash ETag, 304 on a match, immutable when the URL carries ?rev=.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assetEtag, etagMatches, serveGenuiAsset } from '../src/plugin/index.ts'

const FILE = 'zz-route-test.js'
let dir = ''

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'genui-route-')) + '/'
  writeFileSync(`${dir}${FILE}`, 'window.__GenuiAssets__={}')
})
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

interface Out { status: number; headers: Record<string, string>; body: unknown }
async function call(url: string, headers: Record<string, string> = {}): Promise<Out> {
  const out: Out = { status: 0, headers: {}, body: undefined }
  const res = {
    writeHead(status: number, h?: Record<string, string>) { out.status = status; out.headers = h ?? {}; return res },
    end(body?: unknown) { out.body = body },
  }
  await serveGenuiAsset({ method: 'GET', url, headers } as never, res as never, dir)
  return out
}
const URL_BASE = '/plugins/@changfenhuang/dsh-genui/assets/'

describe('genui asset route caching', () => {
  it('serves a rev-pinned URL as immutable with a strong ETag', async () => {
    const r = await call(`${URL_BASE}${FILE}?rev=abc123`)
    expect(r.status).toBe(200)
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(String(r.headers.etag)).toMatch(/^"[0-9a-f]{20}"$/)
  })
  it('keeps no-cache (revalidate through the ETag) when there is no rev', async () => {
    const r = await call(`${URL_BASE}${FILE}`)
    expect(r.status).toBe(200)
    expect(r.headers['cache-control']).toBe('no-cache')
    expect(r.headers.etag).toBeTruthy()
  })
  it('answers If-None-Match with a body-less 304 carrying the same validators', async () => {
    const first = await call(`${URL_BASE}${FILE}?rev=abc123`)
    const r = await call(`${URL_BASE}${FILE}?rev=abc123`, { 'if-none-match': String(first.headers.etag) })
    expect(r.status).toBe(304)
    expect(r.body).toBeUndefined()
    expect(r.headers.etag).toBe(first.headers.etag)
    expect(r.headers['cache-control']).toBe(first.headers['cache-control'])
  })
  it('does not 304 a different validator', async () => {
    const r = await call(`${URL_BASE}${FILE}`, { 'if-none-match': '"nope"' })
    expect(r.status).toBe(200)
  })
  it('still rejects traversal and unknown files', async () => {
    expect((await call(`${URL_BASE}..%2Fpackage.json`)).status).toBe(404)
    expect((await call(`${URL_BASE}missing.js?rev=1`)).status).toBe(404)
  })
})

describe('etag helpers', () => {
  it('hashes content deterministically', () => {
    expect(assetEtag(new TextEncoder().encode('a'))).toBe(assetEtag(new TextEncoder().encode('a')))
    expect(assetEtag(new TextEncoder().encode('a'))).not.toBe(assetEtag(new TextEncoder().encode('b')))
  })
  it('matches lists, weak forms and *', () => {
    expect(etagMatches('"a", "b"', '"b"')).toBe(true)
    expect(etagMatches('W/"a"', '"a"')).toBe(true)
    expect(etagMatches('*', '"a"')).toBe(true)
    expect(etagMatches(undefined, '"a"')).toBe(false)
    expect(etagMatches(['"x"', '"a"'], '"a"')).toBe(true)
  })
})
