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

// Node 26 ships an experimental `localStorage` global that stays undefined
// unless `--localstorage-file` is passed, and its presence shadows jsdom 25's
// Storage: `window.localStorage` is undefined too. The suite persists durable
// block state through localStorage, so provide a spec-compatible in-memory
// Storage when the environment does not supply one.
if (typeof globalThis.localStorage === 'undefined') {
  const data = new Map<string, string>()
  const storage = new Proxy({} as Storage, {
    get(_target, prop) {
      if (prop === 'length') return data.size
      if (prop === 'clear') return (): void => { data.clear() }
      if (prop === 'getItem') return (key: string): string | null => data.get(key) ?? null
      if (prop === 'key') return (index: number): string | null => [...data.keys()][index] ?? null
      if (prop === 'removeItem') return (key: string): void => { data.delete(key) }
      if (prop === 'setItem') return (key: string, value: string): void => { data.set(key, String(value)) }
      return typeof prop === 'string' ? data.get(prop) : undefined
    },
    set(_target, prop, value) {
      if (typeof prop === 'string') data.set(prop, String(value))
      return true
    },
    has(_target, prop) {
      return typeof prop === 'string' && data.has(prop)
    },
    deleteProperty(_target, prop) {
      if (typeof prop === 'string') data.delete(prop)
      return true
    },
    ownKeys() {
      return [...data.keys()]
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === 'string' && data.has(prop)) {
        return { value: data.get(prop), enumerable: true, configurable: true, writable: true }
      }
      return undefined
    },
  })
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  }
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
