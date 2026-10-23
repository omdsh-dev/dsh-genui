/** Test-only bounded failure classification. Never reads an error message,
 * stack, event payload, path, URL, header or credential into a report.
 */
const PHASES = new Set(['binding', 'flush', 'open', 'header', 'read', 'close', 'ownership', 'projection', 'write', 'unknown'])
const OWNERS = new Set(['all', 'parent', 'child-a', 'child-b', 'seeded-away', 'ui-away', 'unknown'])
const NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AssertionError', 'AggregateError',
  'AbortError', 'SessionPersistenceNotFoundError', 'SessionAlreadyExistsError', 'SessionAlreadyOwnedError',
  'SessionReadOnlyError', 'SessionOwnershipLostError', 'SessionHandleClosedError',
  'SessionPersistenceCorruptionError', 'SessionFormatUnsupportedError', 'SessionFormatError',
  'SessionFormatUnsupportedMigrationError'])
const ERRNOS = new Map([['ENOENT', 'fs-not-found'], ['EACCES', 'fs-access-denied'], ['EPERM', 'fs-permission'],
  ['EIO', 'fs-io'], ['ENOSPC', 'fs-no-space'], ['EBUSY', 'fs-busy'], ['EMFILE', 'fs-open-limit']])
const KINDS = new Set([...NAMES, ...ERRNOS.values(), 'unknown'])
const FATALS = new Map([
  ['Bounded audit capacity exceeded', 'audit-capacity'],
  ['Unowned, seed, parent, extra, or invalid model request', 'route-rejected'],
  ['Non-replay selection before preparation', 'route-rejected'],
  ['Invalid final streaming dispatch', 'route-rejected'],
  ['More than one extra synthetic root was created', 'extra-root'],
  ['Foreign or away session emitted relevant event', 'foreign-event'],
  ['Bounded replay consumption failed', 'replay'],
  ['AgentLoop error in synthetic run', 'agent-loop'],
  ['Synthetic fixture lifecycle failed', 'fixture-lifecycle'],
  ['Durable snapshot failed', 'snapshot'],
])
const PRIOR = new Set([...FATALS.values(), 'none', 'unknown'])
const allowed = (set, value) => set.has(value) ? value : 'unknown'

/** A second projection at both artifact writers discards all untrusted fields. */
export function projectSnapshotFailure(input) {
  if (!input || typeof input !== 'object' || !Object.hasOwn(input, 'phase')) return undefined
  return { phase: allowed(PHASES, input.phase), owner: allowed(OWNERS, input.owner),
    errorKinds: (Array.isArray(input.errorKinds) ? input.errorKinds.slice(0, 5) : ['unknown']).map(kind => allowed(KINDS, kind)),
    priorFailure: allowed(PRIOR, input.priorFailure) }
}
function errorKinds(error) {
  const result = [], queue = [error], seen = new Set()
  while (queue.length && result.length < 5) {
    const next = queue.shift()
    if (seen.has(next)) continue
    seen.add(next)
    result.push(ERRNOS.get(next?.code) ?? allowed(NAMES, next?.name))
    if (next?.cause !== undefined) queue.push(next.cause)
    if (Array.isArray(next?.errors)) queue.push(...next.errors.slice(0, 4))
  }
  return result
}
/** Preserve the first failing operation even when a finally/close also fails. */
export function snapshotTrace() {
  let first
  return {
    async run(phase, owner, operation) {
      try { return await operation() }
      catch (error) {
        first ??= { phase, owner, errorKinds: errorKinds(error) }
        throw error
      }
    },
    failure(error, priorFatal) {
      return projectSnapshotFailure({ ...(first ?? { phase: 'unknown', owner: 'unknown', errorKinds: errorKinds(error) }),
        priorFailure: priorFatal === undefined ? 'none' : FATALS.get(priorFatal) ?? 'unknown' })
    },
  }
}
/** Same public open/header/read/close sequence as the original fixture reader. */
export async function readSnapshotSession(persistence, id, owner, trace) {
  const handle = await trace.run('open', owner, () => persistence.open(id, 'read'))
  try {
    const header = await trace.run('header', owner, () => handle.header)
    const events = await trace.run('read', owner, async () => (await handle.read()).events)
    return { header, events }
  } finally { await trace.run('close', owner, () => handle.close()) }
}
