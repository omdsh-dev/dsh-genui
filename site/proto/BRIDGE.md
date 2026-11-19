# GenUI renderer bridge — integration contract

Status: **verified working** (37/37 real-browser checks, 2026-11-09). Owner: renderer-bridge.
Scope: `scripts/build-site.mjs`, `assets/genui/**` (generated), `assets/js/genui-bridge.js`,
`proto/**` (harness + proof shots). The site shell (`index.html`, `assets/css/**`, `assets/js/site.js`,
`content/**`) is owned by others.

Thesis this doc serves: **every demo on the site is mounted by the plugin's real standalone runtime,
not a screenshot or a lookalike.** Nothing here re-implements the renderer; the bridge only loads
scripts, normalizes artifacts, and manages mount lifecycle.

---

## 1. TL;DR for the site integration

```html
<!-- 1. head: vendored renderer variables (:root + body[data-ds-dark-theme] only, no page layout) -->
<link rel="stylesheet" href="assets/genui/theme.css">

<!-- 2. before your site script: bridge defines window.GenuiBridge; it derives assets/genui/ from its own URL -->
<script src="assets/js/genui-bridge.js" defer></script>

<!-- 3. mount any artifacts.json spec record directly -->
<script>
  const manifest = await (await fetch('assets/genui/artifacts.json')).json()
  const spec = manifest.specs.find(entry => entry.id === 'surface-table')
  // lazily loads only spec.requiredAssets engines + the 1.2 MB runtime, then mounts
  const handle = await GenuiBridge.mount(document.querySelector('#demo'), spec, { locale: 'zh' })
  handle.unmount()                       // teardown
  await GenuiBridge.setLocale('en')      // remounts every live mount with its EN artifact
</script>
```

- **Sources you can pass to `mount`/`mountDeferred`** (all normalized):
  1. an artifacts.json spec record `{ id, category, requiredAssets, artifacts:{zh,en} }` ← preferred;
  2. a locale map `{ zh: artifact, en: artifact }`;
  3. a single artifact `{ format:'dsh-genui', version:1, spec, presentation:{locale,theme} }`.
