/**
 * GenUI plugin: teaches the model the ```dsh-ui fence syntax for emitting
 * declarative UI components inline in its reply. The browser half renders the
 * fence through GenuiBlock (ui-primitives); this host half only tells the
 * model the language exists, so a session without the plugin simply never
 * emits fences and nothing changes.
 *
 * The section uses the host's centrally allocated structured-output placement.
 * @module @changfenhuang/dsh-genui
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { SkillProvider } from '@deepseek-ai/dsh-skill'
import type SkillRegistry from '@deepseek-ai/dsh-skill'
import type ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type WorkingDirectoryService = {
  ensure(agent: Agent, signal?: AbortSignal): Promise<string>
}
import { createRenderUiTool, createValidateDshUiTool } from './tool.ts'
import { installFenceFeedback } from './fence-feedback.ts'
import { installDshGoNative } from './dsh-go-native.ts'
import { COMPONENT_SCHEMAS } from '../client/genui-runtime/schema.ts'

/* ---------------- lazy engine asset route ---------------- */

/**
 * The mermaid/three engines ship as standalone IIFE bundles under
 * `lib/assets/` and are fetched by the client ONLY when a spec needs them.
 * This route serves them from the plugin's own package directory through the
 * host webserver service — the longest-prefix rule lets it win over the
 * generic `/plugins` bundle route, and no host source change is needed. The
 * service is optional at this plugin's start time, so a dependency fiber owns
 * the registration and follows the webserver through late binding, replacement,
 * and plugin reloads.
 */

/** Route prefix under /plugins; anything under it is this plugin's asset. */
const ASSET_ROUTE_PATH = '/plugins/@changfenhuang/dsh-genui/assets'

/** Safe flat file names only: no slashes, no traversal, js assets only. */
const ASSET_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/

/** Strong validator for one asset: its content hash (assets are built output and fixed per release). */
export function assetEtag(body: Uint8Array): string {
  return `"${createHash('sha1').update(body).digest('hex').slice(0, 20)}"`
}

/** Whether an `If-None-Match` header already names `etag` (comma list, `*`, or weak `W/` forms). */
export function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  const raw = Array.isArray(header) ? header.join(',') : header
  if (raw === undefined) return false
  return raw.split(',').some((candidate) => {
    const value = candidate.trim().replace(/^W\//, '')
    return value === '*' || value === etag
  })
}

/** The handler itself (registered via the optional webServer probe). */
export async function serveGenuiAsset(
  req: IncomingMessage,
  res: ServerResponse,
  assetDirectory?: string,
): Promise<void> {
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
    const dir = assetDirectory ?? fileURLToPath(new URL('./assets/', import.meta.url))
    const body = await readFile(join(dir, file))
    const etag = assetEtag(body)
    // The client always asks for `?rev=<bundle rev>`, which changes with every rebuild, so a given URL names
    // one content: cache it for a year. Requests without a rev (older clients, hand-typed URLs) still revalidate
    // cheaply through the ETag, so they can never be served stale.
    const versioned = new URL(req.url ?? '/', 'http://x').searchParams.has('rev')
    const headers = {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache',
      etag,
    }
    if (etagMatches(req.headers['if-none-match'], etag)) {
      res.writeHead(304, headers)
      res.end()
      return
    }
    res.writeHead(200, headers)
    res.end(body)
  } catch {
    // Missing asset (old build) — a loud 404; the client shows its fallback.
    res.writeHead(404)
    res.end()
  }
}

const RENDER_UI_TOOL_GUIDANCE = '- Tool channel: render_ui 用于工具结果区域的独立 UI；正文内联用围栏，持续更新的会话面板用 panel:true。围栏和工具都能交互并保存状态，按呈现位置选择。'
const COMPONENT_REFERENCE_PLACEHOLDER = 'dsh-genui:component-reference'
const LOAD_GENUI_SKILL = 'Before emitting UI, MUST call the skill tool to load `genui`.'

