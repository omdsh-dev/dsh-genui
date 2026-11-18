import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type DialogHTMLAttributes, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { useT } from '../i18n/index.ts'
import css from './mermaid-zoom.module.css'

/** One button click is 1.25x; the bounds keep a pathological wheel burst usable. */
const STEP = 1.25
const MIN_SCALE = 0.25
const MAX_SCALE = 8

interface MermaidZoomDialogProps {
  /** The same sanitized SVG string the card already shows; never re-rendered. */
  readonly html: string
  readonly open: boolean
  readonly onClose: () => void
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
}

/**
 * Full-size viewer for one rendered Mermaid diagram.
 *
 * The dialog stays inside the block subtree rather than portalling to
 * document.body, so it inherits the host theme tokens (the same choice the
 * single-image viewer makes) and works unchanged in a standalone artifact.
 * Only CSS transforms move the diagram: no second mermaid.render, no bitmap.
 */
export function MermaidZoomDialog({ html, open, onClose }: MermaidZoomDialogProps): ReactNode {
  const t = useT()
  const id = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const zoomBy = useCallback((factor: number) => {
    setScale(previous => Math.min(MAX_SCALE, Math.max(MIN_SCALE, previous * factor)))
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (dialog === null) return
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    reset()
    closeRef.current?.focus({ preventScroll: true })
    // 主题重绘只替换同一张图的 SVG 字符串，不该重置用户已经调好的缩放。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset])

  // React registers wheel listeners as passive; a native non-passive listener
  // is the only way to keep the zoom from scrolling the conversation behind.
  useEffect(() => {
    const stage = stageRef.current
    if (stage === null || !open) return
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey) return
      const delta = event.deltaMode === 1 ? event.deltaY * 16
        : event.deltaMode === 2 ? event.deltaY * 400
          : event.deltaY
      if (delta === 0) return
      event.preventDefault()
      zoomBy(delta < 0 ? STEP : 1 / STEP)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [open, zoomBy])

  const closeDialog = (): void => {
    const dialog = dialogRef.current
    if (typeof dialog?.close === 'function') dialog.close()
    else dialog?.removeAttribute('open')
    onClose()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closeDialog()
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.isPrimary === false) return
    if (event.target instanceof Element && event.target.closest('a') !== null) return
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (current === null || current.pointerId !== event.pointerId) return
    setOffset({
      x: current.originX + event.clientX - current.startX,
      y: current.originY + event.clientY - current.startY,
    })
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null
  }

  const onLostPointerCapture = (): void => { drag.current = null }

  const onDialogClick = (event: MouseEvent<HTMLDialogElement>): void => {
    const dialog = dialogRef.current
    if (dialog === null || event.target !== dialog) return
    // closedby="any" 原生处理遮罩关闭；这里是 Safari 等旧引擎的回退。
    // 只看 target 会把 dialog 自己的 padding 区也算成遮罩，故用坐标复核。
    const rect = dialog.getBoundingClientRect()
    const inside = rect.top <= event.clientY && event.clientY <= rect.bottom
      && rect.left <= event.clientX && event.clientX <= rect.right
    if (inside) return
    closeDialog()
  }

  // close 事件是异步派发的。快速重开时若迟到的事件到达，dialog 已经重新
  // showModal，忽略它；否则刚打开的弹层会被上一次关闭立刻收掉。
  const onDialogClose: DialogHTMLAttributes<HTMLDialogElement>['onClose'] = () => {
    if (dialogRef.current?.open === true) return
    onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className={css.dialog}
      aria-labelledby={`${id}-title`}
      closedby="any"
      onCancel={event => { event.preventDefault(); closeDialog() }}
      onClose={onDialogClose}
      onKeyDown={onKeyDown}
      onClick={onDialogClick}
    >
      <div className={css.head}>
        <h3 className={css.title} id={`${id}-title`}>{t('block.mermaidZoom')}</h3>
        <div className={css.tools}>
          <button type="button" className={css.tool} aria-label={t('block.mermaidZoomOut')} onClick={() => zoomBy(1 / STEP)}>−</button>
          <button type="button" className={css.tool} aria-label={t('block.mermaidZoomIn')} onClick={() => zoomBy(STEP)}>+</button>
          <button type="button" className={css.tool} aria-label={t('block.mermaidZoomReset')} onClick={reset}>{t('block.mermaidZoomReset')}</button>
          <button ref={closeRef} type="button" className={css.close} aria-label={t('block.mermaidClose')} onClick={closeDialog}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
      {open && (
        <div
          ref={stageRef}
          className={css.stage}
          data-genui-mermaid-stage
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onLostPointerCapture={onLostPointerCapture}
        >
          <div
            className={css.surface}
            data-genui-mermaid-surface
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      )}
      <p className={css.hint}>{t('block.mermaidZoomHint')}</p>
    </dialog>
  )
}
