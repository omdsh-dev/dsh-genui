import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { GENUI_LIMITS } from '../genui-runtime/limits.ts'
import { safeMediaSrc } from '../genui-runtime/value-utils.ts'
import { useT } from '../i18n/index.ts'
import { renderInline } from '../inline.ts'
import type { GenuiImageGroup, GenuiImageGroupItem } from '../spec.ts'
import css from './gallery.module.css'

interface GalleryEntry {
  key: string
  item: GenuiImageGroupItem
  src: string | undefined
}

/** Source identity survives streaming append/reordering; duplicates stay distinct. */
function entriesOf(items: GenuiImageGroupItem[]): GalleryEntry[] {
  const occurrences = new Map<string, number>()
  return items.slice(0, GENUI_LIMITS.maxImageGroupItems).map(item => {
    const src = safeMediaSrc(item.src)
    const identity = src ?? item.src
    const occurrence = occurrences.get(identity) ?? 0
    occurrences.set(identity, occurrence + 1)
    return { key: JSON.stringify([identity, occurrence]), item, src }
  })
}

function GalleryImage({ entry, expanded = false, onRatio }: {
  entry: GalleryEntry
  expanded?: boolean
  onRatio?: (ratio: number) => void
}): ReactNode {
  const t = useT()
  const [failed, setFailed] = useState(false)
  if (entry.src === undefined || failed) return <span className={css.imageError} role={expanded ? 'alert' : undefined}>{t('block.imageError')}</span>
  return (
    <img
      className={expanded ? css.expandedImage : css.thumbnailImage}
      src={entry.src}
      referrerPolicy="no-referrer"
      alt={entry.item.alt ?? t('block.image')}
      loading={expanded ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
      onLoad={event => {
        const { naturalWidth, naturalHeight } = event.currentTarget
        if (naturalWidth > 0 && naturalHeight > 0) onRatio?.(naturalWidth / naturalHeight)
      }}
    />
  )
}

function Thumbnail({ entry, position, onOpen }: {
  entry: GalleryEntry
  position: string
  onOpen: (opener: HTMLButtonElement) => void
}): ReactNode {
  const t = useT()
  const [ratio, setRatio] = useState(4 / 3)
  return (
    <figure className={css.imageTile} style={{ '--gallery-image-ratio': Math.max(0.6, Math.min(2.4, ratio)) } as CSSProperties}>
      <button
        type="button"
        className={css.thumbnail}
        aria-label={t('block.imageOpen', { name: entry.item.alt ?? entry.item.caption ?? position })}
        aria-haspopup="dialog"
        onClick={event => onOpen(event.currentTarget)}
      >
        <GalleryImage entry={entry} onRatio={setRatio} />
        <span className={css.expandHint} aria-hidden="true">⤢</span>
      </button>
      {entry.item.caption !== undefined && <figcaption className={css.caption}>{renderInline(entry.item.caption)}</figcaption>}
    </figure>
  )
}

/** Native modal stays in the block subtree, inheriting the host theme tokens. */
export function ImageGroupNode({ node }: { node: GenuiImageGroup }): ReactNode {
  const t = useT()
  const id = useId()
  const rootRef = useRef<HTMLElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const entries = entriesOf(node.items)
  const selectedIndex = entries.findIndex(entry => entry.key === selectedKey)
  const selected = entries[selectedIndex]

  const restoreFocus = useCallback(() => {
    const opener = openerRef.current
    openerRef.current = null
    if (opener === null) return
    if (opener.isConnected) opener.focus({ preventScroll: true })
    else rootRef.current?.focus({ preventScroll: true })
  }, [])

  const close = useCallback(() => {
    setSelectedKey(null)
    const dialog = dialogRef.current
    if (dialog?.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
    restoreFocus()
  }, [restoreFocus])

  useLayoutEffect(() => {
    if (selectedKey === null) return
    if (selectedIndex < 0) { close(); return }
    const dialog = dialogRef.current
    if (dialog === null || dialog.open) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    closeRef.current?.focus({ preventScroll: true })
  }, [selectedKey, selectedIndex, close])

  useEffect(() => restoreFocus, [restoreFocus])

  const select = (index: number): void => {
    const entry = entries[index]
    if (entry !== undefined) setSelectedKey(entry.key)
  }

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
    if (event.key === 'Tab') {
      // Also keeps keyboard focus inside the inline fallback on older hosts
      // without showModal. Native dialogs perform their own inerting.
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]'))
      const first = controls[0]
      const last = controls[controls.length - 1]
      const active = event.currentTarget.ownerDocument.activeElement
      if (event.shiftKey && active === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus() }
      return
    }
    if (event.key === 'ArrowLeft') select(selectedIndex - 1)
    else if (event.key === 'ArrowRight') select(selectedIndex + 1)
    else if (event.key === 'Home') select(0)
    else if (event.key === 'End') select(entries.length - 1)
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <section ref={rootRef} className={css.gallery} tabIndex={-1} aria-labelledby={`${id}-title`}>
      <h3 className={css.title} id={`${id}-title`}>{renderInline(node.title ?? t('block.imageGroup'))}</h3>
      {entries.length === 0
        ? <p className={css.empty}>{t('block.galleryEmpty')}</p>
        : <div className={css.imageGrid}>
            {entries.map((entry, index) => <Thumbnail
              key={entry.key}
              entry={entry}
              position={t('block.imagePosition', { current: index + 1, total: entries.length })}
              onOpen={opener => { openerRef.current = opener; setSelectedKey(entry.key) }}
            />)}
          </div>}
      <dialog
        ref={dialogRef}
        className={css.dialog}
        aria-labelledby={`${id}-dialog-title`}
        onCancel={event => { event.preventDefault(); close() }}
        onClose={() => { if (!dialogRef.current?.open) close() }}
        onKeyDown={onDialogKeyDown}
      >
        <div className={css.header}>
          <h3 className={css.title} id={`${id}-dialog-title`}>{renderInline(node.title ?? t('block.imageGroup'), false)}</h3>
          <button ref={closeRef} type="button" className={css.control} aria-label={t('block.imageClose')} onClick={close}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {selected !== undefined && <>
          <figure className={css.expandedFigure}>
            <div className={css.expandedFrame}><GalleryImage key={selected.key} entry={selected} expanded /></div>
            {selected.item.caption !== undefined && <figcaption className={css.caption}>{renderInline(selected.item.caption)}</figcaption>}
          </figure>
          <div className={css.lightboxFooter}>
            <span className={css.position} role="status" aria-live="polite" aria-atomic="true">{t('block.imagePosition', { current: selectedIndex + 1, total: entries.length })}</span>
            {entries.length > 1 && <div className={css.controls}>
              <button type="button" className={css.control} aria-label={t('block.imagePrevious')} aria-disabled={selectedIndex === 0} onClick={() => select(selectedIndex - 1)}>
                <span aria-hidden="true">←</span>
              </button>
              <button type="button" className={css.control} aria-label={t('block.imageNext')} aria-disabled={selectedIndex === entries.length - 1} onClick={() => select(selectedIndex + 1)}>
                <span aria-hidden="true">→</span>
              </button>
            </div>}
          </div>
        </>}
      </dialog>
    </section>
  )
}