/** 默认按内容任务主动使用 UI，组件规范由 genui Skill 提供。 */
export const GENUI_SECTION_TEXT = `Render reply UI with a \`dsh-ui\` JSON block:

\`\`\`dsh-ui
{"items":[{"type":"callout","content":"一个 items 对象一个组件"},{"type":"table","columns":["组件","字段"],"rows":[["callout","content"]]}]}
\`\`\`

${LOAD_GENUI_SKILL}
RFC2119: MUST=必须；SHOULD=推荐；MAY=可选。

当前使用完整档（fenceSection: full）。下列任务 SHOULD 优先直接用最小的合适组件呈现，不必等用户提醒：
- 按共同维度比较选项或取舍 → table / choices；展示前后视觉差异 → compare。
- 用数值解释趋势、占比或多项指标关系 → chart / echart / table；单个数字无需强行出组件。
- 理解结果依赖步骤顺序、分支或结构关系 → steps / diagram / mermaid。
- 需要筛选、选择或计算 → input / select / choices + 相应结果组件。
普通解释和短清单默认正文，仅在需要比较、关系表达或交互时用组件；不按条数、字数或回答长度触发，没有组件数量配额。信息只呈现一次。MUST 服从用户明确的纯文字要求。card MAY 用作容器。
生成围栏本身不是仓库视觉改动，无需为此读源码、写文件、起服务；用户要求开发或排错时再按需操作。

Rules:
- LANGUAGE: MUST match reply+UI to conversation language; NEVER infer it from examples/tools. Replace \`<user-language ...>\`; never emit placeholders literally.
- JSON MUST 严格合法：≥3 节点或含 table 时 MUST 调 validate_dsh_ui，按诊断修改并重验；通过后 MUST 逐字复制 native_fence_json / validated_json / repaired_json，不重新编写。小围栏字段存疑也先验证。
- warning=block_markdown：按 replacement 改写并重验。
- 规模: ≤200 节点、嵌套≤8 层（超出被截断）。组件节点必须带字符串 \`type\`，字段遵循 genui skill。
- LOCAL-FIRST + actions: UI 能自己完成的状态变化在本地处理；action 用于需要模型参与的操作。交互以 [genui-action] name + 组件数据回传。
- Secrets ban: 不索取密码、API Key、Token、恢复码；需要时拒绝并解释。
${RENDER_UI_TOOL_GUIDANCE}
- 围栏位置：\`dsh-ui\` 只写在**回答正文**；写在 reasoning/思考块里不渲染、用户看不到——思考里验证好 spec，正文再输出同一份。
- Panel: "panel":true 只渲染进会话面板 dock 并原地更新；"append":true 追加，上限 200 节点/200 次，满了发 replace。面板来的 [genui-action] 只回一个 panel:true 围栏 + 至多一行 10 字内确认。`

/** 最小围栏提示词要求模型加载完整组件规范。 */
export const GENUI_MINIMAL_SECTION_TEXT = `fenceSection: minimal. RFC2119: MUST=required; MAY=optional.
MAY emit reply-body \`dsh-ui\` JSON; MUST follow user preference.
${LOAD_GENUI_SKILL}
生成围栏无需改文件或启动应用。

\`\`\`dsh-ui
{"items":[{"type":"text","content":"Example"}]}
\`\`\``

const GENUI_QUICK_REFERENCE = [
  '## 组件词汇（只允许这些 type）',
  Object.keys(COMPONENT_SCHEMAS).map(type => `\`${type}\``).join(' · '),
  '- chart: kind (bars/line/donut), data [{label,value}]; table: columns + rows; callout: content, tone (info/success/warning/error).',
  '- stat: label + value; keyvalue: pairs [{key,value}]; steps: steps [{title}]; file-tree: items [{name,type}] (file/dir).',
  '- button/choices 需要 action 才能回传。需要结构或字段诊断时，调用 validate_dsh_ui（若可用）。',
].join('\n')

const GENUI_REFERENCE_RULES = 'Reply and write UI text in the conversation language. Never request passwords, API keys, tokens, or recovery codes. Validate complex specs with validate_dsh_ui and fix diagnostics. For panels, panel:true replaces the panel; append:true appends, within 200 nodes and 200 appends. Respond to panel actions with an updated panel.'

/**
 * Register the GenUI output-language section and the render_ui tool.
 * @param ctx - cordis context.
 */
// `tools` is intentionally NOT injected: the service is optional for this
// plugin — hosts without tool access keep the fence channel working. Cordis
// inject entries are hard requirements, so the registry is probed at runtime
// instead (see apply).
export const name = '@changfenhuang/dsh-genui'
export const inject = ['systemPrompt']

const BUNDLED_SKILL_RANK = 600
const BUNDLED_SKILL_PROVIDER = 'dsh-genui'
const BUNDLED_SKILL_INVOCATION = { modelInvocable: true, userInvocable: true } as const

/**
 * The frontmatter field the routing description comes from.
 *
 * A second copy of this sentence in code drifted from SKILL.md unnoticed, and the
 * panel showed the code copy while the model read the same string — so an edit to
 * the skill's own frontmatter changed nothing. The file is the only source.
 */