- **Never** hand-write artifacts: they come from `assets/genui/artifacts.json` (validated by the
  plugin's own `createGenuiArtifact` + `parseGenuiArtifact` at build time).
- All paths are relative → works under a GitHub Pages subpath (`/dsh-genui/`). No `/plugins/...`,
  no `/__manus__`, no CDN.

---

## 2. Files

| path | owner | what |
|---|---|---|
| `assets/genui/standalone-runtime.js` | generated | the plugin's built renderer IIFE (`window.__GenuiStandalone__`) |
| `assets/genui/{mermaid,three,echarts-core,echarts-full,maplibre,icons}.js` | generated | engine bundles, **only those some spec needs** |
| `assets/genui/artifacts.json` | generated | validated artifacts for `content/specs/*.json` + asset manifest (sizes, sha256, node types) |
| `assets/genui/theme.css` | generated | `STANDALONE_THEME_CSS` minus `html` / `body` / `#genui-root` layout rules |
| `assets/js/genui-bridge.js` | hand-written | the bridge (`window.GenuiBridge`). DESIGN.md calls it `assets/js/genui.js`; rename on integration if you prefer |
| `proto/harness.html` | hand-written | proof harness; `?auto=1` mounts everything, `?all=1` mounts every content spec, `?lang=en` |
| `proto/demo-specs.json` | hand-written | harness-only demo specs (table/chart/quiz/mermaid/echart) |
| `proto/demo-artifacts.json` | generated | same pipeline output for the harness demos (so the harness works with zero content specs) |
| `proto/shots/*.png` | generated | screenshot proof |
| `scripts/build-site.mjs` | hand-written | the build (must run through the plugin repo's tsx) |
| `scripts/verify-harness.cjs` | hand-written | Playwright WebKit end-to-end verification + screenshots |

`assets/genui/**` is generated — never hand-edit. `theme.css` must be linked or every renderer
component renders with missing/broken colors (the renderer depends on `--dsw-*` CSS variables).

---

## 3. Build

Run **through the plugin repo's tsx** (plain `node` cannot load the repo's `.ts` sources):

```bash
# full build: validate all specs, vendor runtime+engines, write theme.css + artifacts.json + demo-artifacts.json
/Users/changfenhuang/projects/dsh-genui/node_modules/.bin/tsx genui-site/scripts/build-site.mjs

# validation only — writes nothing (use in the spec authoring loop / CI)
/Users/changfenhuang/projects/dsh-genui/node_modules/.bin/tsx genui-site/scripts/build-site.mjs --check

# site specs only, skip the harness demos (production variant if you want no demo artifacts)
/Users/changfenhuang/projects/dsh-genui/node_modules/.bin/tsx genui-site/scripts/build-site.mjs --no-demo
```

Required env: none. `DSH_GENUI_REPO` overrides the plugin repo path (default
`/Users/changfenhuang/projects/dsh-genui`).

What it does:

1. reads `content/specs/*.json` (`{id, category, note?, zh, en}`; a file may hold one object or an array);
2. for each locale runs the guard (`processGenuiSpec`), then `createGenuiArtifact(..., {locale, theme:'dark'})`,
   then `parseGenuiArtifact` round-trip, then `analyzeGenuiPortability` for `requiredAssets`;
3. fails loudly with **file + locale + JSON path**, e.g.
   `content/specs/x.json: zh: items[2].kind must be bars, line, or donut`;
4. copies the runtime plus the union of engines the specs need (skips files whose sha256 already matches
   the previous manifest; hashes land in `artifacts.json`);
5. writes `theme.css` (asserts `:root` + `body[data-ds-dark-theme]` survive and `html`/`body`/`#genui-root`
   are stripped), `artifacts.json`, `proto/demo-artifacts.json`;
6. **works with zero content specs** (`specs: []`) — useful before the spec deck lands;
7. exits non-zero on any invalid spec / missing plugin asset / runtime without `__GenuiStandalone__`.

`--check` vs full build: identical validation and theme extraction; `--check` performs no writes and reports
`would-copy` / `present` for assets. Full build may copy up to ~8.4 MB (all engines) into `assets/genui/`;
that cost is paid at build time, never on first paint.

**Upstream workaround (do not remove):** the plugin's own `analyzeGenuiPortability` recurses into
`file-tree.items` and reports its data records `{name, type:'file'|'dir'}` as `customTypes:['dir','file']`.
Every validated artifact that contains a file-tree would therefore be rejected, and the plugin's own
`buildStandaloneHtml` throws `unsupported-custom-component` for such specs (real upstream bug; same root
cause). The build filters exactly those two record types before judging portability — a genuine
non-whitelisted node type still fails the gate. Repro:
`processGenuiSpec` accepts `{type:'file-tree', items:[{name:'src', type:'dir'}]}` with `errors: []`, while
`analyzeGenuiPortability().customTypes` is `['dir','file']`.

---

## 4. Vendored asset inventory

From `assets/genui/artifacts.json` at the last build (plugin `@changfenhuang/dsh-genui@0.16.0`, git
`c2624ce`, 84 specs, 60 whitelisted node types, 2026-11-09):

| file | raw bytes | sha256 (first 12) | when it loads |
|---|---:|---|---|
| `standalone-runtime.js` | 1,224,493 | `4395e1052e31` | first `mount` on the page (once) |
| `mermaid.js` | 3,395,203 | `1bf1325a8836` | spec contains a `mermaid` node |
| `three.js` | 699,985 | `3b61ad28030d` | spec contains a `scene3d` node |
| `echarts-core.js` | 588,213 | `5eed01ed23a0` | `echart` with a core preset (`bar/line/area/pie/scatter/bigline`) |
| `echarts-full.js` | 1,044,998 | `53914c2d4957` | `echart` with `option` or a non-core preset |
| `maplibre.js` | 1,665,370 | `895cb7463511` | spec contains a `map` node |
| `icons.js` | 969,068 (when needed) | — | `icon` name outside the 62 inlined icons |
| **total all engines** | **8,618,262** | | theoretical max; a page never loads all of it |

`requiredAssets` per spec is in `artifacts.json`; the bridge loads exactly that list. A table/chart/quiz
demo costs **only the 1.2 MB runtime** — no engine. Heavy engines are the reason `mountDeferred` exists:
the 3.3 MB mermaid bundle must never load unasked.

---

## 5. Load order and globals

**Order matters: engine bundles first, then the runtime.** The bridge's `load(assets)` does this for you
(engines in `ASSET_ORDER` = `mermaid, three, echarts-core, echarts-full, icons, maplibre`, then the runtime).

- Each engine bundle is a self-contained IIFE that registers itself on
  `window.__GenuiAssets__[key]` where `key` is the kebab name camel-cased:
  `mermaid`, `three`, `echartsCore`, `echartsFull`, `icons`, `maplibre`.
- The runtime (`standalone-runtime.js`) publishes
  `window.__GenuiStandalone__ = { mount(root, rawArtifact) => unmountFn }`.
  - `mount` throws `Error('invalid GenUI artifact')` when the artifact envelope/spec fails
    `parseGenuiArtifact`; otherwise it renders into `root` and returns a React unmount function.
  - The standalone runtime **never fetches engines itself** — `src/client/standalone/asset-loader.ts`
    reads `window.__GenuiAssets__` synchronously when an engine node renders. Missing engine ⇒ that node
    keeps its fallback (mermaid: plain source + `渲染中…`), silently, forever.
- The runtime injects the KaTeX stylesheet into `document.head` at script execution time (self-contained
  `data:font/woff2` URLs, no network). Load the bridge after `<head>` exists — normal `defer`/body scripts are fine.

---

## 6. Bridge API (`window.GenuiBridge`)

`configure(options)` / `configureBase(url)` — set asset base explicitly. Default is derived from the
bridge script's own URL: `new URL('../genui/', script.src)` → `assets/genui/`. If the bridge is loaded as an
ES module (`document.currentScript` is null) the fallback is `assets/genui/` relative to `document.baseURI`.
Also accepts `{locale, renderTimeout, labels}`; `labels` overrides the built-in zh/en loading strings.

`load(assets = [])` — `Promise<runtime>`; loads engines first then runtime. Memoized per page; a failed
script load is retried on the next call (unlike the renderer's own strict-once loader) so a flaky first
attempt can recover.

`mount(root, source, options)` — `Promise<handle>`.
- `root`: element or selector. It is cleared and gets a fresh inner `.genui-mount` div per mount
  (protects React roots from container reuse across remounts).
- `source`: artifact | `{zh,en}` | artifacts.json spec record.
- `options`: `{ locale, assets, showLoading = true, onError }`. `assets` defaults to
  `source.requiredAssets`, else an inference scan over the spec (nodes + echart preset rules).
- On success sets `root.dataset.genuiState = 'mounted'` then `'rendered'` once the first DOM child commits.
- On failure it renders the explicit error UI (`role="alert"`), sets `dataset.genuiState = 'error'`,
  emits `genui:error`, calls `onError`, and **rejects**. Always `try/catch` or pass `onError`.
- `handle`: `{ root, id, artifact, assets, mounted, unmount(), remount(nextSource?, nextOptions?),
  setLocale(nextLocale) }`.

`mountDeferred(root, source, options)` — renders a placeholder (dashed surface, engine name + bytes,
real `<button>`) and mounts only when the user clicks, or when it scrolls into view.
- `options`: `{ locale, assets, trigger: 'click' | 'visible', rootMargin, title, meta, label }`.
- Returns `{ el, assets, start(), cancel(), mounted, handle }`; `start()` is idempotent and returns the
  mount promise. Use `trigger:'visible'` for the Atlas grid, `'click'` for the one heavy hero demo.

`unmount(handleOrRoot)` / `unmountAll()` — React unmount + remove the inner mount point; leaves
`dataset.genuiState = 'idle'` and emits `genui:unmounted`.

`setLocale(locale)` — sets the runtime/global locale, updates `document.documentElement.lang`, and
**remounts every live handle** with that locale's artifact (spec text comes from the locale-specific
artifact; the runtime's i18n is module-global, so a remount *is* the switch). Await it before measuring.

`state()` — `{ base, locale, runtimeReady, engines, mounted, specs }` introspection.
`locale`, `base`, `mountedCount`, `version` are readable properties.

Events (on `window`, `CustomEvent.detail`):

| event | detail | when |
|---|---|---|
| `genui:loading` | `{root, id, assets}` | mount started loading engines/runtime |
| `genui:mounted` | `{root, id, assets}` | runtime `mount()` returned |
| `genui:rendered` | `{root, id}` | first DOM child committed (2 rAF later) |
| `genui:error` | `{root, id, error}` | load/mount failed (error UI already rendered) |
| `genui:unmounted` | `{root, id}` | handle unmounted |
| `genui:locale` | `{locale}` | `setLocale` finished remounting |

---

## 7. CSS contract

- Link `assets/genui/theme.css`; it defines `:root` (`--dsw-static-*`, `--dsw-alias-*`) and the
  `body[data-ds-dark-theme]` override block. **No** `html`/`body`/`#genui-root` rules — the site owns page
  layout and its own `body` styling.
- Renderer components only read `--dsw-*` variables; no `--dsw-*` = unstyled/blank demos.
- The bridge's own placeholder/loading/error styles are injected once (`#genui-bridge-style`) and use
  fallback variables. Map them to site tokens if you want exact art direction:
  `--genui-bridge-line`, `--genui-bridge-surface`, `--genui-bridge-text`, `--genui-bridge-strong`,
  `--genui-bridge-text-3`, `--genui-bridge-accent`, `--genui-bridge-accent-soft`.
- Demo surfaces should set the renderer's font-ish context on the host: the renderer inherits
  `font-family` for text/mermaid measurement, so a `font-family` on the mount host is enough.
- **Gotcha:** `theme.css` keeps upstream `:root { color-scheme: light }`. On a dark page this can flip
  native scrollbars/form controls to light. Add `color-scheme: dark` on `html` in site CSS after
  `theme.css` (safe: all vendored artifacts are `theme:'dark'` and `mount` sets
  `body[data-ds-dark-theme]`, which switches the variables to dark).
- Attribution: theme CSS and engine bundles are from `@changfenhuang/dsh-genui` (MIT) — keep the repo's
  license/notice in the site footer.

---

## 8. Global side effects to watch

1. **`document.body[data-ds-dark-theme]` is global.** `mount` toggles it from the artifact's
   `presentation.theme`; unmount does **not** reset it. All artifacts are built with `theme:'dark'`, so
   the site must be dark-only (mixing light and dark mounts would flip the `--dsw-*` palette for every
   mount at once). `theme.css`'s `body[data-ds-dark-theme]` block assumes at least one dark mount.
2. **Locale is module-global in the runtime.** Do not mount zh and en artifacts side by side and expect
   both to keep chrome language; use `setLocale` + remount (bridge handles it).
3. **Mermaid rendering is IntersectionObserver-gated inside the renderer** (one viewport of lookahead)
   and abort-renders if scrolled away before it finishes. Nothing to configure — but for automated
   screenshots scroll to the mermaid node and *stay* until its `<svg>` appears.
4. **Copy buttons** append a temporary textarea to `document.body` for the clipboard fallback.
   No permission prompts, no network.
5. **KaTeX CSS** is injected into `<head>` once at runtime load (self-contained fonts, ~1 MB of base64
   inside the runtime — it is already counted in the 1.2 MB).
6. **No remote font/network dependency in site assets.** The only off-origin requests possible come from
   *spec authors* pointing `image`/`video` nodes at the repo's own
   `raw.githubusercontent.com/omdsh-dev/dsh-genui/...` media (`externalMedia` in `artifacts.json`). If the
   site should be fully offline, vendor those files and rewrite the spec URLs.

---

## 9. Gotchas that cost time (read before adapting the bridge)

1. **Node cannot import the plugin's TS.** Validation must run through
   `/Users/changfenhuang/projects/dsh-genui/node_modules/.bin/tsx`; plain `node` fails on `.ts` imports.
   The build script imports the repo's own `create.ts`/`parse.ts`/`portability.ts`/`standalone-theme.ts`
   by absolute path — that is deliberate: the site validates with the *renderer's* code, not a copy.
2. **Engine order + silent fallback.** Engines must be registered before the runtime's first render; if a
   needed engine is missing, the node does not throw — it shows a fallback forever (mermaid: source +
   `渲染中…`). `requiredAssets` from `artifacts.json` is the only reliable list (the bridge's fallback
   inference is a convenience, not authoritative for e.g. icon catalogues).
3. **file-tree portability false positive** (upstream): see §3. Filter `file`/`dir` or every file-tree
   spec fails; do not "fix" it by removing file-tree from the deck.
4. **`invalid artifact` ≠ invalid spec content.** The runtime throws only when the artifact
   envelope/spec fails its parser. Unknown node types are silently dropped by the guard by design, so a
   bogus spec can render an *empty* block without any error. The harness's error-path test therefore uses
   an invalid envelope (`presentation.locale:'ja'`).
5. **Fresh React container per mount.** Reusing the same container for `createRoot` across unmount/remount
   invites React's "container already passed to createRoot" warning and listener leaks. The bridge always
   creates a new `.genui-mount` inner div; keep that when adapting.
6. **Mermaid viewport gate** (see §8.3) — the single most confusing failure in automation: mount succeeds,
   `data-genui-state="rendered"`, yet the node still shows the fallback because it is below the fold.
7. **Artifacts are canonicalized.** `createGenuiArtifact` strips `panel`/`append`, sanitizes password
   inputs, and defaults `theme` from the current body attribute — always pass `{locale, theme:'dark'}` in
   the build (it does). Don't hand-edit `artifacts.json`.
8. **GH Pages relative paths.** Everything is relative (`assets/genui/...`); the bridge derives its base
   from its own `<script src>`. Serving `genui-site/` from a subpath works unchanged; don't introduce
   absolute `/dsh-genui/...` URLs.

---

## 10. Harness + verification

```bash
# static server (the Lead's site uses 8899; this harness uses 8901)
python3 -m http.server 8901 --bind 127.0.0.1 --directory genui-site   # background job

# harness in a browser
open http://127.0.0.1:8901/proto/harness.html?auto=1&lang=zh
#   ?auto=1  start every deferred heavy demo immediately (screenshot mode)
#   ?all=1   additionally mount EVERY content spec from assets/genui/artifacts.json
#   ?lang=en english artifacts
#   (no params) instant demos only + click-to-load heavy demos, like the real page

# end-to-end verification + screenshots (Playwright WebKit, same executablePath as .scratch/shot4.cjs;
# blocks every non-localhost request; asserts zero console errors)
node genui-site/scripts/verify-harness.cjs
```

`verify-harness.cjs` checks 37 assertions, including: runtime + engines load; table/chart/quiz/mermaid/echart
render real DOM (`<table>`, `<svg>`, `<canvas>`); heavy demos stay deferred until clicked; **all 84 content
specs mount with non-empty DOM and zero renderer ErrorBoundary**; unmount-all then remount; locale switch
zh→en remounts translated artifacts; invalid artifact shows `role="alert"` and the page survives; zero
console errors/page errors/unexpected off-origin requests; no `/plugins/` or `/__manus__` dependency.

Proof shots in `proto/shots/`: `harness-full-zh.png`, `harness-full-en.png`, `demo-table.png`,
`demo-chart.png`, `demo-quiz.png`, `demo-mermaid.png`, `demo-echart.png`, `deferred-placeholder.png`,
`invalid-artifact.png`, `harness-lifecycle.png`.

---

## 11. Known gaps / for the Lead

- `DESIGN.md` names the bridge `assets/js/genui.js`; the prototype is `assets/js/genui-bridge.js`
  (deliverable naming). Rename on integration or import it as-is (it is a plain global IIFE, no bundler).
- `assets/js/genui.js` (Lead-owned) is already wired against this exact API: hero mount, scroll-driven
  surfaces, playground editor, atlas lazy grid (`mountDeferred` per heavy specimen), and `site:lang` →
  `GenuiBridge.setLocale` + atlas rebuild. Any bridge API change must be mirrored there.
- Suggested next step for the atlas: `mountDeferred(..., {trigger:'visible'})` for heavy specimens so the
  8.4 MB engine pool stays off the wire until a visitor actually scrolls to a heavy node.
- `artifacts.json` is ~334 KB (84 specs × 2 locales, full specs inline). If the site does not want to
  fetch it all up-front, split by category in a future build-script iteration (`--split`), or fetch it
  only when the first demo approaches the viewport. Right now: fetch it once, cache, mount on demand.
- Spec deck is owned by spec-author and may still change; after any `content/specs/` change re-run the
  full build **then** `verify-harness.cjs`. A stale `artifacts.json` is detectable: the verifier prints
  `NOTE N external media URL(s) not yet in artifacts.json`.
- Upstream bug to report to the plugin maintainer (not blocked here): file-tree breaks
  `buildStandaloneHtml` / the export-HTML button for any fence containing a file-tree.
