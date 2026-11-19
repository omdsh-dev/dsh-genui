// Real pinned vendor factory with platform spies, not browser/WebGL acceptance.
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { runInNewContext, Script } from 'node:vm'
import { afterEach, expect, it } from 'vitest'
import { adaptMaplibreWorkerFactory, buildMaplibreClassicWorker } from '../tsdown.config.ts'
import { isOwnedMapWorkerUrl, setOwnedMapWorkerUrl } from '../src/client/map-worker-ownership.ts'

const vendor = await readFile(resolve('node_modules/maplibre-gl/dist/maplibre-gl.mjs'), 'utf8')
const workerFile = resolve('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs')
const fileLocation = { href: 'file:///synthetic/map.html', protocol: 'file:', origin: 'file://' }
const httpLocation = { href: 'https://synthetic.example/map.html', protocol: 'https:', origin: 'https://synthetic.example' }
afterEach(() => setOwnedMapWorkerUrl(undefined))

async function factory(url: string, location = fileLocation, adapted = true, blocked = false) {
  const code = adapted ? adaptMaplibreWorkerFactory(vendor, '6.16.0', './ownership.ts') : vendor
  // Evaluate the actual, hash-checked factory plus its helpers. Only import.meta
  // syntax is replaced for this classic VM; our explicit URL bypasses its default.
  const functions = code.slice(code.indexOf('function $c('), code.indexOf('const ol='))
    .replaceAll('import.meta.url', JSON.stringify('https://vendor.example/maplibre-gl.mjs'))
  const calls: { workers: unknown[][], fetches: string[], blobs: unknown[][], revoked: string[] } = { workers: [], fetches: [], blobs: [], revoked: [] }
  const sandbox: Record<string, any> = {
    location, console, kn: { WORKER_URL: url }, __genuiOwnsWorker: isOwnedMapWorkerUrl,
    Worker: class { constructor(...args: unknown[]) { calls.workers.push(args); if (blocked) throw new Error('synthetic worker-src denial') } },
    Blob: class { constructor(...args: unknown[]) { calls.blobs.push(args) } },
    URL: class extends URL {
      static override createObjectURL() { return 'blob:null/vendor-wrapper' }
      static override revokeObjectURL(url: string) { calls.revoked.push(url) }
    },
    fetch(url: string) { calls.fetches.push(url); throw new Error('synthetic connect-src none') },
  }
  runInNewContext(`${functions}; result=al()`, sandbox)
  try { await sandbox.result } catch (error) { return { ...calls, error: String(error) } }
  return { ...calls, error: undefined }
}

it('starts only our live file-origin Blob as a direct classic worker without fetch/import wrappers', async () => {
  const url = 'blob:null/owned-worker'
  setOwnedMapWorkerUrl(url)
  expect(await factory(url)).toEqual({ workers: [[url]], fetches: [], blobs: [], revoked: [], error: undefined })
  expect(isOwnedMapWorkerUrl('blob:null/another-worker')).toBe(false)
})

it('retains the original module worker path for an owned HTTP Blob', async () => {
  const url = 'blob:https://synthetic.example/owned-worker'
  setOwnedMapWorkerUrl(url)
  expect(await factory(url, httpLocation)).toEqual(await factory(url, httpLocation, false))
  expect((await factory(url, httpLocation)).workers).toEqual([[url, { type: 'module' }]])
})

it.each(['blob:null/another-worker', 'blob:null/worker#maplibre-gl-worker.cjs', 'https://vendor.example/worker.mjs'])('leaves unowned URL behavior unchanged: %s', async url => {
  setOwnedMapWorkerUrl('blob:null/owned-worker')
  expect(await factory(url)).toEqual(await factory(url, fileLocation, false))
})

it('does not retain ownership after release or treat a registered non-Blob as an owned worker', async () => {
  const retired = 'blob:null/retired-worker'
  setOwnedMapWorkerUrl(retired); setOwnedMapWorkerUrl(undefined)
  expect(await factory(retired)).toEqual(await factory(retired, fileLocation, false))
  const external = 'https://vendor.example/worker.mjs'
  setOwnedMapWorkerUrl(external)
  expect(await factory(external)).toEqual(await factory(external, fileLocation, false))
})

it('propagates native Worker denial rather than bypassing CSP or retrying another loader', async () => {
  const url = 'blob:null/owned-worker'
  setOwnedMapWorkerUrl(url)
  const result = await factory(url, fileLocation, true, true)
  expect(result.workers).toEqual([[url]])
  expect(result.error).toContain('worker-src denial')
  expect(result.fetches).toEqual([])
  expect(result.blobs).toEqual([])
})

it('fails closed on any changed vendor main bytes or version', () => {
  expect(() => adaptMaplibreWorkerFactory(vendor, '6.16.1', './ownership.ts')).toThrow('audited 6.16.0')
  expect(() => adaptMaplibreWorkerFactory(`${vendor}\n`, '6.16.0', './ownership.ts')).toThrow('audited 6.16.0')
})

it('builds the real official worker into a classic script without module declarations or sibling chunks', async () => {
  const worker = await buildMaplibreClassicWorker(workerFile)
  expect(() => new Script(worker)).not.toThrow()
  expect(worker).toContain('MapLibre GL JS')
  expect(worker).not.toContain('sourceMappingURL=')
  const listeners: string[] = []
  class WorkerGlobalScope {
    worker: any
    addEventListener(type: string) { listeners.push(type) }
    removeEventListener() {}
    postMessage() {}
  }
  const self = new WorkerGlobalScope()
  runInNewContext(worker, {
    self, WorkerGlobalScope, console, TextDecoder, TextEncoder, URL,
    MessageChannel: class { port1 = { postMessage() {} }; port2 = { onmessage: undefined } },
  }, { timeout: 5000 })
  expect(listeners).toContain('message')
  expect(typeof self.worker.actor.messageHandlers.LD).toBe('function')
  await expect(self.worker.actor.messageHandlers.PI()).resolves.toBeUndefined()
})

it('fails closed on changed worker bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'genui-worker-digest-'))
  try {
    const file = join(dir, 'worker.mjs')
    await writeFile(file, 'self.postMessage("not the audited worker")')
    await expect(buildMaplibreClassicWorker(file)).rejects.toThrow('audited 6.16.0 worker')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
