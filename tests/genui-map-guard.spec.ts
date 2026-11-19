import { describe, expect, it } from 'vitest'
import { processGenuiSpec, repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'
import { mapBounds, mapCoordinate, repairMap } from '../src/client/map-data.ts'
import { analyzeSubmissionRegistry } from '../src/client/submission-registry.ts'
import { analyzeGenuiPortability } from '../src/client/artifact/portability.ts'
import type { GenuiMap } from '../src/client/spec.ts'

const location = { id: 'a', label: 'A', coordinates: [120, 30] }
const node = (extra = {}) => ({ type: 'map', locations: [location], ...extra })
describe('map guard and contract', () => {
  it('recognizes map as a native root, field, and offline asset', () => {
    expect(validateGenuiSpec({ items: [node({ id: 'place', selected: 'a' })] }).ok).toBe(true)
    const spec = repairGenuiSpec(node({ id: 'place' }))!
    expect(spec.items[0].type).toBe('map')
    expect(analyzeSubmissionRegistry(spec).registry.members.get('place')).toEqual({ kind: 'field', key: 'place', fieldType: 'map', secret: false })
    expect(analyzeGenuiPortability(spec)).toEqual({ requiredAssets: ['maplibre'], customTypes: [], externalMedia: [], hasModelActions: false })
  })
  it('rejects invalid coordinate ranges, order, lengths and non-finite numbers without clamping', () => {
    for (const coordinates of [[181, 0], [0, -91], [30, 120], [NaN, 1], [1, Infinity], [1], [1, 2, 3], ['1', 2]]) {
      expect(mapCoordinate(coordinates)).toBeUndefined()
      expect(repairMap(node({ locations: [{ ...location, coordinates }] }))?.locations).toEqual([])
      expect(validateGenuiSpec({ items: [node({ locations: [{ ...location, coordinates }] })] }).ok).toBe(false)
    }
    expect(mapCoordinate([-180, 90])).toEqual([-180, 90])
  })
  it('deduplicates IDs without mutating labels or interpreting HTML', () => {
    const input = node({ locations: [location, { ...location, label: 'duplicate' }, { ...location, id: 'b', label: '<img src=x onerror=alert(1)>' }] })
    expect(repairMap(input)?.locations).toHaveLength(2)
    expect(repairMap(input)?.locations[0]?.label).toBe('A')
    expect(validateGenuiSpec({ items: [input] }).errors.join(' ')).toContain('unique')
  })
  it('caps locations and routes; discards a whole malformed route instead of inventing a shortcut', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...location, id: String(i) }))
    const route = { id: 'r', label: 'Route', coordinates: [[0, 0], [1, 1]] }
    const result = repairMap(node({ locations: many, routes: Array.from({ length: 12 }, (_, i) => ({ ...route, id: String(i) })) }))!
    expect(result.locations).toHaveLength(50)
    expect(result.routes).toHaveLength(8)
    for (const coordinates of [[[0, 0]], [[0, 0], [300, 2], [1, 1]], Array.from({ length: 501 }, () => [0, 0])]) {
      expect(repairMap(node({ routes: [{ ...route, coordinates }] }))?.routes).toBeUndefined()
    }
  })
  it('clamps bounded view settings and removes stale selection, model URLs and actions', () => {
    const result = repairMap(node({ zoom: 99, height: 9999, selected: 'missing', style: 'https://evil/style', source: 'https://evil/tiles', workerUrl: 'https://evil/worker', action: 'send', accessToken: 'secret' }))!
    expect(result).toEqual({ type: 'map', locations: [location], zoom: 20, height: 640 })
    expect(validateGenuiSpec({ items: [node({ zoom: -1, height: 0, selected: 'missing' })] }).ok).toBe(false)
    expect(processGenuiSpec({ items: [node({ style: 'https://evil/style' })] }).warnings.some(w => w.message.includes('style'))).toBe(true)
  })
  it('detects field collisions and participates in submit.groups', () => {
    const map = node({ id: 'place' }) as GenuiMap
    expect(analyzeSubmissionRegistry({ items: [map, { type: 'submit', label: 'Choose', groups: ['place'] }] }).diagnostics).toEqual([])
    expect(analyzeSubmissionRegistry({ items: [map, { type: 'input', id: 'place' }] }).diagnostics.join(' ')).toContain('conflicts')
  })
  it('fits the narrow antimeridian interval and handles empty and single-point views', () => {
    expect(mapBounds([])).toBeUndefined()
    expect(mapBounds([[12, 20]])).toEqual([[12, 20], [12, 20]])
    expect(mapBounds([[179, 10], [-179, -5]])).toEqual([[179, -5], [181, 10]])
    expect(mapBounds([[-20, 30], [20, -10]])).toEqual([[-20, -10], [20, 30]])
  })
})

it('reports malformed records, missing labels and non-array routes before repair', () => {
  for (const input of [node({ routes: {} }), node({ locations: [null] }), node({ locations: [{ id: 'x', coordinates: [0, 0] }] }), node({ routes: [null] }), node({ routes: [{ id: 'r', coordinates: [[0, 0], [1, 1]] }] })]) {
    expect(validateGenuiSpec({ items: [input] }).ok).toBe(false)
  }
})
