/**
 * Two-tier icon lookup.
 *
 * Tier 1 (`ICONS`, inlined 61 glyphs) answers synchronously for the names a
 * conversation reaches for most: states, arrows, and the compute primitives
 * figures are built from. Tier 2 is the FULL 753-glyph catalogue, shipped as
 * `lib/assets/icons.js` (~870 KB of path data) and fetched once, on demand,
 * the first time a spec names something outside tier 1.
 *
 * Why a tier at all: one unknown glyph must not cost every reader 870 KB, and
 * one mis-typed glyph must not cost anything — `ICON_NAMES_FULL` is inlined as
 * names only, so "typo" degrades to the fallback dot without a network round
 * trip, while "not downloaded yet" triggers exactly one load and then
 * re-renders the mounted glyphs through the subscription below.
 * @module @changfenhuang/dsh-genui/client/icons/icon-lazy
 */
import { loadGenuiAsset } from '../asset-loader.ts'
import { ICONS, type BundledIcon } from './icon-data.ts'
import { ICON_NAMES_FULL } from './icon-names-full.ts'

const known = new Set(ICON_NAMES_FULL)

let full: Readonly<Record<string, BundledIcon>> | undefined
let load: Promise<void> | undefined
const listeners = new Set<() => void>()

/** Is `name` a real catalogue entry (even if its paths are not downloaded)? */
export function isKnownIcon(name: string): boolean {
  return ICONS[name] !== undefined || known.has(name)
}

/** Resolve a glyph if its paths are already available, synchronously. */
export function resolveIcon(name: string): BundledIcon | undefined {
  return ICONS[name] ?? full?.[name]
}

/**
 * Subscribe to the one-shot full-catalogue load. Used by mounted `icon` nodes
 * to swap their fallback dot for the real glyph.
 * @returns unsubscribe.
 */
export function onIconsLoaded(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Fetch the full catalogue once. A failed load stays failed for the page (the
 * glyphs keep their fallback), matching the asset loader's memoized-rejection
 * contract — retrying on every render would turn a missing route into a
 * request storm.
 */
export function ensureIcons(): Promise<void> {
  if (full !== undefined) return Promise.resolve()
  if (load !== undefined) return load
  load = loadGenuiAsset<Readonly<Record<string, BundledIcon>>>('icons')
    .then((catalogue) => {
      full = catalogue
      for (const listener of [...listeners]) listener()
    })
    .catch((error: unknown) => {
      if (typeof console !== 'undefined') console.warn('[genui] icon catalogue unavailable', error)
    })
  return load
}
