/**
 * Session GenUI panel: the dock surface that renders the latest `render_ui`
 * spec IN PLACE. The toolview publishes every new result into the panel
 * store; this component subscribes and re-renders the same block, so a
 * refresh (model calls render_ui again) updates the panel instead of the
 * message flow accumulating new UI per round.
 *
 * Mounted through the 'conversation.input.dock' list slot (TodoDock posture)
 * — a session-scoped, always-present seat above the composer — so the panel
 * coexists with the message flow on one screen. Absent spec = no panel.
 *
 * The dock is COLLAPSIBLE (TodoDock pattern), defaulting to a one-line
 * header: a tall always-open panel pins above the composer and crushes the
 * message flow's visible area, making history feel unreachable. Collapsed,
 * it takes a single row; expanded, the body caps its height and scrolls
 * internally, so the conversation stays scrollable either way.
 *
 * The expanded body is vertically RESIZABLE: a drag strip between the header
 * and the body adjusts the body height (clamped to sane bounds); the custom
 * height survives expand/collapse cycles for the session's life.
 *
 * Actions ride the same GenuiActionContext contract as inline fences: the
 * sendGenuiAction injection (built from the scoped conversation service in
 * apply) queues a [genui-action] user message back to the model.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14, IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { GenuiActionContext, type GenuiActionHandler } from './action-context.ts'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { GenuiBlock } from './GenuiBlock.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { panelStateKey } from './interaction-store.ts'
import { clearSessionPanel, getPanelExpandToken, getPanelSpec, setLocalPanel, subscribePanel, subscribePanelExpand } from './panel-store.ts'
import css from './GenuiBlock.module.css'

/** Resize bounds for the panel body, in px. */
const PANEL_HEIGHT_MIN = 120
const PANEL_HEIGHT_MAX = 600

/** Injection face built per session in apply (scoped conversation send). */
export interface GenuiPanelInjected {
  sessionId: string
  sendGenuiAction: GenuiActionHandler
}

export type GenuiPanelProps = PropsRuntime<'conversation.input.dock'> & GenuiPanelInjected

/**
 * Panel dock entry. Renders nothing until the session's toolview published a
 * spec; afterwards the SAME block re-renders on every publish. Collapsed by
 * default so the dock never steals the message flow's scroll room; the
 * header always shows the current panel title.
 */
export function GenuiPanel({ sessionId, sendGenuiAction }: GenuiPanelProps) {
  const spec = useSyncExternalStore(subscribePanel, () => getPanelSpec(sessionId))
  const expandToken = useSyncExternalStore(subscribePanelExpand, () => getPanelExpandToken(sessionId))
  const [collapsed, setCollapsed] = useState(true)
  // Custom body height from the resize drag; null = the CSS default (360px).
  const [bodyHeight, setBodyHeight] = useState<number | null>(null)
  const [resizing, setResizing] = useState(false)
  const dragStart = useRef<{ y: number; height: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Explicit expand requests (the /panel command) open the dock even when the
  // user collapsed it manually: the monotone token guarantees a fresh request
  // is never mistaken for the previous one.
  useEffect(() => {
    if (expandToken > 0) setCollapsed(false)
  }, [expandToken])

  // Session teardown: the dock is session-scoped, so unmount means the host
  // pruned or destroyed the session's scope. Release the session's panel
  // state (snapshot, ops, overflow diagnostics, expand token) — without this
  // the module-level store grows one entry per session for the app's whole
  // lifetime. A reopen lazily rebuilds from history replays, which is the
  // host's own lifecycle contract.
  useEffect(() => {
    return () => {
      clearSessionPanel(sessionId)
    }
  }, [sessionId])

  // Cleanup safety net: if the component unmounts mid-drag (spec cleared),
  // the window listeners must not outlive it.
  useEffect(() => {
    if (!resizing) return
    return () => {
      dragStart.current = null
    }
  }, [resizing])

  /** Start a vertical resize drag on the panel's top edge. Dragging UP grows
   * the panel (the edge moves toward the message flow); dragging down shrinks
   * it. Pointer capture binds move/up/cancel to the HANDLE, so dragging past
   * the element edge keeps tracking and nothing global is registered — no
   * window listeners, nothing to leak on unmount. */
  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget
    // Track from the current committed height (state mirrors the drag, the
    // CSS default otherwise) — no DOM measurement needed.
    const startHeight = bodyHeight ?? 360
    dragStart.current = { y: e.clientY, height: startHeight }
    setResizing(true)
    try {
      handle.setPointerCapture(e.pointerId)
    } catch {
      // jsdom / capture unsupported: listeners below still track the drag.
    }
    const onMove = (ev: PointerEvent): void => {
      const start = dragStart.current
      if (start === null) return
      // Upward drag (clientY decreasing) grows the body height.
      const next = Math.min(PANEL_HEIGHT_MAX, Math.max(PANEL_HEIGHT_MIN, start.height + (start.y - ev.clientY)))
      setBodyHeight(next)
    }
    const onUp = (): void => {
      dragStart.current = null
      setResizing(false)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }, [bodyHeight])

  if (spec === null || spec.items.length === 0) return null
  return (
    <div className={css.panel} data-genui-panel>
      {/* Resize grip on the panel's TOP EDGE (above the header): the drag
          target the user described — the outermost top border, not a strip
          under the title. */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整面板高度"
          className={`${css.panelResizeHandle}${resizing ? ` ${css.panelResizeHandleActive}` : ''}`}
          onPointerDown={startResize}
        />
      )}
      <div className={css.panelHeader}>
        <button
          type="button"
          className={css.panelToggle}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(c => !c)}
        >
          <span className={css.panelBadge}>面板</span>
          <span className={css.panelTitle}>{spec.title ?? 'GenUI 面板'}</span>
          <span className={css.panelChevron} aria-hidden>
            {/* Host-style glyphs (same icon set as the TodoDock header) instead of typed arrows. */}
            {collapsed ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
          </span>
        </button>
        {/* In-place dismiss (issue #23): the same local override `/panel
            clear` applies — persists to localStorage, notifies subscribers,
            unmounts the dock without any navigation or reload. */}
        <button
          type="button"
          className={css.panelClose}
          aria-label="关闭面板"
          title="关闭面板"
          onClick={() => setLocalPanel(sessionId, null)}
        >
          <span aria-hidden>✕</span>
        </button>
      </div>
      {!collapsed && (
        <div
          ref={bodyRef}
          className={css.panelBody}
          data-genui-panel-body
          style={bodyHeight === null ? undefined : { height: bodyHeight }}
        >
          <GenuiActionContext.Provider value={sendGenuiAction}>
            <ErrorBoundary label="面板">
              {/* content-fingerprinted: same panel spec re-published restores its state */}
              <GenuiBlock spec={spec} stateKey={panelStateKey(sessionId, JSON.stringify(spec))} />
            </ErrorBoundary>
          </GenuiActionContext.Provider>
        </div>
      )}
    </div>
  )
}
