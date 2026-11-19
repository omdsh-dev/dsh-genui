import type { GenuiNode, GenuiSpec, GenuiWhen } from './spec.ts'
import { GENUI_LIMITS } from './genui-runtime/index.ts'
import { isTableDetailReachable, tableRowsForDetails } from './table-details.ts'

interface AncestorCondition {
  condition: GenuiWhen
  path: string
}

/** 遍历完整 GenUI 组件树，并提供节点路径和祖先条件来源。 */
export function walkGenuiNodes(spec: GenuiSpec, visitor: (node: GenuiNode, path: string, ancestorConditions: readonly AncestorCondition[]) => void): void {
  const walk = (nodes: GenuiNode[], path: string, depth: number, ancestorConditions: readonly AncestorCondition[]): void => {
    if (depth > GENUI_LIMITS.maxDepth) return
    nodes.forEach((node, index) => visit(node, `${path}[${index}]`, depth, ancestorConditions))
  }
  const visit = (node: GenuiNode, at: string, depth: number, ancestorConditions: readonly AncestorCondition[]): void => {
    if (depth > GENUI_LIMITS.maxDepth) return
    visitor(node, at, ancestorConditions)
    if (depth >= GENUI_LIMITS.maxDepth) return
    const childConditions = node.when === undefined ? ancestorConditions : [...ancestorConditions, { condition: node.when, path: `${at}.when.field` }]
    switch (node.type) {
      case 'row':
      case 'col':
      case 'grid':
      case 'card':
        walk(node.items, `${at}.items`, depth + 1, childConditions)
        break
      case 'carousel':
        walk(node.items.slice(0, GENUI_LIMITS.maxCarouselItems), `${at}.items`, depth + 1, childConditions)
        break
      case 'tabs':
        node.tabs.forEach((tab, tabIndex) => walk(tab.items, `${at}.tabs[${tabIndex}].items`, depth + 1, childConditions))
        break
      case 'accordion':
        node.items.forEach((item, itemIndex) => walk(item.items, `${at}.items[${itemIndex}].items`, depth + 1, childConditions))
        break
      case 'list':
        node.items.forEach((item, itemIndex) => {
          if (item !== null && typeof item === 'object' && 'type' in item) visit(item, `${at}.items[${itemIndex}]`, depth + 1, childConditions)
        })
        break
      case 'table':
        node.details?.slice(0, tableRowsForDetails(node).length).forEach((detail, rowIndex) => {
          if (detail !== null && isTableDetailReachable(node, rowIndex)) {
            walk(detail, `${at}.details[${rowIndex}]`, depth + 1, childConditions)
          }
        })
        break
    }
  }
  walk(spec.items, 'items', 0, [])
}