function frontmatterField(front: string, key: string): string | undefined {
  const line = new RegExp('^\\s*' + key + '\\s*:\\s*(.+?)\\s*$', 'mu').exec(front)
  return line?.[1]?.replace(/^['"]|['"]$/gu, '')
}

/** 获取随插件发布的 GenUI Skill 路径。 */
function bundledSkillPath(): string {
  const moduleDirectory = dirname(fileURLToPath(new URL(import.meta.url)))
  return basename(moduleDirectory) === 'plugin'
    ? resolve(moduleDirectory, '../../SKILL.md')
    : resolve(moduleDirectory, '../SKILL.md')
}

/** 从 Skill 中提取组件字段和结构说明，供没有 Skill 工具的模型使用。 */
function componentReference(raw: string, loadedSkill?: string): string {
  const nodes = fromMarkdown(raw).children
  const headings = ['组件词汇（只允许这些 type）', '行内富文本（文字类回答的底座）', 'Computed（输入驱动计算）', '地图 ']
  return headings.map(title => {
    const index = nodes.findIndex(node => node.type === 'heading' && node.children[0]?.type === 'text' && node.children[0].value === title)
    if (index < 0) throw new Error(`genui SKILL.md 缺少组件参考章节：${title}`)
    const heading = nodes[index]!
    if (heading.type !== 'heading' || heading.position?.start.offset === undefined) throw new Error(`genui SKILL.md 章节位置无效：${title}`)
    const remaining = nodes.slice(index + 1)
    const nextIndex = remaining.findIndex(node => node.type === 'heading' && node.depth <= heading.depth)
    const section = nextIndex < 0 ? remaining : remaining.slice(0, nextIndex)
    const selected = section.filter(node => node.type !== 'code').flatMap(node => node.type === 'list' ? node.children : [node])
    const source = (node: typeof heading | (typeof selected)[number]) => {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) throw new Error(`genui SKILL.md 章节内容位置无效：${title}`)
      return raw.slice(start, end)
    }
    const missing = selected.map(source).filter(part => loadedSkill === undefined || !loadedSkill.includes(part))
    return missing.length === 0 ? '' : [source(heading), ...missing].join('\n\n')
  }).filter(Boolean).join('\n\n')
}

/** Recognize the callable loader contract in the agent's view, including preset-owned tools. */
function isSkillLoader(tool: ToolDefinition | undefined): boolean {
  const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  const input = tool?.parameters?.properties
  const output = tool?.output?.schema
  return record(input) && record(input.name) && input.name.type === 'string'
    && record(output) && record(output.properties) && record(output.properties.content)
    && output.properties.content.type === 'string'
}

/** Register through the provider path so source=bundled also gets bundled precedence. */
function bundledSkillProvider(): SkillProvider {
  const path = bundledSkillPath()
  const raw = readFileSync(path, 'utf8')
  const end = raw.indexOf('\n---\n', 4)
  if (!raw.startsWith('---\n') || end < 0) throw new Error('genui SKILL.md has invalid frontmatter')
  const description = frontmatterField(raw.slice(4, end), 'description')
  if (description === undefined) throw new Error('genui SKILL.md frontmatter has no description')
  return {
    name: BUNDLED_SKILL_PROVIDER,
    list: () => Promise.resolve([{
      name: 'genui',
      description,
      invocation: BUNDLED_SKILL_INVOCATION,
      source: 'bundled',
      provider: BUNDLED_SKILL_PROVIDER,
      path,
      resourceBase: { kind: 'directory', path: dirname(path) },
      rank: BUNDLED_SKILL_RANK,
      locator: path,
    }]),
    get: () => Promise.resolve({
      name: 'genui',
      description,
      invocation: BUNDLED_SKILL_INVOCATION,
      source: 'bundled',
      provider: BUNDLED_SKILL_PROVIDER,
      path,
      resourceBase: { kind: 'directory', path: dirname(path) },
      content: raw.slice(end + 5),
    }),
  }
}

/**
 * Plugin config as the host passes it (unvalidated: the node half deliberately
 * imports no schema library, so a profile can set these keys directly).
 */
export interface GenuiPluginConfig {
  /**
   * 在最终 dsh-ui 围栏无法渲染的回合中请求模型发送一次修正版（issue #160）。
   * 默认开启，设置为 false 可以关闭同回合围栏修正。GenUI 回合只返回思考或空白时，仍由宿主重试。
   * 每回合和每个围栏正文最多请求一次，子代理不触发，每次修正请求会消耗模型步数。
   */
  fenceFeedback?: boolean

  /**
   * 是否注册 render_ui 模型工具。默认开启，设置为 false 时关闭；不影响 validate_dsh_ui 和 dsh-ui 围栏渲染。
   */
  renderUiTool?: boolean

  /** 围栏提示档位：full（默认）主动用于适合的任务，minimal 只教语法，false 关闭该提示段。 */
  fenceSection?: 'full' | 'minimal' | false
}

/** 注册 GenUI 围栏提示词、工具及可选宿主能力。 */
export function apply(ctx: Context, config?: GenuiPluginConfig): void {
  installDshGoNative(ctx, config?.fenceSection !== false)
  const renderUiToolEnabled = config?.renderUiTool !== false
  const fenceText = config?.fenceSection === 'minimal' ? GENUI_MINIMAL_SECTION_TEXT : GENUI_SECTION_TEXT
  const ownFenceText = renderUiToolEnabled ? fenceText : fenceText.replace(`${RENDER_UI_TOOL_GUIDANCE}\n`, '')
  let bundledRaw: string | undefined
  ctx.systemPrompt.section({
    name: 'genui:reference',
    order: ctx.systemPrompt.getSectionOrder('STRUCTURED_OUTPUT'),
    interpolate: false,
    text: () => COMPONENT_REFERENCE_PLACEHOLDER,
  })
  if (config?.fenceSection !== false) {
    ctx.systemPrompt.section({
      name: 'genui:fence',
      order: ctx.systemPrompt.getSectionOrder('STRUCTURED_OUTPUT'),
      text: () => ownFenceText,
    })
  }
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    const skills = ctx.reflect.get('skills') as SkillRegistry | undefined
    const tools = ctx.reflect.get('tools') as ToolRuntime | undefined
    const scopedTool = tools?.get('skill', context.scope)
    const sdkSection = assembly.sections.find(section => section.name === 'tools:sdk')
    const schemas = tools?.schemas(context.scope) ?? []
    const skillSchemaVisible = schemas.some(tool => tool.name === 'skill')
    const toolVisible = isSkillLoader(scopedTool) && skillSchemaVisible && (sdkSection === undefined || sdkSection.text.includes('skill'))
    let skillAvailable = false
    let referenceUpdate = ''
    if (skills && toolVisible) {
      const agent = context.scope as Agent | undefined
      const workingDirectory = ctx.reflect.get('workingDirectory') as WorkingDirectoryService | undefined
      const cwd = agent?.session && workingDirectory ? await workingDirectory.ensure(agent, context.signal) : undefined
      const lookup = { scope: context.scope, signal: context.signal, cwd }
      const summary = (await skills.list(lookup)).find(skill => skill.name === 'genui')
      if (summary?.invocation.modelInvocable) {
        const skill = await skills.get('genui', lookup)
        if (skill?.invocation.modelInvocable) {
          skillAvailable = true
          referenceUpdate = componentReference(bundledRaw ??= readFileSync(bundledSkillPath(), 'utf8'), skill.content)
        }
      }
    }
    const referenceEnabled = config?.fenceSection !== false
      || (renderUiToolEnabled && schemas.some(tool => tool.name === 'render_ui'))
    const referenceText = !referenceEnabled ? '' : skillAvailable ? referenceUpdate : GENUI_QUICK_REFERENCE
    return {
      ...assembly,
      sections: assembly.sections.map(section => {
        if (section.name === 'genui:reference' && section.text === COMPONENT_REFERENCE_PLACEHOLDER) return { ...section, text: referenceText }
        if (section.name === 'genui:fence' && section.text === ownFenceText && (!skillAvailable || referenceUpdate)) {
          const guidance = skillAvailable
            ? `${LOAD_GENUI_SKILL} For behavior, fields and delivery, current system guidance and reference updates MUST take precedence over the loaded skill.`
            : 'Follow the GenUI reference in this system prompt.'
          const text = section.text.replace(LOAD_GENUI_SKILL, guidance)
          return { ...section, text: config?.fenceSection === 'minimal' ? `${text}\n\n${GENUI_REFERENCE_RULES}` : text }
        }
        return section
      }),
    }
  })
  installFenceFeedback(ctx, config?.fenceFeedback !== false, renderUiToolEnabled)
  // Hosts without tool access keep the fence channel. The dependency fiber
  // starts whenever tools becomes available and unloads its registrations
  // before either the service or this plugin is replaced.
  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.effect(function* () {
      if (renderUiToolEnabled) {
        yield toolsCtx.tools.register(createRenderUiTool())
      }
      yield toolsCtx.tools.register(createValidateDshUiTool(config?.fenceSection !== false))
    }, 'dsh-genui: model tools')
  })

  ctx.inject(['skills'], (skillCtx) => {
    skillCtx.skills.registerProvider(() => bundledSkillProvider())
  })

  // webServer.register returns a raw disposer, so an explicit effect binds the
  // route to the dependency fiber instead of leaving it in the host route table.
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.reflect.get('webServer') as { register(route: unknown): () => void }
    webCtx.effect(
      () => webServer.register({ kind: 'prefix', path: ASSET_ROUTE_PATH, handler: (req: IncomingMessage, res: ServerResponse) => serveGenuiAsset(req, res) }),
      'dsh-genui: asset route',
    )
  })
}
