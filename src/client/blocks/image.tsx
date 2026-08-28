import { useState, type ReactNode } from 'react'
import css from '../GenuiBlock.module.css'
import type { GenuiImage } from '../spec.ts'

/** Native image display; source safety is enforced by repairGenuiSpec/safeMediaSrc. */
export function ImageNode({ node }: { node: GenuiImage }): ReactNode {
  const [failed, setFailed] = useState(false)

  return (
    <figure className={css.media}>
      {node.alt !== undefined && <figcaption className={css.mediaLabel}>{node.alt}</figcaption>}
      {failed
        ? <div className={css.mediaError} role="alert">图片无法加载</div>
        : <img
            className={css.mediaPlayer}
            src={node.src}
            alt={node.alt ?? '图片'}
            loading="lazy"
            decoding="async"
            style={{ maxHeight: 'min(70vh, 720px)', objectFit: 'contain' }}
            onError={() => setFailed(true)}
          />}
    </figure>
  )
}
