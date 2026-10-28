/**
 * `compare` node: two images shown as an ordered pair (what changed, what was
 * chosen). Three layouts share one frame geometry:
 *
 * - `side`   two columns while the container allows it, one below ~560px
 *            (container query, not a window breakpoint — the same block can
 *            live in a 1100px reply column or a 320px side panel).
 * - `stack`  always vertical, for tall screenshots.
 * - `slider` one frame, the `after` image clipped at a draggable divider.
 *
 * The zoom dialog is a native <dialog> kept inside the block subtree so it
 * inherits the host theme tokens (same approach as image-group).
 * @module @changfenhuang/dsh-genui/client/blocks/compare
 */
import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type KeyboardEvent, type ReactNode,
} from 'react'

import { useT } from '../i18n/index.ts'
import { renderInline } from '../inline.ts'
import { safeMediaSrc } from '../genui-runtime/value-utils.ts'
import type { GenuiCompare, GenuiComparePanel } from '../spec.ts'
import css from './compare.module.css'

interface Panel {
  panel: GenuiComparePanel
  src: string | undefined
  label: string
}

const MIN_HEIGHT = 120
const MAX_HEIGHT = 640
const DEFAULT_HEIGHT = 260

function panelOf(panel: GenuiComparePanel, fallbackLabel: string): Panel {
  const label = panel.label?.trim()
  return {
    panel,
    src: safeMediaSrc(panel.src),
    label: label === undefined || label === '' ? fallbackLabel : label,
  }
}

/** One framed side. Exported for tests to render a single panel. */
function Frame({ side, height, onOpen, expanded = false }: {
  side: Panel
  height: number
  onOpen?: (opener: HTMLButtonElement) => void
  expanded?: boolean
}): ReactNode {
  const t = useT()
  const [failed, setFailed] = useState(false)
  const broken = side.src === undefined || failed
  const image = broken
    ? <span className={css.broken} role={expanded ? 'alert' : undefined}>{t('block.imageError')}</span>
    : (
      <img
        className={css.image}
        src={side.src}
        alt={side.panel.alt ?? side.label}
        referrerPolicy="no-referrer"
        loading={expanded ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailed(true)}
      />
    )

  if (expanded) return <div className={css.expandedFrame}>{image}</div>

  return (
    <button
      type="button"
      className={css.hit}
      style={{ height }}
      aria-label={t('block.compareOpen', { name: side.label })}
      aria-haspopup="dialog"
      onClick={event => onOpen?.(event.currentTarget)}
    >
      {image}
      <span className={css.chip}>{side.label}</span>
      <span className={css.expand} aria-hidden="true">⤢</span>
    </button>
  )
}

/** Draggable divider: a real range input under an invisible surface, so pointer
 *  drag, touch, keyboard arrows and Home/End all work without custom physics. */
function Slider({ before, after, height }: { before: Panel; after: Panel; height: number }): ReactNode {
  const t = useT()
  const [pos, setPos] = useState(50)
  const broken = before.src === undefined || after.src === undefined
  return (
    <div className={css.slider} style={{ height }}>
      {broken
        ? <span className={css.broken}>{t('block.imageError')}</span>
        : (
          <>
            <img className={css.sliderImage} src={before.src} alt={before.panel.alt ?? before.label} referrerPolicy="no-referrer" decoding="async" />
            <img
              className={css.sliderImage}
              src={after.src}
              alt={after.panel.alt ?? after.label}
              referrerPolicy="no-referrer"
              decoding="async"
              style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
            />
          </>
        )}
      <span className={`${css.chip} ${css.chipLeft}`}>{before.label}</span>
      <span className={`${css.chip} ${css.chipRight}`}>{after.label}</span>
      <span className={css.divider} style={{ left: `${pos}%` }} aria-hidden="true">
        <span className={css.knob} aria-hidden="true">↔</span>
      </span>
      <input
        type="range"
        className={css.range}
        min={0}
        max={100}
        step={1}
        value={pos}
        aria-label={`${t('block.compareHint')} (${before.label} / ${after.label})`}
        onChange={event => setPos(Number(event.currentTarget.value))}
      />
    </div>
  )
}

export function CompareNode({ node }: { node: GenuiCompare }): ReactNode {
  const t = useT()
  const id = useId()
  const mode = node.mode ?? 'side'
  const height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(node.height ?? DEFAULT_HEIGHT)))
  const before = panelOf(node.before, t('block.compareBefore'))
  const after = panelOf(node.after, t('block.compareAfter'))

  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const [zoom, setZoom] = useState<'before' | 'after' | null>(null)
  const zoomed = zoom === 'before' ? before : zoom === 'after' ? after : undefined

  const restoreFocus = useCallback(() => {
    const opener = openerRef.current
    openerRef.current = null
    if (opener?.isConnected === true) opener.focus({ preventScroll: true })
  }, [])

  const close = useCallback(() => {
    setZoom(null)
    const dialog = dialogRef.current
    if (dialog?.open === true) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
    restoreFocus()
  }, [restoreFocus])

  useLayoutEffect(() => {
    if (zoom === null) return
    const dialog = dialogRef.current
    if (dialog === null || dialog.open) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    closeRef.current?.focus({ preventScroll: true })
  }, [zoom])

  useEffect(() => restoreFocus, [restoreFocus])

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  }

  return (
    <section className={css.compare} data-genui-compare data-compare-mode={mode} aria-labelledby={`${id}-title`}>
      {node.title !== undefined
        ? <h3 className={css.title} id={`${id}-title`}>{renderInline(node.title)}</h3>
        : <span className={css.srOnly} id={`${id}-title`}>{t('block.compare')}</span>}

      {mode === 'slider'
        ? <Slider before={before} after={after} height={height} />
        : (
          <div className={`${css.grid} ${mode === 'stack' ? css.stack : ''}`}>
            {([before, after] as const).map((side, index) => (
              <figure key={index === 0 ? 'before' : 'after'} className={css.panel}>
                <div className={css.frame}>
                  <Frame
                    side={side}
                    height={height}
                    onOpen={opener => { openerRef.current = opener; setZoom(index === 0 ? 'before' : 'after') }}
                  />
                </div>
                {side.panel.caption !== undefined
                  && <figcaption className={css.caption}>{renderInline(side.panel.caption)}</figcaption>}
              </figure>
            ))}
          </div>
        )}

      {mode === 'slider' && (before.panel.caption !== undefined || after.panel.caption !== undefined) && (
        <div className={css.captions}>
          {before.panel.caption !== undefined && <span className={css.caption}>{renderInline(before.panel.caption)}</span>}
          {after.panel.caption !== undefined && <span className={css.caption}>{renderInline(after.panel.caption)}</span>}
        </div>
      )}

      <dialog
        ref={dialogRef}
        className={css.dialog}
        aria-labelledby={`${id}-dialog-title`}
        onCancel={event => { event.preventDefault(); close() }}
        onClose={() => { if (!dialogRef.current?.open) close() }}
        onKeyDown={onDialogKeyDown}
      >
        <div className={css.dialogHead}>
          <h3 className={css.title} id={`${id}-dialog-title`}>{zoomed?.label ?? t('block.compare')}</h3>
          <button ref={closeRef} type="button" className={css.close} aria-label={t('block.imageClose')} onClick={close}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {zoomed !== undefined && <Frame side={zoomed} height={height} expanded />}
      </dialog>
    </section>
  )
}

/** Exported for the gallery/tests: the frame height clamp. */
export const COMPARE_HEIGHT_CLAMP: readonly [number, number] = [MIN_HEIGHT, MAX_HEIGHT]
