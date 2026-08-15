/**
 * GenUI plugin: teaches the model the ```dsh-ui fence syntax for emitting
 * declarative UI components inline in its reply. The browser half renders the
 * fence through GenuiBlock (ui-primitives); this host half only tells the
 * model the language exists, so a session without the plugin simply never
 * emits fences and nothing changes.
 *
 * The section is a convention section (order 100-199), placed after the bash
 * guidance so the model sees it among its output-format rules.
 * @module @omdsh-dev/dsh-genui
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRenderUiTool, createValidateDshUiTool } from './tool.ts'

/** Convention: tool guidance uses 100–199; bash's section is 104. */
export const GENUI_SECTION_ORDER = 105

/* ---------------- lazy engine asset route ---------------- */

/**
 * The mermaid/three engines ship as standalone IIFE bundles under
 * `lib/assets/` and are fetched by the client ONLY when a spec needs them.
 * This route serves them from the plugin's own package directory through the
 * host webserver service — the longest-prefix rule lets it win over the
 * generic `/plugins` bundle route, and no host source change is needed. The
 * service is optional at this plugin's start time (same ordering reality as
 * the tools registry), so registration probes immediately AND on the
 * `internal/service` event, exactly like the tools registration below.
 */

/** Route prefix under /plugins; anything under it is this plugin's asset. */
const ASSET_ROUTE_PATH = '/plugins/@omdsh-dev/dsh-genui/assets'

/** Safe flat file names only: no slashes, no traversal, js assets only. */
const ASSET_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/

/** The handler itself (registered via the optional webServer probe). */
async function serveGenuiAsset(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  } catch {
    res.writeHead(400)
    res.end()
    return
  }
  const rel = pathname.startsWith(`${ASSET_ROUTE_PATH}/`) ? pathname.slice(ASSET_ROUTE_PATH.length) : null
  if (rel === null) {
    res.writeHead(404)
    res.end()
    return
  }
  const file = rel.slice(1)
  if (!ASSET_FILE_RE.test(file)) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
    // lib/index.js → ./assets/ = <pkg>/lib/assets/ (the tsdown asset outDir).
    const dir = fileURLToPath(new URL('./assets/', import.meta.url))
    const body = await readFile(join(dir, file))
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
    })
    res.end(body)
  } catch {
    // Missing asset (old build) — a loud 404; the client shows its fallback.
    res.writeHead(404)
    res.end()
  }
}

