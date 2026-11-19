# dsh-genui — verified facts for the new product site

Audit date: **2026-11-09** (Asia/Shanghai). Auditor: content-editor.
Sources (read-only): local checkout `/Users/changfenhuang/projects/dsh-genui` at commit
`c2624ce0e08fd18510bef640168fcb81e817ed58` (git describe `v0.15.0-66-gc2624ce`, working tree
clean except 3 untracked docs), the npm registry, `gh api`, and the GitHub Actions API.

Rule of this file: **every number that may appear in copy is listed here with its proof.** Anything
that could not be proven is in §13 UNVERIFIED — never put those in copy.

---

## 1. Version and release state

| Claim | Verified value | Proof |
|---|---|---|
| Installable (published) version | **0.15.0**, published 2026-10-28T05:20:43Z | `registry.npmjs.org/@changfenhuang%2Fdsh-genui` → `dist-tags.latest = 0.15.0`; 23 versions total; last 4 publishes: 0.13.0, 0.14.0, 0.15.0 |
| GitHub release | **v0.15.0** (Latest, 2026-10-28T05:01:18Z) | `gh release list --repo omdsh-dev/dsh-genui`; highest git tag is `v0.15.0` |
| Repo package version | `0.16.0` in `package.json:4`, **not published** | `gh api repos/omdsh-dev/dsh-genui/commits/main` = c2624ce, msg “release: prepare GenUI 0.16.0 with DSH rc.5 acceptance”; npm has **no 0.16.0** version; no `v0.16.0` tag or release |
| Canonical npm name | **`@changfenhuang/dsh-genui`** | `package.json:2`; README badge L13; README install block L90; `scripts/install.sh:26` |
| GitHub repo | `omdsh-dev/dsh-genui` (org stays `omdsh-dev`, npm scope is personal) | `package.json:62-70`; CHANGELOG:439 |

**Copy must say v0.15.0** (that is what `dsh plugin add` installs today). If the site is deployed
after 0.16.0 is published, this table must be re-audited first.

### 1a. Rename history (only needed if copy mentions legacy installs)

`@dsh-external/dsh-genui` (initial OSS name) → `@omdsh-dev/dsh-genui` (CHANGELOG:530, “发布前最终改名”)
→ `@changfenhuang/dsh-genui` (CHANGELOG:439, npm scope moved to the personal account; GitHub repo kept
in `omdsh-dev`). README migration note (README.md:116-120) only covers the `@omdsh-dev` → current step.
The site copy does not need any legacy alias.

---

## 2. Install — the one command that actually works

```sh
dsh plugin --profile web add @changfenhuang/dsh-genui
```

Proof: README.md:90 and `scripts/install.sh:133` use exactly this argument order. **Option order is
load-bearing**: `dsh plugin --help` says `Usage: dsh plugin [options] [args...]` and `args` are
“forwarded verbatim” to pnpm, so `--profile` must come **before** `add`. Tested 2026-11-09:
`dsh plugin add @changfenhuang/dsh-genui --profile web` fails with
`error: required option '--profile <name>' not specified` (the trailing tokens are treated as pnpm args).
`dsh plugin --profile web add …` reached the profile lock step (blocked by the sandbox from writing to
`~/.dsh/profiles/web/`, which is expected in this environment and proves parsing succeeded).

npm alternative (dependency only — **does not register the plugin**):

```sh
npm install @changfenhuang/dsh-genui
```

Proof: README.md:92-94 (“npm install only adds the dependency and does not register the plugin”),
CHANGELOG:400.

### 2a. Prerequisites (all verified; the old site snippet omitted them)

| Requirement | Value | Proof |
|---|---|---|
| DSH version | `^0.2.0-rc.1 || ^0.2.1-rc.1 || ^0.2.2-alpha.2` | `package.json:82-87` peerDependencies; `package.json:214` engines.dsh; README.md:81 |
| Node.js | `^22.19.0 || >=24.0.0` (so: 22.19+, or 24+) | `package.json:215` |
| pnpm | required on PATH by the `dsh plugin` CLI; repo pins `pnpm@11.7.0`, engines `>=11.7.0 <12` | `package.json:212-216`; README.md:82; `scripts/install.sh:107-112` (fails with `corepack enable` hint) |
| After install | restart the web host + hard refresh the browser | README.md:98-99; `scripts/install.sh:144-149` |

