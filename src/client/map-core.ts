/** Heavy engine: imported ONLY by the maplibre asset entry. */
import * as maplibre from 'maplibre-gl/dist/maplibre-gl-csp.js'
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl'
import type { GenuiMap } from './spec.ts'
import type { MapController, MapMountOptions } from './map-lazy.ts'
import { mapBounds, isMapProjectable } from './map-data.ts'
import { maplibreCss, maplibreWorker } from './maplibre-resources.ts'

const ROUTES = '__genui_routes'
let workerUrl: string | undefined
let users = 0
// 5.6.2 can retain a CSP-blocked Worker in its private pool after Map.remove().
// A real observed block is sticky for this engine instance; do not silently
// retry the same dead pool on remount. A new page/engine has independent state.
let workerPolicyBlocked = false
/** Own this bundle's worker URL. MapLibre 5.6.2 retains an RTL global dispatcher,
 * so Map.remove() alone does not guarantee worker termination: acceptance blocker.
 */
function acquireWorker(): () => void {
  if (workerUrl === undefined) {
    workerUrl = URL.createObjectURL(new Blob([maplibreWorker], { type: 'text/javascript' }))
    maplibre.setWorkerUrl(workerUrl)
  }
  users++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--users === 0 && workerUrl !== undefined) {
      URL.revokeObjectURL(workerUrl)
      workerUrl = undefined
    }
  }
}
function injectCss(): void {
  if (document.querySelector('[data-genui-maplibre-css]') !== null) return
  const style = document.createElement('style')
  style.dataset.genuiMaplibreCss = ''
  style.textContent = maplibreCss
  document.head.appendChild(style)
}
export function offlineMapStyle(): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef2f6' } }] }
}
/** Follow the shortest segment at the dateline without changing stored WGS84 data. */
export function unwrapRoute(points: readonly [number, number][]): [number, number][] {
  const result: [number, number][] = []
  for (const [lng, lat] of points) {
    const previous = result.at(-1)?.[0]
    const unwrapped = previous === undefined ? lng : lng + 360 * Math.round((previous - lng) / 360)
    result.push([unwrapped, lat])
  }
  return result
}
export function mountMap(container: HTMLElement, initial: GenuiMap, initialSelection: string, options: MapMountOptions): MapController {
  if (maplibreWorker === '') throw new Error('MapLibre worker missing: use the packaged maplibre engine asset')
  if (workerPolicyBlocked) throw new Error('Map worker blocked by document policy')
  injectCss()
  const releaseWorker = acquireWorker()
  const startupWorkerUrl = workerUrl
  let destroyed = false, failed = false, starting = true
  function stopStartup(): void {
    starting = false
    document.removeEventListener('securitypolicyviolation', workerPolicyViolation)
  }
  function error(): void {
    if (destroyed || failed) return
    failed = true
    stopStartup()
    options.onError()
  }
  function workerPolicyViolation(event: SecurityPolicyViolationEvent): void {
    if (!starting || event.disposition !== 'enforce' || event.effectiveDirective !== 'worker-src') return
    // CSP3 strips non-HTTP URLs to their scheme. A document-level Blob worker
    // denial therefore conservatively fails only this pending initialization;
    // its UUID cannot be attributed. Never affect an already-ready Map, report-
    // only policy, another directive, another full URL, or another document.
    if (event.blockedURI === startupWorkerUrl || event.blockedURI === 'blob' || event.blockedURI === 'blob:') {
      workerPolicyBlocked = true
      error()
    }
  }
  // 5.6.2 does not forward asynchronous Worker failures as Map errors. Observe
  // enforced CSP before construction without changing the host policy.
  document.addEventListener('securitypolicyviolation', workerPolicyViolation)
  let map: maplibre.Map
  try {
    map = new maplibre.Map({
      container, style: (options.config?.style as StyleSpecification | undefined) ?? offlineMapStyle(),
      center: initial.center !== undefined && isMapProjectable(initial.center) ? initial.center : [0, 0], zoom: initial.zoom ?? 1,
      minZoom: 0, maxZoom: 20, scrollZoom: false, dragRotate: false, touchPitch: false, attributionControl: {}, renderWorldCopies: true,
    })
  } catch (failure) { stopStartup(); releaseWorker(); throw failure }
  let node = initial, selected = initialSelection, styleReady = false
  const markers = new Map<string, { marker: maplibre.Marker; button: HTMLButtonElement; click: () => void }>()
  function clearMarkers(): void {
    for (const { marker, button, click } of markers.values()) { button.removeEventListener('click', click); marker.remove() }
    markers.clear()
  }
  function select(id: string): void {
    selected = id
    for (const [id, entry] of markers) entry.button.setAttribute('aria-pressed', String(id === selected))
    const location = node.locations.find(item => item.id === id)
    if (!destroyed && !failed && location !== undefined && isMapProjectable(location.coordinates)) map.easeTo({ center: location.coordinates, duration: 0 })
  }
  function reset(): void {
    if (destroyed || failed) return
    if (node.center !== undefined && isMapProjectable(node.center)) {
      map.jumpTo({ center: node.center, zoom: node.zoom ?? 10, bearing: 0, pitch: 0 })
      return
    }
    const points = [...node.locations.map(item => item.coordinates), ...(node.routes ?? []).flatMap(route => route.coordinates)].filter(isMapProjectable)
    const bounds = mapBounds(points)
    if (bounds === undefined) map.jumpTo({ center: [0, 0], zoom: node.zoom ?? 1, bearing: 0, pitch: 0 })
    else map.fitBounds(bounds, { padding: 40, maxZoom: node.zoom ?? 14, duration: 0, bearing: 0 })
  }
  function renderData(): void {
    if (destroyed || failed) return
    const visibleLocations = node.locations.filter(location => isMapProjectable(location.coordinates))
    const ids = new Set(visibleLocations.map(location => location.id))
    for (const [id, entry] of markers) if (!ids.has(id)) {
      entry.button.removeEventListener('click', entry.click)
      entry.marker.remove()
      markers.delete(id)
    }
    for (const location of visibleLocations) {
      let entry = markers.get(location.id)
      if (entry === undefined) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'genui-map-marker'
        button.textContent = '●'
        const click = (): void => options.onSelect(location.id)
        button.addEventListener('click', click)
        const marker = new maplibre.Marker({ element: button }).setLngLat(location.coordinates).addTo(map)
        entry = { marker, button, click }
        markers.set(location.id, entry)
      }
      entry.button.setAttribute('aria-label', options.markerLabel(location.label))
      entry.button.setAttribute('aria-pressed', String(location.id === selected))
      entry.marker.setLngLat(location.coordinates)
    }
    if (!styleReady) return
    const data: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
      type: 'FeatureCollection', features: (node.routes ?? []).filter(route => route.coordinates.every(isMapProjectable)).map(route => ({
        type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: unwrapRoute(route.coordinates) },
      })),
    }
    const source = map.getSource(ROUTES) as GeoJSONSource | undefined
    if (source !== undefined) source.setData(data)
    else {
      map.addSource(ROUTES, { type: 'geojson', data })
      map.addLayer({ id: ROUTES, type: 'line', source: ROUTES, paint: { 'line-color': '#315fa8', 'line-width': 4 } })
    }
  }
  const styleLoad = (): void => { if (!destroyed && !failed) { styleReady = true; renderData() } }
  const load = (): void => {
    if (destroyed || failed) return
    styleLoad(); reset(); stopStartup(); options.onReady()
  }
  map.on('load', load)
  map.on('style.load', styleLoad)
  map.on('error', error)
  try { renderData(); reset() } catch (failure) {
    stopStartup()
    clearMarkers()
    map.off('load', load)
    map.off('style.load', styleLoad)
    map.off('error', error)
    try { map.remove() } finally { releaseWorker() }
    throw failure
  }
  return {
    update(next, nextSelected) { node = next; selected = nextSelected; renderData() },
    select, reset,
    zoom(delta) { if (!destroyed && !failed) map.zoomTo(Math.min(20, Math.max(0, map.getZoom() + delta)), { duration: 0 }) },
    resize() { if (!destroyed && !failed) map.resize() },
    destroy() {
      if (destroyed) return
      destroyed = true
      stopStartup()
      clearMarkers()
      map.off('load', load)
      map.off('style.load', styleLoad)
      map.off('error', error)
      try { map.remove() } finally { releaseWorker() }
    },
  }
}
