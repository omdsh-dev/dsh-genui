import type { GenuiSpec, GenuiTab } from '../client/spec.ts'

/** If `spec` is a single root `tabs` node, its tabs; otherwise null. */
function asTabs(spec: GenuiSpec): GenuiTab[] | null {
  if (spec.items.length !== 1) return null
  const only = spec.items[0]
  if (only?.type !== 'tabs' || !Array.isArray(only.tabs)) return null
  return only.tabs
}

/**
 * Merge an `append` spec into the current panel spec:
 * - both sides single-tabs containers → merge BY TAB LABEL: items of
 *   same-labelled tabs are appended, new labels are added (order preserved);
 * - otherwise → plain item lists are appended to the tail.
 * The previous title wins unless it was absent. `next` is returned as-is when
 * there is nothing to merge into. Export for tests.
 */
export function mergePanelSpecs(prev: GenuiSpec | null, next: GenuiSpec): GenuiSpec {
  if (prev === null || prev.items.length === 0 && (prev.computed?.length ?? 0) === 0) return next
  const title = prev.title ?? next.title
  const computed = [...(prev.computed ?? []), ...(next.computed ?? [])]
  const base = { ...prev, ...(title === undefined ? {} : { title }), ...(computed.length === 0 ? {} : { computed }) }
  const prevTabs = asTabs(prev)
  const nextTabs = asTabs(next)
  if (prevTabs !== null && nextTabs !== null) {
    const merged = new Map(prevTabs.map(t => [t.label, { label: t.label, items: [...t.items] }]))
    for (const tab of nextTabs) {
      const existing = merged.get(tab.label)
      if (existing !== undefined) existing.items.push(...tab.items)
      else merged.set(tab.label, { label: tab.label, items: [...tab.items] })
    }
    return { ...base, items: [{ type: 'tabs', tabs: [...merged.values()] }] }
  }
  return { ...base, items: [...prev.items, ...next.items] }
}
