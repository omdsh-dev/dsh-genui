/** Merge already approved exact versions; pnpm otherwise uses the first matching name. */
export function mergeExactVersionExceptions(rules) {
  const result = []
  const positions = new Map()
  for (const rule of rules) {
    const at = rule.indexOf('@', rule.startsWith('@') ? 1 : 0)
    if (at < 0) { result.push(rule); continue }
    const name = rule.slice(0, at)
    const index = positions.get(name)
    if (index === undefined) { positions.set(name, result.length); result.push(rule); continue }
    const versions = new Set([...result[index].slice(name.length + 1).split('||'), ...rule.slice(at + 1).split('||')].map(value => value.trim()))
    result[index] = `${name}@${[...versions].join(' || ')}`
  }
  return result
}
