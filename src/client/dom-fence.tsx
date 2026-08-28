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
import { Fragment, isValidElement, type Key, type ReactNode } from 'react'
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

/** Block-level content that never belongs to a code-block surface: a real
 * fence surface is "banner chrome + ONE code body". An element that also
 * contains paragraphs/lists/headings/tables (or several `<pre>` bodies) is a
 * message-level container, not a fence — taking it over would hide the whole
 * final answer (issue #19's residual variant of the issue #13 class). */
const BLOCK_CONTENT_SELECTOR = 'p, ul, ol, dl, table, h1, h2, h3, h4, h5, h6, blockquote, hr, img, figure'

/** Does this element look like a single code-block surface rather than a
 * message container? The only allowed non-code content is banner chrome. */
function isPlausibleFenceSurface(candidate: Element): boolean {
  const pres = candidate.querySelectorAll('pre')
  if (pres.length > 1) return false
  const pre = pres[0] ?? null
  for (const el of candidate.querySelectorAll(BLOCK_CONTENT_SELECTOR)) {
    if (pre !== null && pre.contains(el)) continue
    return false
  }
  return true
}

/** `renderResolvedFenceNode` returns a bare Fragment for `panel:true` fences
 * (the publisher renders nothing); every inline fence mounts a real tree.
 * The DOM channel uses this to tell an empty container that was WIPED by a
 * host re-render apart from an intentionally empty panel root. */
function isPanelRoot(node: ReactNode): boolean {
  return isValidElement(node) && node.type === Fragment
}

