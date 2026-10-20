/**
 * Runtime loader for the mermaid engine. The heavy mermaid bundle ships as a
 * separate asset (`lib/assets/mermaid.js`, served by the plugin's own HTTP
 * route) and is fetched ONLY when a spec contains a `mermaid` node — the
 * main client bundle stays small and most conversations never download
 * mermaid at all. On a host that does not serve the asset (older harness) the
 * load rejects and the MermaidNode shows its plain-source fallback.
 *
 * The pure source utilities stay statically exported from mermaid-safe so
 * tests (and any consumer) can use them without the engine.
 * @module @changfenhuang/dsh-genui/client/mermaid-lazy
 */
import { loadGenuiAsset } from './asset-loader.ts'
export { assertSafeSvg, ensureFlowchartKind, repairMermaidSource } from './mermaid-safe.ts'

/** The engine surface registered by the mermaid asset bundle. */
interface MermaidAssetApi {
  renderMermaid: (code: string, target?: HTMLElement) => Promise<string>
}

interface RenderJob {
  code: string
  signal: AbortSignal | undefined
  target: HTMLElement | undefined
  resolve: (svg: string) => void
  reject: (error: unknown) => void
  abort: () => void
}

const jobs: RenderJob[] = []
let active = false
let listening = false
let timer: ReturnType<typeof setTimeout> | undefined
let scrollUntil = 0

// Keep graph layout out of an ongoing scroll gesture. Matches #303's tested
// quiet period; this is scheduling, not a change to DOM-fence discovery.
const SCROLL_QUIET_MS = 250
const onScroll = (): void => {
  scrollUntil = performance.now() + SCROLL_QUIET_MS
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  pump()
}
const onVisibility = (): void => { pump() }

/** 持续监听滚动与页面可见状态，供空闲调度器记录活动时间。 */
function listenForActivity(): void {
  if (listening || typeof document === 'undefined') return
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  document.addEventListener('visibilitychange', onVisibility)
  listening = true
}

// 调度器随客户端渲染器加载，确保队列空闲时也能记录滚动事件。
listenForActivity()

function pump(): void {
  if (active) return
  if (jobs.length === 0) {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    return
  }
  if (timer !== undefined || document.hidden) return
  // A fresh task (rather than a promise/microtask chain) gives input, paint
  // and the host watchdog a chance between diagrams, including after errors.
  timer = setTimeout(() => {
    timer = undefined
    if (document.hidden) return
    if (performance.now() < scrollUntil) { pump(); return }
    const job = jobs.shift()
    if (job === undefined) { pump(); return }
    active = true
    void (async () => {
      let deferred = false
      try {
        job.signal?.throwIfAborted()
        const api = await loadGenuiAsset<MermaidAssetApi>('mermaid')
        job.signal?.throwIfAborted()
        // Loading the engine may outlive a scroll or visibility change.
        if (document.hidden || performance.now() < scrollUntil) {
          deferred = true
          jobs.unshift(job)
          return
        }
        const svg = await api.renderMermaid(job.code, job.target)
        job.signal?.throwIfAborted()
        job.resolve(svg)
      } catch (error) {
        job.reject(error)
      } finally {
        if (!deferred) job.signal?.removeEventListener('abort', job.abort)
        active = false
        pump()
      }
    })()
  }, Math.max(0, scrollUntil - performance.now()))
}

/**
 * Render mermaid source to an SVG string (engine loaded on demand).
 * @param code - the mermaid diagram source.
 * @param options - abort signal for queued or superseded work.
 * @returns the rendered SVG markup (verified free of script/event handlers).
 * @throws when the asset cannot load, the kind is not whitelisted, rendering
 *   fails, or the output fails the sanitization check.
 */
// Queue one diagram; cancellation discards stale source before engine work.
export function renderMermaid(code: string, options: { signal?: AbortSignal; target?: HTMLElement } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const signal = options.signal
    if (signal?.aborted) { reject(signal.reason); return }
    const job: RenderJob = { code, signal, target: options.target, resolve, reject, abort: () => {
      const index = jobs.indexOf(job)
      if (index !== -1) jobs.splice(index, 1)
      reject(signal?.reason)
      signal?.removeEventListener('abort', job.abort)
      pump()
    } }
    signal?.addEventListener('abort', job.abort, { once: true })
    jobs.push(job)
    listenForActivity()
    pump()
  })
}
