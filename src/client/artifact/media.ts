/**
 * Standalone export: embed the images the page can read for itself.
 *
 * A spec may point at `/api/file?path=…` (the host's authenticated file
 * route) or any other same-origin address. Those URLs are only reachable
 * while the host runs and the page keeps its credentials; an exported HTML
 * file opened from `file://` sends neither, so every image showed the
 * `图片无法加载` fallback (issue #453). Reading the bytes at export time and
 * shipping them as `data:` URLs makes the single-file artifact stand on its
 * own. Anything the export cannot read — another origin (CORS), a non-image
 * response, an oversized body, an exhausted budget — keeps its URL and stays
 * an external reference, exactly as before.
 * @module @changfenhuang/dsh-genui/client/artifact/media
 */

import type { GenuiSpec } from '../spec.ts'
import { walkGenuiNodes } from '../walk-spec.ts'
import { bytesToDataUrl } from './base64.ts'

/** Per-image ceiling for embedded payloads (2 MiB before Base64). */
export const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024

/** Whole-artifact ceiling for embedded payloads (8 MiB of Base64 text). */
export const MAX_INLINE_TOTAL_BYTES = 8 * 1024 * 1024

/** Why one media source stayed a URL instead of becoming an embedded copy. */
export type GenuiMediaSkipReason = 'external-origin' | 'unreadable' | 'not-an-image' | 'too-large' | 'budget'

/** One writable media field inside a spec tree. */
export interface GenuiMediaRef {
  /** Current source value. */
  src: string
  /** Replace the source in place. */
  set: (next: string) => void
  /** Whether the field carries an image (only images are embedded). */
  image: boolean
}

/** One media source the export left alone, and why. */
export interface GenuiSkippedMedia {
  src: string
  reason: GenuiMediaSkipReason
}

/** Result of embedding same-origin images into an exported artifact. */
export interface GenuiStandaloneMedia {
  /** Original URL → `data:` URL. Empty when nothing could be embedded. */
  media: Map<string, string>
  /** Sources that stayed URLs. */
  skipped: GenuiSkippedMedia[]
}

/** Options for {@link inlineStandaloneMedia}. */
export interface GenuiStandaloneMediaOptions {
  /** Page address relative URLs resolve against; defaults to `document.baseURI`. */
  baseURI?: string
  /** Fetch implementation (tests inject one). */
  fetchImpl?: typeof fetch
  /** Per-image byte ceiling. */
  maxImageBytes?: number
  /** Total Base64 text ceiling. */
  maxTotalBytes?: number
}

/** Collect every writable media field, including fields that are not nodes. */
export function collectGenuiMediaRefs(spec: GenuiSpec): GenuiMediaRef[] {
  const refs: GenuiMediaRef[] = []
  walkGenuiNodes(spec, node => {
    switch (node.type) {
      case 'image':
        refs.push({ src: node.src, set: next => { node.src = next }, image: true })
        break
      case 'audio':
        refs.push({ src: node.src, set: next => { node.src = next }, image: false })
        break
      case 'video':
        refs.push({ src: node.src, set: next => { node.src = next }, image: false })
        if (typeof node.poster === 'string') refs.push({ src: node.poster, set: next => { node.poster = next }, image: true })
        break
      case 'image-group':
        for (const item of node.items) refs.push({ src: item.src, set: next => { item.src = next }, image: true })
        break
      case 'compare':
        for (const side of [node.before, node.after]) refs.push({ src: side.src, set: next => { side.src = next }, image: true })
        break
      case 'entity-card':
        if (typeof node.image === 'string') refs.push({ src: node.image, set: next => { node.image = next }, image: true })
        break
    }
  })
  return refs
}

/** Sniff the image type of a body whose response header omitted it. */
function sniffImageMime(bytes: Uint8Array): string | undefined {
  const head = bytes.subarray(0, 16)
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'image/gif'
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return 'image/webp'
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
  const text = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart()
  return text.startsWith('<svg') || text.startsWith('<?xml') ? 'image/svg+xml' : undefined
}

/** Resolve one source against the export page and read its bytes. */
async function readEmbeddedImage(
  url: string,
  fetchImpl: typeof fetch,
  maxImageBytes: number,
): Promise<string | { reason: GenuiMediaSkipReason }> {
  try {
    const response = await fetchImpl(url, { credentials: 'same-origin' })
    if (!response.ok) return { reason: 'unreadable' }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxImageBytes) return { reason: 'too-large' }
    const header = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
    const mime = header.startsWith('image/') ? header : sniffImageMime(bytes)
    if (mime === undefined) return { reason: 'not-an-image' }
    return bytesToDataUrl(bytes, mime)
  } catch {
    return { reason: 'unreadable' }
  }
}

/**
 * Embed same-origin images into an exported artifact.
 *
 * @param spec - spec whose media sources are already absolute.
 * @param options - base address, fetch implementation, and byte budgets.
 * @returns the original URL → `data:` URL map plus what stayed external.
 */
export async function inlineStandaloneMedia(
  spec: GenuiSpec,
  options: GenuiStandaloneMediaOptions = {},
): Promise<GenuiStandaloneMedia> {
  const baseURI = options.baseURI ?? (typeof document === 'undefined' ? undefined : document.baseURI)
  const media = new Map<string, string>()
  const skipped: GenuiSkippedMedia[] = []
  if (baseURI === undefined) return { media, skipped }
  let origin: string
  try {
    origin = new URL(baseURI).origin
  } catch {
    return { media, skipped }
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const maxImageBytes = options.maxImageBytes ?? MAX_INLINE_IMAGE_BYTES
  let budget = options.maxTotalBytes ?? MAX_INLINE_TOTAL_BYTES
  /** Two components may share one source; read each body once. */
  const cache = new Map<string, string | { reason: GenuiMediaSkipReason }>()

  for (const ref of collectGenuiMediaRefs(spec)) {
    if (!ref.image) continue
    const src = ref.src.trim()
    if (src === '' || src.startsWith('data:')) continue
    let url: URL
    try {
      url = new URL(src, baseURI)
    } catch {
      skipped.push({ src, reason: 'unreadable' })
      continue
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      skipped.push({ src, reason: 'unreadable' })
      continue
    }
    if (url.origin !== origin) {
      skipped.push({ src, reason: 'external-origin' })
      continue
    }
    const href = url.href
    let embedded = cache.get(href)
    if (embedded === undefined) {
      embedded = await readEmbeddedImage(href, fetchImpl, maxImageBytes)
      cache.set(href, embedded)
    }
    if (typeof embedded !== 'string') {
      skipped.push({ src, reason: embedded.reason })
      continue
    }

    if (embedded.length > budget) {
      skipped.push({ src, reason: 'budget' })
      continue
    }
    budget -= embedded.length
    media.set(src, embedded)
    media.set(href, embedded)
  }

  return { media, skipped }
}
