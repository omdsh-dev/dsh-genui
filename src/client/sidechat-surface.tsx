/** 显式侧聊接入，不伪装成主会话消息行。 */
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { GenuiActionContext } from './action-context.ts'
import { ExportableGenuiBlock } from './artifact/ExportableGenuiBlock.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { codeBlockSurfaces } from './dom-fence.tsx'
import { resolveGenuiSpec } from './fence-render.tsx'
import { fenceStateKey, loadBlockState, saveBlockState, type BlockInteractionState } from './interaction-store.ts'
import { sourceFencesOf } from './source-fence.ts'

/** Provider 声明的 sidechat 内容及其稳定身份和专属交互路由。 */
export interface SidechatSurface {
  readonly root: HTMLElement
  /** Provider 提供的稳定 surface 名称，同时写入 root 标记。 */
  readonly source: string
  readonly threadId: string
  readonly eventSeq: number
  readonly contentBlockIndex: number
  readonly text: string
  readonly sendPrompt: (text: string) => Promise<void>
}

/** 宿主或插件向 GenUI 提供的 sidechat adapter 注册接口。 */
export interface SidechatSurfaceService {
  registerSidechatSurfaceAdapter(adapter: {
    readonly id: string
    readonly mount: (surface: SidechatSurface) => (() => void)
  }): () => void
}

const MOUNT = 'data-genui-explicit-fence'
const SIDECHAT_ROOT = 'data-genui-sidechat-root'
const sidechatSurfaceOwners = new WeakMap<HTMLElement, symbol>()

function CommittedFence({ children, onCommit }: { children: ReactNode; onCommit: (content: HTMLElement) => void }) {
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (content.current !== null) onCommit(content.current) }, [onCommit])
  // A stable ownership boundary distinguishes host replacement from ordinary
  // React changes inside the renderer without introducing a layout box.
  return <div ref={content} style={{ display: 'contents' }}>{children}</div>
}

/** Flush before replacing a root, while its immutable storage key still owns it. */
function surfaceState(stateKey: string) {
  let latest: BlockInteractionState | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let active = true
  return {
    initial: loadBlockState(stateKey),
    capture(state: BlockInteractionState): void {
      if (!active) return
      latest = state
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => saveBlockState(stateKey, state), 300)
    },
    dispose(): void {
      active = false
      if (timer !== undefined) clearTimeout(timer)
      if (latest !== undefined) saveBlockState(stateKey, latest)
    },
  }
}

function validSurface(surface: SidechatSurface): boolean {
  return typeof surface.source === 'string' && surface.source.trim() !== ''
    && surface.root instanceof HTMLElement
    && surface.root.getAttribute('data-genui-surface') === surface.source
    && typeof surface.threadId === 'string' && surface.threadId.trim() !== ''
    && Number.isSafeInteger(surface.eventSeq) && surface.eventSeq >= 0
    && Number.isSafeInteger(surface.contentBlockIndex) && surface.contentBlockIndex >= 0
    && typeof surface.text === 'string' && typeof surface.sendPrompt === 'function'
}

/**
 * Mount only a provider-declared, settled assistant text block. Pair ALL host
 * code blocks with ALL source AST code nodes by ordinal AND exact body. A
 * mismatch, unsupported panel, or malformed spec leaves the stock Markdown.
 * No main-session lookup, fallback action route, global query or polling.
 */
