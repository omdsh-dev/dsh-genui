/** Browser API polyfills for the test environment. */
import { setLocale } from '../src/client/i18n/index.ts'

// Locale pin: jsdom reports an English navigator, so the renderer would
// default to `en`. The suite's existing expectations were written against the
// Chinese chrome that shipped before the i18n extraction, so pinning `zh`
// keeps every one of them meaningful — they now assert that the zh dictionary
// still reproduces the pre-extraction wording verbatim. English rendering and
// locale switching are covered explicitly in tests/i18n.spec.ts.
setLocale('zh')

// jsdom lacks rAF: the reveal animation uses it per item; manual tick below.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  // @ts-expect-error test-only stub
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number
  // @ts-expect-error test-only stub
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id)
}

// jsdom lacks PointerEvent: the panel resize drag and pointer interactions
// in general rely on it. A MouseEvent subclass carries pointerId/pointerType
// so fireEvent.pointerDown/pointerMove/pointerUp behave like the browser.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 1
      this.pointerType = params.pointerType ?? 'mouse'
    }
  }
  // @ts-expect-error test-only polyfill
  window.PointerEvent = PointerEventPolyfill
  // @ts-expect-error test-only polyfill
  globalThis.PointerEvent = PointerEventPolyfill
}

// jsdom only exposes `localStorage` for a non-opaque origin, and on Node 26 + jsdom 25 it comes
// back undefined even with `environmentOptions.jsdom.url` set — 218 tests then die on
// `localStorage.clear()`, which reads as "the product is broken" on a clean checkout. Guarded like
// the rAF and PointerEvent stubs above: the shape is the real Storage API, so a genuine storage bug
// still shows up as a failing assertion rather than being papered over.
if (typeof globalThis.localStorage === 'undefined') {
  class MemoryStorage implements Storage {
    private data = new Map<string, string>()
    get length(): number { return this.data.size }
    clear(): void { this.data.clear() }
    getItem(key: string): string | null { return this.data.has(key) ? this.data.get(key)! : null }
    key(index: number): string | null { return [...this.data.keys()][index] ?? null }
    removeItem(key: string): void { this.data.delete(key) }
    setItem(key: string, value: string): void { this.data.set(key, String(value)) }
  }
  const memory = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true })
  Object.defineProperty(window, 'localStorage', { value: memory, configurable: true })
}
