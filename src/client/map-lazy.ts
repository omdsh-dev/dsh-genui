import { loadGenuiAsset } from './asset-loader.ts'
import type { GenuiMap } from './spec.ts'
import type { GenuiMapConfig } from './map-config.ts'

export interface MapController {
  update(node: GenuiMap, selected: string): void
  select(id: string): void
  reset(): void
  zoom(delta: number): void
  resize(): void
  destroy(): void
}
export interface MapMountOptions {
  config?: GenuiMapConfig | undefined
  onSelect(id: string): void
  onError(): void
  onReady(): void
  markerLabel(label: string): string
}
export interface MapAssetApi {
  mountMap(container: HTMLElement, node: GenuiMap, selected: string, options: MapMountOptions): MapController
}
export async function loadMapEngine(): Promise<MapAssetApi> {
  return loadGenuiAsset<MapAssetApi>('maplibre')
}
