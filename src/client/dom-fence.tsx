/**
 * DOM render channel: pure-plugin fence rendering for pristine hosts.
 *
 * Stock DSH renders every fenced code block through the shared CodeBlock
 * surface (stable class `md-code-block`, language label rendered as the
 * banner's childless label div). This channel observes the conversation DOM,
 * finds blocks labelled `dsh-ui`, parses the raw fence body and mounts the
 * plugin's own React tree next to the (hidden) stock block:
 *
 * Fence discovery is **multi-surface** (issue #6): besides `md-code-block`,
 * the channel also matches the deepsuite-style surfaces some host builds
 * render instead (`.code-block` / `.code-block-small`), and — as the
 * structural backstop — ANY element whose banner labels it `dsh-ui` and
 * which contains a `<pre>` body. The only invariants are the language label
 * (a leaf element with the exact text `dsh-ui`, outside the code body) and
 * the `<pre>`, so a host DOM drift degrades to a rendered fence, never a
 * silently skipped one:
 *
 * - **Streaming takeover**: the channel takes over a dsh-ui block as soon as
 *   ONE finished component parses (the partial parser), and re-renders the
 *   root as the body grows — the UI assembles top-down while the reply
 *   streams, no settled marker required. A body with no finished component
 *   yet stays a stock code block (partial JSON must never look broken).
 * - **Pre-paint surgery repair**: the host's React re-renders during
 *   streaming can wipe our foreign container or reset the hide. A repair
 *   pass in the MutationObserver microtask re-applies the surgery before
 *   paint (same pattern the annotation plugin proved on this host), and the
 *   1s sweep is the backstop.
 * - **Settled transition**: when `[data-streaming]` leaves the row, the
 *   mount re-renders with the stable source identity — the moment panels
 *   publish and durable state keys in (mirrors the registry channel's
 *   settled-source semantics; streaming renders are identity-less).
 * - Stable identity: the owning row's `data-chat-anchor-key` (session-stable,
 *   seq-derived) + the fence's ordinal among settled dsh-ui blocks in that
 *   row. `sourceId = dom:<anchor>:<ordinal>` feeds panel dedup and durable
 *   state.
 * - Actions ride the plugin-owned GenuiActionContext provider: every tree
 *   this channel mounts is wrapped with a handler that relays
 *   `[genui-action]` through the scoped conversation send — no host plumbing.
 * - Removal (branch switch, unload): each mount is unmounted with its root,
 *   and the stock block is restored.
 *
 * Security posture matches the registry channel: only code shipped in this
 * plugin's browser bundle mounts React roots, the model can only author
 * fence text, and unrepairable bodies stay stock code blocks.
 */
