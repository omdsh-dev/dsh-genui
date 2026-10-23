/** Trusted host configuration. NEVER populate from a model-authored spec. */
import { createContext, useContext, useSyncExternalStore } from 'react'

/** Structural inline-style carrier with all vendor extension fields preserved.
 * Hosts may use their own MapLibre StyleSpecification for deeper static checking.
 * Runtime style validation remains MapLibre's responsibility, not the model guard.
 */
export type GenuiMapStyle = {
  version: 8
  sources: Record<string, unknown>
  layers: readonly unknown[]
  [name: string]: unknown
}

export interface GenuiMapConfig {
  /** Host-owned inline style. Its sources, sprites and glyphs may use network. */
  style: GenuiMapStyle
}
/** Optional embedding boundary; absent means a source-free offline map. */
export const GenuiMapContext = createContext<GenuiMapConfig | undefined>(undefined)

let hostConfig: GenuiMapConfig | undefined
const listeners = new Set<() => void>()
/** Host-plugin integration; call with reviewed configuration, never model JSON. */
export function setGenuiMapConfig(config: GenuiMapConfig | undefined): void {
  hostConfig = config
  for (const listener of listeners) listener()
}
export function useGenuiMapConfig(): GenuiMapConfig | undefined {
  const context = useContext(GenuiMapContext)
  const fallback = useSyncExternalStore(
    listener => { listeners.add(listener); return () => listeners.delete(listener) },
    () => hostConfig,
    () => undefined,
  )
  return context ?? fallback
}
