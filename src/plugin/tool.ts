/**
 * The `render_ui` tool: a model-facing channel that renders a GenUI spec as
 * an interactive card in the conversation TOOL ROW (route A of the design
 * doc). The ```dsh-ui fence channel renders inline in the reply; this tool
 * renders in the tool row and rides the harness's result `meta` projection:
 * `presentationMeta` stores the repaired spec, the browser toolview
 * (`src/client/toolview.tsx`) reads it from the result node and renders.
 *
 * Zero runtime harness imports, deliberately: an external plugin's node half
 * must not depend on the harness module graph at runtime (the profile
 * resolves only the plugin package itself). The definition is therefore a
 * plain `ToolDefinition` object — the exact shape `defineTool` returns — with
 * the arguments schema authored as JSON Schema (the harness validates args
 * and output with the same JSON Schema validator defineTool uses). Deep
 * validation, deterministic repair, and resource limits live in the shared
 * guard (`src/client/guard.ts`), which the schema deliberately stays loose
 * enough to reach.
 * @module @changfenhuang/dsh-genui/plugin/tool
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { GenericCallView, GenericResultView, JsonSchemaNode, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { GenuiSpec } from '../client/spec.ts'
import {
  GENUI_LIMITS, countDeclaredGenuiNodes, countGenuiNodes, repairGenuiSpec,
} from '../client/guard.ts'
import { completeFenceJson } from '../shared/fence-repair.ts'
import { validateRenderableChartSemantics } from './chart-contract.ts'

/**
 * Arguments schema: an open `spec` slot. The schema must NOT reject anything
 * the guard could repair — the model's component trees are imperfect by
 * nature, and the guard heals them; argument validation would only strand
 * them. `additionalProperties: false` keeps the call shape honest.
 *
 * `spec` IS typed `object` on purpose: the guard can only repair plain
 * records (a serialized JSON string, array, or scalar root is unusable), so
 * argument validation rejecting non-objects loses nothing repairable — and
 * it stops the model from double-encoding the tree as a string (observed
 * twice in the wild), failing fast with a clear schema error instead.
 */
const RENDER_UI_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    spec: {
      type: 'object',
      description: 'GenUI component tree (white-listed vocabulary, see the dsh-ui fence section in the system prompt). Deep-validated and repaired by the renderer. Pass the spec as a JSON OBJECT — never as a serialized JSON string (a string fails argument validation).',
      // Structural hints for the tool-call bridge. A bare `object` here was
      // observed to make some bridge layers stringify the whole spec into an
      // OpenAI-style `{ arguments: "<JSON>" }` wrapper (and to corrupt long
      // specs mid-stream). Declaring the known top-level fields gives the
      // bridge a concrete shape to serialize directly, while the schema stays
      // deliberately open (unknown keys tolerated, `items` elements are free
      // objects) so the guard — not the schema — remains the repair authority.
      properties: {
        title: { type: 'string', description: 'Short title shown as the card banner.' },
        gap: { type: 'number', description: 'Vertical gap between root items in px.' },
        panel: { type: 'boolean', description: 'Panel-only: renders into the session panel dock instead of the message flow.' },
        items: {
          type: 'array',
          description: 'Root component list (white-listed vocabulary).',
          items: { type: 'object' },
        },
      },
    },
  },
  required: ['spec'],
  additionalProperties: false,
}

/** The tool's canonical value is a short model-facing summary string. */
const RENDER_UI_OUTPUT_SCHEMA: JsonSchemaNode = { type: 'string', description: 'One-line human-readable render summary for the model.' }

/**
 * Read the `spec` argument defensively (presenters run on replayed args).
 *
 * The harness tool-call bridge has been observed to deliver arguments in
 * shapes other than the authored `{ spec: <object> }`:
 * - `{ spec: "<JSON string>" }` — spec serialized to text;
 * - `{ arguments: "<JSON string>" }` / `{ arguments: <object> }` — a
 *   double-encoded wrapper from the SDK tool-call bridge (seen live in the
 *   web GUI: small specs arrived wrapped this way, large specs arrived with
 *   their JSON corrupted mid-stream);
 * - a bare JSON string (double-encoded root).
 * Each shape is unwrapped here so the guard can repair the actual tree.
 * Corrupted JSON cannot be recovered (bytes were lost in transit): it yields
 * `undefined` plus a diagnostic log line for the transport-layer bug.
 */
