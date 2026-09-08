// The session panel: store publish/subscribe isolation, dock rendering, the
// action loop wiring, and the toolview→store publish path.
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GENUI_ACTION_DEBOUNCE_MS } from '../src/client/GenuiBlock.tsx'
import { renderGenuiFence } from '../src/client/index.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'
import { GenuiPanel } from '../src/client/panel.tsx'
import {
  applyPanelOperation, clearSessionPanel, getPanelExpandToken, getPanelSpec, requestPanelExpand, setLocalPanel, setPanelLimits, subscribePanel,
} from '../src/client/panel-store.ts'
import { GenuiToolView } from '../src/client/toolview.tsx'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  clearSessionPanel('s1')
  clearSessionPanel('s2')
  // panel persistence writes localStorage — wipe it between tests so a
  // session id reused across tests never hydrates stale storage.
  localStorage.clear()
})

const text = (content: string) => ({ type: 'text', content })

/** Direct replace publish (the operation-model spelling of the old facade). */
let directSeq = 0
function direct(sessionId: string, spec: unknown, seq?: number): void {
  const order = seq ?? directSeq
  applyPanelOperation(sessionId, {
    sourceId: `direct:${directSeq++}`,
    order: [order, -1, 0],
    mode: 'replace',
    spec: spec as never,
  })
}

