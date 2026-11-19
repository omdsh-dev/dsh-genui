/**
 * Conditional visibility for GenUI nodes.
 *
 * A node carrying `when` renders only while the condition holds. The condition
 * reads the block's own field/answer state, so a decision tree reacts instantly
 * with no model round trip:
 *
 *     { "type": "select", "id": "entity", "options": ["公司", "个人"] }
 *     { "type": "input", "id": "taxId", "label": "税号",
 *       "when": { "field": "entity", "op": "eq", "value": "公司" } }
 *
 * Two rules make this safe rather than merely visual:
 *
 * 1. A hidden node is not rendered, so the reader never sees a stale control.
 * 2. `collectHiddenKeys` lists the field ids/groups under a false condition, and
 *    the sibling `submit` filters them out of its payload and its required set.
 *    A hidden field must never submit a value the reader cannot see, and it must
 *    never block submission by looking unanswered.
 *
 * Without block state (export, panel, embedded renderer with no provider) the
 * condition cannot be evaluated: nodes stay VISIBLE. Hiding content on missing
 * state would silently drop a whole branch of an exported document.
 *
 * @module conditions
 */
import type { GenuiNode, GenuiWhen, GenuiSpec } from './spec.ts'
import { isTableDetailReachable, tableRowsForDetails } from './table-details.ts'
import { walkGenuiNodes } from './walk-spec.ts'
import { GENUI_LIMITS } from './genui-runtime/index.ts'

/** The slice of block state a condition can read. */
export interface ConditionState {
  fields: Readonly<Record<string, string>>
  answers: Readonly<Record<string, string>>
  multiAnswers: Readonly<Record<string, string[]>>
  conditionHidden?: ReadonlySet<string>
}

/** Current value of a referenced field, or undefined when nothing set it. */
function readValue(field: string, state: ConditionState): string | readonly string[] | undefined {
  if (state.conditionHidden?.has(field)) return undefined
  const inFields = Object.hasOwn(state.fields, field) ? state.fields[field] : undefined
  if (inFields !== undefined) return inFields
  const multi = Object.hasOwn(state.multiAnswers, field) ? state.multiAnswers[field] : undefined
  if (multi !== undefined) return multi
  return Object.hasOwn(state.answers, field) ? state.answers[field] : undefined
}

function asNumbers(left: unknown, right: unknown): [number, number] | undefined {
  const a = Number(String(left).trim())
  const b = Number(String(right).trim())
  if (String(left).trim() === '' || String(right).trim() === '') return undefined
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined
  return [a, b]
}

