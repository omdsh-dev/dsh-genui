# 🎨 dsh-genui

<div align="center">

**English** · [简体中文](./README.zh-CN.md)

<br>

[**Open the live product site**](https://omdsh-dev.github.io/dsh-genui/) · [**Watch the real demo**](#watch-the-real-interface) · [**Install in DSH**](#quick-start)

</div>

> Give the model's answers a face — the text is still there, and an interactive UI is already live.
>
> 🔌 Ecosystem: the repo carries the `#dsh` · `#dsh-plugin` topics — welcome to be listed by @dsh-plugin.

`dsh-genui` turns a model reply into a **safe, interactive DSH surface**. Ask “how are this month’s orders doing?” and the answer can include a sortable data panel, a native video, a draggable plot, a local quiz, or a persistent session panel — without replacing the surrounding text.

## Start with the evidence

| If you want to… | Go straight to… | What you can verify |
|---|---|---|
| See the complete DSH flow first | [40-second real walkthrough](#40-second-walkthrough) | Components are rendered inside a real DSH conversation. |
| Inspect concrete UI outputs | [Three real outputs](#three-real-outputs-inside-a-dsh-reply) | Monitoring, function plots, and composable layout primitives. |
| Try it in your own DSH | [Quick start](#quick-start) | A public npm install, a prompt to run, and an activation check. |
| Learn the JSON language | [Component syntax](./SKILL.md) | The supported, guarded `dsh-ui` component specification. |

## Watch the real interface

> **No concept mockups.** The recording and images in this section are captured from `dsh-genui` rendering in the DSH interface. Use them to see the actual visual language before installing.

### 40-second walkthrough

<div align="center">

https://github.com/user-attachments/assets/f5db33ec-7471-4d4a-a85b-79c9962ab4ef

</div>

<p align="center">
  <a href="./assets/demo.mp4"><img src="./assets/demo-thumb.png" width="92%" alt="Preview of the complete dsh-genui walkthrough video"></a>
  <br><em>Click the preview to download the original MP4 if the GitHub player is unavailable.</em>
</p>

The walkthrough moves from an answer-embedded panel through forms, plotting, Mermaid, and 3D-oriented components. The player does **not** auto-play. If it does not load, use the [original MP4](./assets/demo.mp4); the four-step prompt sequence is documented in [demo-prompts.md](./demo-prompts.md).

### Three real outputs inside a DSH reply

#### 1. A monitoring panel is an answer, not a separate dashboard

<p align="center">
  <img src="./assets/showcase-panel.png" width="92%" alt="Real dsh-genui monitoring panel rendered inside a DSH conversation">
  <br><em>Real output: refresh/reset controls, time-range selection, statistics, charts, and a service table live inside the assistant reply.</em>
</p>

#### 2. A function plot redraws locally as its parameters change

<p align="center">
  <img src="./assets/showcase-plot.png" width="76%" alt="Real dsh-genui function plot with draggable parameter sliders">
  <br><em>Real output: `plot` renders curves while sliders, reset, and animation controls update the graph locally.</em>
</p>

#### 3. Layout primitives compose into structured work surfaces

<p align="center">
  <img src="./assets/showcase.png" width="76%" alt="Real dsh-genui layout and card component composition">
  <br><em>Real output: typography, grid, card, and row/column primitives combine into a hierarchy the model can describe declaratively.</em>
</p>

---

## ⚠️ Read this first: dual-channel rendering (no host source patch required)

The plugin ships **two rendering channels** and picks one automatically after the host activates its browser module:

- **Registry channel**: when the host exposes the `fence-registry` extension point (newer dsh builds), fences register through the host's streaming render pipeline and behave seamlessly with the host;
- **DOM channel**: when the host lacks that extension point (including stock DSH and older builds), the plugin observes the session DOM and mounts its own render tree. Since 0.7.2 it **supports streaming rendering**: components appear as the model writes them — the first finished component shows up immediately, no need to wait for the whole reply. Since 0.8.3 fence discovery is **multi-surface**: it matches the stock `md-code-block` surface, the deepsuite-style `.code-block` / `.code-block-small` surfaces some host builds render instead, and — as a structural backstop — any element whose banner labels it `dsh-ui` and contains a `<pre>` body. If your dsh build renders fences with a different class name, they still render (and a one-time console warning tells you the host DOM drifted).

Whichever channel is active, components, interactions, panels, and persistence behave identically.

The repository ships both renderer channels, the host plugin, and the built browser bundle. The host still owns **client activation** and must provide the `slots` and `sessions` services. A downloaded `client.js` or a ModuleLoader cache entry proves only that bytes arrived — successful activation always prints `[genui] client active; fence-channel=registry|dom`. If that line is absent, fix package/profile identity or host activation first; DOM attributes such as `data-streaming` and `data-chat-anchor-key` are optional fallbacks, not installation prerequisites.

---

## ✨ Before vs. after

| Plain answer | With dsh-genui |
|---|---|
| "Revenue this month: ¥128,430, +12.4% MoM — watch the conversion rate." | One line of analysis + three stat cards (revenue / orders / conversion), a trend chart, and a progress bar rendered right beside it |
| Want to see more? Type another question. | The panel already has "Refresh" / "Switch view" buttons — click, and the model updates the data |

## 🚀 Quick start

Prerequisites — all required:

1. **dsh installed** (any open-source build works — the plugin picks its rendering channel at startup, see "dual-channel rendering" above)
2. **`pnpm` on your PATH**: the `dsh plugin` command depends on it. If missing: `corepack enable` (or `npm i -g pnpm`), then **open a new terminal** and confirm `pnpm -v` prints a version

Install and activate in DSH (one command, all dependencies included):

```sh
# Public npm package (works without an npm account)
dsh plugin --profile web add @changfenhuang/dsh-genui
```

To add it only as a Node dependency in an existing project:

```sh
npm install @changfenhuang/dsh-genui
```

> `npm install` only adds the dependency; it does not register the plugin with DSH. Use `dsh plugin add` above when installing it into DSH.

> ⚠️ **Don't use `link:` on a freshly cloned directory** — `link:` does not install the plugin's dependencies (mermaid / three / react), so the renderer will break. Use the npm command above for normal installation; reserve `link:` for local development iteration (see below).

### Migrating from the old `@omdsh-dev` package name

If you installed from `github:omdsh-dev/dsh-genui` before v0.9.2, pnpm may keep the dependency under the old `@omdsh-dev/dsh-genui` key even though the repository now declares `@changfenhuang/dsh-genui`. The loader resolves plugins from the profile's dependency keys, so a later reinstall can then fail with `Cannot find package '@changfenhuang/dsh-genui'`. Re-add the plugin under its current package name:

```sh
dsh plugin --profile web remove @omdsh-dev/dsh-genui
dsh plugin --profile web add @changfenhuang/dsh-genui
```

This migration is required once for old GitHub-spec installs. New installs should use the npm command above and will use the current dependency key.

### Verify the install in 60 seconds

After the command completes, restart dsh web and hard-refresh the browser. In a **new** session, say:

```text
Use dsh-ui to draw a stats dashboard with a sortable service table.
```

You should see the reply turn into an in-place dashboard rather than a code block. For an unambiguous technical check, open the browser console: successful activation prints `[genui] client active; fence-channel=registry|dom`.

### Developer iteration (link mode)

```sh
cd dsh-genui
pnpm install
dsh plugin --profile web add link:$PWD
```

## 🧩 Capability map

| Surface | First thing to try | Observable behavior |
|---|---|---|
| Data | Ask for an order or service dashboard | `stat`, `table`, `chart`, and `progress` appear inside the reply; supported numeric table values sort numerically. |
| Media | Ask for an audio or video reference | Browser-reachable media plays inline, with poster/aspect-ratio and failure states. |
| Exploration | Ask for `plot` with a parameter | Dragging sliders redraws the curve locally and immediately. |
| Feedback | Ask for a short quiz | The UI grades and explains locally; only the next model step needs an `action`. |
| Workspace | Ask for `/panel` or `panel: true` | A persistent, resizable session dock is updated in place. |

The following is the detailed capability reference. Every behavior is constrained by the whitelisted `dsh-ui` specification; see [SKILL.md](./SKILL.md) for the JSON syntax.

- **Answer-as-UI**: components are embedded in the reply and appear as they stream — no waiting for the whole message
- **30+ components**: cards, tables, charts, forms, tabs, accordions, file trees, timelines, diffs…
- **Native media**: audio and video play inline from browser-reachable http(s) or same-origin relative URLs, with user-controlled playback, video posters/aspect ratios, and visible failure states
- **ECharts integration**: the `echart` node renders full ECharts charts with theme-aware colors, tooltips, and legends. Two modes: **preset shorthand** (`preset: 'bar' | 'line' | 'area' | 'pie' | 'scatter'` + `data`/`series`) for quick upgrade from the `chart` node, or **full option** (`option` field) for custom chart types, dataZoom, visualMap, and other advanced ECharts features. The echarts engine (~1 MB) is lazy-loaded on demand — the main bundle never carries it, and conversations without `echart` nodes never download it- **Function plots**: `plot` draws curves; parameter sliders redraw in real time, with optional auto-animation

- **Quiz**: `quiz` grades on click with explanation and retry; with `action`, the answer is also sent back to the model (grading stays local and instant)
- **Local grading (submit)**: a multiple-choice set = one `radio` per question with `group` + `answer` (correct answer) + `explanation`, plus one `submit` button — after the user answers everything and clicks once, **the score, per-question right/wrong, and explanations appear right in the UI with zero model round-trips**; the quiz then locks, and "retake" resets locally (optional `resetAction` notifies the model). Questions without an answer fall back to an aggregated action (`fields` collects every input with an `id`)
- **State persistence**: answers, submission locks, and input values are saved per "session + content fingerprint" — refresh or reopen restores everything; re-rendering identical content keeps user state; new content starts fresh; LRU cap of 200 blocks
- **Form semantics**: `input` Enter / `textarea` Ctrl+Enter submits immediately (`submit:true`), no blur needed; fields with an `id` are collected into the submit's `fields`
- **Secrets ban**: GenUI must never ask for passwords, API keys, access tokens, recovery codes, or other secrets; even if a password input appears, it stays masked, is never persisted, and never enters form collection
- **Local-first principle**: state changes the UI can do itself (grading, quiz checking, resets, expand/collapse, selection) always happen locally and instantly; actions are reserved for things that genuinely need the model (generating new content, running tools, next-step suggestions)
- **Honest interactions**: interactive components must carry `action`; buttons without one render disabled (kills the "looks clickable, does nothing" fake button); buttons with `action` show instant "triggered" local feedback (proof the local event fired, not that the model received it)
- **Event loop**: buttons/switches/inputs/dropdowns/checkboxes/radios/textareas/quizzes carry `action`; click or blur sends back to the model, which updates the UI; same-name actions are debounced with a 300 ms trailing edge — rapid clicks merge into one (last value wins)
- **Tool channel**: the `render_ui` tool renders the same spec as a card in the tool row (deliverable-style UI goes through the tool, answer-style UI through the fence)
- **Session panel**: a persistent dock above the composer; `render_ui` / `panel: true` fences update the same surface in place; `/panel` opens it from the client (`/panel <instruction>` customizes via the model, `/panel clear` clears); the top border is draggable to resize; `append: true` merges incrementally — same-named tabs append content, new tabs get added; the whole panel caps at 200 nodes / 200 appends, after which the model should send `replace` to rebuild
- **Self-healing & limits**: every fence passes a spec guard — bad nodes are silently dropped, numbers clamped, strings truncated; the whole tree is capped at 200 nodes / 8 nesting levels; pathological specs never crash the UI
- **Chart error self-healing**: mermaid failures auto-retry with repairs (strip backticks, quote Chinese/space labels, remove `<br/>`) before degrading to source; a broken chart never hits the screen
- **Accessibility**: tabs/accordions/switches/progress bars carry full ARIA and keyboard navigation (arrow keys switch tabs, Home/End jump)
- **Zero intrusion**: without the plugin, fences are just code blocks — no errors, no session pollution

Component JSON syntax lives in [SKILL.md](./SKILL.md). On hosts with the public skill registry, the plugin registers this bundled `genui` skill automatically, so new Sessions receive the complete component and field catalog without copying files into `~/.dsh`.

`chart` stays the compact three-kind renderer: use `kind: 'bars' | 'line' | 'donut'` with finite numeric `data[].value` fields. `validate_dsh_ui` reports `variant`, unsupported kinds, and invalid datum fields explicitly; `render_ui` rejects the same errors instead of silently rendering the default bars view. Unknown extension fields remain allowed.

## 📄 Example

The model outputs this fence (written for the browser — you don't need to read it):

```dsh-ui
{"title":"Order overview","items":[
  {"type":"stat","label":"Total revenue","value":"¥128,430","delta":"+12.4%"},
  {"type":"stat","label":"Orders","value":"1,024","delta":"-3.1%"}
]}
```

What you see: two stat cards.

### ECharts example

```dsh-ui
{"title":"Q1 Revenue","items":[
  {"type":"echart","title":"Monthly Revenue","preset":"bar","data":[
    {"label":"Jan","value":98},
    {"label":"Feb","value":112},
    {"label":"Mar","value":128}
  ]}
]}
```

What you see: a themed bar chart with tooltips and axis labels — rendered by ECharts, lazy-loaded on demand.

## 🔧 How it works

The model writes the interface description as JSON inside a `dsh-ui` fence; the browser-side renderer (`src/client`) claims this language through the main repo's `fence-registry` interface and renders it. Components are whitelisted — the model can't smuggle in HTML/scripts; function expressions go through a standalone parser, never `eval`.

The core render package stays light (≈110 KB min / 28 KB gzip); the mermaid, three.js, and echarts engines are bundled separately as on-demand assets (loaded through the plugin's self-registered HTTP routes the first time they're used), so startup only downloads the rendering core.

## ❓ FAQ

- **Rendering as a code block?** First check the browser console for `[genui] client active; fence-channel=registry|dom`. If absent, the client bundle was not activated even if its URL returns 200 — align the profile dependency, `package.json.name`, `cordis.patch.yml`, ModuleLoader id, and configured bundle name. If present, inspect the fence label/body; registry-less hosts automatically use the DOM channel.
- **Chat UI goes blank when rendering a dsh-ui fence?** Your dsh is too old — update dsh first, then reinstall the plugin.
- **`dsh: pnpm not found on PATH`?** Install pnpm, then **open a new terminal** and retry (`corepack enable` or `npm i -g pnpm`).
- **npm install returns 404?** The npm package is public and requires no login. Run `npm view @changfenhuang/dsh-genui version` to verify the package name and public registry; if a newly published version still returns 404, retry shortly.
- **Installed but scene3d/mermaid/echarts don't render?** The engines (mermaid / three / echarts) are no longer inlined in client.js — they load on demand the first time they're used (`/plugins/@changfenhuang/dsh-genui/assets/*.js`, hosted by the plugin's own HTTP routes). First restart dsh web + hard refresh (Cmd+Shift+R); still broken, remove and reinstall (`dsh plugin --profile web remove @changfenhuang/dsh-genui`, then add again). Hosts without the asset routes degrade to source/load-error hints — update dsh.
- **Model not outputting fences?** New sessions pick it up after a restart; or just say "output it with dsh-ui".
- **No lib/ after cloning?** Build it yourself: `pnpm install && pnpm run check`.

## 🧑‍💻 Development

```sh
pnpm install
pnpm run check   # type check + full tests + build
```

### Real-device e2e

The real chain end to end: start a temporary dsh web → install the plugin → send a message in a browser so the model outputs a `dsh-ui` fence → assert the rendering → click an action button → assert the model responds (event-loop closure):

```sh
DEEPSEEK_API_KEY=sk-... node scripts/e2e.mjs          # link-installs the current workspace
```

Prereqs: `dsh`/`pnpm` on PATH, `DEEPSEEK_API_KEY`, and the main repo's web build output (playwright resolves it from the main repo). On PASS it saves an `e2e-final.png` screenshot.

### Visual e2e (no model key)

For style/component iterations, a visual smoke that needs no API key: boots a real dsh web with the plugin link-installed, injects the component gallery fence through the DOM channel, renders it in headless Chrome, screenshots the full page, and exercises local interactions (table sort, quiz judging, tree collapse, numeric alignment) with hard assertions:

```sh
npx tsx scripts/e2e-visual.mts          # → .e2e-artifacts/gallery.png + interactions.png
npx tsx scripts/e2e-visual.mts --keep   # keep the scratch DSH_HOME for debugging
```

Overridable: `--port 3098`, `--out <dir>`, `DSH_BIN` (defaults to the npm-mode `~/node_modules/.bin/dsh`), `PLAYWRIGHT_PATH` (defaults to the global playwright-core).

## 🗺️ Roadmap (evaluated)

| Direction | Verdict | Rationale |
|---|---|---|
| Incremental patching (model sends diffs, not full specs) | Not doing | A fence costs 200–800 tokens; resending is nearly free; a patch protocol's teaching cost and error rate aren't worth it. Revisit if sub-second auto-refreshing panels ever appear |
| Action debounce/dedup | ✅ Done (300 ms trailing edge, per action name) | Rapid-click spam is real friction; one choke point |
| Cross-session state persistence (replay restores tabs/switches) | Not doing | Replay-reset is the more correct default (the model has already updated the UI with a new fence); state survives naturally during streaming |
| MCP adapter / standalone gallery page / i18n | Not doing | No cross-tool demand signal; gallery material is covered by `gallery.ts` + demo-prompts + README screenshots; only 6 built-in strings |

Unit tests and builds use the locked published dsh rc.8 packages. `DSH_ROOT` is only needed by source-level or end-to-end checks.

## 🔗 Friendly links

- [Linux.do](https://linux.do)

---

📄 License: MIT
