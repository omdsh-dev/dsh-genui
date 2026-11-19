# dsh-go native integration

This integration uses the native interfaces already supplied by dsh-go. It does not require an App patch, an embedded browser per message, or a replacement APK. Install the plugin in the DSH engine connected to the App. The App must already provide the native interfaces described below.

The original GenUI `items` document remains authoritative. Web rendering, export, panels and `[genui-action]` keep their existing vocabulary and payloads. Native views are derived from that document; they never replace the stored web spec.

## Existing surfaces

| Surface | Content and interaction | Host coverage |
| --- | --- | --- |
| Native tool card | Layout, text, metrics, comparisons, steps, progress, lists, tables, key/value data, basic charts and bounded embedded images. Tool cards are read-only. | Local, SSH and relay: the projection travels in the persisted tool result. |
| Assistant `dsh-ui` fence | The App's ten model-card components, including visible choices and confirmation replies. `validate_dsh_ui` can return `native_fence_json`, retaining web `items` alongside a native `stack`/`children` projection. Emit that exact JSON. | The fence is ordinary conversation content; no bridge is needed. |
| GenUI native panel | Buttons, single-choice selectors, checkbox groups, switches, submissions, local quiz/grading, tabs, accordions, copy (including table Markdown/CSV export), confirmed HTTPS links and supported display components. | Requires the existing `dshGo` bridge and the session-state API from DSH 0.2.1-rc.2 or later. Currently available on the local engine; SSH/relay panel access depends on their host bridge support. |

The native manifest adds a GenUI composer shortcut and a GenUI session/chat panel. A host without the optional bridge keeps the original web plugin and native tool cards. The plugin does not install or alter the bridge.

## State and actions

The panel reconstructs content from committed successful `render_ui` results and closed assistant fences, in session-log order. Failed calls, unfinished fences and model-only replacement copies cannot replace a newer human-visible card. Panel appends use the same tab-aware merge as the web renderer; references to earlier form members are checked after merging.

Default choices enter the same effective state used for rendering, computed values and submission. Selection, expansion and grading state is stored as an ignorable plugin record in the owning session. Restart/replay restores it; appends retain the panel's identity, while replacement starts a new panel. Text/password inputs are not offered by the native protocol and their values are never collected into this state.

Local choices, tabs, accordions and grading need no model request. A component with a model action sends the existing `[genui-action] <name> <JSON payload>` to its exact originating, loaded, idle session. No current-session fallback is used. Control identities include the session, source revision and displayed state; stale clicks, unknown choices and duplicate/pending model input are rejected. Copy and HTTPS-link actions use the App's existing effects, including its link confirmation.

Inline native choices differ: the App sends `[dsh-ui reply]` containing only the visible card title and labels. The model responds to that visible choice in context. Each native model card settles after one reply, so a fence with several independent controls stays on the panel path. These replies do not carry hidden action identifiers or arbitrary business payloads; use the native panel when exact callbacks or persistent local interaction are required.

## Capability limits

| Existing App limit | Handling |
| --- | --- |
| Tool card: 8 KiB, 40 nodes, depth 6 | Emit a projection only when the complete card fits. Never silently drop an interactive or advanced sibling. |
| Model fence: 16 KiB for the **whole JSON body**, including web `items` | Return a dual-format fence only when the entire document fits. Never cut web content to fit the native projection. |
| Native panel: 32 KiB, 120 nodes, depth 8 | Show a clear capacity message when it cannot fit. |
| Fixed native component vocabulary | Unsupported components appear as explicit notices in the panel; the full source stays in the conversation. |
| Images | Only embedded PNG/JPEG/GIF/WebP accepted by the App; no external URL/SVG is disguised as a native image. |

Free-text fields, sliders, ECharts, Mermaid/SVG engines, 3D, audio/video and other widgets beyond the native vocabulary cannot retain their full interaction in this interface. Native charts support bar, horizontal bar, line and single-series donut; stacked charts remain unsupported. A sparkline becomes a native line chart without discarding its values. Table detail expansion and graphic table cells remain explicit gaps. Code/JSON can be shown as native text within the native text budget.

## Build and verification

```sh
pnpm install --frozen-lockfile
pnpm run check
node scripts/verify-pack.mjs
dsh plugin --profile web add /absolute/path/to/dsh-genui
```

Run the last command in the engine's environment, using its actual profile. This adds the plugin, not an App update. Keep a linked source directory in place. Updating already loaded host code may require reloading the engine.

The automated suite covers native projections, dual-format web preservation, whole-fence byte limits, committed-history replay, append and replacement behavior, defaults, computed labels, local grading, durable state restore, scoped actions and delayed/stale clicks. These checks are distinct from Android device acceptance. Touch/scroll, the installed App version and real local/SSH/relay connection behavior still need device verification before claiming release acceptance.
