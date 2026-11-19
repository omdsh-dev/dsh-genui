// Mocked MapLibre contract and resource lifecycle, not real WebGL acceptance.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ maps: [] as any[], markers: [] as any[], setWorkerUrl: vi.fn(), constructorFailure: false, resetFailure: false, duringConstructor: undefined as (() => void) | undefined }))
vi.mock('../src/client/maplibre-resources.ts', () => ({ maplibreCss: '.maplibre-test{}', maplibreWorker: 'self.onmessage = () => {}' }))
vi.mock('maplibre-gl', () => ({
  setWorkerUrl: fake.setWorkerUrl,
  Map: class {
    options: any; events = new Map<string, () => void>(); sources = new Map<string, any>(); loaded = false
    remove = vi.fn(); easeTo = vi.fn(); jumpTo = vi.fn(); fitBounds = vi.fn(); zoomTo = vi.fn(); resize = vi.fn(); addLayer = vi.fn()
    constructor(options: any) { fake.duringConstructor?.(); if (fake.constructorFailure) throw new Error('WebGL unavailable'); this.options = options; fake.maps.push(this); if (fake.resetFailure) this.fitBounds.mockImplementationOnce(() => { throw new Error('reset failed') }) }
    on(event: string, callback: () => void) { this.events.set(event, callback) }
    off(event: string, callback: () => void) { if (this.events.get(event) === callback) this.events.delete(event) }
    isStyleLoaded() { return this.loaded }
    getSource(id: string) { return this.sources.get(id) }
    addSource(id: string, source: any) { this.sources.set(id, { ...source, setData: vi.fn() }) }
    getZoom() { return 10 }
  },
  Marker: class {
    options: any; setLngLat = vi.fn().mockReturnThis(); addTo = vi.fn().mockReturnThis(); remove = vi.fn()
    constructor(options: any) { this.options = options; fake.markers.push(this) }
  },
}))
let mountMap: typeof import('../src/client/map-core.ts').mountMap
let offlineMapStyle: typeof import('../src/client/map-core.ts').offlineMapStyle
let unwrapRoute: typeof import('../src/client/map-core.ts').unwrapRoute
import type { GenuiMap } from '../src/client/spec.ts'
let ownsWorker: typeof import('../src/client/map-worker-ownership.ts').isOwnedMapWorkerUrl
const node: GenuiMap = { type: 'map', locations: [{ id: 'a', label: '<script>attack</script>', coordinates: [179, 10] }, { id: 'b', label: 'B', coordinates: [-179, 20] }], routes: [{ id: 'route', label: 'Route', coordinates: [[179, 10], [-179, 20]] }] }
const options = () => ({ onSelect: vi.fn(), onError: vi.fn(), onReady: vi.fn(), markerLabel: (s: string) => s })
const destroy: Array<() => void> = []
beforeEach(async () => {
  vi.resetModules()
  ;({ mountMap, offlineMapStyle, unwrapRoute } = await import('../src/client/map-core.ts'))
  ;({ isOwnedMapWorkerUrl: ownsWorker } = await import('../src/client/map-worker-ownership.ts'))
  fake.maps.length = 0; fake.markers.length = 0; fake.constructorFailure = false; fake.resetFailure = false; fake.duringConstructor = undefined; vi.clearAllMocks()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:map-worker'), revokeObjectURL: vi.fn() }))
})
afterEach(() => { for (const dispose of destroy.splice(0)) dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
function mount(opts = options()) { const result = mountMap(document.createElement('div'), node, '', opts); destroy.push(result.destroy); return result }
function loaded(index = 0) { const map = fake.maps[index]; map.loaded = true; map.events.get('load')(); return map }
describe('MapLibre engine boundary', () => {
  it('has zero external default sources and does not hijack wheel scrolling', () => {
    expect(offlineMapStyle()).toMatchObject({ version: 8, sources: {} })
    const opts = options(); mount(opts)
    expect(opts.onReady).not.toHaveBeenCalled()
    expect(fake.maps[0].options.scrollZoom).toBe(false)
    loaded()
    expect(opts.onReady).toHaveBeenCalledOnce()
    expect(fake.maps[0].options.style).not.toHaveProperty('glyphs')
    expect(fake.maps[0].options.style).not.toHaveProperty('sprite')
  })
  it('adds real marker objects and inline GeoJSON routes without executing label HTML', () => {
    const opts = options(); mount(opts); const map = loaded()
    expect(fake.markers).toHaveLength(2)
    const button = fake.markers[0].options.element as HTMLButtonElement
    expect(button.querySelector('script')).toBeNull()
    button.click()
    expect(opts.onSelect).toHaveBeenCalledExactlyOnceWith('a')
    expect(map.sources.get('__genui_routes').data.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[179, 10], [181, 20]] })
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ type: 'line' }))
    expect(map.fitBounds).toHaveBeenCalledWith([[179, 10], [181, 20]], expect.anything())
  })
  it('reconciles markers by stable ID, updates routes, and removes obsolete data', () => {
    const controller = mount(); const map = loaded()
    controller.select('a')
    controller.update({ ...node, locations: [{ ...node.locations[0]!, label: 'Updated' }], routes: [] }, 'a')
    expect(fake.markers).toHaveLength(2)
    expect(fake.markers[0].options.element.getAttribute('aria-pressed')).toBe('true')
    expect(fake.markers[0].options.element.getAttribute('aria-label')).toBe('Updated')
    expect(fake.markers[1].remove).toHaveBeenCalledOnce()
    expect(map.sources.get('__genui_routes').setData).toHaveBeenCalledWith({ type: 'FeatureCollection', features: [] })
  })
  it('keeps the shared worker URL until the final map removal call, then revokes once', () => {
    const first = mount(), second = mount()
    expect(ownsWorker('blob:map-worker')).toBe(true)
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    first.destroy(); first.destroy()
    expect(ownsWorker('blob:map-worker')).toBe(true)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    second.destroy()
    expect(ownsWorker('blob:map-worker')).toBe(false)
    expect(fake.maps[1].remove).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:map-worker')
    expect(fake.maps.every(map => map.events.size === 0)).toBe(true)
    expect(fake.maps[1].remove.mock.invocationCallOrder[0]).toBeLessThan((URL.revokeObjectURL as any).mock.invocationCallOrder[0])
  })
  it('unwraps adjacent route segments without mutating the source', () => {
    const points: [number, number][] = [[179, 0], [-179, 1], [178, 2]]
    expect(unwrapRoute(points)).toEqual([[179, 0], [181, 1], [178, 2]])
    expect(points[1]).toEqual([-179, 1])
  })
})

