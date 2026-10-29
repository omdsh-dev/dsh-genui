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
import type { GenuiWhen } from './spec.ts'

/** The slice of block state a condition can read. */
export interface ConditionState {
  fields: Readonly<Record<string, string>>
  answers: Readonly<Record<string, string>>
  multiAnswers: Readonly<Record<string, string[]>>
}

/** Current value of a referenced field, or undefined when nothing set it. */
function readValue(field: string, state: ConditionState): string | readonly string[] | undefined {
  const inFields = state.fields[field]
  if (inFields !== undefined) return inFields
  const multi = state.multiAnswers[field]
  if (multi !== undefined) return multi
  return state.answers[field]
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
  const hidden = new Set<string>()
  if (!Array.isArray(items)) return hidden

  const ownKey = (node: ConditionNode): string | undefined => {
    const id = typeof node.id === 'string' ? node.id : undefined
    if (id !== undefined) return id
    return typeof node.group === 'string' ? node.group : undefined
  }

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (typeof value !== 'object' || value === null) return
    const node = value as ConditionNode
    const when = node.when as GenuiWhen | undefined
    const visible = when === undefined || evaluateWhen(when, state)
    if (!visible) {
      const key = ownKey(node)
      if (key !== undefined) hidden.add(key)
    }
    // Descendants of a hidden container are hidden too, and so are their keys.
    if (!visible) collectKeys(value, hidden)
    else if (node.items !== undefined) walk(node.items)
  }

  walk(items)
  return hidden
}

/** Add every id/group under a subtree (used when a container is hidden). */
function collectKeys(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) { value.forEach(entry => collectKeys(entry, into)); return }
  if (typeof value !== 'object' || value === null) return
  const node = value as ConditionNode
  const id = typeof node.id === 'string' ? node.id : undefined
  if (id !== undefined) into.add(id)
  const group = typeof node.group === 'string' ? node.group : undefined
  if (group !== undefined) into.add(group)
  for (const child of Object.values(node)) {
    if (typeof child === 'object' && child !== null) collectKeys(child, into)
  }
}
