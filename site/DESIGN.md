# dsh-genui product site — design contract

Status: binding for everyone building this site. If reality forces a deviation, update this file first.

## The thesis

> **The page is the frame. The components are the artwork.**

A visitor should understand in 10 seconds that dsh-genui turns a model reply into a real interface,
and in 60 seconds should *use* one. Every "demo" on the site is rendered by the **actual GenUI
standalone runtime** (`lib/assets/standalone-runtime.js`, `window.__GenuiStandalone__.mount`).
No screenshots of components, no fake app chrome, no hand-built lookalikes.

Corollaries:

1. The site's own chrome is near-monochrome. All color comes from the rendered components.
2. No simulated DSH window, sidebar, fake chat titles, or nested "card inside card inside window".
   The site has its own identity as a page.
3. Every claim shown on the site must be verifiable in the repo. Copy cites capability, not hype.
4. If the renderer is still loading or fails, the page stays beautiful and readable (progressive
   enhancement, explicit fallback copy).

## Visual direction: "Answer → Interface"

Cinematic dark, editorial restraint, one signature transformation.

### Palette

| token | value | use |
|---|---|---|
| `--bg` | `#0a0a0b` | page |
| `--bg-2` | `#0e0f11` | band sections |
| `--surface` | `#131417` | demo surface / cards |
| `--surface-2` | `#191b1f` | raised |
| `--line` | `rgba(255,255,255,0.075)` | hairlines |
| `--line-strong` | `rgba(255,255,255,0.16)` | focus/hover lines |
| `--text` | `#f3f1ec` | primary (warm white) |
| `--text-2` | `#a9a7a1` | secondary |
| `--text-3` | `#6d6c68` | tertiary / captions |
| `--accent` | `#e6d3ac` | champagne: rules, numbers, focus, selection |
| `--accent-soft` | `rgba(230,211,172,0.12)` | tint fills |
| `--ok` / `--warn` | `#7fb98a` / `#d8a55c` | only for real status |

Never introduce a second accent. No blue buttons. No purple gradients. No glassmorphism blur soup.
The renderer's own colors (`--dsw-*` variables) are the only saturated colors on the page.

### Type

- Latin display: **Instrument Serif** (italic allowed) — used for one word/phrase per section max.
- Latin UI/body: **Geist Sans** 400/500/600.
- Mono: **Geist Mono** 400/500 — kickers, versions, code, numerals in evidence.
- Chinese: system stack `"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei"`.
  Never ship a webfont for Chinese. Latin webfonts are self-hosted woff2 in `assets/fonts/`.
- Scale (desktop): display 88–104px / h2 44–52px / h3 22–24px / body 16–17px / caption 12–13px.
  Chinese display lines get `letter-spacing: -0.035em` and `line-height: 0.98–1.06`.
- Eyebrows/kickers: mono, 11–12px, uppercase EN / normal zh, color `--text-3`, tracking 0.14em.

### Layout

- Content max-width 1180px, gutters 24px (16px < 480px). Full-bleed bands allowed.
- Section rhythm: 120–160px vertical padding desktop, 72–96px mobile. Only hairlines and space
  separate sections — no card-in-card borders, no drop shadows on page-level elements.
- Demo surfaces are the only things allowed to elevate (1px border + soft ambient shadow).
- Grid: 12 col desktop, 8 tablet, 4 mobile.

### Motion

- Entrances: 600–750ms, `cubic-bezier(0.16, 1, 0.3, 1)`, translateY 14–24px + opacity, staggered
  60–90ms, once, triggered by IntersectionObserver.
- The signature beat: plain text (a reply) crossfades into a live interface — 520ms total,
  blur(6px) → 0, opacity, 6px rise. Reversible by the user in the hero ("文字 / 界面" toggle).
- No parallax jitter, no autoplay carousels, no marquee longer than one viewport width.
- `prefers-reduced-motion: reduce` → all transforms off, final states shown immediately.

### Depth & texture

- Graphite background with one very soft radial champagne glow per page (not per section).
- 2% film-grain overlay (base64 PNG, `pointer-events:none`, fixed) for cinematic texture.
- Hairline rules: 1px, `--line`. Corner radii: 10–14px on surfaces, 999px on pills.

## Page structure

1. **Nav** — wordmark `genui` + `dsh` badge; links 演示 / 组件 / 文档 / GitHub(★ count) / EN; CTA 安装.
   Hub-ready: a "插件" group that already lists Annotation and the org, so sibling pages can be added.
2. **Hero** — kicker `dsh-genui · Generative UI for DeepSeek Harness · v0.15.0`,
   H1 `回答，成为界面。` (EN: "Replies become interfaces."), lede, two CTAs,
   and the signature **live reply panel** with a 文字 / 界面 toggle that morphs the same answer.
   Panel caption: `真实渲染器渲染 · 非截图` (EN: `Rendered by the real runtime — not a screenshot`).