describe('panel store', () => {
  it('publishes and reads per session, isolated across sessions', () => {
    const a = { items: [text('A')] }
    const b = { items: [text('B')] }
    direct('s1', a)
    direct('s2', b)
    expect(getPanelSpec('s1')).toBe(a)
    expect(getPanelSpec('s2')).toBe(b)
  })

  it('notifies subscribers only on actual change', () => {
    const spec = { items: [text('x')] }
    const fn = vi.fn()
    const unsub = subscribePanel(fn)
    direct('s1', spec)
    expect(fn).toHaveBeenCalledTimes(1)
    direct('s1', spec) // same reference: no notification
    expect(fn).toHaveBeenCalledTimes(1)
    direct('s1', { items: [text('y')] })
    expect(fn).toHaveBeenCalledTimes(2)
    unsub()
    direct('s1', { items: [text('z')] })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('clears the panel on null publish (local override)', () => {
    direct('s1', { items: [text('x')] })
    // the user-facing hard clear is the local override; clearSessionPanel is
    // memory teardown (its storage survives for reopen hydration).
    setLocalPanel('s1', null)
    expect(getPanelSpec('s1')).toBeNull()
  })
})

describe('GenuiPanel dock', () => {
  function renderPanel(sessionId = 's1', sendGenuiAction = vi.fn()) {
    return render(<GenuiPanel sessionId={sessionId} sendGenuiAction={sendGenuiAction} /> as never)
  }

  it('renders nothing without a published spec', () => {
    const { container } = renderPanel()
    expect(container.querySelector('[data-genui-panel]')).toBeNull()
  })

  it('dismisses the panel in place via the header ✕ button and persists the cleared state (issue #23)', () => {
    direct('s1', { title: 'T', items: [text('x')] })
    const { container } = renderPanel()
    expect(container.querySelector('[data-genui-panel]')).not.toBeNull()
    const close = container.querySelector<HTMLButtonElement>('[aria-label="关闭面板"]')
    expect(close).not.toBeNull()
    fireEvent.click(close!)
    // Same semantics as `/panel clear`: snapshot folds to null in memory,
    // subscribers notified, dock unmounts without navigation or reload.
    expect(getPanelSpec('s1')).toBeNull()
    expect(container.querySelector('[data-genui-panel]')).toBeNull()
    const persisted = JSON.parse(localStorage.getItem('dsh.genui.panel') ?? '{}') as { sessions: Record<string, { snapshot: unknown }> }
    expect(persisted.sessions['s1']?.snapshot).toBeNull()
    // A later publish re-opens the dock exactly as after `/panel clear`.
    act(() => {
      direct('s1', { title: 'T2', items: [text('y')] })
    })
    expect(container.querySelector('[data-genui-panel]')).not.toBeNull()
  })

  it('shows a resize handle on the top edge when expanded and resizes the body on drag', () => {
    direct('s1', { title: 'T', items: [text('x')] })
    const { container } = renderPanel()
    // collapsed: no handle
    expect(container.querySelector('[role="separator"][aria-label="调整面板高度"]')).toBeNull()
    fireEvent.click(container.querySelector('[aria-expanded="false"]')!)
    const handle = container.querySelector('[role="separator"][aria-label="调整面板高度"]')!
    expect(handle).not.toBeNull()
    const body = container.querySelector('[data-genui-panel-body]') as HTMLElement | null
    expect(body).not.toBeNull()
    // drag UP 100px (top edge toward the message flow): body grows; events
    // ride the handle via pointer capture (no window listeners)
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 0, pointerId: 1 })
    expect(body!.style.height).toBe('460px')
    // drag beyond the cap: clamped to PANEL_HEIGHT_MAX (600)
    fireEvent.pointerMove(handle, { clientY: -2000, pointerId: 1 })
    expect(body!.style.height).toBe('600px')
    // drag below the floor: clamped to PANEL_HEIGHT_MIN (120)
    fireEvent.pointerMove(handle, { clientY: 2000, pointerId: 1 })
    expect(body!.style.height).toBe('120px')
    // release: listeners gone, height persists
    fireEvent.pointerUp(handle, { pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 300, pointerId: 1 })
    expect(body!.style.height).toBe('120px')
  })

  it('pointercancel ends the drag and leaves no listeners behind', () => {
    direct('s1', { title: 'T', items: [text('x')] })
    const { container, unmount } = renderPanel()
    fireEvent.click(container.querySelector('[aria-expanded="false"]')!)
    const handle = container.querySelector('[role="separator"][aria-label="调整面板高度"]')!
    const body = container.querySelector('[data-genui-panel-body]') as HTMLElement | null
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 7 })
    fireEvent.pointerMove(handle, { clientY: 100, pointerId: 7 })
    expect(body!.style.height).toBe('460px')
    fireEvent.pointerCancel(handle, { pointerId: 7 })
    fireEvent.pointerMove(handle, { clientY: 0, pointerId: 7 })
    expect(body!.style.height).toBe('460px') // drag ended, no further changes
    unmount() // must not throw (no dangling window listeners)
  })

  it('renders collapsed with the title, and reveals content on expand (per session)', () => {
    direct('s1', { title: '面板 A', items: [text('内容 A')] })
    direct('s2', { title: '面板 B', items: [text('内容 B')] })
    const { container } = renderPanel('s1')
    expect(container.querySelector('[data-genui-panel]')).not.toBeNull()
    // collapsed by default: title visible, content hidden
    expect(screen.getByText('面板 A')).toBeTruthy()
    expect(screen.queryByText('内容 A')).toBeNull()
    expect(screen.queryByText('内容 B')).toBeNull()
    // expand: content appears, other sessions' still hidden
    fireEvent.click(container.querySelector('[aria-expanded="false"]')!)
    expect(screen.getByText('内容 A')).toBeTruthy()
    expect(screen.queryByText('内容 B')).toBeNull()
    // collapse again
    fireEvent.click(container.querySelector('[aria-expanded="true"]')!)
    expect(screen.queryByText('内容 A')).toBeNull()
  })

  it('updates in place when a new spec is published (expanded)', () => {
    const { container } = renderPanel()
    act(() => { direct('s1', { title: 'T', items: [text('第一版')] }) })
    fireEvent.click(container.querySelector('[aria-expanded="false"]')!)
    expect(screen.getByText('第一版')).toBeTruthy()
    act(() => { direct('s1', { title: 'T', items: [text('第二版')] }) })
    expect(screen.queryByText('第一版')).toBeNull()
    expect(screen.getByText('第二版')).toBeTruthy()
    expect(container.querySelectorAll('[data-genui-panel]')).toHaveLength(1)
  })

  it('routes component actions through sendGenuiAction (debounced)', () => {
    vi.useFakeTimers()
    const sendGenuiAction = vi.fn()
    direct('s1', {
      title: 'T',
      items: [{ type: 'button', label: '刷新', action: 'refresh' }],
    })
    const { container } = renderPanel('s1', sendGenuiAction)
    fireEvent.click(container.querySelector('[aria-expanded="false"]')!) // expand first
    fireEvent.click(screen.getByText('刷新'))
    expect(sendGenuiAction).not.toHaveBeenCalled()
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(sendGenuiAction).toHaveBeenCalledWith('refresh', expect.objectContaining({ type: 'button' }))
  })
})