function specOf(args: unknown): unknown {
  if (typeof args === 'string') {
    return parseSpecJson(args, 'bare-string')
  }
  if (typeof args !== 'object' || args === null) return undefined
  const record = args as Record<string, unknown>
  if ('spec' in record) {
    const s = record.spec
    if (typeof s === 'string') return parseSpecJson(s, 'spec-string')
    return unwrapSpec(s, 'spec')
  }
  if ('arguments' in record) {
    const a = record.arguments
    if (typeof a === 'string') return parseSpecJson(a, 'arguments-string')
    if (typeof a === 'object' && a !== null) return unwrapSpec(a, 'arguments')
  }
  return undefined
}

/**
 * Peel nested `{ spec: ... }` wrapper layers. Observed bridge shapes nest the
 * authored `spec` object one or more levels deep (e.g. the serialized text
 * inside `{ arguments: "..." }` is itself `{ spec: { title, gap, items } }`),
 * so unwrapping stops only at a value that carries no `spec` key.
 */
function unwrapSpec(value: unknown, shape: string): unknown {
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    if ('spec' in record) {
      const s = record.spec
      if (typeof s === 'string') return parseSpecJson(s, `${shape}/spec-string`)
      return unwrapSpec(s, `${shape}/spec`)
    }
  }
  return value
}

/** Try to decode a serialized spec; log a diagnostic when it is broken. */
function parseSpecJson(raw: string, shape: string): unknown {
  try {
    return unwrapSpec(JSON.parse(raw), shape)
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    const pos = /position (\d+)/.exec(detail)?.[1] ?? '?'
    console.error(`[genui-tool] spec wrapped as ${shape} but its JSON is broken (${raw.length} bytes, error at ${pos}); cannot recover — bytes lost in transit`)
    return undefined
  }
}

/** Total node count of a repaired spec — the shared guard traversal
 * (`countGenuiNodes`) so the tool reports the SAME number the panel fold and
 * validation use. A local walker used to under-count specs whose content
 * lives inside tabs/accordion/file-tree (their children are not `.items`). */
function countNodes(spec: GenuiSpec): number {
  return countGenuiNodes(spec, GENUI_LIMITS.maxNodes)
}

/** Tool-call title shared by the pending and completed presentations. */
function cardTitle(args: unknown): string | undefined {
  const spec = repairGenuiSpec(specOf(args))
  return spec === null ? undefined : `渲染 UI：${spec.title ?? '未命名'}`
}

/**
 * Build the render_ui tool definition. Registered by the plugin node half;
 * `ctx.tools.register` consumes it exactly like a `defineTool` result.
 */
export function createRenderUiTool(): ToolDefinition {
  return {
    name: 'render_ui',
    description:
      'Render an interactive UI card in the conversation tool row by passing a GenUI spec (a white-listed component tree; the same vocabulary as the ```dsh-ui fence, see the system prompt). '
      + 'Use it when the user asks for a structured panel, dashboard, or form that belongs in the tool row rather than inline in the reply. '
      + 'The card is interactive client-side (tabs, buttons, inputs, switches); components carrying an "action" field send [genui-action] back to you when the user interacts, and you should re-render the updated UI.',
    parameters: RENDER_UI_PARAMETERS,
    output: {
      schema: RENDER_UI_OUTPUT_SCHEMA,
      render(_args: unknown, value: JsonValue): ContentBlock[] {
        return [{ type: 'text', text: String(value) }]
      },
      presentationMeta(args: unknown): JsonValue {
        // The browser toolview reads the repaired spec from result meta. The
        // spec is JSON-safe by construction (only string/number/boolean/array
        // fields after repair), so the widening cast is lossless.
        return repairGenuiSpec(specOf(args)) as unknown as JsonValue
      },
    },
    async execute(args: unknown): Promise<JsonValue> {
      const input = specOf(args)
      const chartErrors = validateRenderableChartSemantics(input)
      if (chartErrors.length > 0) {
        throw new Error('render_ui spec invalid: ' + chartErrors.join('; '))
      }
      const spec = repairGenuiSpec(input)
      if (spec === null) {
        return 'render_ui：spec 无效 —— 根对象需要 "items" 数组（组件树白名单见系统提示词），请修正后重试。'
      }
      const title = spec.title ?? '未命名'
      return `已渲染 UI「${title}」（${countNodes(spec)} 个组件）。用户现在可以看到这张卡片；组件带 action 时，用户交互会以 [genui-action] 消息发回给你，届时请重新渲染更新后的界面。`
    },
    presentCall(args: unknown): GenericCallView | undefined {
      const title = cardTitle(args)
      return title === undefined ? undefined : { card: 'generic', title, kind: 'other' }
    },
    presentResult(args: unknown): GenericResultView | undefined {
      const title = cardTitle(args)
      return title === undefined ? undefined : { card: 'generic', title }
    },
  }
}