import type { Key, ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { GenuiActionContext, type GenuiActionHandler } from './action-context.ts'
import { renderResolvedFenceNode, type GenuiFenceContext } from './fence-render.tsx'

/** Fence surfaces the channel can take over, newest host first: the shared
 * CodeBlock surface every rc.6+ markdown fence renders through
 * (`.md-code-block`) and the deepsuite-style surfaces some host builds
 * render instead (`.code-block` / `.code-block-small`). Surfaces with an
 * unlisted class are still found by the structural backstop (label + `<pre>`),
 * so this list is an optimization, not a hard contract. */
const CODE_BLOCK_SELECTORS = '.md-code-block, .code-block, .code-block-small'
/** Marker attribute set on blocks this channel has taken over. */
const PROCESSED = 'data-genui-rendered'
/** The settled marker on AssistantMarkdown (absent = settled). */
const STREAMING = '[data-streaming]'
/** Container class for the plugin-owned root. */
const CONTAINER_CLASS = 'genui-dom-fence'
/** Slow sweep interval: the observer catches everything, this is the 1s
 * belt-and-braces pass (history loads, missed attribute batches). */
const SWEEP_MS = 1000

/** Max ancestors walked from a `<pre>` to its fence surface root (banner +
 * pre holder). Most hosts put the pre directly under the surface; some wrap
 * it in a content div. */
const SURFACE_HOPS = 4

interface Mount {
  root: Root
  container: HTMLElement
  block: HTMLElement
  lastRaw: string
  lastSettled: boolean
}

function isTextNode(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE
}

/** The banner's language label: a leaf element whose text is exactly the
 * lang. CodeBlock renders the label as a childless div; deepsuite-style
 * surfaces use a span; the ONLY structural invariants across hosts are "a
 * leaf element holds exactly the lang text" and "it lives outside the code
 * body" — a fence whose code literally contains the text `dsh-ui` must not
 * self-identify through its body. A container holding SEVERAL code blocks
 * must not self-identify through a nested block's label either (issue #13:
 * the shared markdown root was mistaken for a dsh-ui fence and hid the whole
 * message, losing every other code block). */
function infostringOf(block: Element): string | null {
  const pre = block.querySelector('pre')
  for (const el of block.querySelectorAll('*')) {
    if (el.childElementCount !== 0) continue
    if (el.textContent !== 'dsh-ui') continue
    if (pre !== null && pre.contains(el)) continue
    // A leaf label that belongs to a NESTED known code surface is that
    // surface's banner, not `block`'s own banner. Only accept labels whose
    // nearest known surface is `block` itself (or none — unknown surfaces
    // stay supported by the structural backstop).
    const owner = el.closest(CODE_BLOCK_SELECTORS)
    if (owner !== null && owner !== block) continue
    return 'dsh-ui'
  }
  return null
}

/** The banner label's raw text (empty while streaming — the host renders the
 * language label only once the reply settles). Returns the first leaf
 * outside the code body (banners always lead with the language), so a
 * span-label host reads identically to the div-label host. */
function labelTextOf(block: Element): string {
  const pre = block.querySelector('pre')
  for (const el of block.querySelectorAll('*')) {
    if (el.childElementCount !== 0) continue
    if (pre !== null && pre.contains(el)) continue
    return el.textContent ?? ''
  }
  return ''
}

/** Raw fence body from the stock block's code surface. */
function rawOf(block: Element): string {
  const pre = block.querySelector('pre')
  if (pre === null) return ''
  let text = ''
  for (const node of pre.childNodes) {
    if (isTextNode(node)) text += node.textContent ?? ''
    else text += node.textContent ?? ''
  }
  return text
}

/** Settled gate: no streaming marker on any ancestor. */
function isSettled(block: Element): boolean {
  return block.closest(STREAMING) === null
}

/** Walk up from a `<pre>` to its fence surface root — the ancestor that
 * carries the banner label AND the pre. Returns null when no ancestor within
 * `SURFACE_HOPS` (or the scope boundary) labels itself `dsh-ui`. */
function surfaceOf(pre: HTMLElement, scope: ParentNode = document): HTMLElement | null {
  let el: HTMLElement | null = pre.parentElement
  for (let hops = 0; el !== null && el !== scope && hops < SURFACE_HOPS; hops += 1, el = el.parentElement) {
    if (infostringOf(el) === 'dsh-ui') return el
  }
  return null
}

/**
 * Every dsh-ui fence surface under `scope`, outer-most first, deduped.
 * Known surface classes first (cheap, ordered), then a structural sweep —
 * every `<pre>` whose banner labels it `dsh-ui` — so a host with an
 * unlisted surface shape still renders. The label + `<pre>` gates make the
 * structural pass false-positive-free: a random code surface without the
 * exact `dsh-ui` label is never taken over.
 */
function findFenceCandidates(scope: ParentNode = document): HTMLElement[] {
  const seen = new Set<HTMLElement>()
  const out: HTMLElement[] = []
  for (const el of scope.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTORS)) {
    // Modifier classes can sit inside a surface (e.g. a `code-block-small`
    // child of `code-block`): only the outermost matching element is a
    // candidate, so a fence is never double-counted or taken over twice.
    if (el.parentElement !== null && el.parentElement.closest(CODE_BLOCK_SELECTORS) !== null) continue
    if (seen.has(el)) continue
    out.push(el)
    seen.add(el)
  }
  for (const pre of scope.querySelectorAll<HTMLElement>('pre')) {
    // `<pre>` bodies inside a known surface were already handled by the
    // selector pass. Walking up from them again would climb PAST their own
    // (non-dsh-ui or dsh-ui) surface into a shared container — e.g. a
    // markdown root holding both a dsh-ui fence and a python block — and
    // the backstop would mislabel that whole container as a fence, hiding
    // every other code block with it (issue #13).
    if (pre.closest(CODE_BLOCK_SELECTORS) !== null) continue
    const surface = surfaceOf(pre, scope)
    if (surface === null || seen.has(surface)) continue
    // Host DOM drift diagnostic: the fence renders (structural backstop),
    // but the surface class is unknown to this build — warn once per
    // renderer install so future drift is never silent again.
    if (!driftWarned) {
      driftWarned = true
      console.warn('[dsh-genui] 围栏表面类名未被已知选择器命中（宿主 DOM 漂移），已按 label+pre 结构识别 dsh-ui 围栏')
    }
    out.push(surface)
    seen.add(surface)
  }
  return out
}