`dsh plugin` is also how users activate it (`dsh plugin --profile web add` reconciles the profile's
bundles); the plugin declares its own bundle patch in `package.json:203-211`
(`"dsh": { "bundle": { "patch": "./cordis.patch.yml" }, "client": { "platform": "web" } }`).

---

## 3. Vocabulary: **60** whitelisted node types

Verified three independent ways on 2026-11-09:

1. Runner import of the real schema (`tsx` importing `src/client/genui-runtime/schema.ts`):
   `Object.keys(COMPONENT_SCHEMAS).length === 60` and `GENUI_NATIVE_TYPES.size === 60`
   (`schema.ts:325` raw table, `:478` normalized map, `:485` native-type set; `spec.ts:1-6` documents
   the vocabulary as a white list).
2. The site's own bridge artifacts, generated 2026-11-09T07:45Z by `genui-site/scripts/build-site.mjs`
   (`scripts/build-site.mjs:427` prints `vocabulary 60 whitelisted node types`): `genui-site/assets/genui/artifacts.json`
   records `nodeTypeCount: 60` and a 60-entry `nodeTypes` array. That file currently holds **84 rendered
   specs** (60 atlas + 15 showcase + 6 playground + 2 surface + 1 hero) — note that 84 is the *spec*
   count, **not** a node-type count, and is the most likely origin of the old site's wrong “84”.
3. `genui-site/content/components.json` (this deck) enumerates the same 60 types, grouped for the atlas.

Full list (alphabetical):
`accordion, arrow, audio, avatar, badge, blocks, breadcrumb, button, callout, card, carousel, chart,
checkbox, choices, code, col, compare, copy, date-picker, diagram, diff, divider, echart, editor,
entity-card, file-tree, grid, hero, icon, image, image-group, input, json, keyvalue, link, list, map,
mermaid, plot, popover, progress, quiz, radio, row, scene3d, segmented-control, select, slider, spacer,
stat, steps, submit, svg, switch, table, tabs, text, textarea, timeline, video`