/**
 * The `validate_dsh_ui` tool: a model-facing pre-flight check for the
 * ```dsh-ui fence channel. The model calls it with the JSON text it is about
 * to put inside a fence; it reports whether the body parses as a valid GenUI
 * spec, and when it does not, WHERE it breaks and WHAT is likely wrong
 * (bracket counts, common typo classes) so the model can fix and re-validate
 * before emitting — turning "render a red banner after the fact" into
 * "verify before you send". Purely local: no LLM, no network, no DOM.
 */
const VALIDATE_DESCRIPTION =
  'Validate the JSON body of a ```dsh-ui fence BEFORE emitting it — use for non-trivial specs (≥3 nodes or containing a table); skip for trivial ones (≤2 nodes). '
  + 'Pass the exact JSON text you are about to put inside the fence as the "spec" argument (a string). '
  + 'Returns ✅ when it parses as a valid GenUI spec, or ❌ with the exact position, bracket counts, and likely causes when it does not — fix the JSON, re-validate, and only then emit the fence. '
  + 'When the JSON is broken but repairable (unescaped quotes, trailing commas, missing closers), the ❌ reply INCLUDES the auto-repaired JSON — copy it verbatim into the fence instead of rewriting by hand.'

const VALIDATE_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    spec: {
      oneOf: [
        { type: 'string', description: 'The exact JSON text of the fence body.' },
        { type: 'object', description: 'The spec object (serialized before validation).' },
      ],
      description: 'The dsh-ui fence body to validate: pass the JSON as a string for an exact check, or as the spec object.',
    },
  },
  required: ['spec'],
  additionalProperties: false,
}

/** Read the fence-body text from the call args (string preferred, object serialized). */
function fenceTextOf(args: unknown): string | null {
  if (typeof args === 'string') return args
  if (typeof args !== 'object' || args === null) return null
  const record = args as Record<string, unknown>
  const s = 'spec' in record ? record.spec : 'arguments' in record ? record.arguments : undefined
  if (typeof s === 'string') return s
  if (typeof s === 'object' && s !== null) return JSON.stringify(s)
  return null
}

/** Count structural brackets outside string literals. */
function bracketCounts(raw: string): { '{': number; '}': number; '[': number; ']': number } {
  const counts = { '{': 0, '}': 0, '[': 0, ']': 0 }
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') counts['{'] += 1
    else if (ch === '}') counts['}'] += 1
    else if (ch === '[') counts['['] += 1
    else if (ch === ']') counts[']'] += 1
  }
  return counts
}

/** Short structural hint from bracket counts (empty when balanced). */
function bracketDiagnostic(raw: string): string {
  const c = bracketCounts(raw)
  const diffs: string[] = []
  if (c['{'] !== c['}']) {
    const d = c['{'] - c['}']
    diffs.push(`{ ×${c['{']} / } ×${c['}']} → ${d > 0 ? `缺 ${d} 个 }` : `多 ${-d} 个 }`}`)
  }
  if (c['['] !== c[']']) {
    const d = c['['] - c[']']
    diffs.push(`[ ×${c['[']} / ] ×${c[']']} → ${d > 0 ? `缺 ${d} 个 ]` : `多 ${-d} 个 ]`}`)
  }
  return diffs.length === 0 ? '' : `  括号计数：${diffs.join('；')}（长表格最易在收尾处错位，如把 ]]}]} 写成 ]}]}]}）\n`
}

