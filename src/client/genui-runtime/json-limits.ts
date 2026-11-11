import { GENUI_LIMITS } from './limits.ts'

export type JsonLimitViolation = 'depth' | 'nodes'

/** 对不可信 JSON 值检查嵌套深度及遍历总量，使用迭代防止调用栈溢出。 */
export function jsonLimitViolation(value: unknown): JsonLimitViolation | null {
  const stack: Array<[unknown, number]> = [[value, 0]]
  let visited = 0
  while (stack.length > 0) {
    const [current, depth] = stack.pop()!
    if (depth > GENUI_LIMITS.maxJsonDepth) return 'depth'
    visited += 1
    if (visited > GENUI_LIMITS.maxJsonNodes) return 'nodes'

    if (Array.isArray(current)) {
      if (current.length > GENUI_LIMITS.maxJsonNodes - visited - stack.length) return 'nodes'
      for (const entry of current) stack.push([entry, depth + 1])
    } else if (current !== null && typeof current === 'object') {
      // 逐项入栈；发现超出预算时立即停止，避免分配超大的 Object.values 数组。
      for (const key in current) {
        if (!Object.hasOwn(current, key)) continue
        if (visited + stack.length >= GENUI_LIMITS.maxJsonNodes) return 'nodes'
        stack.push([(current as Record<string, unknown>)[key], depth + 1])
      }
    }
  }
  return null
}

/** 将可安全处理的 JSON 值转成字符串，超出限制或序列化失败时返回 undefined。 */
export function stringifyLimitedJson(value: unknown): string | undefined {
  if (jsonLimitViolation(value) !== null) return undefined
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}
