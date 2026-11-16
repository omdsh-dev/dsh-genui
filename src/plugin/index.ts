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
import type WorkingDirectoryService from '@deepseek-ai/dsh-working-directory'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRenderUiTool, createValidateDshUiTool } from './tool.ts'
import { installFenceFeedback } from './fence-feedback.ts'
import { installDshGoNative } from './dsh-go-native.ts'

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

const RENDER_UI_TOOL_GUIDANCE = '- Tool channel: render_ui 工具把同一 spec 渲染为工具行卡片；围栏用于回答内联 UI。'
const COMPONENT_REFERENCE_PLACEHOLDER = 'dsh-genui:component-reference'

/** 围栏提示词保留基础规则，组件规范由 genui Skill 提供。 */
export const GENUI_SECTION_TEXT = `Render UI inside your reply with a fenced \`dsh-ui\` JSON block:

\`\`\`dsh-ui
{"title":"示例","gap":14,"items":[{"type":"text","content":"把这里换成你的组件"}]}
\`\`\`

Before producing a dsh-ui fence, call the skill tool to load \`genui\`. Its component vocabulary covers layout, display, charts, interaction, and advanced content; use its field definitions and examples.

**先问一句：删掉这个组件，读者会不会更费劲。** 会才出；不会就写正文。避免正文与组件重复。

Rules:
- LANGUAGE: reply+UI=conversation language; schema fixed. NEVER infer it from prompt/skill/examples/tools. Replace \`<user-language ...>\`; never emit these placeholders literally.
- JSON 严格：坏组件被丢弃，坏围栏变代码块；≥3 节点或含 table 时调 validate_dsh_ui，按诊断修改并重验；小围栏字段存疑也先验证。
- warning=block_markdown：按 replacement 改写并重验。
- 规模: ≤200 节点、嵌套≤8 层（超出被截断）。组件节点必须带字符串 \`type\`，字段遵循 genui skill。
- LOCAL-FIRST + actions: UI 能自己完成的状态变化在本地处理；action 用于需要模型参与的操作。交互以 [genui-action] name + 组件数据回传。
- Secrets ban: 不索取密码、API Key、Token、恢复码；需要时拒绝并解释。
${RENDER_UI_TOOL_GUIDANCE}
- 围栏位置：\`dsh-ui\` 只写在**回答正文**；写在 reasoning/思考块里不渲染、用户看不到——思考里验证好 spec，正文再输出同一份。
- Panel: "panel":true 只渲染进会话面板 dock 并原地更新；"append":true 追加合并；上限 200 节点/200 次追加，满了发 replace 重建。面板来的 [genui-action] 只回一个 panel:true 围栏 + 至多一行 10 字内确认。`

/** 最小围栏提示词要求模型加载完整组件规范。 */
export const GENUI_MINIMAL_SECTION_TEXT = `Render UI in the reply body using a fenced \`dsh-ui\` block containing valid JSON:

\`\`\`dsh-ui
{"items":[{"type":"text","content":"Example"}]}
\`\`\`

Before producing a dsh-ui fence, call the skill tool to load \`genui\`. Follow its component and safety rules.`

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
function componentReference(raw: string): string {
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
    const selected = section.filter(node => node.type !== 'code')
    return [heading, ...selected].map(node => {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) throw new Error(`genui SKILL.md 章节内容位置无效：${title}`)
      return raw.slice(start, end)
    }).join('\n\n')
  }).join('\n\n')
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
   * 默认开启，设置为 false 可以关闭同回合围栏修正。GenUI 回合的 reasoning-only 响应仍会交给宿主重试策略处理。
   * 每回合和每个围栏正文最多请求一次，子代理不触发，每次修正请求会消耗模型步数。
   */
  fenceFeedback?: boolean

  /**
   * 是否注册 render_ui 模型工具。默认开启，设置为 false 时关闭；不影响 validate_dsh_ui 和 dsh-ui 围栏渲染。
   */
  renderUiTool?: boolean

  /** 控制围栏系统提示词的内容；默认使用 full，false 关闭该提示段。 */
  fenceSection?: 'full' | 'minimal' | false
}

/** 注册 GenUI 围栏提示词、工具及可选宿主能力。 */
export function apply(ctx: Context, config?: GenuiPluginConfig): void {
  installDshGoNative(ctx, config?.fenceSection !== false)
  const renderUiToolEnabled = config?.renderUiTool !== false
  let reference: string | undefined
  ctx.systemPrompt.section({
    name: 'genui:reference',
    order: ctx.systemPrompt.getSectionOrder('STRUCTURED_OUTPUT'),
    interpolate: false,
    text: () => COMPONENT_REFERENCE_PLACEHOLDER,
  })
  if (config?.fenceSection !== false) {
    const text = config?.fenceSection === 'minimal' ? GENUI_MINIMAL_SECTION_TEXT : GENUI_SECTION_TEXT
    ctx.systemPrompt.section({
      name: 'genui:fence',
      order: ctx.systemPrompt.getSectionOrder('STRUCTURED_OUTPUT'),
      text: () => renderUiToolEnabled ? text : text.replace(`${RENDER_UI_TOOL_GUIDANCE}\n`, ''),
    })
  }
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    const skills = ctx.reflect.get('skills') as SkillRegistry | undefined
    const tools = ctx.reflect.get('tools') as ToolRuntime | undefined
    const scopedTool = tools?.get('skill', context.scope)
    const globalTool = tools?.get('skill')
    const nativeTool = assembly.tools.some(tool => tool.name === 'skill')
    const ptcTool = assembly.tools.some(tool => tool.name === 'run_code') && assembly.sections.some(section => section.name === 'tools:sdk' && section.text.includes('skill')) && tools?.schemas(context.scope).some(tool => tool.name === 'skill')
    const toolVisible = globalTool !== undefined && scopedTool === globalTool && (nativeTool || ptcTool)
    let skillAvailable = false
    if (skills && toolVisible) {
      const agent = context.scope as Agent | undefined
      const workingDirectory = ctx.reflect.get('workingDirectory') as WorkingDirectoryService | undefined
      const cwd = agent?.session && workingDirectory ? await workingDirectory.ensure(agent, context.signal) : undefined
      const lookup = { scope: context.scope, signal: context.signal, cwd }
      const summary = (await skills.list(lookup)).find(skill => skill.name === 'genui')
      if (summary?.invocation.modelInvocable) {
        const skill = await skills.get('genui', lookup)
        skillAvailable = skill?.invocation.modelInvocable === true
      }
    }
    const needsReference = !skillAvailable && (config?.fenceSection !== false || renderUiToolEnabled)
    return {
      ...assembly,
      sections: assembly.sections.map(section => {
        if (section.name === 'genui:reference' && section.text === COMPONENT_REFERENCE_PLACEHOLDER) return { ...section, text: needsReference ? (reference ??= componentReference(readFileSync(bundledSkillPath(), 'utf8'))) : '' }
        const fenceText = config?.fenceSection === 'minimal' ? GENUI_MINIMAL_SECTION_TEXT : GENUI_SECTION_TEXT
        const ownFenceText = renderUiToolEnabled ? fenceText : fenceText.replace(`${RENDER_UI_TOOL_GUIDANCE}\n`, '')
        if (section.name === 'genui:fence' && section.text === ownFenceText && !skillAvailable) {
          const text = section.text.replace('Before producing a dsh-ui fence, call the skill tool to load `genui`.', 'Follow the GenUI reference in this system prompt.')
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