it('preserves polar records but never plots or centers them at a different location', () => {
  const polar: GenuiMap = { type: 'map', center: [0, 90], locations: [{ id: 'pole', label: 'North Pole', coordinates: [0, 90] }], routes: [{ id: 'polar-route', label: 'Polar', coordinates: [[0, 80], [0, 90]] }] }
  const controller = mountMap(document.createElement('div'), polar, 'pole', options())
  destroy.push(controller.destroy)
  const map = loaded()
  expect(fake.markers).toHaveLength(0)
  expect(map.options.center).toEqual([0, 0])
  expect(map.sources.get('__genui_routes').data.features).toEqual([])
  controller.select('pole')
  expect(map.easeTo).not.toHaveBeenCalled()
})

it('releases the worker URL on constructor failure', () => {
  fake.constructorFailure = true
  expect(() => mount()).toThrow('WebGL unavailable')
  expect(ownsWorker('blob:map-worker')).toBe(false)
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:map-worker')
})

it('continues updating inline routes while an existing source is loading', () => {
  const controller = mount(); const map = loaded()
  map.loaded = false
  controller.update({ ...node, routes: [] }, '')
  expect(map.sources.get('__genui_routes').setData).toHaveBeenCalledWith({ type: 'FeatureCollection', features: [] })
})

it('cleans up a map and worker after post-constructor initialization fails', () => {
  fake.resetFailure = true
  expect(() => mount()).toThrow('reset failed')
  expect(ownsWorker('blob:map-worker')).toBe(false)
  expect(fake.maps[0].remove).toHaveBeenCalledOnce()
  expect(fake.maps[0].events.size).toBe(0)
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:map-worker')
})

function workerCsp(change: Partial<SecurityPolicyViolationEvent> = {}) {
  // jsdom lacks SecurityPolicyViolationEvent; use its browser-defined fields.
  document.dispatchEvent(Object.assign(new Event('securitypolicyviolation'), {
    disposition: 'enforce', effectiveDirective: 'worker-src', blockedURI: 'blob', ...change,
  }))
}

