import { validateGenuiChartSemantics } from '../client/guard.ts'

/** Plain object helper for raw model-authored specs. */
function obj(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Visit chart nodes through the component-bearing containers understood by
 * the GenUI guard. This deliberately does not recursively inspect arbitrary
 * objects (for example `json.value` or `echart.option`), where a nested
 * `{type:"chart"}` is data rather than a GenUI node.
 */
function visitChartNodes(
  value: unknown,
  visit: (node: Record<string, unknown>, at: string) => void,
): void {
  function walkNode(value: unknown, at: string): void {
    const node = obj(value)
    if (node === undefined || typeof node.type !== 'string') return
    if (node.type === 'chart') visit(node, at)

    if ((node.type === 'row' || node.type === 'col' || node.type === 'grid' || node.type === 'card') && Array.isArray(node.items)) {
      walk(node.items, `${at}.items`)
      return
    }
    if (node.type === 'tabs' && Array.isArray(node.tabs)) {
      for (let index = 0; index < node.tabs.length; index++) {
        const tab = obj(node.tabs[index])
        if (tab === undefined) continue
        const items = tab.items !== undefined ? tab.items : tab.content
        if (Array.isArray(items)) walk(items, `${at}.tabs[${index}].items`)
        else walkNode(items, `${at}.tabs[${index}].items`)
      }
      return
    }
    if (node.type === 'accordion' && Array.isArray(node.items)) {
      for (let index = 0; index < node.items.length; index++) {
        const item = obj(node.items[index])
        if (item === undefined) continue
        const items = item.items !== undefined ? item.items : item.content
        if (Array.isArray(items)) walk(items, `${at}.items[${index}].items`)
        else walkNode(items, `${at}.items[${index}].items`)
      }
      return
    }
    if (node.type === 'list' && Array.isArray(node.items)) {
      for (let index = 0; index < node.items.length; index++) {
        walkNode(node.items[index], `${at}.items[${index}]`)
      }
    }
  }

  function walk(list: unknown, path: string): void {
    if (!Array.isArray(list)) return
    for (let index = 0; index < list.length; index++) {
      walkNode(list[index], `${path}[${index}]`)
    }
  }

  const root = obj(value)
  if (root === undefined) return
  if (!Array.isArray(root.items) && root.type === 'chart') walkNode(root, 'spec')
  else walk(root.items, 'items')
}

/**
 * Validate the native chart contract all the way to something the renderer
 * can actually draw. The shared guard still owns field/type validation; this
 * layer adds renderer-specific invariants that would otherwise produce an
 * empty line/donut chart or a grouped-bars shell with no points.
 */
export function validateRenderableChartSemantics(value: unknown): string[] {
  const errors = validateGenuiChartSemantics(value)
  visitChartNodes(value, (node, at) => {
    const kind = node.kind === undefined ? 'bars' : node.kind

    if (Array.isArray(node.data) && node.data.length === 0) {
      errors.push(`${at}.data must not be empty`)
    }
    if (Array.isArray(node.series)) {
      if (node.series.length === 0) errors.push(`${at}.series must not be empty`)
      for (let index = 0; index < node.series.length; index++) {
        const series = obj(node.series[index])
        if (series !== undefined && Array.isArray(series.data) && series.data.length === 0) {
          errors.push(`${at}.series[${index}].data must not be empty`)
        }
      }
    }

    if (kind === 'line' || kind === 'donut') {
      if (node.series !== undefined) {
        errors.push(`${at}.series is only supported for bars`)
      }
      if (node.data === undefined) {
        errors.push(`${at}.data is required for ${kind}`)
      }
    }
  })
  return errors
}
