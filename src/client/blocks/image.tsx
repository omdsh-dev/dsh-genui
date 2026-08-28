import { useState, type ReactNode } from 'react'
import css from '../GenuiBlock.module.css'
import type { GenuiImage } from '../spec.ts'

/**
 * Keep image sources on the same browser-reachable boundary as native
 * audio/video: http(s) or same-origin relative URLs only. In particular,
 * local/active schemes and protocol-relative URLs must not become a way for a
 * model-authored spec to reach arbitrary browser capabilities.
 */
function imageNode(value: unknown): GenuiImage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const node = value as Record<string, unknown>
  if (node.type !== 'image' || typeof node.src !== 'string') return null

  const src = node.src.trim()
  if (src === '' || src.length > 2048) return null
  if (!/^https?:\/\//i.test(src)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || /^[/\\]{2}/.test(src)) return null
  }

  const alt = typeof node.alt === 'string' ? node.alt.slice(0, 2000) : undefined
  return alt === undefined ? { type: 'image', src } : { type: 'image', src, alt }
}

/** Native image display for model-authored, browser-reachable sources. */
export function ImageNode({ node }: { node: unknown }): ReactNode {
  const image = imageNode(node)
  const [failed, setFailed] = useState(false)

  if (image === null) return null

  return (
    <figure className={css.media}>
      {image.alt !== undefined && <figcaption className={css.mediaLabel}>{image.alt}</figcaption>}
      {failed
        ? <div className={css.mediaError} role="alert">图片无法加载</div>
        : <img
            className={css.mediaPlayer}
            src={image.src}
            alt={image.alt ?? '图片'}
            loading="lazy"
            decoding="async"
            style={{ maxHeight: 'min(70vh, 720px)', objectFit: 'contain' }}
            onError={() => setFailed(true)}
          />}
    </figure>
  )
}
