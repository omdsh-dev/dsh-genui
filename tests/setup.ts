/** Browser API polyfills for the test environment. */
import { setLocale } from '../src/client/i18n/index.ts'

// Locale pin: jsdom reports an English navigator, so the renderer would
// default to `en`. The suite's existing expectations were written against the
// Chinese chrome that shipped before the i18n extraction, so pinning `zh`
// keeps every one of them meaningful — they now assert that the zh dictionary
// still reproduces the pre-extraction wording verbatim. English rendering and
// locale switching are covered explicitly in tests/i18n.spec.ts.
setLocale('zh')

// Node 22+ ships an experimental globalThis.localStorage getter that shadows
// jsdom's implementation and yields undefined unless the process was started
// with --localstorage-file. Persistence specs (panel/interaction/achievement)
// then fail on `localStorage.clear()` with a TypeError that has nothing to do
// with the code under test. Install an in-memory Storage instead of depending
// on that runtime flag so the suite is runner-agnostic.
function installMemoryStorage(name: 'localStorage' | 'sessionStorage'): void {
  const store = new Map<string, string>()
  const methods = {
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
  // A Proxy (not a plain object) so Object.keys/values/entries enumerate the
  // stored keys exactly like jsdom's Storage does — specs assert on
  // Object.values(localStorage), which item access alone would not satisfy.
  const storage = new Proxy({} as Storage, {
    get(_target, prop) {
      if (prop === 'length') return store.size
      if (prop in methods) return methods[prop as keyof typeof methods]
      return store.get(String(prop))
    },
    set(_target, prop, value) { store.set(String(prop), String(value)); return true },
    has(_target, prop) { return prop in methods || store.has(String(prop)) },
    deleteProperty(_target, prop) { store.delete(String(prop)); return true },
    ownKeys() { return [...store.keys()] },
    getOwnPropertyDescriptor(_target, prop) {
      const key = String(prop)
      return store.has(key) ? { configurable: true, enumerable: true, value: store.get(key) } : undefined
    },
  })
  for (const target of [globalThis, typeof window === 'undefined' ? undefined : window] as const) {
    if (target === undefined) continue
    Object.defineProperty(target, name, { value: storage, configurable: true, writable: true })
  }
}

if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage === null) {
  installMemoryStorage('localStorage')
}
if (typeof globalThis.sessionStorage === 'undefined' || globalThis.sessionStorage === null) {
  installMemoryStorage('sessionStorage')
}

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