describe('GenuiToolView publishes to the panel store', () => {
  const resultBlock = (meta: unknown): ToolCallBlock => ({
    kind: 'tool-result',
    seq: 1,
    time: 0,
    callId: 'call-1',
    call: { name: 'render_ui', argsRaw: '{}' },
    callTime: 1,
    content: [],
    isError: false,
    meta,
  } as ToolCallBlock)

  function props(block: ToolCallBlock, sessionId = 's1'): ToolCallViewProps {
    return {
      callId: 'call-1',
      toolName: 'render_ui',
      block,
      openFile: () => {},
      sessionId,
    } as unknown as ToolCallViewProps
  }

  it('publishes the repaired spec for the session on a settled result', () => {
    render(<GenuiToolView {...props(resultBlock({ items: [text('面板内容')] }))} />)
    const published = getPanelSpec('s1')
    expect(published).not.toBeNull()
    expect(published!.items.some(n => n.type === 'text' && 'content' in n && n.content === '面板内容')).toBe(true)
    // other sessions untouched
    expect(getPanelSpec('s2')).toBeNull()
  })

  it('does not publish while the call is running (no meta)', () => {
    render(<GenuiToolView {...props({ kind: 'tool-call', seq: 1, time: 0, callId: 'call-1', call: { name: 'render_ui', argsRaw: '{}' } } as ToolCallBlock)} />)
    expect(getPanelSpec('s1')).toBeNull()
  })
})

describe('panel-only fences', () => {
  const ctx = (seq: number, block = 0, fence = 0) => ({
    sessionId: 's1',
    source: { id: JSON.stringify(['assistant', seq, block, fence]), order: [seq, block, fence] as const },
  })

  it('publishes a panel:true fence from a settled source context and renders nothing', () => {
    const node = renderGenuiFence('{"panel":true,"title":"面板","items":[{"type":"text","content":"面板内容"}]}', 0, ctx(10))
    // The keyed publisher element renders nothing into the message flow…
    const { container } = render(node as never)
    expect(container.textContent).toBe('')
    // …and folds the panel exactly once.
    const published = getPanelSpec('s1')
    expect(published).not.toBeNull()
    expect(published!.panel).toBe(true)
    expect(published!.items.some(n => n.type === 'text' && 'content' in n && n.content === '面板内容')).toBe(true)
  })

  it('keeps ordinary fences rendering inline without touching the panel', () => {
    clearSessionPanel('s1')
    const node = renderGenuiFence('{"title":"普通","items":[{"type":"text","content":"正文"}]}', 0, ctx(10))
    expect(node).not.toBeNull()
    expect(getPanelSpec('s1')).toBeNull()
  })

  it('skips publishing without a settled source (streaming / non-conversation)', () => {
    clearSessionPanel('s1')
    // context without a source: streaming render — the panel stays untouched
    const streaming = renderGenuiFence('{"panel":true,"items":[{"type":"text","content":"x"}]}', 0, { sessionId: 's1' })
    expect(streaming).toBeNull()
    expect(getPanelSpec('s1')).toBeNull()
    // no context at all (non-conversation surface): same behavior
    const bare = renderGenuiFence('{"panel":true,"items":[{"type":"text","content":"x"}]}', 0)
    expect(bare).toBeNull()
    expect(getPanelSpec('s1')).toBeNull()
  })

  it('repair keeps the panel flag', () => {
    const repaired = repairGenuiSpec({ panel: true, items: [] })
    expect(repaired?.panel).toBe(true)
    expect(repairGenuiSpec({ panel: 'yes', items: [] })?.panel).toBeUndefined()
  })
})

