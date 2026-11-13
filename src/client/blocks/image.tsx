import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { renderInline } from '../inline.ts'
import blockCss from '../GenuiBlock.module.css'
import css from './image.module.css'
import { useT } from '../i18n/index.ts'
import type { GenuiImage } from '../spec.ts'

/**
 * Native image display with a click-to-zoom viewer.
 *
 * The zoom dialog is a native <dialog> kept inside the block subtree so it
 * inherits the host theme tokens (the same approach image-group and compare
 * use). Source safety is enforced upstream by repairGenuiSpec/safeMediaSrc.
 *
 * @param props.node - one validated `image` node.
 * @returns the framed picture, its label/caption, and the zoom viewer.
 */
export function ImageNode({ node }: { node: GenuiImage }): ReactNode {
  const t = useT()
  const id = useId()
  const [failed, setFailed] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)

  const restoreFocus = useCallback(() => {
    const opener = openerRef.current
    if (opener?.isConnected === true) opener.focus({ preventScroll: true })
  }, [])

  const close = useCallback(() => {
    setZoomed(false)
    const dialog = dialogRef.current
    if (dialog !== null) {
      if (dialog.open === true && typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
    restoreFocus()
  }, [restoreFocus])

  useLayoutEffect(() => {
    if (!zoomed) return
    const dialog = dialogRef.current
    if (dialog === null || dialog.open) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    closeRef.current?.focus({ preventScroll: true })
  }, [zoomed])

  useEffect(() => restoreFocus, [restoreFocus])

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  const name = node.alt ?? t('block.image')

  return (
    <figure className={blockCss.media}>
      {node.alt !== undefined && <figcaption className={blockCss.mediaLabel}>{renderInline(node.alt)}</figcaption>}
      {failed
        ? <div className={blockCss.mediaError} role="alert">{t('block.imageError')}</div>
        : (
          <button
            ref={openerRef}
            type="button"
            className={css.zoom}
            aria-label={t('block.imageOpen', { name })}
            aria-haspopup="dialog"
            onClick={() => setZoomed(true)}
          >
            <img
              className={blockCss.mediaPlayer}
              src={node.src}
              alt={name}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              style={{ maxHeight: 'min(70vh, 720px)', objectFit: 'contain' }}
              onError={() => setFailed(true)}
            />
            <span className={css.expand} aria-hidden="true">⤢</span>
          </button>
        )}
      {node.caption !== undefined && <figcaption className={blockCss.mediaCaption}>{renderInline(node.caption)}</figcaption>}
      <dialog
        ref={dialogRef}
        className={css.dialog}
        aria-labelledby={`${id}-dialog-title`}
        onCancel={event => { event.preventDefault(); close() }}
        onClose={() => { if (dialogRef.current?.open !== true) close() }}
        onKeyDown={onDialogKeyDown}
      >
        <div className={css.dialogHead}>
          <h3 className={css.dialogTitle} id={`${id}-dialog-title`}>{renderInline(name, false)}</h3>
          <button ref={closeRef} type="button" className={css.dialogClose} aria-label={t('block.imageClose')} onClick={close}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className={css.frame}>
          <img
            className={css.image}
            src={node.src}
            alt={name}
            loading="eager"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        </div>
        {node.caption !== undefined && <p className={css.dialogCaption}>{renderInline(node.caption)}</p>}
      </dialog>
    </figure>
  )
}