/** The fence language description injected into every assembled system prompt. */
export const GENUI_SECTION_TEXT = `You can render interactive UI components INSIDE your reply — between paragraphs — by emitting a fenced block with the language tag \`dsh-ui\` containing a JSON spec:

\`\`\`dsh-ui
{"title":"Optional title","gap":14,"items":[...]}
\`\`\`

The spec is a white-listed component tree rendered inline where the fence sits. Vocabulary (only these \`type\` values; the \`genui\` skill, when available, carries the fuller content→component mapping and field details):

- text: {"type":"text","size":"h1|h2|h3|body|muted|caption","content":"...","center":true?}
- row / col: {"type":"row"|"col","items":[...],"wrap":true?,"spacer":true?,"gap":n?} — layout containers
- grid: {"type":"grid","cols":n,"items":[...]} / card: {"type":"card","title":"...","items":[...]}
- button: {"type":"button","label":"...","tone":"primary|danger|success|ghost","full":true?,"small":true?,"icon":"emoji?","action":"name"?} — renders as disabled without an action
- input / textarea: {"type":"input"|"textarea","label":"...","placeholder":"...","inputType":"text|email"?,"rows":n?,"value":"...","action":"name"?,"id":"field-id"?} — input submits on Enter (submit:true), textarea on Ctrl/Cmd+Enter; blur sends only when the value changed; values with an id persist across refreshes and are collected by a sibling submit as fields:{id:value}
- select: {"type":"select","label":"...","options":[...],"selected":下标?,"action":"name"?,"id":"field-id"?} — id/selected behave like input
- checkbox / switch / slider: {"type":"checkbox"|"switch","label":"...","checked":true?,"action":"name"?} · {"type":"slider","label":"...","min":0,"max":100,"step":1,"value":n?,"action":"name"?,"id":"field-id"?} — slider is a numeric form field: id persists and goes into submit's fields
- radio: {"type":"radio","label":"...","options":[...],"selected":n?,"action":"name"?} — add "group":"question name" to record choices (no round-trip on click); adding "answer":correct index|label and "explanation":"explanation text" lets a sibling submit grade locally
- submit: {"type":"submit","label":"Submit","groups":["q1"]?,"action":"name"?,"resetAction":"name"?} — LOCAL-FIRST: when questions carry answers, clicking grades in place (score + per-question ✓/✗ + explanations) and locks to "Retake", zero round-trips, no action needed; only when there are no answers does it send one action {answers:{group:choice},fields:{id:value},total,answered}; stays disabled until all questions are answered
- quiz: {"type":"quiz","question":"...","options":[{"label":"...","correct":true?,"feedback":"..."?}],"explanation":"...","id":"..."?,"action":"name"?} — click to grade in place + retry; id changes reset it; with an action it also reports {type:'quiz',question,answer,correct}
- link: {"type":"link","label":"...","href":"https://..."?} — http(s)/mailto only; without href renders as plain text
- badge: {"type":"badge","label":"...","tone":"success|warn|danger|accent","icon":"emoji?"}
- stat: {"type":"stat","label":"...","value":"...","delta":"+12.4%|-3%"}
- progress: {"type":"progress","label":"...","value":0-100,"valueLabel":"70%"}
- divider: {"type":"divider"} / spacer: {"type":"spacer"}
- list: {"type":"list","items":["..."] or [{"title":"...","desc":"..."}]}
- table: {"type":"table","columns":["..."],"rows":[["...","..."]]} — header clicks sort locally (asc/desc/restore, number-aware)
- chart: {"type":"chart","kind":"bars|line|donut","data":[{"label":"...","value":n,"color":"#hex?"}],"series":[...]?} — bars by default; line for trends; donut for shares; series=grouped bars; negative values render with zero height but keep their labels; hover shows exact values
- tabs: {"type":"tabs","tabs":[{"label":"...","items":[...]}]} / accordion: {"type":"accordion","items":[{"title":"...","items":[...]}]}
- avatar: {"type":"avatar","name":"..."}
- plot: {"type":"plot","series":[{"expr":"sin(x)","label":"...","kind":"line|area|scatter"?,"params":[...]?}],"xMin":-5,"xMax":5,"yMin":?,"yMax":?,"title":"..."} — SVG function plot (draggable pan / wheel zoom; params render live sliders); kind defaults to line, area fills to the baseline, scatter plots points; expression whitelist sin/cos/tan/asin/acos/atan/sqrt/cbrt/exp/log/ln/abs/floor/ceil/round/min/max/pow, constants pi/e/tau, variable x
- callout: {"type":"callout","tone":"info|success|warning|error","title":"...","content":"..."}
- steps: {"type":"steps","current":n,"steps":[{"title":"...","desc":"..."}]}
- keyvalue: {"type":"keyvalue","pairs":[{"key":"...","value":"..."}]} / json: {"type":"json","value":...} / code: {"type":"code","lang":"ts","code":"..."} / diff: {"type":"diff","diffs":[{"path":"...","oldText":"..."|null,"newText":"..."}]}
- copy: {"type":"copy","label":"Copy","text":"..."}
- mermaid: {"type":"mermaid","code":"graph TD\\nA-->B"} — flowchart/sequence/class/gantt/pie/er/state/journey
- scene3d: {"type":"scene3d","title":"...","meshes":[{"shape":"box|sphere|cone|cylinder|torus","color":"#hex?","size":n|[w,h,d]?,"position":[x,y,z]?,"rotation":[rx,ry,rz]?,"scale":n?|[x,y,z]?}],"ambient":0-2?,"background":"#hex?"} — drag to rotate, wheel to zoom
- timeline: {"type":"timeline","items":[{"title":"...","desc":"...","time":"..."}]}
- file-tree: {"type":"file-tree","items":[{"name":"...","type":"file|dir","children":[...]?}]} — directory rows are clickable to collapse
- breadcrumb: {"type":"breadcrumb","items":["Home","Settings","Account"]}

Rules:
- Trigger: proactively use a fence when structured presentation beats plain text (key points, emphasis, comparison, flows, steps, status, data, demos); don't wrap plain Q&A and one-liners in UI.
- Place the fence where the component belongs in your answer, with text flowing around it; don't nest a fence inside another code fence, and keep markdown out of JSON strings.
- Component choice (one primary component per topic): conclusions/reminders→callout · 2–4 metrics→grid+stat · progress→progress · multi-stage→steps · key points→list · config→keyvalue · comparison→table · trend→chart(line) · share→chart(donut) · category comparison→chart(bars) · math curve→plot · events→timeline · paginated content→tabs · long content→accordion · tree→file-tree · code→code · file changes→diff · nested JSON→json · architecture/flow→mermaid · geometry only→scene3d · teaching→quiz · single action→button(action). Prefer table/chart over walls of text; don't repeat the same data in two components; 3–8 components per reply, fewer when unsure.
- Syntax: a broken fence degrades to a code block, so keep the JSON strict. Before emitting a fence with ≥3 nodes or containing a table, call validate_dsh_ui; on ❌ fix it and resend; if the ❌ reply includes an "auto-repaired" JSON, copy it verbatim.
- Theme: adapt content to dark mode; the UI theme follows the app — don't invent one. Scale: ≤200 nodes, nesting ≤8 levels (excess is truncated); 3D meshes 1–5; give plot a sensible xMin/xMax.
- v2 actions: button/input/select/checkbox/radio/switch/slider/textarea/quiz can carry "action":"name"; interactions come back as [genui-action] name + component data, then re-render to update the UI. Interactive components must carry an action (buttons without one render disabled); buttons with an action show a "triggered" local feedback on click.
- LOCAL-FIRST: state changes the UI can do itself (grading, checking answers, resetting, expanding, selecting) all happen in place with zero model round-trips; actions are only for things that need the model (generating new content, running tools, next-step suggestions).
- Durable state: interaction state persists by "session + content fingerprint" — refreshing/replaying the same content restores it; new content (new questions, changed spec) clears it. Re-rendering the same content keeps state; rendering new content resets it.
- Exam pattern: one radio per question (group question name + answer + explanation) plus one submit (all groups listed); when the user finishes and clicks submit, grade locally. Re-render only when the user asks for a new exam or follow-up advice.
- Secrets ban: GenUI must not ask for passwords, API keys, access tokens, recovery codes, or other secrets; refuse and explain when needed.
- Tool channel: the render_ui tool renders the same spec as a tool-row card (for deliverable-style interfaces); the fence is for inline UI in answers.
- Panel: "panel":true fences render only into the session panel dock and update in place; "append":true merges by appending (appends to same-label tabs / adds a new tab / appends at the end); panel cap is 200 nodes / 200 appends — when full, send a replace to rebuild. A [genui-action] from a panel component gets only a panel:true fence plus at most one line of confirmation ≤10 characters, no explanations, no ordinary fences.`