export function mountSidechatSurface(surface: SidechatSurface): () => void {
  if (!validSurface(surface) || sidechatSurfaceOwners.has(surface.root)) return () => {}
  const fences = sourceFencesOf(surface.text)
  if (!fences.some(fence => fence.lang === 'dsh-ui')) return () => {}
  const owner = Symbol('genui-sidechat-surface')
  sidechatSurfaceOwners.set(surface.root, owner)
  surface.root.setAttribute(SIDECHAT_ROOT, '')
  let active = true
  let queued = false
  const mounts = new Map<HTMLElement, { container: HTMLElement; root: Root; display: string; index: number; state: ReturnType<typeof surfaceState>; content: HTMLElement | null; committed: boolean; wiped: boolean }>()

  const drop = (block: HTMLElement): void => {
    const mounted = mounts.get(block)
    if (mounted === undefined) return
    mounts.delete(block)
    mounted.state.dispose()
    block.style.display = mounted.display
    // A provider can dispose in the same tick as a host replacement, before
    // MutationObserver delivers its records. Restore the owned boundary for
    // teardown here too, rather than relying only on the asynchronous observer.
    if (mounted.content !== null && mounted.content.parentNode !== mounted.container) {
      mounted.container.append(mounted.content)
    }
    mounted.container.remove()
    // Service cleanup can run inside the parent's React commit. Retire this
    // independent root after that commit; the action gate closes immediately.
    queueMicrotask(() => {
      try { mounted.root.unmount() } catch { /* A host replacement may already have removed the tree. */ }
    })
  }

  const scan = (): void => {
    queued = false
    if (!active) return
    if (!validSurface(surface)) {
      for (const block of mounts.keys()) drop(block)
      return
    }
    const all = codeBlockSurfaces(surface.root).filter(block => block.closest(`[${MOUNT}]`) === null)
    const blocks = all.filter(block => !all.some(other => other !== block && other.contains(block)))
    if (blocks.length !== fences.length) {
      for (const block of mounts.keys()) drop(block)
      return
    }
    for (const [block, mounted] of mounts) {
      const fence = fences[mounted.index]
      if (blocks[mounted.index] !== block || fence === undefined
        || block.querySelector('pre')?.textContent?.trimEnd() !== fence.value.trimEnd()
        || mounted.wiped) drop(block)
    }
    for (const [index, block] of blocks.entries()) {
      const fence = fences[index]
      if (fence?.lang !== 'dsh-ui' || block.querySelector('pre')?.textContent?.trimEnd() !== fence.value.trimEnd()) continue
      const existing = mounts.get(block)
      if (existing !== undefined) {
        if (existing.container.parentElement !== block.parentElement || block.nextElementSibling !== existing.container) block.after(existing.container)
        if (existing.committed && block.style.display !== 'none') block.style.display = 'none'
        continue
      }
      const id = JSON.stringify([surface.source, surface.threadId, surface.eventSeq, surface.contentBlockIndex, index])
      const spec = resolveGenuiSpec(fence.value, { sessionId: surface.threadId, source: { id, order: [surface.eventSeq, surface.contentBlockIndex, index] } })
      // There is no child-thread panel dock. Do not silently publish into a
      // different surface or reinterpret panel semantics as inline rendering.
      if (spec === null || spec.panel === true) continue
      // Match the existing bounded interaction store, without persisting raw
      // specs (which can contain password defaults) as storage keys.
      const stateKey = fenceStateKey(surface.threadId, id, fence.value)
      const state = surfaceState(stateKey)
      const container = document.createElement('div')
      container.setAttribute(MOUNT, '')
      block.after(container)
      let root: Root | undefined
      try {
        root = createRoot(container)
        const ownedRoot = root
        root.render(
          <CommittedFence onCommit={content => {
            const mounted = mounts.get(block)
            if (active && mounted?.root === ownedRoot) {
              mounted.committed = true
              mounted.content = content
              block.style.display = 'none'
            }
          }}>
          <GenuiActionContext.Provider value={(action, payload) => {
            if (!active || surface.root.getAttribute('data-genui-surface') !== surface.source
              || mounts.get(block)?.root !== ownedRoot || !surface.root.contains(block)) return
            void surface.sendPrompt(`[genui-action] ${action} ${JSON.stringify(payload)}`).catch(() => {
              // 传输错误由 provider 处理，动作不会发送到主会话。
            })
          }}>
            <ErrorBoundary key={stateKey} label="sidechat dsh-ui fence">
              <ExportableGenuiBlock spec={spec} stateKey={stateKey}
                {...(state.initial === null ? {} : { initialState: state.initial })}
                onStateChange={state.capture} animateEntrance={false} />
            </ErrorBoundary>
          </GenuiActionContext.Provider>
          </CommittedFence>,
        )
        mounts.set(block, { container, root, display: block.style.display, index, state, content: null, committed: false, wiped: false })
      } catch {
        state.dispose()
        root?.unmount()
        container.remove()
        // Construction failure must leave the original code visible.
      }
    }
  }
  const schedule = (): void => {
    if (!active || queued) return
    queued = true
    queueMicrotask(scan)
  }
  const observer = new MutationObserver(records => {
    // React still owns its boundary when the host replaces our container's
    // children, even with nonempty replacement content. Reattach it solely for orderly teardown,
    // then rebuild from the captured state. Otherwise React's unmount would
    // try removing children no longer present and emit NotFoundError.
    for (const record of records) {
      for (const mounted of mounts.values()) {
        if (mounted.committed && mounted.content !== null && record.target === mounted.container
          && mounted.content.parentNode !== mounted.container
          && [...record.removedNodes].includes(mounted.content)) {
          mounted.container.append(mounted.content)
          mounted.wiped = true
        }
      }
    }
    if (records.some(record => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement
      if (target?.closest(`[${MOUNT}]`) === null) return true
      return [...mounts.values()].some(mounted => target === mounted.container && mounted.wiped)
    })) schedule()
  })
  observer.observe(surface.root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-genui-surface'],
  })
  scan()
  return () => {
    active = false
    observer.disconnect()
    for (const block of mounts.keys()) drop(block)
    if (sidechatSurfaceOwners.get(surface.root) === owner) {
      if (surface.root.hasAttribute('data-genui-surface') || !surface.root.isConnected) {
        surface.root.removeAttribute(SIDECHAT_ROOT)
      }
      sidechatSurfaceOwners.delete(surface.root)
    }
  }
}

/** 向提供通用 sidechat service 的宿主注册 GenUI adapter。 */
export function installSidechatAdapter(service: Partial<SidechatSurfaceService> | undefined): () => void {
  if (typeof service?.registerSidechatSurfaceAdapter !== 'function') return () => {}
  return service.registerSidechatSurfaceAdapter({ id: 'dsh-genui', mount: mountSidechatSurface })
}