3. **Manifesto** — 3 short lines, editorial, no cards. Explains the mechanism: a ```dsh-ui fence.
4. **Surfaces** — same data, three surfaces (文字 / 表格 / 图表), scroll-driven, real renderer.
5. **Playground** — editable fence on the left, live render on the right, preset chips, copy button,
   honest error state. This is the proof section.
6. **Atlas** — every whitelisted node as a live specimen, grouped, filterable, lazy-mounted.
7. **Action loop** — click → action → model turn → new interface, shown as one minimal diagram plus
   a working local example.
8. **Evidence** — real media from the repo (showcase pngs / demo mp4), compatibility, tests, export.
9. **Install** — one command with copy, requirements, doc links.
10. **Footer** — Oh My DSH family, license, unofficial disclaimer, star CTA.

## Copy voice

- zh: short declarative sentences, no exclamation marks, no "一站式/赋能/革命性".
- en: same voice, lowercase kickers, no marketing superlatives.
- Numbers must be true and dated from the repo. Never round a star count up or invent a metric.
- Every section title is a claim, not a label: "回答，成为界面。" not "功能特性".

## Copy keys (the i18n contract)

`meta.title`, `meta.description`, `nav.demo`, `nav.components`, `nav.docs`, `nav.plugins`,
`nav.github`, `nav.install`, `nav.lang`
`hero.kicker`, `hero.titleLine1`, `hero.titleLine2`, `hero.lede`, `hero.ctaPrimary`,
`hero.ctaSecondary`, `hero.panelCaption`, `hero.toggleText`, `hero.toggleUi`, `hero.scroll`
(note: the canonical implemented deck is `content/copy.zh.json` / `content/copy.en.json`; this list is the design-time draft)
`manifesto.kicker`, `manifesto.line1..3`, `manifesto.note`
`surfaces.kicker`, `surfaces.title`, `surfaces.lede`, `surfaces.step1..3`, `surfaces.caption`
`playground.kicker`, `playground.title`, `playground.lede`, `playground.editorLabel`,
`playground.previewLabel`, `playground.presetsLabel`, `playground.copy`, `playground.copied`,
`playground.invalid`, `playground.reset`, `playground.hint`, `playground.preset.*`
`atlas.kicker`, `atlas.title`, `atlas.lede`, `atlas.count`, `atlas.all`, `atlas.group.*`,
`atlas.specLabel`, `atlas.copySpec`, `atlas.note`
`action.kicker`, `action.title`, `action.lede`, `action.step1..4`, `action.demoPrompt`,
`action.demoAction`, `action.demoResult`, `action.reset`
`evidence.kicker`, `evidence.title`, `evidence.card1..4.title`, `evidence.card1..4.body`,
`evidence.compat.label`, `evidence.compat.value`, `evidence.tests.label`, `evidence.tests.value`,
`evidence.license.label`, `evidence.license.value`, `evidence.export.label`, `evidence.export.value`
`install.kicker`, `install.title`, `install.lede`, `install.copy`, `install.copied`,
`install.req.*`, `install.links.*`
`footer.tagline`, `footer.plugins`, `footer.docs`, `footer.community`, `footer.license`,
`footer.disclaimer`, `footer.next`
`ui.copy`, `ui.copied`, `ui.close`, `ui.loading`, `ui.error`

## Technical rules

- Static site. No framework, no bundler for site code. Vanilla HTML/CSS/JS modules.
- `assets/genui/` is **vendored/generated** (runtime, engines, theme.css, artifacts.json) — produced
  by `scripts/build-site.mjs` from `~/projects/dsh-genui/lib/**`; never hand-edited.
- Site CSS must not inherit the renderer's global `body` rules: vendor theme is included for the
  `--dsw-*` variables only, then site CSS defines its own `body`.
- Demos mount through one bridge (`assets/js/genui.js`): lazy-load runtime once, preload only the
  engines a demo needs, `mount(root, artifact)`, unmount on dispose, remount on language change.
- All interactive controls: real `<button>`/`<a>`, visible `:focus-visible` ring in `--accent`,
  keyboard operable, `aria-*` where needed. No divs with click handlers.
- Budgets (measured): HTML 8.4 KB gz, CSS 11.9 KB gz, site JS 18.1 KB gz, fonts 140 KB, renderer lazy (≈1.2 MB once, per-spec engines on demand).
  Renderer + engines are lazy and never block first paint. LCP must be text, not the demo.
- Works at 390px, 768px, 1024px, 1440px, 1920px. No horizontal scroll anywhere.
- Both `lang=zh` and `lang=en` must be complete; no untranslated strings, no layout overflow in EN.
- Nothing may reference `/__manus__`, manus analytics, or absolute `/dsh-genui/` asset paths
  (relative paths only, so the site works under any GH Pages subpath).
