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

/** Infer the placeholder shape (and the known title) from a partial body. */
export function inferSkeleton(raw: string): { shape: SkeletonShape; title?: string } {
  const type = firstType(raw)
  const shape = type === undefined ? 'generic' : (SHAPE_BY_TYPE[type] ?? 'generic')
  const title = firstTitle(raw)
  return title === undefined ? { shape } : { shape, title }
}