/**
 * Register the GenUI output-language section and the render_ui tool.
 * @param ctx - cordis context.
 */
// `tools` is intentionally NOT injected: the service is optional for this
// plugin — hosts without tool access keep the fence channel working. Cordis
// inject entries are hard requirements, so the registry is probed at runtime
// instead (see apply).
export const inject = ['systemPrompt']

export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'genui:fence',
    order: GENUI_SECTION_ORDER,
    text: GENUI_SECTION_TEXT,
  })
  // The tools service is optional: hosts without tool access (or minimal
  // compositions) keep the fence channel; only when the registry exists does
  // the render_ui tool join the model's tool set. `reflect.get(name, false)`
  // is cordis's non-throwing optional service lookup (the proxy's own trap
  // uses it) — property access without inject would throw instead.
  //
  // Start-up ordering: this plugin injects only `systemPrompt`, so cordis
  // starts it EARLY — before the tools provider (which injects deeper
  // dependencies) has bound its service. A one-shot probe at apply time
  // therefore misses the registry on real hosts (the fence section lands,
  // the tool never registers). Fix: probe immediately AND subscribe to
  // `internal/service` (emitted by cordis on every service binding), so the
  // registration lands the moment `tools` appears, whatever the order.
  let registered = false
  const tryRegister = (value: { register(tool: unknown): unknown } | undefined): void => {
    if (registered) return
    const tools = value ?? ctx.reflect.get('tools', false) as { register(tool: unknown): unknown } | undefined
    if (tools === undefined) return
    tools.register(createRenderUiTool())
    tools.register(createValidateDshUiTool())
    registered = true
  }
  tryRegister(undefined)
  ctx.on('internal/service', (name: string, value: unknown) => {
    if (name === 'tools') tryRegister(value as { register(tool: unknown): unknown })
  })

  // Lazy-engine asset route: same optional-probe pattern as the tools
  // registry — the webserver service may bind after this plugin starts.
  let assetsRegistered = false
  const tryRegisterAssets = (value: { register(route: unknown): unknown } | undefined): void => {
    if (assetsRegistered) return
    const webServer = value ?? ctx.reflect.get('webServer', false) as { register(route: unknown): unknown } | undefined
    if (webServer === undefined) return
    webServer.register({ kind: 'prefix', path: ASSET_ROUTE_PATH, handler: serveGenuiAsset })
    assetsRegistered = true
  }
  tryRegisterAssets(undefined)
  ctx.on('internal/service', (name: string, value: unknown) => {
    if (name === 'webServer') tryRegisterAssets(value as { register(route: unknown): unknown })
  })
}
