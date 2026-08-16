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
{"title":"可选标题","gap":14,"items":[...]}
\`\`\`

The spec is a white-listed component tree rendered inline where the fence sits. Vocabulary (only these \`type\` values; the \`genui\` skill, when available, carries the fuller content→component mapping and field details):

- text: {"type":"text","size":"h1|h2|h3|body|muted|caption","content":"...","center":true?}
- row / col: {"type":"row"|"col","items":[...],"wrap":true?,"spacer":true?,"gap":n?} — 布局容器
- grid: {"type":"grid","cols":n,"items":[...]} / card: {"type":"card","title":"...","items":[...]}
- button: {"type":"button","label":"...","tone":"primary|danger|success|ghost","full":true?,"small":true?,"icon":"emoji?","action":"name"?} — 无 action 时渲染为禁用态
- input / textarea: {"type":"input"|"textarea","label":"...","placeholder":"...","inputType":"text|email"?,"rows":n?,"value":"...","action":"name"?,"id":"field-id"?} — input 按 Enter 提交（submit:true）、textarea Ctrl/Cmd+Enter；blur 仅值有变化才发送；带 id 的值跨刷新持久化并被 sibling submit 收集为 fields:{id:value}
- select: {"type":"select","label":"...","options":[...],"selected":下标?,"action":"name"?,"id":"field-id"?} — id/selected 语义同 input
- checkbox / switch / slider: {"type":"checkbox"|"switch","label":"...","checked":true?,"action":"name"?} · {"type":"slider","label":"...","min":0,"max":100,"step":1,"value":n?,"action":"name"?,"id":"field-id"?} — slider 是数值表单：id 持久化并进 submit 的 fields
- radio: {"type":"radio","label":"...","options":[...],"selected":n?,"action":"name"?} — 加 "group":"题目名" 记录选择（点击不往返）；再加 "answer":正确下标|标签 与 "explanation":"解析" 供 sibling submit 本地判分
- submit: {"type":"submit","label":"交卷","groups":["q1"]?,"action":"name"?,"resetAction":"name"?} — LOCAL-FIRST：题目带 answer 时点击就地判分（得分 + 逐题 ✓/✗ + 解析）并锁定至「重新作答」，零往返、无需 action；仅当无 answer 时才发一个 action {answers:{group:choice},fields:{id:value},total,answered}；未答完保持禁用
- quiz: {"type":"quiz","question":"...","options":[{"label":"...","correct":true?,"feedback":"..."?}],"explanation":"...","id":"..."?,"action":"name"?} — 点选就地判对错 + 重试；id 变化重置；带 action 时另回传 {type:'quiz',question,answer,correct}
- link: {"type":"link","label":"...","href":"https://..."?} — 仅 http(s)/mailto；无 href 渲染为纯文本
- badge: {"type":"badge","label":"...","tone":"success|warn|danger|accent","icon":"emoji?"}
- stat: {"type":"stat","label":"...","value":"...","delta":"+12.4%|-3%"}
- progress: {"type":"progress","label":"...","value":0-100,"valueLabel":"70%"}
- divider: {"type":"divider"} / spacer: {"type":"spacer"}
- list: {"type":"list","items":["..."] or [{"title":"...","desc":"..."}]}
- table: {"type":"table","columns":["..."],"rows":[["...","..."]]} — 表头点击本地排序（升/降/还原，数值感知）
- chart: {"type":"chart","kind":"bars|line|donut","data":[{"label":"...","value":n,"color":"#hex?"}],"series":[...]?} — bars 默认；line 趋势；donut 占比；series=分组柱；负值柱高为 0 但标注照显；hover 显示精确值
- echart: {"type":"echart","preset":"bar|line|area|pie|scatter","title":"..."?,"height":n?,"data":[{"label":"...","value:n}]?,"series":[...]?} — ECharts 全功能图表（渐变/tooltip/动画/图例交互），视觉效果远超 chart；preset 模式用和 chart 一样的 data/series 格式自动构建主题化配置；也可传 "option":{...} 写原生 ECharts 配置（支持 radar/gauge/heatmap/dataZoom 等，option 中的函数会被过滤）；推荐用 echart 替代 chart
- tabs: {"type":"tabs","tabs":[{"label":"...","items":[...]}]} / accordion: {"type":"accordion","items":[{"title":"...","items":[...]}]}
- avatar: {"type":"avatar","name":"..."}
- plot: {"type":"plot","series":[{"expr":"sin(x)","label":"...","kind":"line|area|scatter"?,"params":[...]?}],"xMin":-5,"xMax":5,"yMin":?,"yMax":?,"title":"..."} — SVG 函数图（可拖拽平移/滚轮缩放；params 渲染实时滑块）；kind 缺省 line，area 填到基线，scatter 散点；表达式白名单 sin/cos/tan/asin/acos/atan/sqrt/cbrt/exp/log/ln/abs/floor/ceil/round/min/max/pow，常量 pi/e/tau，变量 x
- callout: {"type":"callout","tone":"info|success|warning|error","title":"...","content":"..."}
- steps: {"type":"steps","current":n,"steps":[{"title":"...","desc":"..."}]}
- keyvalue: {"type":"keyvalue","pairs":[{"key":"...","value":"..."}]} / json: {"type":"json","value":...} / code: {"type":"code","lang":"ts","code":"..."} / diff: {"type":"diff","diffs":[{"path":"...","oldText":"..."|null,"newText":"..."}]}
- copy: {"type":"copy","label":"复制","text":"..."}
- mermaid: {"type":"mermaid","code":"graph TD\\nA-->B"} — flowchart/sequence/class/gantt/pie/er/state/journey
- scene3d: {"type":"scene3d","title":"...","meshes":[{"shape":"box|sphere|cone|cylinder|torus","color":"#hex?","size":n|[w,h,d]?,"position":[x,y,z]?,"rotation":[rx,ry,rz]?,"scale":n?|[x,y,z]?}],"ambient":0-2?,"background":"#hex?"} — 拖拽旋转滚轮缩放
- timeline: {"type":"timeline","items":[{"title":"...","desc":"...","time":"..."}]}
- file-tree: {"type":"file-tree","items":[{"name":"...","type":"file|dir","children":[...]?}]} — 目录行可点击折叠
- breadcrumb: {"type":"breadcrumb","items":["首页","设置","账户"]}

Rules:
- Trigger: 结构化表达优于纯文本时就主动用围栏（要点、强调、对比、流程、步骤、状态、数据、演示），纯问答与一句话不套 UI。
- 围栏放在回答中该组件该在的位置，文字前后照常流动；不要把围栏套进别的代码围栏，JSON 字符串内不放 markdown。
- Component choice (每个主题一个主组件): 结论/提醒→callout · 2–4 指标→grid+stat · 进度→progress · 多阶段→steps · 要点→list · 配置→keyvalue · 对比→table · 趋势→echart(line) 或 chart(line) · 占比→echart(pie) 或 chart(donut) · 分类对比→echart(bar) 或 chart(bars) · 数学曲线→plot · 事件→timeline · 分页内容→tabs · 长内容→accordion · 树→file-tree · 代码→code · 文件变更→diff · 嵌套JSON→json · 架构/流程→mermaid · 仅几何内容→scene3d · 教学→quiz · 单操作→button(action)。优先 echart/table 而非文字堆砌；同一数据不重复出现在两个组件；每次回复 3–8 个组件，拿不准就少。
- 语法: 坏围栏降级为代码块，保持 JSON 严格。≥3 节点或含 table 的围栏发出前调用 validate_dsh_ui 验证，❌ 则修好再发；若 ❌ 回复里附了「已自动修复」的 JSON，照抄即可。
- 主题: 内容适配暗色；UI 主题跟随 app，不要自造。规模: ≤200 节点、嵌套≤8 层（超出被截断）；3D 网格 1–5 个；plot 给合理 xMin/xMax。
- v2 actions: button/input/select/checkbox/radio/switch/slider/textarea/quiz 可带 "action":"name"，交互以 [genui-action] name + 组件数据回传，届时重渲染更新 UI。可交互组件必须带 action（无 action 按钮禁用）；带 action 的按钮点击有「已触发」本地反馈。
- LOCAL-FIRST: UI 自己能做的状态变化（判卷、判题、重置、展开、选中）全部就地完成，零模型往返；action 只用于必须模型参与的事（生成新内容、执行工具、下一步建议）。
- Durable state: 交互状态按「会话+内容指纹」持久化——刷新/重放同一内容恢复原状；换内容（换题、改 spec）自动清空。重渲染相同内容保留状态，渲染新内容重置状态。
- Exam pattern: 每题一个 radio（group 题目名 + answer + explanation）+ 一个 submit（groups 全列）；用户答完点交卷，本地即时判分。仅当用户要新卷或追问建议时才重渲染。
- Secrets ban: GenUI 不得索取密码、API Key、访问令牌、恢复码等秘密；需要时拒绝并解释。
- Tool channel: render_ui 工具把同一 spec 渲染为工具行卡片（交付物型界面用）；围栏用于回答内联 UI。
- Panel: "panel":true 围栏只渲染进会话面板 dock 并原地更新；"append":true 追加合并（同标签 tabs 追加/新标签加入/尾部追加）；面板上限 200 节点/200 次追加，满了发 replace 重建。面板组件来的 [genui-action] 只回一个 panel:true 围栏 + 至多一行 10 字以内确认，不解释、不用普通围栏。`

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