describe('panel operation model (real order, no Infinity)', () => {
  const fenceSpec = (content: string) => ({ panel: true, items: [text(content)] })
  const toolSpec = (content: string) => ({ items: [text(content)] })

  afterEach(() => {
    setPanelLimits({ maxNodes: 200, maxAppends: 200 })
  })

  it('rejects an older seq publish after a newer one', () => {
    const newer = { items: [text('新')] }
    const older = { items: [text('旧')] }
    direct('s1', newer, 100)
    direct('s1', older, 50) // replay of an older tool result
    expect(getPanelSpec('s1')).toBe(newer)
  })

  it('accepts the same-seq overwrite (later publish wins ties)', () => {
    const a = { items: [text('A')] }
    const b = { items: [text('B')] }
    direct('s1', a, 10)
    direct('s1', b, 10) // same seq: later wins
    expect(getPanelSpec('s1')).toBe(b)
  })

  it('a later tool result wins over an earlier fence (real order)', () => {
    const fence = fenceSpec('F')
    const tool = toolSpec('T')
    applyPanelOperation('s1', { sourceId: 'fence:20', order: [20, 0, 0], mode: 'replace', spec: fence })
    applyPanelOperation('s1', { sourceId: 'tool:30', order: [30, -1, 0], mode: 'replace', spec: tool })
    expect(getPanelSpec('s1')).toBe(tool)
  })

  it('replaying an older fence after a newer tool does not clobber it', () => {
    const fence = fenceSpec('F')
    const tool = toolSpec('T')
    applyPanelOperation('s1', { sourceId: 'tool:30', order: [30, -1, 0], mode: 'replace', spec: tool })
    applyPanelOperation('s1', { sourceId: 'fence:20', order: [20, 0, 0], mode: 'replace', spec: fence })
    expect(getPanelSpec('s1')).toBe(tool)
  })

  it('out-of-order arrivals fold by order, not by arrival', () => {
    const a = { items: [text('A')] }
    const b = { items: [text('B')] }
    applyPanelOperation('s1', { sourceId: 'src:b', order: [30, -1, 0], mode: 'replace', spec: b })
    applyPanelOperation('s1', { sourceId: 'src:a', order: [20, -1, 0], mode: 'replace', spec: a })
    // final fold: A's replace is older than B's → B wins
    expect(getPanelSpec('s1')).toBe(b)
  })

  it('A→B→A replays append each source exactly once', () => {
    const a = { items: [text('A')] }
    const b = { items: [text('B')] }
    applyPanelOperation('s1', { sourceId: 'src:a', order: [10, 0, 0], mode: 'append', spec: a })
    applyPanelOperation('s1', { sourceId: 'src:b', order: [11, 0, 0], mode: 'append', spec: b })
    applyPanelOperation('s1', { sourceId: 'src:a', order: [10, 0, 0], mode: 'append', spec: a }) // replay
    expect(getPanelSpec('s1')!.items).toEqual([text('A'), text('B')])
  })

  it('an append older than the latest replace is cut', () => {
    const r = { items: [text('R')] }
    const a = { items: [text('A')] }
    applyPanelOperation('s1', { sourceId: 'r:20', order: [20, -1, 0], mode: 'replace', spec: r })
    applyPanelOperation('s1', { sourceId: 'a:10', order: [10, 0, 0], mode: 'append', spec: a }) // late arrival, older
    expect(getPanelSpec('s1')!.items).toEqual([text('R')])
  })

  it('the same source replayed 3 times folds and notifies once', () => {
    const fn = vi.fn()
    const unsub = subscribePanel(fn)
    const spec = { items: [text('X')] }
    applyPanelOperation('s1', { sourceId: 'src:x', order: [10, 0, 0], mode: 'append', spec })
    applyPanelOperation('s1', { sourceId: 'src:x', order: [10, 0, 0], mode: 'append', spec })
    applyPanelOperation('s1', { sourceId: 'src:x', order: [10, 0, 0], mode: 'append', spec })
    expect(getPanelSpec('s1')!.items).toEqual([text('X')])
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('a local clear persists and blocks old replays; a later publish rebuilds', () => {
    direct('s1', { items: [text('x')] }, 5)
    setLocalPanel('s1', null)
    expect(getPanelSpec('s1')).toBeNull()
    // old replay at/below the clear barrier stays dead
    direct('s1', { items: [text('old')] }, 4)
    expect(getPanelSpec('s1')).toBeNull()
    // a genuinely newer publish rebuilds the panel
    direct('s1', { items: [text('y')] }, 6)
    expect(getPanelSpec('s1')?.items).toEqual([text('y')])
  })

  it('a consumed op dropped by a later replace never re-folds on replay (history scroll)', () => {
    applyPanelOperation('s1', { sourceId: 'a:10', order: [10, 0, 0], mode: 'append', spec: { items: [text('A')] } })
    applyPanelOperation('s1', { sourceId: 'r:20', order: [20, 0, 0], mode: 'replace', spec: { items: [text('R')] } })
    // scrolling history re-mounts the old card and re-publishes its op:
    // it was already consumed, so it must NOT re-append under R.
    applyPanelOperation('s1', { sourceId: 'a:10', order: [10, 0, 0], mode: 'append', spec: { items: [text('A')] } })
    expect(getPanelSpec('s1')!.items).toEqual([text('R')])
  })

  it('restores the panel from localStorage after memory teardown (reload)', () => {
    direct('s1', { items: [text('持久')] }, 9)
    clearSessionPanel('s1') // dock unmount on session prune
    // first read after teardown re-hydrates from storage
    expect(getPanelSpec('s1')!.items).toEqual([text('持久')])
    // old replays stay dead after hydration
    applyPanelOperation('s1', { sourceId: 'old:3', order: [3, 0, 0], mode: 'replace', spec: { items: [text('旧')] } })
    expect(getPanelSpec('s1')!.items).toEqual([text('持久')])
    // a genuinely newer op folds on top of the restored snapshot
    applyPanelOperation('s1', { sourceId: 'new:10', order: [10, 0, 0], mode: 'replace', spec: { items: [text('新')] } })
    expect(getPanelSpec('s1')!.items).toEqual([text('新')])
  })

  it('warns once per source when a barrier rejects an op (issue #4 diagnostics)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      direct('s1', { items: [text('持久')] }, 3000)
      clearSessionPanel('s1') // reload: memory gone, storage keeps maxSeenSeq
      const old = { items: [text('旧')] }
      applyPanelOperation('s1', { sourceId: 'old:2000', order: [2000, 0, 0], mode: 'replace', spec: old })
      expect(getPanelSpec('s1')!.items).toEqual([text('持久')]) // replay dead
      // replay of the same source stays silent (one diagnostic per source)
      applyPanelOperation('s1', { sourceId: 'old:2000', order: [2000, 0, 0], mode: 'replace', spec: old })
      const calls = warn.mock.calls.filter(([m]) => String(m).includes('[genui]'))
      expect(calls).toHaveLength(1)
      expect(String(calls[0]![0])).toContain('屏障')
      expect(String(calls[0]![0])).toContain('2000')
    } finally {
      warn.mockRestore()
    }
  })
})