**Critical caveat for copy:** the **published 0.15.0** package contains only **51** of these. The nine
added on the repo's 0.16.0 line (not yet on npm) are: `choices, compare, date-picker, editor,
entity-card, file-tree, image-group, popover, segmented-control`. (Verified by extracting the schema
table from tag `v0.15.0` and diffing it with HEAD: 51 vs 60.)

Judgement: the site renders from the repo main-branch renderer, so **60 is the truthful count for what
the page itself shows**, and the lead has adopted 60 in `index.html`. `evidence.compatBody` in
`index.html` now carries the one-line release-lag note (“npm 最新发布为 0.15.0；本站由仓库主分支渲染器
绘制，因此组件数领先一版”) — keep that note if 60 ships, otherwise a careful reader can catch the gap.

Docs that must **not** be used as count sources:
- `SKILL.md:36-40` summary vocabulary lists **58** types (omits `choices` and `map`, although both are
  documented later in the same file, `SKILL.md:107` and `docs/map.md`).
- `README.md:131,142` says “30+ Component Ecosystem” — a stale marketing sentence.
- The previous product site said **84**; no file in the repo has any 84-type claim. That number was
  invented and must never reappear.

---

## 4. Tests and CI

| Claim | Verified value | Proof |
|---|---|---|
| Unit tests | **2,106 passed / 152 spec files** (vitest, jsdom) | GitHub Actions job log, run `41602237925`, job “check (22, dsh-v0.2.1-rc.3, current)”, main @ **c2624ce**, 2026-11-03T08:24Z: `Test Files 152 passed (152)`, `Tests 2106 passed (2106)` |
| Test command | `pnpm run check` on every CI push/PR (runs `tsc` + `vitest run` + build + standalone/map asset checks) | `.github/workflows/ci.yml:88`; `package.json` scripts `check` |
| Newer open PR (not main) | 2,117 tests / 154 files | CI run `42171764774` on open PR #419 (2026-11-06); not merged, so **do not use 2,117** |
| What the tests cover (usable wording) | spec/schema validation, streaming fence rendering, focus handling, URL/media policy | test files: `tests/genui-media.spec.tsx`, `tests/dom-fence-*.spec.tsx` (streaming), `tests/genui-image-group*.spec.tsx`/`gallery-*` (focus), `tests/validate*`/`genui-*.spec.tsx` (validation) |

Caveat to know: the main CI **run** is red because an unrelated lane failed
(“published-current” host-install step, `Error: An error occurred while trying to read the map file at
index.js.map`), while the `check` test lane passed. If the site says “CI 绿灯” that would be false; say
“2,106 条测试通过” and link the Actions page instead.

The old site claimed **253** tests — that was real in 2026-08 (`CHANGELOG` for 0.8.x era) and is now
wrong by ~8×. It must not ship.

---

## 5. Repo / package metrics (date-stamped)

| Metric | Value | Proof |
|---|---|---|
| GitHub stars | **941** (2026-11-09T07:29Z) | `gh api repos/omdsh-dev/dsh-genui --jq .stargazers_count` |
| Forks | **89** | same call, `.forks_count` |
| Watchers | 2 | same call, `.subscribers_count` |
| Open issues | 23 | same call, `.open_issues_count` |
| Repo created | 2026-08-13 | same call, `.created_at` |
| License | **MIT** | `LICENSE:1-3` (Copyright (c) 2026 dsh-external); `package.json:61`; `gh api` `.license.spdx_id = "MIT"` |
| Repo size / package | host plugin + browser renderer + skill + docs (see §7) | `package.json:1-3`, `:29-58` (`files`) |

Stars are fetched live by `assets/js/site.js:223-245` with the baked value as fallback
(`index.html:101,151,588` = 941). Copy must not round up (“1k” is fine as a live-rendered format, but
never hardcode a bigger number).

---

## 6. Filesystem / media facts (details in `media.md`)

| Asset | Value | Proof |
|---|---|---|
| `assets/demo.mp4` | 1152×720, **53.1 s**, H.264 + AAC, 2,608,997 bytes | `mdls assets/demo.mp4` (README calls it “40-Second Walkthrough” — stale; **do not say 40 s**) |
| `assets/demo-thumb.png` | 960×600 PNG, real DSH dark-theme capture **with a large white circular play overlay and no glyph** | visual inspection; crop verified |
| `assets/showcase.png` | 1440×800, light-theme real capture: 3 stat cards (在线率/CPU/内存), ring progress 72 %, 性能指标 table, 清单 list | README.md:60-63 captions |
| `assets/showcase-panel.png` | 1440×980, light-theme real capture: stat cards + filterable service table + grouped totals + spark/ring cells + main-detail table | README.md:60-63 captions |
| `assets/showcase-plot.png` | 1440×800, light-theme real capture: two-curve `plot` (“波动叠加”) with parameter slider | README.md:60-63 captions |
| Real-vs-mock | All three showcase PNGs and the mp4 are **real DSH captures**, per README.md:41 (“no conceptual mockups or faked pre-renders”) | |
| `docs/screenshots/*.png` | 4 diagnostic captures (achievements, template-center, issue-159 before/after, issue-183 wordcloud/svg); include DSH chrome / issue text / personal session titles | visual inspection |

---

## 7. What actually ships in the npm package

`package.json:29-58` (`files`) plus `exports` (`:10-35`):

- **Host plugin** — `lib/index.js`, skill registration, fence feedback, panel/tool surface
  (entry `package.json:7`; `exports["."]` `:11-14`).
- **Browser renderer (client half)** — `lib/client.js` (~996 KB on disk); React 18 renderer, CSS modules,
  KaTeX math, i18n dictionaries (`src/client/i18n/runtime.ts`).
- **genui skill** — `SKILL.md` (fence vocabulary + usage rules), synced into the user's skill roots by
  `scripts/install.sh:30-100`.
- **Lazy engine assets** — `lib/assets/mermaid.js` (3.4 MB), `three.js` (700 KB),
  `echarts-core.js` (588 KB), `echarts-full.js` (1.0 MB), `maplibre.js` (1.7 MB), `icons.js` (969 KB).
  Loaded only when a spec contains the matching node type (`src/client/asset-loader.ts`,
  `src/client/artifact/portability.ts` maps node type → required asset).
- **Standalone runtime** — `lib/assets/standalone-runtime.js` (1.2 MB), exported as
  `@changfenhuang/dsh-genui/assets/standalone`, used by the new site's bridge.
- **Docs in the package** — `README.md`, `README.zh-CN.md`, `CHANGELOG.md`, `SKILL.md`,
  `docs/gallery.md`, `docs/copy-preview.md`, `docs/dsh-go.md`, `docs/map.md`, `ICON-NAMES.md`,
  `demo-prompts.md`, `THIRD_PARTY_NOTICES.md`, icon/logo SVG.
- Runtime dependencies: `katex`, `mdast-util-from-markdown`, `react` (`package.json:73-77`).

---

## 8. Locales, themes, export, panel

| Claim | Verified value | Proof |
|---|---|---|
| Renderer locales | **en + zh** (both dictionaries ship; en is the per-key fallback) | `src/client/i18n/runtime.ts:34` `LOCALE_IDS = ['en','zh']`; `:13-20` resolution order |
| Standalone artifact locale | `presentation.locale: 'en' \| 'zh'` | `src/client/artifact/types.ts:16`; `src/client/artifact/parse.ts:23`; runtime calls `setLocale(...)` `src/client/standalone/runtime.tsx:14` |
| Themes | **light + dark** (`presentation.theme`, host `body[data-ds-dark-theme]`), all surfaces follow the host theme | `artifact/types.ts:9`; README.md:174 + theming section README.md:326-348 |
| Export/standalone | **Standalone `.html`** (inlines renderer, theme CSS, KaTeX fonts, required engines) and **`.genui.json`** (normalized spec + interaction state) | README.md:264-268; implementation `src/client/artifact/html.ts`, `portability.ts`, `types.ts:5` (`format: 'dsh-genui'`, version 1) |
| Export limits | exported media keeps its URL (image bytes are **not** inlined) | `docs/gallery.md` “Standalone export … does not embed image bytes” |
| Panel behavior | `panel: true` renders into the session dock and updates in place; `append: true` merges into the existing panel; caps 200 nodes / 200 appends, then a `replace` is needed; panel actions come back as a `panel:true` fence | `src/plugin/index.ts:132`; README.md:174 |
| Panel entry | `/panel` command or `render_ui` tool card | README.md:174; `package.json` dshGo panel contract |

---

## 9. Security and URL policy (usable claims)

| Claim | Verified value | Proof |
|---|---|---|
| Vocabulary is a whitelist, no arbitrary HTML path | renderer maps each node to DOM directly | `src/client/spec.ts:1-6` |
| Math is evaluated without `eval`/`new Function` (whitelisted functions/constants only) | yes | `src/client/safe-math.ts:1-10` |
| Mermaid injection point is sanitized twice | mermaid runs at strict security level, then rendered SVG is re-scanned and refused on `<script`, `on*=` or `javascript:` | `src/client/mermaid-core.ts:1-15`, `src/client/mermaid-safe.ts:1-20` |
| ECharts options are sanitized | tooltip HTML mode forced to `richText`; script/on-handler/`javascript:` payloads refused | `src/client/guard.ts:1415-1480` |
| Link policy | only `http(s)` and `mailto` become clickable (max 2048 chars); anything else renders as plain text | `src/client/genui-runtime/value-utils.ts:27-32` |
| Media policy | image/audio/video src accepts `http(s)` or same-origin relative only; `file:`, `data:`, `javascript:`, protocol-relative and control characters refused | `value-utils.ts:35-45`; `guard.ts:2422,2460` |
| Secrets | passwords / API keys / tokens / recovery codes are refused by policy | `SKILL.md:99` (秘密禁令); README.md:180 |
| Bad node isolation | malformed nodes are dropped while siblings render | README.md:184 |
| Same-turn repair | invalid fences are reported back to the model within the same turn | README.md:182; `src/plugin/fence-feedback.ts:38-60,151` |

**Do not claim “XSS-proof” or “sandboxed” in an absolute sense.** The accurate claims are: whitelisted
node vocabulary, no arbitrary-HTML path for model JSON, scheme-restricted links/media, sanitized
mermaid/ECharts, refused secret collection.

---

## 10. Other verified counts (safe to use sparingly)

| Claim | Value | Proof |
|---|---|---|
| Built-in icon glyphs | **749** total = 64 inline + 685 lazy-loaded (OpenAI Apps SDK UI, MIT) | `ICON-NAMES.md:1`; `src/client/icons/icon-data.ts` (`ICONS` = 64 entries, verified by count), `src/client/icons/icon-data-full.ts` (`ICONS_FULL` = 749 entries, verified by count); CHANGELOG 0.14.0 entry |
| `diagram` kinds | **27** | `schema.ts:82-86` `DIAGRAM_KINDS.length === 27` (runtime-verified) |
| `echart` presets | **14** (bar, line, area, pie, scatter, radar, gauge, funnel, treemap, sankey, graph, heatmap, bigline, wordCloud) | `schema.ts:83-87` `ECHART_PRESETS.length === 14`; `SKILL.md:92-94` |
| `chart` kinds | 3 (bars, line, donut) | `schema.ts:68`; `SKILL.md:90` |
| Node/depth caps | **200 nodes, depth 8** per fence; table 50 rows × 12 cols; carousel/image-group 24; scene3d 1–5 meshes | `src/client/genui-runtime/limits.ts:4,6,25-45`; `SKILL.md:390`; `src/plugin/index.ts:125` |
| Inline rich text | code / bold / highlight / link / `\n` inside text fields | `SKILL.md:183-195` |
| KaTeX math | inline `$…$` / display `$$…$$`; matrices, multi-line | `SKILL.md:32` |

---

## 11. Copy deck (this deliverable) — key list and mapping

Files: `genui-site/content/copy.zh.json`, `genui-site/content/copy.en.json`.
Both are flat dotted-key JSON with **identical key sets** (128 keys): the 126 keys the current
`index.html` needs (125 in the markup + `ui.copied`) plus `meta.title` / `meta.description`
(the document `<title>` and meta description are currently hardcoded zh in `index.html:8-24` and must
switch language too — that is why they are in the deck).

Attribute keys use the `aria-label:<key>` form the lead specified, e.g.
`"aria-label:nav.aria": "主导航" / "Main navigation"`. **Wiring note:** `assets/js/site.js:32`
currently looks up `en['attr:'+attr] ?? en[key]`; it must become
`en[attr + ':' + key] ?? en[key]` for this key form to resolve.

### 11a. Where my zh differs from the current inline zh in index.html (flagged, 5 keys + 3 additions)

| Key | index.html now | `copy.zh.json` | Why |
|---|---|---|---|
| `hero.ledeBefore` / `hero.ledeAfter` | `一段 ` / ` 围栏，让模型的回答直接长成可排序的表格、可拖动的图表、可作答的测验。渲染发生在浏览器里，互动不必等模型。` | `一段 ` / ` 围栏，让回答长成可排序的表格、可拖动的图表、可作答的测验。` | DESIGN caps the hero lede at 42 zh chars; the current string is 57. The dropped sentence (“渲染发生在浏览器里，互动不必等模型”) is already the claim of `manifesto.p2`, so nothing is lost. New total: 39 chars. |
| `evidence.testsBody` | `152 个文件，覆盖类型、规格、流式渲染、焦点与 URL 策略。` | `152 个测试文件，覆盖规格校验、流式渲染、焦点与 URL 策略。` | The 2,106 number is vitest; “类型” (tsc) is a separate step of `pnpm check`, not part of those 152 files. Precision fix. |
| `evidence.exportBody` | `…面板数量都有硬上限…` | `…面板大小都有硬上限…` | The verified caps are panel size (200 nodes / 200 appends), not a count of panels (`src/plugin/index.ts:132`). |
| `footer.tagline` | `…是 Oh My DSH 社区里的一个开源插件…` | `…是 omdsh-dev 组织维护的开源插件…` | “Oh My DSH 社区” is not verifiable in the repo; the repo org (`omdsh-dev`) and MIT license are. Change it back only if brand wants the community framing. |
| (new) `meta.title`, `meta.description` | hardcoded zh in `index.html:<head>` | added | `<title>`/OG must switch with the language toggle. |
| (new) `ui.copied` | JS hardcodes `'Copied' : '已复制'` (`site.js:259`) | added | was in the lead's key list; wire the copy button to it. |

All other 123 zh values are byte-identical to the inline text in `index.html` (including the leading
space in `hero.ledeAfter` and the trailing space in `hero.ledeBefore`).

### 11b. DESIGN.md “Copy keys” → implemented keys (reconciliation)

DESIGN.md is older than `index.html`; the markup renamed most keys. To update DESIGN.md first (per its
own rule), map as follows:

| DESIGN.md key(s) | Implemented key(s) |
|---|---|
| `meta.title` / `meta.description` | same (now in deck) |
| `nav.demo`, `nav.components`, `nav.docs`, `nav.plugins`, `nav.install` | same |
| `nav.github`, `nav.lang` | not needed: star link has literal `GitHub`, language buttons have literal `中` / `EN`; aria labels are `aria-label:nav.aria` / `aria-label:nav.langAria` |
| `hero.kicker` | hardcoded eyebrow `Generative UI for DeepSeek Harness` (+ version in `.hero__meta`) |
| `hero.titleLine1`, `hero.titleLine2` | same |
| `hero.lede` | split into `hero.ledeBefore` + `<code>dsh-ui</code>` + `hero.ledeAfter` |
| `hero.ctaPrimary`, `hero.ctaSecondary`, `hero.panelCaption`, `hero.toggleText`, `hero.toggleUi`, `hero.scroll` | same |
| `manifesto.kicker` / `line1..3` / `note` | folded into `manifesto.index`, `titleLine1/2`, `p1/p2`, `mech1..3Title/Body` |
| `surfaces.kicker` / `title` / `step1..3` | folded into `surfaces.index`, `titleLine1/2`, `step1..3Title` (+ new `step1..3Body`) |
| `playground.kicker` / `title` | folded into `playground.index`, `titleLine1/2` |
| `playground.presetsLabel` | `aria-label:playground.presetsAria` |
| `playground.preset.*` | `playground.presetDashboard/Table/Quiz/Form/Flow/3d` |
| `playground.copied` | `ui.copied` (shared) |
| `playground.invalid` / `hint` | not wired in markup (renderer bridge supplies its own error/loading UI); keep `ui.error` / `ui.loading` for it |
| `atlas.kicker` / `title` | `atlas.index`, `titleLine1/2` |
| `atlas.count` | covered by `hero.metaNodes` + `atlas.titleLine1` (60) |
| `atlas.group.*` | `atlas.groupLayout/Display/Chart/Interactive/Advanced` (same five ids) |
| `atlas.specLabel` / `copySpec` | not in markup yet (atlas drawer is client-rendered) |
| `action.kicker` / `title` | `action.index`, `titleLine1/2` |
| `action.demoPrompt/Action/Result/Reset` | not in markup (local demo controls not built yet) |
| `evidence.kicker` / `cardN.title/body` | `evidence.index` + the four proof cards (`compatLabel/Body`, `testsLabel/Unit/Body`, `exportLabel/Value/Body`, `linksLabel`) + `videoCaption` |
| `evidence.{compat,tests,license,export}.label/value` | compat: hardcoded value in markup + `compatLabel`; tests: number hardcoded + `testsLabel/testsUnit`; license: literal `MIT` in hero/footer (no card); export: `exportLabel/Value` |
| `install.kicker` / `title` | `install.index`, `titleLine1/2` |
| `install.req.*` | labels `install.req1..3Label`; values hardcoded in markup (see §12 for correct values) |
| `install.links.*` | `install.linkReadme` / `install.linkSkill` |
| `footer.plugins` / `docs` / `community` / `license` | `footer.colProduct/colDocs/colCommunity`; license is literal `MIT License` in `footer__legal` |
| `footer.next` | not needed |
| `ui.copy` / `ui.copied` / `ui.close` / `ui.loading` / `ui.error` | `ui.copied` in deck; the others are unused by current markup (bridge can wire them) |

Length contract kept for the deck: zh hero lede 39 chars (≤42), en hero lede 97 chars (≤120), all zh
section ledes ≤ 90; no exclamation marks; en kickers lowercase; no superlatives.

---

## 12. Numbers that appear in copy (single source)

| Where | Value | Citation |
|---|---|---|
| Hero meta `v0.15.0` | 0.15.0 | §1 npm `dist-tags.latest` |
| Hero meta / atlas “60 节点” | 60 | §3 |
| Hero/footer stars `941` | 941 @ 2026-11-09 | §5 `gh api` |
| Evidence tests `2,106` + “152 个文件/测试文件” | 2,106 / 152 | §4 Actions job log, main @ c2624ce |
| Evidence compatibility string | `^0.2.0-rc.1 \|\| ^0.2.1-rc.1 \|\| ^0.2.2-alpha.2` | §2a |
| Evidence “单文件 HTML” export | true | §8 |
| Footer license “MIT” | true | §5 |
| Install requirements (hardcoded in markup) | DSH peer range; Node 22.19+/24+; pnpm on PATH; web profile | §2a |
| Action section payload example | `{"type":"button","label":…}` inside `[genui-action] …` — **needs markup fix**, see §12a | |
| Hero/surfaces demo content (18 tasks, 3.4 days, 本周交付…) | **illustrative sample data**, not product metrics | — (write “示例数据” in a caption if the design allows) |

### 12a. The action payload block in `index.html` must be replaced

The block currently shown as “模型收到的内容” (index.html:~454-460) is invented:
`{"type":"action","name":"regenerate","block":"chart-1","path":"panel.orders","state":{"range":"24h"}}`
does not occur anywhere in the implementation. The real, user-visible serialization of a button click
(rendered through the shipped i18n runtime, `src/client/i18n/zh.ts:368-370` /
`src/client/i18n/en.ts:373-375`, template `action.inline` + `action.payload`) is, verbatim:

zh (action name `refresh`, node label `刷新数据` — single line, no newlines):

```text
[genui-action] refresh。用户刚刚在界面中触发了动作 "refresh"，请根据组件数据执行相应操作，并用 dsh-ui 输出更新后的界面。 组件数据: {"type":"button","label":"刷新数据"}
```

en (same node in an English UI, label `Refresh data`):

```text
[genui-action] refresh. The user just triggered this action "refresh" in the interface. Carry it out using the component data, then reply with an updated dsh-ui fence. Component data: {"type":"button","label":"Refresh data"}
```

Notes for the site copy:
- It is a **normal user turn**: `conversation.send(text)` (`src/client/index.tsx:100-111`), no extra
  wrapper, no JSON envelope, no markdown — the message above is the entire visible/sent content.
- The payload comes from the clicked node: a `button` sends `{type:'button', label}` exactly
  (`src/client/blocks/render-node.tsx:396`). Slider/switch/checkbox/radio/submit send their own
  `{type:…, value/checked/answers/fields/…}` shapes (`src/client/blocks/forms.tsx:64-273`).
- The action name appears twice in the sentence (that is the shipped template, not a typo).
- The payload suffix includes a **leading space** before `组件数据:` / `Component data:`.

A truthful short version for the site's code block could be:

```text
[genui-action] refresh
组件数据: {"type":"button","label":"刷新数据"}
```

(and the en block: `[genui-action] refresh` / `Component data: {"type":"button","label":"Refresh data"}`).
If the design wants pure JSON, label it “节点回传的数据 / payload” and show only
`{"type":"button","label":"刷新数据"}` — never the invented object above.

---

## 13. UNVERIFIED / do-not-ship

| Item | Status | Note |
|---|---|---|
| “84 whitelisted node types” (old site / task brief) | **FALSE** | real count 60 (§3). Never ship. |
| “80+ node types” (brief) | **FALSE** | same. |
| “253 tests” (old site) | **FALSE today** | real 2,106 (§4). Old 253 was true around v0.8.x. |
| “40-second walkthrough” | **FALSE** | file is 53.1 s (§6). Say 53 s or omit duration. |
| “@dsh-external/dsh-genui → …” current status | historical only | current name is `@changfenhuang/dsh-genui`; `@omdsh-dev/dsh-genui` is the documented legacy alias. |
| npm 0.16.0 availability | **not published** | do not say 0.16.0 is installable (§1). |
| “Oh My DSH” as the community/legal entity | UNVERIFIED in repo | the repo org is `omdsh-dev`; LICENSE holder is `dsh-external`. Don’t put it in legal line without a decision. |
| Copyright line “© 2026 Oh My DSH” | UNVERIFIED | `LICENSE` says `Copyright (c) 2026 dsh-external`. Suggest “MIT License · © 2026 dsh-external” or leave the org name out of the legal line. |
| “millisecond / 60 FPS / sub-millisecond” performance claims (README.zh-CN:74) | UNVERIFIED as a benchmark | no benchmark artifact in repo; do not ship. |
| “zero-latency”, “XSS-proof”, “sandboxed” | marketing absolute | use the precise policy claims in §9 instead. |
| star count other than 941 on 2026-11-09 | re-audit | fetched live at runtime anyway. |
| `demo-thumb.png` as poster | **defective** | real PNG has a big white circle, no play glyph; also shows personal session titles. Use a fresh poster (first frame) or a showcase PNG. |
| `footer.disclaimer` wording (“独立、非官方…”) | editorial, not code-verifiable | fine as a disclaimer; do not present as a fact cite. |
| `evidence.compatBody` “组件数领先一版” | true today (60 vs 51) | becomes stale when 0.16.0 publishes — add to release checklist. |