describe('asynchronous worker startup failures', () => {
  it.each(['blob', 'blob:', 'blob:map-worker'])('fails once on an enforced owned Blob worker violation (%s)', blockedURI => {
    const opts = options(); mount(opts)
    workerCsp({ blockedURI }); workerCsp({ blockedURI })
    expect(opts.onError).toHaveBeenCalledOnce()
    loaded()
    expect(opts.onReady).not.toHaveBeenCalled()
    expect(fake.maps[0].addLayer).not.toHaveBeenCalled()
  })
  it('observes CSP before Map construction, not after the worker has started', () => {
    const opts = options(); fake.duringConstructor = () => workerCsp()
    mount(opts)
    expect(opts.onError).toHaveBeenCalledOnce()
    loaded()
    expect(opts.onReady).not.toHaveBeenCalled()
  })
  it('ignores report-only, unrelated directives and different complete worker URLs', () => {
    const opts = options(); mount(opts)
    const unrelated: Partial<SecurityPolicyViolationEvent>[] = [{ disposition: 'report' }, { effectiveDirective: 'script-src' },
      { effectiveDirective: 'img-src' }, { blockedURI: 'https://synthetic.invalid/worker.js' },
      { blockedURI: 'blob:another-worker' }]
    for (const change of unrelated) workerCsp(change)
    expect(opts.onError).not.toHaveBeenCalled()
    loaded()
    workerCsp()
    expect(opts.onError).not.toHaveBeenCalled()
    expect(opts.onReady).toHaveBeenCalledOnce()
    const nextOpts = options(); mount(nextOpts); loaded(1)
    expect(nextOpts.onReady).toHaveBeenCalledOnce()
  })
  it.each(['ready', 'error', 'destroy', 'constructor throw', 'initialization throw'])('removes the startup listener on %s', outcome => {
    vi.useFakeTimers()
    const add = vi.spyOn(document, 'addEventListener'), remove = vi.spyOn(document, 'removeEventListener')
    const opts = options()
    fake.constructorFailure = outcome === 'constructor throw'; fake.resetFailure = outcome === 'initialization throw'
    if (fake.constructorFailure || fake.resetFailure) expect(() => mount(opts)).toThrow()
    else {
      const controller = mount(opts)
      if (outcome === 'ready') loaded()
      else if (outcome === 'error') fake.maps[0].events.get('error')()
      else controller.destroy()
    }
    const subscriptions = add.mock.calls.filter(([name]) => name === 'securitypolicyviolation')
    expect(subscriptions).toHaveLength(1)
    expect(remove).toHaveBeenCalledWith('securitypolicyviolation', subscriptions[0]![1])
    expect(vi.getTimerCount()).toBe(0)
    const count = opts.onError.mock.calls.length
    workerCsp(); vi.advanceTimersByTime(30000)
    expect(opts.onError).toHaveBeenCalledTimes(count)
  })
  it('does not receive CSP violations dispatched in another document', () => {
    const opts = options(); mount(opts)
    const other = document.implementation.createHTMLDocument('Unrelated host')
    other.dispatchEvent(Object.assign(new Event('securitypolicyviolation'), {
      disposition: 'enforce', effectiveDirective: 'worker-src', blockedURI: 'blob',
    }))
    expect(opts.onError).not.toHaveBeenCalled()
  })
  it('cancels a pending instance without removing another pending listener or accepting its late load', () => {
    const firstOpts = options(), secondOpts = options(), remountOpts = options()
    const first = mount(firstOpts), lateLoad = fake.maps[0].events.get('load')
    const second = mount(secondOpts)
    first.destroy(); lateLoad(); workerCsp()
    expect(firstOpts.onReady).not.toHaveBeenCalled()
    expect(firstOpts.onError).not.toHaveBeenCalled()
    expect(secondOpts.onError).toHaveBeenCalledOnce()
    second.destroy()
    expect(() => mount(remountOpts)).toThrow('Map worker blocked by document policy')
    expect(remountOpts.onReady).not.toHaveBeenCalled()
  })
  it.each(['map error', 'constructor throw', 'initialization throw'])('does not cache an unrelated %s as a worker policy block', outcome => {
    fake.constructorFailure = outcome === 'constructor throw'; fake.resetFailure = outcome === 'initialization throw'
    if (fake.constructorFailure || fake.resetFailure) expect(() => mount()).toThrow()
    else { const controller = mount(); fake.maps[0].events.get('error')(); controller.destroy() }
    fake.constructorFailure = false; fake.resetFailure = false
    const index = fake.maps.length, opts = options()
    mount(opts); loaded(index)
    expect(opts.onReady).toHaveBeenCalledOnce()
    expect(opts.onError).not.toHaveBeenCalled()
  })
  it('remembers an observed block without a second CSP event, but isolates a fresh engine module', async () => {
    const opts = options(), first = mount(opts)
    workerCsp(); first.destroy(); first.destroy()
    expect(fake.maps[0].remove).toHaveBeenCalledOnce()
    expect(opts.onError).toHaveBeenCalledOnce()
    const count = fake.maps.length
    expect(() => mount()).toThrow('Map worker blocked by document policy')
    expect(fake.maps).toHaveLength(count)
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
    vi.resetModules()
    const fresh = await import('../src/client/map-core.ts')
    const freshOpts = options()
    const controller = fresh.mountMap(document.createElement('div'), node, '', freshOpts)
    destroy.push(controller.destroy); loaded(count)
    expect(freshOpts.onReady).toHaveBeenCalledOnce()
    expect(freshOpts.onError).not.toHaveBeenCalled()
  })
  it('isolates concurrent startup listeners and clears them across unmount/remount', () => {
    const readyOpts = options(), pendingOpts = options(), remountOpts = options()
    mount(readyOpts); loaded()
    const pending = mount(pendingOpts)
    workerCsp()
    expect(readyOpts.onError).not.toHaveBeenCalled()
    expect(pendingOpts.onError).toHaveBeenCalledOnce()
    pending.destroy()
    expect(() => mount(remountOpts)).toThrow('Map worker blocked by document policy')
    expect(remountOpts.onReady).not.toHaveBeenCalled()
    expect(readyOpts.onError).not.toHaveBeenCalled()
  })
})
