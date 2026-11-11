/*!
 * genui-bridge.js — mount the REAL dsh-genui standalone renderer on any static page.
 *
 * The renderer is the plugin's own build output (`assets/genui/standalone-runtime.js`,
 * an IIFE that publishes `window.__GenuiStandalone__ = { mount }`). This bridge owns:
 *
 *   1. lazy, one-time script loading (engine bundles first, then the runtime);
 *   2. artifact normalization (single artifact | {zh,en} map | artifacts.json spec record);
 *   3. explicit loading / error UI so a slow or broken renderer never leaves a blank hole;
 *   4. mount / unmount / remount lifecycle (fresh inner mount point per mount, so React roots
 *      never collide and a locale switch is a plain remount);
 *   5. deferred mounting for heavy engine nodes (mermaid / three / map / echart), triggered by
 *      a click or by viewport visibility — the ~3.4 MB mermaid bundle never loads unasked.
 *
 * Public surface: `window.GenuiBridge` (see proto/BRIDGE.md for the full contract).
 * Prototype: the site team owns the final copy; keep the API shape.
 */
(function () {
  'use strict'

  var VERSION = '1.0.0'
  /** Engine bundle order — mirrors artifact/portability.ts ASSET_ORDER. */
  var ASSET_ORDER = ['mermaid', 'three', 'echarts-core', 'echarts-full', 'icons', 'maplibre']
  /** Mirrors src/client/echarts-engine.ts CORE_PRESETS (fallback inference only). */
  var ECHARTS_CORE_PRESETS = { bar: 1, line: 1, area: 1, pie: 1, scatter: 1, bigline: 1 }
  var RUNTIME_FILE = 'standalone-runtime.js'
  var SPEC_FORMAT = 'dsh-genui'
  var SPEC_VERSION = 1
  var DEFAULT_LOCALE = 'zh'

  var LOAD_LABELS = {
    zh: {
      loading: '正在加载渲染器…',
      load: '加载并渲染',
      reload: '重新渲染',
      error: '渲染器加载失败',
      invalid: '无效的 GenUI artifact',
      retry: '重试',
      heavy: '需要额外引擎',
      mount: '渲染',
    },
    en: {
      loading: 'Loading the renderer…',
      load: 'Load and render',
      reload: 'Render again',
      error: 'The renderer failed to load',
      invalid: 'Invalid GenUI artifact',
      retry: 'Retry',
      heavy: 'Needs an extra engine',
      mount: 'Render',
    },
  }

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                      */
  /* ------------------------------------------------------------------ */

  function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  /** Kebab-case bundle name → camelCase `window.__GenuiAssets__` key. */
  function assetKey(name) {
    return name.replace(/-(\w)/g, function (_match, char) { return char.toUpperCase() })
  }

  function normalizeLocale(locale) {
    return locale === 'en' ? 'en' : locale === 'zh' ? 'zh' : DEFAULT_LOCALE
  }

  function resolveElement(root) {
    if (typeof root === 'string') return document.querySelector(root)
    return root || null
  }

  function baseFromScript() {
    try {
      var script = document.currentScript
      if (script && script.src) return new URL('../genui/', script.src).href
    } catch (_error) { /* fall through */ }
    return new URL('assets/genui/', document.baseURI).href
  }

  /* ------------------------------------------------------------------ */
  /* Bridge state                                                       */
  /* ------------------------------------------------------------------ */

  var config = {
    base: baseFromScript().replace(/\/?$/, '/'),
    locale: normalizeLocale(document.documentElement.getAttribute('lang')),
    labels: LOAD_LABELS,
    /** ms to wait for the first rendered child before `genui:rendered` fires anyway. */
    renderTimeout: 4000,
  }

  /** url → Promise (script injection, memoized per page). */
  var scriptLoads = new Map()
  /** engine name → Promise (memoized; cleared on failure so a retry can succeed). */
  var engineLoads = new Map()
  var runtimeLoad = null
  var mountedHandles = new Set()
  var styleInjected = false

  /* ------------------------------------------------------------------ */
  /* Styles (self-contained; site CSS can override any class)            */
  /* ------------------------------------------------------------------ */

  var STYLE_ID = 'genui-bridge-style'
  var BRIDGE_CSS = [
    '.genui-mount{display:block;width:100%;min-width:0}',
    '.genui-bridge-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;',
    'min-height:200px;padding:28px 24px;border:1px dashed var(--genui-bridge-line,rgba(255,255,255,.14));',
    'border-radius:12px;background:var(--genui-bridge-surface,rgba(255,255,255,.02));',
    'color:var(--genui-bridge-text,#a9a7a1);font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;}',
    '.genui-bridge-placeholder__title{font-weight:500;color:var(--genui-bridge-strong,#f3f1ec)}',
    '.genui-bridge-placeholder__meta{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;',
    'letter-spacing:.08em;text-transform:uppercase;color:var(--genui-bridge-text-3,#6d6c68)}',
    '.genui-bridge-placeholder__btn{appearance:none;margin:0;padding:8px 18px;border-radius:999px;cursor:pointer;',
    'border:1px solid var(--genui-bridge-accent,#e6d3ac);background:transparent;color:var(--genui-bridge-accent,#e6d3ac);',
    'font:500 13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;transition:background-color .18s ease,color .18s ease}',
    '.genui-bridge-placeholder__btn:hover{background:var(--genui-bridge-accent-soft,rgba(230,211,172,.12))}',
    '.genui-bridge-placeholder__btn:focus-visible{outline:2px solid var(--genui-bridge-accent,#e6d3ac);outline-offset:3px}',
    '.genui-bridge-loading{display:flex;align-items:center;justify-content:center;gap:10px;min-height:120px;',
    'color:var(--genui-bridge-text,#a9a7a1);font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}',
    '.genui-bridge-loading__dot{width:8px;height:8px;border-radius:50%;background:var(--genui-bridge-accent,#e6d3ac);',
    'animation:genui-bridge-pulse 1s ease-in-out infinite}',
    '@keyframes genui-bridge-pulse{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}',
    '@media (prefers-reduced-motion: reduce){.genui-bridge-loading__dot{animation:none;opacity:.8}}',
    '.genui-bridge-error{padding:18px 20px;border:1px solid rgba(216,165,92,.35);border-radius:12px;',
    'background:rgba(216,165,92,.07);color:#d8a55c;font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:left}',
    '.genui-bridge-error__title{font-weight:600;margin-bottom:4px}',
    '.genui-bridge-error__detail{margin-top:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
    'font-size:12px;opacity:.85;word-break:break-word}',
    '[data-genui-state="error"]{scroll-margin-block:110px}',
  ].join('')

  function ensureStyles() {
    if (styleInjected || document.getElementById(STYLE_ID)) { styleInjected = true; return }
    var style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = BRIDGE_CSS
    document.head.appendChild(style)
    styleInjected = true
  }

  /* ------------------------------------------------------------------ */
  /* Loading                                                            */
  /* ------------------------------------------------------------------ */

  function injectScript(url) {
    if (scriptLoads.has(url)) return scriptLoads.get(url)
    var promise = new Promise(function (resolve, reject) {
      var script = document.createElement('script')
      script.src = url
      script.async = true
      script.dataset.genuiLoader = 'runtime-bridge'
      script.onload = function () {
        script.remove()
        resolve(url)
      }
      script.onerror = function () {
        script.remove()
        reject(new Error('failed to load ' + url))
      }
      document.head.appendChild(script)
    })
    scriptLoads.set(url, promise)
    return promise
  }

  /** Load one lazy engine bundle and return the API it registered. */
  function loadEngine(name) {
    if (ASSET_ORDER.indexOf(name) === -1) return Promise.reject(new Error('unknown GenUI engine: ' + name))
    var key = assetKey(name)
    var assets = window.__GenuiAssets__ || {}
    if (assets[key] !== undefined) return Promise.resolve(assets[key])
    if (engineLoads.has(name)) return engineLoads.get(name)
    var promise = injectScript(config.base + name + '.js').then(function () {
      var registered = (window.__GenuiAssets__ || {})[key]
      if (registered === undefined) throw new Error(name + '.js loaded but registered no "' + key + '" engine')
      return registered
    })
    engineLoads.set(name, promise)
    promise.catch(function () { engineLoads.delete(name) })
    return promise
  }

  /** Load the standalone runtime (after its engines are registered). */
  function loadRuntime() {
    if (window.__GenuiStandalone__ && typeof window.__GenuiStandalone__.mount === 'function') {
      return Promise.resolve(window.__GenuiStandalone__)
    }
    if (runtimeLoad !== null) return runtimeLoad
    runtimeLoad = injectScript(config.base + RUNTIME_FILE).then(function () {
      var runtime = window.__GenuiStandalone__
      if (!runtime || typeof runtime.mount !== 'function') {
        throw new Error(RUNTIME_FILE + ' loaded but window.__GenuiStandalone__.mount is missing')
      }
      return runtime
    })
    runtimeLoad.catch(function () { runtimeLoad = null })
    return runtimeLoad
  }

  /** Load only the given engines, then the runtime. Engines must register first. */
  function load(assets) {
    var requested = Array.isArray(assets) ? assets : []
    var ordered = ASSET_ORDER.filter(function (name) { return requested.indexOf(name) !== -1 })
    return Promise.all(ordered.map(loadEngine)).then(function () { return loadRuntime() })
  }

  /* ------------------------------------------------------------------ */
  /* Artifact + source normalization                                    */
  /* ------------------------------------------------------------------ */

  function isArtifact(value) {
    return isRecord(value) && value.format === SPEC_FORMAT && value.version === SPEC_VERSION && isRecord(value.presentation)
  }

  /**
   * Normalize anything the site may hand us into
   * `{ id, requiredAssets, artifacts: {zh, en}, source, bytes }`.
   * Accepted shapes:
   *   a single artifact     {format:'dsh-genui', version:1, spec, presentation:{locale,theme}}
   *   a locale map          {zh: artifact, en: artifact}
   *   a spec record         {id, category, requiredAssets:[...], artifacts:{zh,en}}  (artifacts.json entry)
   */
  function normalizeSource(value) {
    if (!isRecord(value)) throw new Error('GenuiBridge: source must be an object')
    if (isArtifact(value)) {
      var locale = normalizeLocale(value.presentation.locale)
      var artifacts = {}
      artifacts[locale] = value
      return { id: undefined, requiredAssets: inferRequiredAssets(value.spec), artifacts: artifacts, source: value }
    }
    if (isRecord(value.artifacts)) {
      return {
        id: value.id,
        requiredAssets: Array.isArray(value.requiredAssets) ? value.requiredAssets.slice() : undefined,
        artifacts: value.artifacts,
        source: value,
      }
    }
    if (isArtifact(value.zh) || isArtifact(value.en)) {
      return { id: value.id, requiredAssets: Array.isArray(value.requiredAssets) ? value.requiredAssets.slice() : undefined, artifacts: value, source: value }
    }
    throw new Error('GenuiBridge: unrecognized source — expected an artifact, a {zh,en} map, or an artifacts.json spec record')
  }

  function pickArtifact(source, locale) {
    var wanted = source.artifacts[normalizeLocale(locale)]
    if (isArtifact(wanted)) return wanted
    if (isArtifact(source.artifacts.zh)) return source.artifacts.zh
    if (isArtifact(source.artifacts.en)) return source.artifacts.en
    return undefined
  }

  /**
   * Fallback engine inference for callers that pass a bare artifact (no manifest entry).
   * Prefer `requiredAssets` from artifacts.json: this scan only knows node types + echart presets.
   * Echart rule is deliberately conservative: core presets load echarts-core, ANY other preset
   * (known full-engine one, typo, future addition) loads echarts-full — never silently miss an engine.
   */
  function inferRequiredAssets(spec) {
    var found = {}
    function visit(value) {
      if (Array.isArray(value)) { value.forEach(visit); return }
      if (!isRecord(value) || typeof value.type !== 'string') return
      var node = value
      if (node.type === 'mermaid') found.mermaid = true
      if (node.type === 'scene3d') found.three = true
      if (node.type === 'map') found.maplibre = true
      if (node.type === 'echart') {
        if (node.option !== undefined) found['echarts-full'] = true
        else if (ECHARTS_CORE_PRESETS[node.preset || 'bar']) found['echarts-core'] = true
        else found['echarts-full'] = true
      }
      var children = node.items
      if (Array.isArray(children)) children.forEach(function (child) { if (isRecord(child) && typeof child.type === 'string') visit(child) })
      if (Array.isArray(node.tabs)) node.tabs.forEach(function (tab) { if (isRecord(tab) && Array.isArray(tab.items)) tab.items.forEach(visit) })
      if (Array.isArray(node.details)) node.details.forEach(function (row) { if (Array.isArray(row)) row.forEach(visit) })
    }
    if (isRecord(spec) && Array.isArray(spec.items)) spec.items.forEach(visit)
    return ASSET_ORDER.filter(function (name) { return found[name] === true })
  }

  /* ------------------------------------------------------------------ */
  /* Placeholder / loading / error UI                                   */
  /* ------------------------------------------------------------------ */

  function labelsFor(locale) {
    return config.labels[normalizeLocale(locale)] || LOAD_LABELS.en
  }

  function renderLoading(root, locale) {
    ensureStyles()
    root.dataset.genuiState = 'loading'
    root.replaceChildren()
    var wrap = document.createElement('div')
    wrap.className = 'genui-bridge-loading'
    wrap.setAttribute('role', 'status')
    wrap.setAttribute('aria-live', 'polite')
    var dot = document.createElement('span')
    dot.className = 'genui-bridge-loading__dot'
    dot.setAttribute('aria-hidden', 'true')
    var label = document.createElement('span')
    label.textContent = labelsFor(locale).loading
    wrap.append(dot, label)
    root.append(wrap)
  }

  function renderError(root, locale, error) {
    ensureStyles()
    root.dataset.genuiState = 'error'
    root.replaceChildren()
    var labels = labelsFor(locale)
    var box = document.createElement('div')
    box.className = 'genui-bridge-error'
    box.setAttribute('role', 'alert')
    var title = document.createElement('div')
    title.className = 'genui-bridge-error__title'
    title.textContent = labels.error
    var message = document.createElement('div')
    message.textContent = error && error.message ? error.message : String(error)
    var detail = document.createElement('div')
    detail.className = 'genui-bridge-error__detail'
    detail.textContent = error && error.name ? error.name : ''
    box.append(title, message)
    if (detail.textContent) box.append(detail)
    root.append(box)
  }

  /** Resolve after the runtime has committed its first DOM child (or after a timeout). */
  function whenRendered(root) {
    return new Promise(function (resolve) {
      var done = false
      var observer = new MutationObserver(function () {
        if (root.childElementCount > 0) finish()
      })
      var timer = setTimeout(finish, config.renderTimeout)
      function finish() {
        if (done) return
        done = true
        clearTimeout(timer)
        observer.disconnect()
        requestAnimationFrame(function () { requestAnimationFrame(resolve) })
      }
      observer.observe(root, { childList: true, subtree: true })
      if (root.childElementCount > 0) finish()
    })
  }

  function emit(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: detail }))
    } catch (_error) { /* CustomEvent always available in the target browsers */ }
  }

  /* ------------------------------------------------------------------ */
  /* Mount lifecycle                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Mount a GenUI artifact into `root`.
   *
   * @param {Element|string} root        host element (cleared) or selector
   * @param {object} source              artifact | {zh,en} | artifacts.json spec record
   * @param {object} [options]
   * @param {string} [options.locale]    'zh' | 'en' (default: bridge locale)
   * @param {string[]} [options.assets]  engines to preload (default: source.requiredAssets / inferred)
   * @param {boolean} [options.showLoading=true]
   * @returns {Promise<object>} handle: {root, id, assets, artifact, unmount, remount, setLocale}
   */
  async function mount(root, source, options) {
    var opts = options || {}
    var element = resolveElement(root)
    if (!element) throw new Error('GenuiBridge.mount: root element not found: ' + root)
    ensureStyles()

    var record = normalizeSource(source)
    var locale = normalizeLocale(opts.locale || config.locale)
    var artifact = pickArtifact(record, locale)
    if (artifact === undefined) {
      var missing = new Error('GenuiBridge.mount: source has no artifact for locale "' + locale + '"')
      renderError(element, locale, missing)
      throw missing
    }
    var assets = Array.isArray(opts.assets) ? opts.assets : record.requiredAssets
    if (!Array.isArray(assets)) assets = inferRequiredAssets(artifact.spec)

    if (opts.showLoading !== false) {
      renderLoading(element, locale)
      emit('genui:loading', { root: element, assets: assets.slice(), id: record.id })
    }

    try {
      await load(assets)
      // Fresh inner mount point per mount: React never sees a reused container, so
      // repeat mounts / locale remounts cannot collide with a previous root.
      element.replaceChildren()
      var mountPoint = document.createElement('div')
      mountPoint.className = 'genui-mount'
      mountPoint.dataset.genuiMountFor = record.id || 'genui'
      element.append(mountPoint)
      var runtimeUnmount = window.__GenuiStandalone__.mount(mountPoint, artifact)
    } catch (error) {
      renderError(element, locale, error)
      emit('genui:error', { root: element, error: error, id: record.id })
      if (typeof opts.onError === 'function') opts.onError(error)
      throw error
    }

    element.dataset.genuiState = 'mounted'
    element.dataset.genuiSpec = record.id || ''
    var handle = {
      root: element,
      id: record.id,
      assets: assets.slice(),
      artifact: artifact,
      /** true until unmount() is called */
      mounted: true,
      unmount: function () { dispose(true) },
      remount: function (nextSource, nextOptions) {
        var source2 = nextSource === undefined ? record.source : nextSource
        dispose(false)
        return mount(element, source2, Object.assign({}, opts, nextOptions))
      },
      setLocale: function (nextLocale) {
        dispose(false)
        return mount(element, record.source, Object.assign({}, opts, { locale: nextLocale }))
      },
    }

    function dispose(emitEvent) {
      if (!handle.mounted) return
      handle.mounted = false
      mountedHandles.delete(handle)
      try {
        runtimeUnmount()
      } catch (error) {
        // React unmount can throw if a component's cleanup failed; never block the page.
        if (typeof opts.onError === 'function') opts.onError(error)
      }
      if (mountPoint.parentNode) mountPoint.remove()
      element.dataset.genuiState = 'idle'
      delete element.dataset.genuiSpec
      if (emitEvent) emit('genui:unmounted', { root: element, id: record.id })
    }

    mountedHandles.add(handle)
    emit('genui:mounted', { root: element, id: record.id, assets: assets.slice() })
    whenRendered(element).then(function () {
      if (handle.mounted) {
        element.dataset.genuiState = 'rendered'
        emit('genui:rendered', { root: element, id: record.id })
      }
    })
    return handle
  }

  /**
   * Render a placeholder now, mount later — on click or when scrolled into view.
   * Used for heavy engine nodes so a 3.4 MB bundle never loads unasked.
   *
   * @returns {{el, assets, start, cancel, mounted}}
   */
  function mountDeferred(root, source, options) {
    var opts = options || {}
    var element = resolveElement(root)
    if (!element) throw new Error('GenuiBridge.mountDeferred: root element not found: ' + root)
    ensureStyles()
    var record = normalizeSource(source)
    var locale = normalizeLocale(opts.locale || config.locale)
    var assets = Array.isArray(opts.assets) ? opts.assets : record.requiredAssets
    if (!Array.isArray(assets)) assets = inferRequiredAssets(pickArtifact(record, locale) ? pickArtifact(record, locale).spec : undefined)
    var labels = labelsFor(locale)
    var trigger = opts.trigger === 'visible' ? 'visible' : 'click'
    var state = { started: false, cancelled: false, handle: undefined, observer: undefined }
    var startPromise = null
    var resolver = null

    element.dataset.genuiState = 'deferred'
    element.replaceChildren()
    var box = document.createElement('div')
    box.className = 'genui-bridge-placeholder'
    var title = document.createElement('div')
    title.className = 'genui-bridge-placeholder__title'
    title.textContent = opts.title || labels.heavy
    var meta = document.createElement('div')
    meta.className = 'genui-bridge-placeholder__meta'
    meta.textContent = opts.meta || (assets.length > 0 ? assets.join(' + ') : 'no engine bundle')
    var button = document.createElement('button')
    button.type = 'button'
    button.className = 'genui-bridge-placeholder__btn'
    button.textContent = opts.label || labels.load
    box.append(title, meta, button)
    element.append(box)

    function start() {
      if (startPromise !== null) return startPromise
      if (state.cancelled) return Promise.resolve(undefined)
      state.started = true
      if (state.observer) { state.observer.disconnect(); state.observer = undefined }
      button.disabled = true
      startPromise = mount(element, record.source, Object.assign({}, opts, { locale: locale })).then(function (handle) {
        state.handle = handle
        if (resolver) resolver(handle)
        return handle
      }).catch(function (error) {
        // mount() has already rendered the error UI; keep the promise rejectable for callers.
        if (resolver) resolver(undefined)
        throw error
      })
      return startPromise
    }

    button.addEventListener('click', function () { start() })
    if (trigger === 'visible' && typeof IntersectionObserver === 'function') {
      state.observer = new IntersectionObserver(function (entries) {
        if (entries.some(function (entry) { return entry.isIntersecting })) start()
      }, { rootMargin: opts.rootMargin || '200px 0px' })
      state.observer.observe(element)
    }

    return {
      el: element,
      assets: assets.slice(),
      start: start,
      cancel: function () {
        state.cancelled = true
        if (state.observer) { state.observer.disconnect(); state.observer = undefined }
        if (state.handle) state.handle.unmount()
        if (element.dataset.genuiState === 'deferred') {
          element.replaceChildren()
          delete element.dataset.genuiState
        }
        if (resolver) resolver(undefined)
      },
      get mounted() { return state.handle !== undefined && state.handle.mounted },
      get handle() { return state.handle },
    }
  }

  /** Unmount one handle (or every handle mounted into an element). */
  function unmount(handleOrRoot) {
    if (!handleOrRoot) { unmountAll(); return }
    if (typeof handleOrRoot.unmount === 'function') { handleOrRoot.unmount(); return }
    var element = resolveElement(handleOrRoot)
    mountedHandles.forEach(function (handle) { if (handle.root === element) handle.unmount() })
  }

  function unmountAll() {
    Array.from(mountedHandles).forEach(function (handle) { handle.unmount() })
  }

  /* ------------------------------------------------------------------ */
  /* Locale                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Switch the bridge locale and remount every live handle with that locale's
   * artifact (the renderer's i18n is module-global, so a remount is the switch).
   * Locale-map sources get the translated spec; bare artifacts keep their text
   * but re-render chrome labels in the new locale.
   */
  async function setLocale(locale) {
    config.locale = normalizeLocale(locale)
    document.documentElement.setAttribute('lang', config.locale === 'zh' ? 'zh-CN' : 'en')
    var jobs = Array.from(mountedHandles).map(function (handle) {
      return handle.setLocale(config.locale).catch(function (error) {
        emit('genui:error', { root: handle.root, error: error })
        return undefined
      })
    })
    await Promise.all(jobs)
    emit('genui:locale', { locale: config.locale })
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                         */
  /* ------------------------------------------------------------------ */

  function configure(options) {
    var opts = options || {}
    if (typeof opts.base === 'string' && opts.base.length > 0) {
      config.base = new URL(opts.base, document.baseURI).href.replace(/\/?$/, '/')
    }
    if (opts.locale !== undefined) config.locale = normalizeLocale(opts.locale)
    if (isRecord(opts.labels)) {
      config.labels = {
        zh: Object.assign({}, LOAD_LABELS.zh, opts.labels.zh || {}),
        en: Object.assign({}, LOAD_LABELS.en, opts.labels.en || {}),
      }
    }
    if (typeof opts.renderTimeout === 'number') config.renderTimeout = opts.renderTimeout
    return config
  }

  var GenuiBridge = {
    /** Bridge contract version (not the renderer's). */
    version: VERSION,
    configure: configure,
    configureBase: function (base) { return configure({ base: base }) },
    get base() { return config.base },
    get locale() { return config.locale },
    get mountedCount() { return mountedHandles.size },

    /** Engines + runtime. `load(['mermaid'])` is safe to call repeatedly. */
    load: load,
    loadEngine: loadEngine,
    loadRuntime: loadRuntime,

    mount: mount,
    mountDeferred: mountDeferred,
    unmount: unmount,
    unmountAll: unmountAll,
    setLocale: setLocale,

    /** Introspection for the harness / site status line. */
    state: function () {
      var handles = Array.from(mountedHandles)
      return {
        base: config.base,
        locale: config.locale,
        runtimeReady: !!(window.__GenuiStandalone__ && typeof window.__GenuiStandalone__.mount === 'function'),
        engines: Object.keys(window.__GenuiAssets__ || {}),
        mounted: handles.length,
        specs: handles.map(function (handle) { return handle.id || '(artifact)' }),
      }
    },
  }

  window.GenuiBridge = GenuiBridge
})()
