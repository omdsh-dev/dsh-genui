/**
 * Standalone-export media substitution.
 *
 * An exported artifact keeps the media URLs the author wrote, because the
 * media policy deliberately accepts only http(s) and same-origin relative
 * sources. When the export can read the bytes itself it ships them inside the
 * page as `data:` URLs and registers them here, keyed by the URL the spec
 * still carries. Rendering then reads the embedded copy, so the exported file
 * shows its images with no host process, no cookie, and no network (issue
 * #453). The fence path never installs a map, so model-authored specs keep
 * exactly the sources they had.
 * @module @changfenhuang/dsh-genui/client/media-overrides
 */

/** Export-time replacements: original media URL → embedded data URL. */
let overrides: ReadonlyMap<string, string> | undefined

/** Install (or clear) the export media map; only the standalone runtime sets it. */
export function setGenuiMediaOverrides(next: ReadonlyMap<string, string> | undefined): void {
  overrides = next
}

/** Resolve one media source, preferring the embedded copy when the page has one. */
export function genuiMediaSrc(src: string): string {
  return overrides?.get(src) ?? src
}