const COMMON_CAUSES =
  '常见原因：① 收尾括号错位/缺失（{ 与 }、[ 与 ] 数量不相等）② 字符串值内用了半角引号 "（中文引语请用 “” 或 「」）③ 尾随逗号 ④ 字符串未闭合'

/** Return the model-facing chart field failure for one parsed fence body. */
function chartValidationFailure(value: unknown): string | undefined {
  const errors = validateRenderableChartSemantics(value)
  return errors.length === 0 ? undefined : `❌ chart 字段验证失败：\n- ${errors.join('\n- ')}`
}

/** Build the validate_dsh_ui tool definition (registered alongside render_ui). */
export function createValidateDshUiTool(): ToolDefinition {
  return {
    name: 'validate_dsh_ui',
    description: VALIDATE_DESCRIPTION,
    parameters: VALIDATE_PARAMETERS,
    output: {
      schema: { type: 'string', description: 'Validation verdict for the model.' },
      render(_args: unknown, value: JsonValue): ContentBlock[] {
        return [{ type: 'text', text: String(value) }]
      },
    },
    async execute(args: unknown): Promise<JsonValue> {
      const raw = fenceTextOf(args)
      if (raw === null || raw.trim() === '') {
        return '❌ validate_dsh_ui：缺少 spec 参数 —— 把围栏 JSON 文本作为 spec 传入。'
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error)
        // Pre-emission, both repair tiers are safe (no streaming half exists
        // in a validation call). When the repair succeeds, hand the model the
        // FIXED JSON instead of asking it to re-author the fix — re-writing
        // the whole fence by hand is where the next typo comes from.
        const repaired = completeFenceJson(raw)
        if (repaired !== null) {
          const repairedValue = JSON.parse(repaired.text) as unknown
          const chartFailure = chartValidationFailure(repairedValue)
          if (chartFailure !== undefined) return chartFailure
          if (repairGenuiSpec(repairedValue) !== null) {
            return `❌ dsh-ui 围栏 JSON 解析失败：${detail}。\n${bracketDiagnostic(raw)}  已自动修复 ${repaired.repairs} 处，下面是修复后的 JSON，直接作为围栏正文发出即可（无需再验证）：\n\`\`\`\n${repaired.text}\n\`\`\``
          }
        }
        return `❌ dsh-ui 围栏 JSON 解析失败：${detail}。\n${bracketDiagnostic(raw)}  自动修复未能恢复（结构损坏），请按错误信息修正后重新调用本工具验证，通过后再发出围栏。\n${COMMON_CAUSES}`
      }
      const chartFailure = chartValidationFailure(parsed)
      if (chartFailure !== undefined) return chartFailure
      const spec = repairGenuiSpec(parsed)
      if (spec === null) {
        return '❌ 不是合法 GenUI spec：根对象需要 "items" 数组，且每个节点 type 必须在白名单内（见系统提示词）。请修正后重新验证。'
      }
      const validCount = countNodes(spec)
      const declaredCount = countDeclaredGenuiNodes(parsed, GENUI_LIMITS.maxNodes + 1)
      if (declaredCount > validCount) {
        return `❌ 验证未通过：检测到声明了 ${declaredCount} 个组件，但仅成功解析出 ${validCount} 个（有 ${declaredCount - validCount} 个组件因字段格式异常被丢弃）。常见原因：table 的 columns/rows 不是二维字符串数组、tabs 的 items/content 缺失、嵌套组件字段类型不符。请修正后重新验证。`
      }
      return `✅ dsh-ui spec 合法（${validCount} 个组件），可以发出围栏。`
    },
    presentCall(): GenericCallView | undefined {
      return { card: 'generic', title: '验证 dsh-ui 围栏', kind: 'other' }
    },
    presentResult(): GenericResultView | undefined {
      return { card: 'generic', title: '验证 dsh-ui 围栏' }
    },
  }
}
