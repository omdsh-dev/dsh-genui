# dsh-genui product site

The marketing/product site for [`dsh-genui`](https://github.com/omdsh-dev/dsh-genui) — a DeepSeek Harness
plugin that turns model replies into real interfaces.

**Thesis: the page is the frame, the components are the artwork.**
Every demo on this page is rendered by the plugin's **actual standalone renderer**
(`lib/assets/standalone-runtime.js` via `window.__GenuiStandalone__.mount`), not by screenshots or
lookalikes. Site chrome stays monochrome; all colour comes from the real components.

Direction: **"Answer → Interface"** — cinematic dark, editorial restraint, one signature beat: a plain
answer that becomes a live interface. Chinese-first with an English toggle.

## What is here

```
index.html                  the page (single document, zh authored inline)
assets/css/                 base (tokens/type/atmosphere) · shell (nav/footer) · hero · sections
assets/js/site.js           nav, reveal, language, hero morph orchestration, copy buttons
assets/js/genui.js          page ↔ bridge integration: hero, surfaces, playground, atlas, locale
assets/js/genui-bridge.js   renderer loader/mount bridge (window.GenuiBridge)
assets/i18n/en.json         English dictionary (zh is the authored HTML)
assets/fonts/               self-hosted Geist Sans/Mono + Instrument Serif (latin subsets)
assets/img/                 real repo media, vendored: demo.mp4, showcase stills, posters, og
assets/genui/               GENERATED — renderer, engines, theme.css, artifacts.json (gitignored)
content/specs/              84 dsh-ui specs: hero, surfaces, presets, showcases, 60 atlas specimens
content/copy.*.json         bilingual copy deck (zh reference + en source)
content/components.json     the 60-node inventory the atlas filter/labels use
content/facts.md            every number on the page with the file:line that proves it
proto/                      bridge proof harness (BRIDGE.md + screenshots) — not part of the page
scripts/build-site.mjs      validates specs, vendors the renderer, emits artifacts.json + theme.css
scripts/verify-harness.cjs  37-check end-to-end proof in WebKit
```

## Build

Requires the plugin checkout (sibling repo) and its `tsx`:

```bash
# validate every spec + vendor runtime/engines + write artifacts.json and theme.css
/Users/<you>/projects/dsh-genui/node_modules/.bin/tsx scripts/build-site.mjs

# validation only, writes nothing (CI gate / spec loop)
/Users/<you>/projects/dsh-genui/node_modules/.bin/tsx scripts/build-site.mjs --check
```

Override the plugin location with `DSH_GENUI_REPO=/path/to/dsh-genui`.

Preview:

```bash
node scripts/serve.cjs . 8902
# → http://127.0.0.1:8902/
```

(`python3 -m http.server` also works for browsing, but it can drop large concurrent responses in
sandboxed environments — use the Node server when running `scripts/verify-harness.cjs`.)

The plugin must be built first (`pnpm build` in the plugin repo) so `lib/assets/standalone-runtime.js`
exists and matches `src/`. CI does this automatically before calling `build-site.mjs`.

## How a demo works

1. `content/specs/<id>.json` = `{ id, category, zh: GenuiSpec, en: GenuiSpec }`.
2. `build-site.mjs` validates it through the plugin's own `createGenuiArtifact` / `parseGenuiArtifact`
   chain, computes its required engines, and writes a locale-keyed artifact into
   `assets/genui/artifacts.json`.
3. `genui.js` loads that JSON, calls `GenuiBridge.mount(host, record, { locale })`; the bridge loads
   only the engines that spec needs (engines first, then the runtime) and mounts the real renderer.
4. Heavy engines (mermaid 3.3 MB, three 684 KB, maplibre 1.6 MB, echarts-full 1 MB) are deferred:
   atlas cards render on click, curated compositions on scroll.
5. Language switch remounts every live handle with the other locale's artifact.

## Rules

- Never commit `assets/genui/**` (generated) or `site/anthology.html` (generated in CI).
- Never hand-edit `assets/genui/**`; run the build.
- Never add a demo that is not produced by the real renderer.
- Specs: `span` cannot be 1 (the renderer clamps to ≥2); one-column children omit `span`.
- Copy numbers come from `content/facts.md` only. `60` node types and `2,106` tests are verified;
  the installable npm release is `0.15.0` (repo main is ahead — the compat card says so).
- Both locales must stay complete; `ui.copied`, `meta.title`, `meta.description` also live in the deck.
- Keep the initial payload small: HTML+CSS+site JS ≈ 40 KB gzipped, fonts ≈ 140 KB, renderer lazy.

## Known limitations

- The vendored renderer under `assets/genui/` is a build artifact: a stale local `lib/` shows fewer
  node types (CI rebuilds first). The site degrades gracefully with a note on those cards.
- Locally the atlas anthology link points at the deployed Pages URL.
- `file-tree` specs trip an upstream `analyzeGenuiPortability` false positive; the site build filters
  exactly `file`/`dir` record types (documented in `scripts/build-site.mjs`).
