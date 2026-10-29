/**
 * Shape-aware streaming skeleton.
 *
 * While a fence body is still arriving and nothing has parsed yet, the block is
 * replaced by a placeholder. A generic three-bar placeholder communicates
 * "loading" but nothing about WHAT is loading, and it appears often enough to
 * feel like a different product from the component that replaces it. This module
 * reads what is already known from the partial body — the first component `type`
 * and the `title`, if it has arrived — so the placeholder can look like the thing
 * it is about to become.
 *
 * The inference is deliberately shallow: one regex each, no incremental parser.
 * Anything uncertain falls back to the generic shape, because a wrong guess is
 * worse than a neutral one.
 *
 * @module streaming-shape
 */

/** Placeholder layouts, one per component family that looks different enough. */
export type SkeletonShape =
  | 'card'
  | 'table'
  | 'chart'
  | 'list'
  | 'keyvalue'
  | 'stat'
  | 'text'
  | 'diagram'
  | 'code'
  | 'media'
  | 'control'
  | 'rule'
  | 'generic'

/** First component type → placeholder shape. Unknown types stay generic. */
const SHAPE_BY_TYPE: Readonly<Record<string, SkeletonShape>> = {
  card: 'card', accordion: 'card', tabs: 'card', col: 'card', row: 'card',
  table: 'table',
  chart: 'chart', echart: 'chart', plot: 'chart', sparkline: 'chart',
  list: 'list', steps: 'list', timeline: 'list', 'file-tree': 'list', keyvalue: 'list',
  stat: 'stat', progress: 'stat', badge: 'stat',
  text: 'text', callout: 'text', code: 'text',
  diagram: 'diagram', mermaid: 'diagram',
  diff: 'code', json: 'code',
  image: 'media', 'image-group': 'media', video: 'media', audio: 'media', scene3d: 'media',
  input: 'keyvalue', textarea: 'keyvalue', select: 'keyvalue', slider: 'keyvalue',
  checkbox: 'keyvalue', radio: 'keyvalue', switch: 'keyvalue', submit: 'keyvalue',
  choices: 'list', quiz: 'list', compare: 'media',
  // Small single-object components: a pill is the honest placeholder for a
  // button/link/icon, not a stack of paragraphs.
  button: 'control', link: 'control', icon: 'control', avatar: 'control',
  arrow: 'control', breadcrumb: 'control', copy: 'control',
  // Hairlines carry no content; a rule says "a line arrives here".
  divider: 'rule', spacer: 'rule',
  hero: 'media', carousel: 'media', map: 'media', svg: 'media',
  blocks: 'card', grid: 'card',
}

/** The `type` of the first component written, if it is already readable. */
function firstType(raw: string): string | undefined {
  const match = /"type"\s*:\s*"([a-z0-9-]{1,24})"/.exec(raw)
  return match?.[1]
}

/**
 * The first `title` value, including a title that is still being typed (no
 * closing quote yet) — a partially arrived title is still the real title, and
 * showing it early is the single biggest improvement over a grey bar.
 */
function firstTitle(raw: string): string | undefined {
  const match = /"title"\s*:\s*"([^"\\]{0,80})/.exec(raw)
  const title = match?.[1]?.trim()
  return title === undefined || title === '' ? undefined : title
}

/** What the prefix already tells us about the component's SIZE. */
export interface SkeletonDetail {
  /** Table: how many columns were declared (3 when unknown). */
  columns?: number
  /** Chart: the declared kind, which decides bars vs a donut ring. */
  chartKind?: string
  /** Text/callout: an estimate of the rendered line count. */
  lines?: number
}

/** Closed string literals inside the `columns` array, i.e. the declared count. */
function columnCount(raw: string): number | undefined {
  const start = raw.indexOf('"columns"')
  if (start < 0) return undefined
  const open = raw.indexOf('[', start)
  if (open < 0) return undefined
  let count = 0
  let inString = false
  let escaped = false
  for (let i = open + 1; i < raw.length; i++) {
    const ch = raw[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') { inString = false; count += 1 } else continue
      continue
    }
    if (ch === '"') inString = true
    else if (ch === ']') break
  }
  // A column still being typed is not counted: it has no closing quote yet.
  return count === 0 ? undefined : Math.min(count, 8)
}

/** Chart kind: `kind` (or a legacy `chartType`) when it already arrived. */
function chartKind(raw: string): string | undefined {
  const match = /"(?:kind|chartType)"\s*:\s*"([a-z]{1,12})"/.exec(raw)
  return match?.[1]
}

/** Rough rendered-line estimate: ~42 CJK/latin characters per line here. */
function lineEstimate(raw: string): number | undefined {
  const match = /"content"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(raw)
  const text = match?.[1]
  if (text === undefined) return undefined
  const chars = text.replace(/\\n/g, '\n').length
  if (chars === 0) return undefined
  return Math.min(6, Math.max(1, Math.ceil(chars / 42)))
}

/** Infer the placeholder shape, its known title, and its size hints. */
export function inferSkeleton(raw: string): {
  shape: SkeletonShape
  title?: string
  columns?: number
  chartKind?: string
  lines?: number
} {
  const type = firstType(raw)
  const shape = type === undefined ? 'generic' : (SHAPE_BY_TYPE[type] ?? 'generic')
  const detail: SkeletonDetail = {}
  if (shape === 'table') {
    const columns = columnCount(raw)
    if (columns !== undefined) detail.columns = columns
  }
  if (shape === 'chart') {
    const kind = chartKind(raw)
    if (kind !== undefined) detail.chartKind = kind
  }
  if (shape === 'text') {
    const lines = lineEstimate(raw)
    if (lines !== undefined) detail.lines = lines
  }
  // exactOptionalPropertyTypes: build the object incrementally instead of
  // passing `title: undefined`, which is not the same as an absent key here.
  const result: ReturnType<typeof inferSkeleton> = { shape, ...detail }
  const title = firstTitle(raw)
  if (title !== undefined) result.title = title
  return result
}
