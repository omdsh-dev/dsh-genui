import type { GenuiSpec } from '../spec.ts'
import { walkGenuiNodes } from '../walk-spec.ts'
import { bytesToDataUrl } from './base64.ts'

interface GenuiMediaRef {
  src: string
  set: (next: string) => void
  image: boolean
}

/** DSH Desktop serves its Web UI and file API on this protocol. */
export function isDesktopMediaUrl(url: URL): boolean {
  return url.protocol === 'dsh-app:' && url.host === 'app'
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

/** Read same-origin images with the active host session. The HTML stores each source once. */
export async function inlineStandaloneMedia(spec: GenuiSpec, baseURI: string, fetchImpl = fetch): Promise<Map<string, string>> {
  const base = new URL(baseURI)
  const sources = new Set(collectGenuiMediaRefs(spec).filter(ref => ref.image).map(ref => ref.src))
  const media = new Map<string, string>()
  for (const src of sources) {
    if (src === '') continue
    try {
      const url = new URL(src, base)
      if (url.protocol !== base.protocol || url.host !== base.host) continue
      const response = await fetchImpl(url.href, { credentials: 'same-origin' })
      const mime = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (response.ok && mime?.startsWith('image/')) {
        media.set(src, bytesToDataUrl(new Uint8Array(await response.arrayBuffer()), mime))
      }
    } catch {
      // The original reference remains available in the exported spec.
    }
  }
  return media
}
