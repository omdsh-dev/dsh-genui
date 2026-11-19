/** Bounded geographic data shared by the guard and direct renderer callers. */
import { GENUI_LIMITS } from './genui-runtime/limits.ts'
import type { GenuiMap, GenuiMapLocation, GenuiMapRoute } from './spec.ts'
import { int, num, obj, opt, str } from './genui-runtime/value-utils.ts'

/** GeoJSON order: longitude, latitude. Invalid coordinates are never clamped. */
export const MAP_MERCATOR_LATITUDE = 85.051129
export function isMapProjectable(point: readonly [number, number]): boolean { return Math.abs(point[1]) <= MAP_MERCATOR_LATITUDE }

export function mapCoordinate(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined
  const [lng, lat] = value
  return typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180
    && typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90 ? [lng, lat] : undefined
}

function mapId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 200 ? value : undefined
}

export function repairMap(value: unknown): GenuiMap | null {
  const v = obj(value)
  if (v === undefined || !Array.isArray(v.locations)) return null
  const ids = new Set<string>()
  const locations: GenuiMapLocation[] = []
  for (const raw of v.locations.slice(0, GENUI_LIMITS.maxMapLocations)) {
    const item = obj(raw)
    if (item === undefined) continue
    const id = mapId(item.id), label = str(item.label, GENUI_LIMITS.maxString), coordinates = mapCoordinate(item.coordinates)
    if (id === undefined || label === undefined || coordinates === undefined || ids.has(id)) continue
    ids.add(id)
    locations.push({ id, label, coordinates, ...opt('description', str(item.description, GENUI_LIMITS.maxString)) })
  }
  const routeIds = new Set<string>()
  const routes: GenuiMapRoute[] = []
  if (Array.isArray(v.routes)) for (const raw of v.routes.slice(0, GENUI_LIMITS.maxMapRoutes)) {
    const route = obj(raw)
    if (route === undefined) continue
    const id = mapId(route.id), label = str(route.label, GENUI_LIMITS.maxString)
    if (id === undefined || label === undefined || routeIds.has(id) || !Array.isArray(route.coordinates)
      || route.coordinates.length < 2 || route.coordinates.length > GENUI_LIMITS.maxMapRoutePoints) continue
    const coordinates = route.coordinates.map(mapCoordinate)
    // Drop the whole invalid route: removing a waypoint invents a new path.
    if (coordinates.some(point => point === undefined)) continue
    routeIds.add(id)
    routes.push({ id, label, coordinates: coordinates as [number, number][] })
  }
  const selected = mapId(v.selected)
  return {
    type: 'map', locations,
    ...opt('id', mapId(v.id)), ...opt('title', str(v.title, GENUI_LIMITS.maxString)),
    ...opt('selected', selected !== undefined && ids.has(selected) ? selected : undefined),
    ...opt('center', mapCoordinate(v.center)), ...opt('zoom', num(v.zoom, 0, 20)),
    ...opt('height', int(v.height, 200, 640)), ...(routes.length > 0 ? { routes } : {}),
  }
}

export function validateMap(v: Record<string, unknown>, at: string, errors: string[]): void {
  if (!Array.isArray(v.locations)) errors.push(`${at}: type 'map' requires locations (array)`)
  if (v.routes !== undefined && !Array.isArray(v.routes)) errors.push(`${at}.routes must be an array`)
  const ids = new Set<string>()
  for (const [field, limit] of [['locations', GENUI_LIMITS.maxMapLocations], ['routes', GENUI_LIMITS.maxMapRoutes]] as const) {
    const entries = v[field]
    if (!Array.isArray(entries)) continue
    if (entries.length > limit) errors.push(`${at}.${field} exceeds ${limit} entries`)
    const seen = new Set<string>()
    entries.slice(0, limit).forEach((raw, index) => {
      const item = obj(raw), path = `${at}.${field}[${index}]`
      if (item === undefined) { errors.push(`${path} must be an object`); return }
      if (typeof item.label !== 'string') errors.push(`${path}.label must be a string`)
      if (mapId(item.id) === undefined) errors.push(`${path}.id must be a non-empty string of at most 200 characters`)
      else if (seen.has(item.id as string)) errors.push(`${path}.id must be unique`)
      else { seen.add(item.id as string); if (field === 'locations') ids.add(item.id as string) }
      if (field === 'locations') {
        if (mapCoordinate(item.coordinates) === undefined) errors.push(`${path}.coordinates must be [longitude, latitude] in [-180,180] × [-90,90]`)
      } else if (!Array.isArray(item.coordinates) || item.coordinates.length < 2 || item.coordinates.length > GENUI_LIMITS.maxMapRoutePoints
        || item.coordinates.some(point => mapCoordinate(point) === undefined)) {
        errors.push(`${path}.coordinates must contain 2–${GENUI_LIMITS.maxMapRoutePoints} valid [longitude, latitude] pairs`)
      }
    })
  }
  if (v.id !== undefined && mapId(v.id) === undefined) errors.push(`${at}.id must be a non-empty string of at most 200 characters`)
  if (v.selected !== undefined && (typeof v.selected !== 'string' || !ids.has(v.selected))) errors.push(`${at}.selected must reference a location id`)
  if (v.center !== undefined && mapCoordinate(v.center) === undefined) errors.push(`${at}.center must be valid [longitude, latitude]`)
  for (const [field, min, max] of [['zoom', 0, 20], ['height', 200, 640]] as const) {
    const n = v[field]
    if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)) errors.push(`${at}.${field} must be between ${min} and ${max}`)
  }
}

/** Smallest longitude interval, including points straddling the antimeridian. */
export function mapBounds(points: readonly [number, number][]): [[number, number], [number, number]] | undefined {
  if (points.length === 0) return undefined
  const lngs = points.map(([lng]) => (lng + 360) % 360).sort((a, b) => a - b)
  let gap = -1, start = 0
  for (let i = 0; i < lngs.length; i++) {
    const next = lngs[(i + 1) % lngs.length]! + (i === lngs.length - 1 ? 360 : 0)
    if (next - lngs[i]! > gap) { gap = next - lngs[i]!; start = (i + 1) % lngs.length }
  }
  let west = lngs[start]!, east = west + 360 - gap
  if (west > 180) { west -= 360; east -= 360 }
  return [[west, Math.min(...points.map(p => p[1]))], [east, Math.max(...points.map(p => p[1]))]]
}