describe('panel budget (node/appends limits)', () => {
  const nSpec = (n: number) => ({ items: Array.from({ length: n }, (_, i) => text(`n${i}`)) })
  const oneTabAppend = (n: number) => ({
    items: [{ type: 'tabs', tabs: [{ label: 'T', items: Array.from({ length: n }, (_, i) => text(`t${i}`)) }] }],
  })

  afterEach(() => {
    setPanelLimits({ maxNodes: 200, maxAppends: 200 })
  })

  it('rejects the append that would push the panel past maxNodes (201st node)', () => {
    setPanelLimits({ maxNodes: 200 })
    applyPanelOperation('s1', { sourceId: 'r:0', order: [0, -1, 0], mode: 'replace', spec: nSpec(200) })
    const status = applyPanelOperation('s1', { sourceId: 'a:1', order: [1, 0, 0], mode: 'append', spec: nSpec(1) })
    expect(status).toBe('overflow')
    expect(getPanelSpec('s1')!.items).toHaveLength(200) // unchanged
  })

  it('replaying the over-budget source is idempotent (one diagnostic per source)', () => {
    setPanelLimits({ maxNodes: 5 })
    applyPanelOperation('s1', { sourceId: 'r:0', order: [0, -1, 0], mode: 'replace', spec: nSpec(5) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const one = applyPanelOperation('s1', { sourceId: 'a:1', order: [1, 0, 0], mode: 'append', spec: nSpec(1) })
    const two = applyPanelOperation('s1', { sourceId: 'a:1', order: [1, 0, 0], mode: 'append', spec: nSpec(1) })
    const three = applyPanelOperation('s1', { sourceId: 'a:1', order: [1, 0, 0], mode: 'append', spec: nSpec(1) })
    expect(one).toBe('overflow')
    expect(two).toBe('idempotent')
    expect(three).toBe('idempotent')
    expect(getPanelSpec('s1')!.items).toHaveLength(5)
    warn.mockRestore()
  })

  it('a later append after the overflow barrier is rejected without growing the map', () => {
    setPanelLimits({ maxNodes: 5 })
    applyPanelOperation('s1', { sourceId: 'r:0', order: [0, -1, 0], mode: 'replace', spec: nSpec(5) })
    applyPanelOperation('s1', { sourceId: 'a:1', order: [1, 0, 0], mode: 'append', spec: nSpec(1) }) // overflow
    const late = applyPanelOperation('s1', { sourceId: 'a:2', order: [2, 0, 0], mode: 'append', spec: nSpec(1) })
    expect(late).toBe('blocked')
    expect(getPanelSpec('s1')!.items).toHaveLength(5)
  })

  it('a later replace clears the overflow barrier and appends recover', () => {
    setPanelLimits({ maxNodes: 5 })
    applyPanelOperation('s1', { sourceId: 'r:0', order: [0, -1, 0], mode: 'replace', spec: nSpec(5) })
    expect(applyPanelOperation('s1', { sourceId: 'a:1', order: [1, 0, 0], mode: 'append', spec: nSpec(1) })).toBe('overflow')
    const fresh = nSpec(2)
    expect(applyPanelOperation('s1', { sourceId: 'r:10', order: [10, -1, 0], mode: 'replace', spec: fresh })).toBe('accepted')
    expect(getPanelSpec('s1')!.items).toHaveLength(2)
    expect(applyPanelOperation('s1', { sourceId: 'a:11', order: [11, 0, 0], mode: 'append', spec: nSpec(1) })).toBe('accepted')
    expect(getPanelSpec('s1')!.items).toHaveLength(3)
  })

  it('rejects the append beyond the appends budget even when nodes do not grow', () => {
    setPanelLimits({ maxNodes: 200, maxAppends: 3 })
    applyPanelOperation('s1', { sourceId: 'r:0', order: [0, -1, 0], mode: 'replace', spec: nSpec(1) })
    for (let i = 1; i <= 3; i++) {
      expect(applyPanelOperation('s1', { sourceId: `a:${i}`, order: [i, 0, 0], mode: 'append', spec: oneTabAppend(0) })).toBe('accepted')
    }
    const fourth = applyPanelOperation('s1', { sourceId: 'a:4', order: [4, 0, 0], mode: 'append', spec: oneTabAppend(0) })
    expect(fourth).toBe('overflow')
  })

  it('a replace beyond the node budget keeps the prior fold as the barrier', () => {
    setPanelLimits({ maxNodes: 5 })
    const base = nSpec(4)
    applyPanelOperation('s1', { sourceId: 'r:0', order: [0, -1, 0], mode: 'replace', spec: base })
    const big = nSpec(6)
    expect(applyPanelOperation('s1', { sourceId: 'r:10', order: [10, -1, 0], mode: 'replace', spec: big })).toBe('overflow')
    expect(getPanelSpec('s1')).toBe(base)
    // appends after the rejected replace stay dead
    expect(applyPanelOperation('s1', { sourceId: 'a:11', order: [11, 0, 0], mode: 'append', spec: nSpec(1) })).toBe('blocked')
  })
})

describe('panel local override (barrier semantics)', () => {
  const aSpec = { items: [text('A')] }

  it('clear blocks old replays; a later real operation rebuilds', () => {
    applyPanelOperation('s1', { sourceId: 'a:10', order: [10, 0, 0], mode: 'replace', spec: aSpec })
    setLocalPanel('s1', null) // /panel clear at maxSeen = 10
    expect(getPanelSpec('s1')).toBeNull()
    // old replay cannot resurrect the panel
    applyPanelOperation('s1', { sourceId: 'a:10', order: [10, 0, 0], mode: 'replace', spec: aSpec })
    expect(getPanelSpec('s1')).toBeNull()
    // a later real fence builds a fresh panel
    const c = { items: [text('C')] }
    applyPanelOperation('s1', { sourceId: 'c:11', order: [11, 0, 0], mode: 'replace', spec: c })
    expect(getPanelSpec('s1')).toBe(c)
  })

  it('setting the default panel overrides old ops; later ops replace or merge into it', () => {
    const def = { title: '默认', items: [text('D')] }
    applyPanelOperation('s1', { sourceId: 'a:10', order: [10, 0, 0], mode: 'replace', spec: aSpec })
    setLocalPanel('s1', def) // /panel at maxSeen = 10
    expect(getPanelSpec('s1')).toBe(def)
    // the old op stays dead
    applyPanelOperation('s1', { sourceId: 'a:10', order: [10, 0, 0], mode: 'replace', spec: aSpec })
    expect(getPanelSpec('s1')).toBe(def)
    // a later append merges INTO the default base
    applyPanelOperation('s1', { sourceId: 'a:11', order: [11, 0, 0], mode: 'append', spec: { items: [text('E')] } })
    expect(getPanelSpec('s1')!.items).toEqual([text('D'), text('E')])
  })
})

describe('settled-fence publisher (host fence-source contract)', () => {
  /** Minimal host-style render context for a settled fence. */
  const ctx = (seq: number, block = 0, fence = 0, sessionId = 's1') => ({
    sessionId,
    source: { id: JSON.stringify(['assistant', seq, block, fence]), order: [seq, block, fence] as const },
  })
  const appendBody = (content: string) => JSON.stringify({ panel: true, append: true, items: [{ type: 'text', content }] })
  const replaceBody = (content: string) => JSON.stringify({ panel: true, items: [{ type: 'text', content }] })

  it('appends two messages whose local fence keys are both 0 (each once)', () => {
    const fn = vi.fn()
    const unsub = subscribePanel(fn)
    render(renderGenuiFence(appendBody('第一轮'), 0, ctx(10)) as never)
    render(renderGenuiFence(appendBody('第二轮'), 0, ctx(11)) as never)
    const spec = getPanelSpec('s1')!
    expect(spec.items.map(n => (n as { content: string }).content)).toEqual(['第一轮', '第二轮'])
    expect(fn).toHaveBeenCalledTimes(2)
    unsub()
  })

  it('identical content in two messages still appends twice (identity, not hash)', () => {
    render(renderGenuiFence(appendBody('相同'), 0, ctx(10)) as never)
    render(renderGenuiFence(appendBody('相同'), 0, ctx(11)) as never)
    expect(getPanelSpec('s1')!.items).toHaveLength(2)
  })

  it('two fences in one message fold by text-block/fence order, not effect order', () => {
    const a = JSON.stringify({ panel: true, append: true, items: [{ type: 'text', content: '块A' }] })
    const b = JSON.stringify({ panel: true, append: true, items: [{ type: 'text', content: '块B' }] })
    // Second block rendered first (out-of-order mount), first block second.
    render(renderGenuiFence(b, 1, ctx(10, 1, 0)) as never)
    render(renderGenuiFence(a, 0, ctx(10, 0, 0)) as never)
    const spec = getPanelSpec('s1')!
    expect(spec.items.map(n => (n as { content: string }).content)).toEqual(['块A', '块B'])
  })

  it('re-rendering the same settled fence (same source) folds and notifies once', () => {
    const fn = vi.fn()
    const unsub = subscribePanel(fn)
    const body = appendBody('X')
    const first = render(renderGenuiFence(body, 0, ctx(10)) as never)
    render(renderGenuiFence(body, 0, ctx(10)) as never)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(getPanelSpec('s1')!.items).toHaveLength(1)
    first.unmount()
    unsub()
  })

  it('StrictMode double effect folds once (per-source dedup)', () => {
    const fn = vi.fn()
    const unsub = subscribePanel(fn)
    render(<StrictMode>{renderGenuiFence(replaceBody('S'), 0, ctx(10)) as never}</StrictMode>)
    expect(getPanelSpec('s1')!.items).toHaveLength(1)
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('a replace after earlier appends resets the panel', () => {
    render(renderGenuiFence(appendBody('旧1'), 0, ctx(10)) as never)
    render(renderGenuiFence(appendBody('旧2'), 0, ctx(11)) as never)
    render(renderGenuiFence(replaceBody('新面板'), 0, ctx(12)) as never)
    const spec = getPanelSpec('s1')!
    expect(spec.items.map(n => (n as { content: string }).content)).toEqual(['新面板'])
  })

  it('streaming (no source) publishes nothing; settled publishes once', () => {
    const fn = vi.fn()
    const unsub = subscribePanel(fn)
    render(renderGenuiFence(replaceBody('流式'), 0, { sessionId: 's1' }) as never) // context without source
    expect(getPanelSpec('s1')).toBeNull()
    expect(fn).not.toHaveBeenCalled()
    render(renderGenuiFence(replaceBody('定稿'), 0, ctx(10)) as never)
    expect(getPanelSpec('s1')).not.toBeNull()
    unsub()
  })

  it('an over-budget append from the publisher warns once and keeps the panel', () => {
    setPanelLimits({ maxNodes: 5 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(renderGenuiFence(JSON.stringify({ panel: true, append: true, items: Array.from({ length: 6 }, (_, i) => ({ type: 'text', content: `n${i}` })) }), 0, ctx(10)) as never)
    render(renderGenuiFence(JSON.stringify({ panel: true, append: true, items: [{ type: 'text', content: 'x' }] }), 0, ctx(11)) as never)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
    setPanelLimits({ maxNodes: 200 })
  })
})

describe('session teardown hygiene', () => {
  it('clearSessionPanel also drops the expand token and overflow diagnostics', () => {
    requestPanelExpand('s1')
    expect(getPanelExpandToken('s1')).toBe(1)
    clearSessionPanel('s1')
    expect(getPanelExpandToken('s1')).toBe(0)
    expect(getPanelSpec('s1')).toBeNull()
  })
})