interface Mount {
  root: Root
  container: HTMLElement
  block: HTMLElement
  lastRaw: string
  lastSettled: boolean
  lastNode: ReactNode
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
 * `SURFACE_HOPS` (or the scope boundary) labels itself `dsh-ui`, or when the
 * labeled ancestor is a message-level container rather than a code surface
 * (see {@link isPlausibleFenceSurface}). */
function surfaceOf(pre: HTMLElement, scope: ParentNode = document): HTMLElement | null {
  let el: HTMLElement | null = pre.parentElement
  for (let hops = 0; el !== null && el !== scope && hops < SURFACE_HOPS; hops += 1, el = el.parentElement) {
    if (infostringOf(el) !== 'dsh-ui') continue
    if (!isPlausibleFenceSurface(el)) return null
    return el
  }
  return null
}

/** The labeled-but-implausible ancestor `surfaceOf` just rejected, if any:
 * diagnostics for the issue #19 guard so a skipped fence is never silent. */
function implausibleLabeledAncestorOf(pre: HTMLElement, scope: ParentNode = document): HTMLElement | null {
  let el: HTMLElement | null = pre.parentElement
  for (let hops = 0; el !== null && el !== scope && hops < SURFACE_HOPS; hops += 1, el = el.parentElement) {
    if (infostringOf(el) === 'dsh-ui' && !isPlausibleFenceSurface(el)) return el
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
    // Message-level containers that happen to carry a surface class must
    // not be taken over: hiding them hides the whole answer (issue #19).
    if (!isPlausibleFenceSurface(el)) continue
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
    if (surface === null) {
      // Diagnose the issue #19 guard: a labeled ancestor that is NOT a code
      // surface (prose/multiple code bodies) was skipped on purpose.
      if (implausibleLabeledAncestorOf(pre, scope) !== null && !plausibilityWarned) {
        plausibilityWarned = true
        console.warn('[dsh-genui] 跳过带 dsh-ui 标签但疑似消息容器的节点（含段落或多个代码体）——防止 DOM 通道隐藏整条消息（issue #19）')
      }
      continue
    }
    if (seen.has(surface)) continue
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
/** One-time-per-install issue #19 guard diagnostic (same budget). */
let plausibilityWarned = false

/** Root factory seam (tests / tuning): the DOM channel creates one React root
 * per taken-over fence through this indirection so mount-failure cleanup is
 * reachable in jsdom without mocking the react-dom module. */
let domRootFactory: (container: HTMLElement) => Root = createRoot

/** Override the React root factory (tests / tuning). */
export function setDomRootFactory(factory: (container: HTMLElement) => Root): void {
  domRootFactory = factory
}

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
  plausibilityWarned = false
  const mounts = new Map<HTMLElement, Mount>()
  let disposed = false
  let rafId: number | null = null

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
    // Mount FIRST, hide AFTER (issue #19): the stock block is only ever
    // hidden once a successfully mounted replacement stands next to it. A
    // mount failure leaves the original code block untouched — the final
    // answer can never be blanked by a half-completed takeover.
    const container = document.createElement('div')
    container.className = CONTAINER_CLASS
    block.after(container)
    let root: Root
    try {
      root = domRootFactory(container)
    } catch (error) {
      container.remove()
      warnOnce(block, `failed to create a React root for a dsh-ui fence (${error instanceof Error ? error.message : String(error)}); keeping the stock code block visible`)
      return
    }
    try {
      const handler: GenuiActionHandler = (action, payload) => {
        const sid = sessionIdOf()
        if (sid === undefined) return
        sendAction(sid, action, payload)
      }
      root.render(<GenuiActionContext.Provider value={handler}>{node}</GenuiActionContext.Provider>)
    } catch (error) {
      try {
        root.unmount()
      } catch {
        // Best-effort cleanup; removing the container below restores the DOM.
      }
      container.remove()
      warnOnce(block, `failed to mount a dsh-ui fence (${error instanceof Error ? error.message : String(error)}); keeping the stock code block visible`)
      return
    }
    block.style.display = 'none'
    block.setAttribute(PROCESSED, '')
    mounts.set(block, { root, container, block, lastRaw: raw, lastSettled: settled, lastNode: node })
  }

  /** Pre-paint repair: the host's React re-renders during streaming can wipe
   * our foreign container or reset the hide. Re-apply the surgery in the
   * observer microtask (before paint) so raw JSON never flashes between
   * chunks; the rAF sweep re-renders React state at its own pace. */
  function repairSurgery(): void {
    for (const mount of Array.from(mounts.values())) {
      const block = mount.block
      // The host replaced the row: the stock block is gone but our foreign
      // container may still be attached. Drop the mount NOW (removes the
      // orphan container) instead of waiting for the sweep — the new block
      // will be taken over by the sweep's discovery pass.
      if (!block.isConnected) {
        if (mount.container.isConnected) unmountBlock(block)
        continue
      }
      // Re-attach the container BEFORE re-hiding (issue #19: never hide the
      // original while no mounted replacement stands next to it).
      if (mount.container.parentElement !== block.parentElement
          || mount.container.previousElementSibling !== block) {
        block.after(mount.container)
      }
      if (!mount.container.isConnected) {
        // Insertion failed (pathological host re-parent): surrender the
        // takeover and keep the raw stock block visible rather than leaving
        // it hidden with no replacement.
        block.style.display = ''
        block.removeAttribute(PROCESSED)
        mounts.delete(block)
        try {
          mount.root.unmount()
        } catch {
          // Best-effort; the detached container gets removed below.
        }
        mount.container.remove()
        warnOnce(block, 'dsh-ui replacement container could not be re-attached after a host re-render; restoring the stock code block')
        continue
      }
      if (block.style.display !== 'none') block.style.display = 'none'
      if (!block.hasAttribute(PROCESSED)) block.setAttribute(PROCESSED, '')
    }
  }

  /** Sweep: drop dead mounts, re-render changed bodies (streaming growth and
   * the streaming→settled transition), repair surgery, then take over every
   * new dsh-ui block — settled or still streaming. */
  function sweep(): void {
    if (disposed) return
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
      // A host re-render can also wipe the CONTENT of our container while
      // leaving the node in place. An inline mount whose container came back
      // empty (and was not empty by design — panel roots are) must be
      // re-rendered, otherwise the block stays hidden behind an empty box.
      const contentWiped = !isPanelRoot(mount.lastNode) && mount.container.childElementCount === 0
      if (mount.lastRaw !== raw || mount.lastSettled !== settled || contentWiped) {
        const anchor = rowOf(block)
        const { key, context } = contextOf(anchor, block, settled)
        const node = renderResolvedFenceNode(raw, key, context)
        if (node === null) {
          unmountBlock(block)
          continue
        }
        if (contentWiped) {
          // The old root's fiber bookkeeping points at children the host
          // already removed — re-rendering it can throw removeChild errors
          // on missing nodes. Rebuild the mount in place: fresh container +
          // fresh root, block re-hidden only after the replacement exists.
          try {
            mount.root.unmount()
          } catch {
            // The host's wipe already invalidated the tree; the fresh root
            // below is the recovery, not the old one.
          }
          const fresh = document.createElement('div')
          fresh.className = CONTAINER_CLASS
          mount.container.remove()
          block.after(fresh)
          try {
            const freshRoot = domRootFactory(fresh)
            const handler: GenuiActionHandler = (action, payload) => {
              const sid = sessionIdOf()
              if (sid !== undefined) sendAction(sid, action, payload)
            }
            freshRoot.render(<GenuiActionContext.Provider value={handler}>{node}</GenuiActionContext.Provider>)
            mount.root = freshRoot
            mount.container = fresh
          } catch (error) {
            // Never leave the stock block hidden behind a broken root:
            // restore the raw code block and drop the mount (issue #19).
            fresh.remove()
            block.style.display = ''
            block.removeAttribute(PROCESSED)
            mounts.delete(block)
            warnOnce(block, `failed to rebuild a wiped dsh-ui mount (${error instanceof Error ? error.message : String(error)}); restoring the stock code block`)
            continue
          }
        } else {
          try {
            mount.root.render(<GenuiActionContext.Provider value={(action, payload) => {
              const sid = sessionIdOf()
              if (sid !== undefined) sendAction(sid, action, payload)
            }}>{node}</GenuiActionContext.Provider>)
          } catch (error) {
            // Never leave the stock block hidden behind a broken root: restore
            // the raw code block and drop the mount (issue #19).
            unmountBlock(block)
            warnOnce(block, `failed to re-render a dsh-ui fence (${error instanceof Error ? error.message : String(error)}); restoring the stock code block`)
            continue
          }
        }
        mount.lastRaw = raw
        mount.lastSettled = settled
        mount.lastNode = node
      }
    }
    repairSurgery()
    for (const block of findFenceCandidates()) {
      renderBlock(block)
    }
  }

  const schedule = (): void => {
    if (disposed || rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      if (disposed) return
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
    disposed = true
    observer.disconnect()
    window.clearInterval(interval)
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    for (const block of Array.from(mounts.keys())) unmountBlock(block)
  }
}