function isBlank(value: string | readonly string[] | undefined): boolean {
  if (value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  return value.length === 0
}

/**
 * Evaluate one condition against block state.
 * @param when - the condition carried by a node.
 * @param state - current field/answer state.
 * @returns true when the node should render.
 */
export function evaluateWhen(when: GenuiWhen, state: ConditionState): boolean {
  const actual = readValue(when.field, state)

  switch (when.op) {
    case 'empty': return isBlank(actual)
    case 'not-empty': return !isBlank(actual)
    case 'checked': {
      if (actual === undefined) return when.value === false
      if (typeof actual === 'string') return actual.trim() !== '' && actual !== 'false'
      return actual.length > 0
    }
    case 'eq':
    case 'neq': {
      if (when.value === undefined) return false
      // A grouped checkbox matches when ANY selected label equals the target.
      const target = String(when.value).trim()
      const equal = typeof actual === 'string'
        ? actual.trim() === target
        : (actual ?? []).some(entry => entry.trim() === target)
      return when.op === 'eq' ? equal : !equal && actual !== undefined
    }
    case 'in':
    case 'not-in': {
      if (!Array.isArray(when.value)) return false
      const targets = when.value.map(entry => String(entry).trim())
      const picked = typeof actual === 'string'
        ? [actual.trim()]
        : (actual ?? []).map(entry => entry.trim())
      const hit = picked.length > 0 && picked.some(entry => targets.includes(entry))
      return when.op === 'in' ? hit : !hit && actual !== undefined
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (when.value === undefined || actual === undefined || typeof actual !== 'string') return false
      const pair = asNumbers(actual, when.value)
      if (pair === undefined) return false
      const [left, right] = pair
      if (when.op === 'gt') return left > right
      if (when.op === 'gte') return left >= right
      if (when.op === 'lt') return left < right
      return left <= right
    }
    default:
      return false
  }
}

/** A node that can carry an identity a submit collects by. */
interface ConditionNode {
  type?: unknown
  id?: unknown
  group?: unknown
  items?: unknown
  when?: unknown
}

/**
 * Field ids and answer groups hidden by a false condition anywhere in the tree.
 * @param items - root node list.
 * @param state - current field/answer state.
 * @returns keys whose visible controls are not on screen right now.
 */
export function collectHiddenKeys(items: unknown, state: ConditionState): ReadonlySet<string> {
  if (!Array.isArray(items)) return new Set(state.conditionHidden ?? [])

  const ownKey = (node: ConditionNode): string | undefined => {
    const id = typeof node.id === 'string' ? node.id : undefined
    if (id !== undefined) return id
    return typeof node.group === 'string' ? node.group : undefined
  }

  const collectPass = (conditionHidden: ReadonlySet<string>): Set<string> => {
    const found = new Set<string>()
    const passState = { ...state, conditionHidden }
    const walk = (nodes: GenuiNode[], depth: number): void => {
      if (depth > GENUI_LIMITS.maxDepth) return
      nodes.forEach(node => {
        const visible = node.when === undefined || evaluateWhen(node.when, passState)
        if (!visible) {
          const key = ownKey(node)
          if (key !== undefined) found.add(key)
          // A found container hides every real GenUI field beneath it.
          collectKeys(node, found)
          return
        }
        if (depth >= GENUI_LIMITS.maxDepth) return
        switch (node.type) {
          case 'row':
          case 'col':
          case 'grid':
          case 'card':
            walk(node.items, depth + 1)
            break
          case 'carousel':
            walk(node.items.slice(0, GENUI_LIMITS.maxCarouselItems), depth + 1)
            break
          case 'tabs':
            node.tabs.forEach(tab => walk(tab.items, depth + 1))
            break
          case 'accordion':
            node.items.forEach(item => walk(item.items, depth + 1))
            break
          case 'list':
            node.items.forEach(item => {
              if (item !== null && typeof item === 'object' && 'type' in item) walk([item as GenuiNode], depth + 1)
            })
            break
          case 'table':
            node.details?.slice(0, tableRowsForDetails(node).length).forEach((detail, rowIndex) => {
              if (detail !== null && isTableDetailReachable(node, rowIndex)) walk(detail, depth + 1)
            })
            break
        }
      })
    }

    walk(items as GenuiNode[], 0)
    return found
  }

  const seed = new Set(state.conditionHidden ?? [])
  let hidden = new Set(seed)
  const seen = new Set<string>()
  const conservativeHidden = new Set(seed)
  // Guard 层会拒绝循环依赖。直接调用渲染器时，采用保守的隐藏结果，
  // 保证非法条件不会使整条消息抛出异常，也不会提交循环中的旧字段值。
  for (let pass = 0; pass <= GENUI_LIMITS.maxNodes; pass += 1) {
    const signature = JSON.stringify([...hidden].sort())
    if (seen.has(signature)) return conservativeHidden
    seen.add(signature)
    const next = new Set([...seed, ...collectPass(hidden)])
    if (next.size === hidden.size && [...next].every(key => hidden.has(key))) return next
    for (const key of next) conservativeHidden.add(key)
    hidden = next
  }
  return conservativeHidden
}

/** Add only real GenUI field ids/groups, keeping diagram-internal node ids out. */
function collectKeys(value: GenuiNode, into: Set<string>): void {
  walkGenuiNodes({ items: [value] } as GenuiSpec, node => {
    if ('id' in node && typeof node.id === 'string') into.add(node.id)
    if ('group' in node && typeof node.group === 'string') into.add(node.group)
  })
}