/** One-time-per-install drift diagnostic flag (reset per install, so tests
 * and hot re-installs each get a fresh warning budget). */
let driftWarned = false

/**
 * The owning conversation row (stable per-message identity).
 *
 * The host renders `data-chat-anchor-key` from a React key that is OMITTED
 * when the routed node's key is undefined — observed on Safari (and any
 * fallback render path), where every fence row lacks the attribute while
 * Chrome's identical page has it. Fences must not silently die there, so the
 * lookup walks down a fallback chain and never gives up:
 *
 * 1. `[data-chat-anchor-key]` — the canonical stable row anchor;
 * 2. `[data-chat-flow-key]` / `[data-chat-flow-kind]` — the same row div
 *    rendered by the host (both carry the routing key/kind, and the kind is
 *    a separate value that survives an undefined React key);
 * 3. the code block itself — last resort; identity degrades to
 *    `dom:unknown:<ordinal>` (see `fenceIndexOf`/`contextOf`).
 */
const FLOW_ROW = '[data-chat-flow-key], [data-chat-flow-kind]'
function rowOf(block: Element): Element {
  return block.closest('[data-chat-anchor-key]') ?? block.closest(FLOW_ROW) ?? block
}

/** 1-based ordinal of this block among the row's settled dsh-ui blocks
 * (document order). Streaming candidates are skipped, so the ordinal stays
 * stable while the block itself is still streaming. When the fallback chain
 * bottoms out at the block itself (no owning row in the DOM at all), the
 * ordinal falls back to document order among ALL settled dsh-ui blocks so
 * sibling fences never collide on the same `dom:unknown:N` identity. */
function fenceIndexOf(row: Element, block: Element): number {
  const scope = row === block ? document : row
  let index = 0
  for (const candidate of findFenceCandidates(scope)) {
    if (candidate.closest(STREAMING) !== null) continue
    if (infostringOf(candidate) === null) continue
    index += 1
    if (candidate === block) return index
  }
  return index + 1
}

/**
 * messageSeq estimate from the row's anchor key.
 *
 * The host's context key is `<kindLen>:<kind><id>` (e.g.
 * `14:assistant-step3:0`); the id of an assistant step is `<turn>:<step>` —
 * the ONLY per-message monotonic counter the host exposes in the DOM. Turn
 * and step strictly increase with message order, so a turn-based seq keeps
 * growing across page reloads: the panel store's persisted replay barrier
 * (hydration: replays at/below the persisted max seq are dead) depends on
 * this monotonicity. Without it every assistant step yields the SAME
 * constant (the kind-length prefix), so after a refresh the barrier equals
 * that constant and silently rejects every new panel fence (issue #4).
 *
 * Fallback (non-assistant rows, anchor-less Safari rows): the row's
 * document-order index among chat rows — monotonic within the current
 * render window, degraded across reloads.
 */
function anchorSeqOf(row: Element): number {
  const key = row.getAttribute('data-chat-anchor-key') ?? ''
  const turnStep = /assistant-step(\d+):(\d+)$/.exec(key)
  if (turnStep !== null) {
    const turn = Number(turnStep[1])
    const step = Number(turnStep[2])
    if (Number.isFinite(turn) && Number.isFinite(step)) return turn * 1000 + step
  }
  const rows = document.querySelectorAll(`[data-chat-anchor-key], ${FLOW_ROW}`)
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i] === row) return i
  }
  return 0
}

/**
 * Install the DOM render channel. Returns a disposer that restores every
 * taken-over block and disconnects the observers.
 *
 * @param ctx - the client context (sessions service for the current session).
 * @param sendAction - plugin-owned relay: (sessionId, action, payload) → the
 *   scoped conversation send carrying the `[genui-action]` prompt.
 */
export function installDomFenceRenderer(
  ctx: Context,
  sendAction: (sessionId: SessionId, action: string, payload: Record<string, unknown>) => void,
): () => void {
  if (typeof document === 'undefined') return () => {}
  driftWarned = false
  const mounts = new Map<HTMLElement, Mount>()

  const sessionIdOf = (): SessionId | undefined => {
    try {
      return ctx.sessions.list.getSnapshot().current
    } catch {
      return undefined
    }
  }

  /** Render context for a block: session always; the stable source identity
   * only once settled — streaming renders are identity-less (no panel
   * publish, no durable state), mirroring the registry channel. */
  function contextOf(row: Element, block: Element, settled: boolean): { key: Key; context: GenuiFenceContext } {
    if (settled && row.getAttribute('data-chat-anchor-key') === null) {
      // Safari / fallback render path: the host omitted the row anchor (the
      // attribute is a React key that React drops when undefined). Fences
      // still render with the degraded `dom:unknown:N` identity — warn once
      // per block so the degraded path is visible in the console.
      warnOnce(block, 'no [data-chat-anchor-key] ancestor for a dsh-ui fence (host render path without row anchor — e.g. Safari); using fallback identity dom:unknown:N')
    }
    const fenceIndex = fenceIndexOf(row, block)
    const anchorKey = row.getAttribute('data-chat-anchor-key') ?? 'unknown'
    const key = `dom:${anchorKey}:${fenceIndex}` as Key
    const sessionId = sessionIdOf()
    const context: GenuiFenceContext = {
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(settled ? { source: { id: key as string, order: [anchorSeqOf(row), 0, fenceIndex] as const } } : {}),
    }
    return { key, context }
  }

  function unmountBlock(block: HTMLElement): void {
    const mount = mounts.get(block)
    if (mount === undefined) return
    mounts.delete(block)
    mount.root.unmount()
    mount.container.remove()
    block.style.display = ''
    block.removeAttribute(PROCESSED)
  }

  /** One-time-per-block diagnostics: silent returns must be diagnosable
   * (the 1s sweep would otherwise spam the console every pass). */
  const warned = new WeakSet<Element>()
  function warnOnce(block: Element, message: string): void {
    if (warned.has(block)) return
    warned.add(block)
    console.warn(`[dsh-genui] ${message}`)
  }

  function renderBlock(block: HTMLElement): void {
    if (block.hasAttribute(PROCESSED)) return
    const row = rowOf(block)
    const settled = isSettled(block)
    // Settled blocks must carry the dsh-ui label. Streaming blocks cannot:
    // the host renders the language label only once the reply settles
    // (MarkdownText passes `lang={streaming ? undefined : lang}`), so during
    // streaming the fence is identified by CONTENT — a partial parse that
    // yields a GenUI node. A misidentified fence (e.g. a ```json block that
    // happens to parse) is reverted at the settle transition below.
    if (settled && infostringOf(block) === null) return
    const raw = rawOf(block)
    if (raw.trim() === '') {
      if (settled) warnOnce(block, 'settled dsh-ui fence has an empty body; keeping the code block')
      return
    }
    const { key, context } = contextOf(row, block, settled)
    const node: ReactNode | null = renderResolvedFenceNode(raw, key, context)
    // Null = no finished component yet (streaming half) or unrepairable:
    // the stock code block stays visible until something renders. A settled
    // unrepairable body warns once (the DOM channel has no visible
    // diagnostic of its own — the stock block keeps the raw content).
    if (node === null) {
      if (settled) warnOnce(block, 'settled dsh-ui fence body does not parse; keeping the code block')
      return
    }
    const container = document.createElement('div')
    container.className = CONTAINER_CLASS
    block.style.display = 'none'
    block.after(container)
    block.setAttribute(PROCESSED, '')
    const root = createRoot(container)
    const handler: GenuiActionHandler = (action, payload) => {
      const sid = sessionIdOf()
      if (sid === undefined) return
      sendAction(sid, action, payload)
    }
    root.render(<GenuiActionContext.Provider value={handler}>{node}</GenuiActionContext.Provider>)
    mounts.set(block, { root, container, block, lastRaw: raw, lastSettled: settled })
  }

  /** Pre-paint repair: the host's React re-renders during streaming can wipe
   * our foreign container or reset the hide. Re-apply the surgery in the
   * observer microtask (before paint) so raw JSON never flashes between
   * chunks; the rAF sweep re-renders React state at its own pace. */
  function repairSurgery(): void {
    for (const mount of mounts.values()) {
      const block = mount.block
      if (!block.isConnected) continue
      if (block.style.display !== 'none') block.style.display = 'none'
      if (!block.hasAttribute(PROCESSED)) block.setAttribute(PROCESSED, '')
      if (mount.container.parentElement !== block.parentElement
          || mount.container.previousElementSibling !== block) {
        block.after(mount.container)
      }
    }
  }

  /** Sweep: drop dead mounts, re-render changed bodies (streaming growth and
   * the streaming→settled transition), repair surgery, then take over every
   * new dsh-ui block — settled or still streaming. */
  function sweep(): void {
    for (const [block, mount] of mounts) {
      if (!block.isConnected) {
        unmountBlock(block)
        continue
      }
      const raw = rawOf(block)
      const settled = isSettled(block)
      // Settle transition label re-verification: a streaming block was taken
      // over by content, not by label. If the now-visible label exists and is
      // NOT dsh-ui (a ```json fence that happened to parse), restore the
      // stock block and drop the mount.
      if (settled && !mount.lastSettled) {
        const labelText = labelTextOf(block)
        if (labelText !== '' && labelText !== 'dsh-ui') {
          // A content-identified fence settled as another language (e.g. a
          // ```json block that happened to parse): restore the stock block.
          unmountBlock(block)
          continue
        }
      }
      if (mount.lastRaw !== raw || mount.lastSettled !== settled) {
        const anchor = rowOf(block)
        const { key, context } = contextOf(anchor, block, settled)
        const node = renderResolvedFenceNode(raw, key, context)
        if (node === null) {
          unmountBlock(block)
          continue
        }
        mount.lastRaw = raw
        mount.lastSettled = settled
        mount.root.render(<GenuiActionContext.Provider value={(action, payload) => {
          const sid = sessionIdOf()
          if (sid !== undefined) sendAction(sid, action, payload)
        }}>{node}</GenuiActionContext.Provider>)
      }
    }
    repairSurgery()
    for (const block of findFenceCandidates()) {
      renderBlock(block)
    }
  }

  let scheduled = false
  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      sweep()
    })
  }

  const observer = new MutationObserver(() => {
    // Pre-paint pass: surgery repair only (cheap DOM ops); the React
    // re-render goes through the rAF-scheduled sweep.
    repairSurgery()
    schedule()
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-streaming'],
    // React streams tokens as text-node updates: without characterData the
    // observer would only fire on structural changes and miss body growth.
    characterData: true,
  })
  const interval = window.setInterval(sweep, SWEEP_MS)
  sweep()

  return () => {
    observer.disconnect()
    window.clearInterval(interval)
    for (const block of Array.from(mounts.keys())) unmountBlock(block)
  }
}
