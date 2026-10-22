import test from 'node:test'
import assert from 'node:assert/strict'
import { snapshotTrace, readSnapshotSession, projectSnapshotFailure } from '../fixture/lib/snapshot-diagnostics.mjs'

const SECRET = 'synthetic-secret-shaped-url-path-payload-token-sentinel'
const failure = (name = 'TypeError') => Object.assign(new Error(SECRET), { name, raw: SECRET, url: SECRET, stack: SECRET })
for (const phase of ['binding', 'flush', 'ownership', 'projection', 'write']) test(`records ${phase} without exposing the error`, async () => {
  const trace = snapshotTrace(), error = failure()
  await assert.rejects(trace.run(phase, 'child-a', () => { throw error }), value => value === error)
  const result = trace.failure(error)
  assert.deepEqual(result, { phase, owner: 'child-a', errorKinds: ['TypeError'], priorFailure: 'none' })
  assert.ok(!JSON.stringify(result).includes(SECRET))
})
for (const phase of ['open', 'header', 'read', 'close']) test(`public snapshot reader records ${phase} and closes only an opened handle`, async () => {
  const trace = snapshotTrace(), error = failure(), calls = []
  const operation = (kind, result) => { calls.push(kind); if (kind === phase) throw error; return result }
  const handle = { get header() { return operation('header', { id: 'synthetic' }) },
    async read() { return operation('read', { events: [] }) }, async close() { return operation('close') } }
  await assert.rejects(readSnapshotSession({ async open(id, mode) {
    assert.equal(id, 'synthetic'); assert.equal(mode, 'read'); return operation('open', handle)
  } }, 'synthetic', 'parent', trace), value => value === error)
  assert.equal(trace.failure(error).phase, phase)
  assert.deepEqual(calls, phase === 'open' ? ['open'] : phase === 'header' ? ['open', 'header', 'close'] : ['open', 'header', 'read', 'close'])
  assert.ok(!JSON.stringify(trace.failure(error)).includes(SECRET))
})
test('header/read primary failure survives a later finally/close failure', async () => {
  for (const phase of ['header', 'read']) {
    const trace = snapshotTrace(), primary = failure('SessionPersistenceCorruptionError'), secondary = failure('SessionHandleClosedError')
    const handle = { get header() { if (phase === 'header') throw primary; return {} }, async read() { throw primary }, async close() { throw secondary } }
    await assert.rejects(readSnapshotSession({ open: async () => handle }, 'synthetic', 'child-b', trace), value => value === secondary)
    assert.deepEqual(trace.failure(secondary, 'AgentLoop error in synthetic run'), {
      phase, owner: 'child-b', errorKinds: ['SessionPersistenceCorruptionError'], priorFailure: 'agent-loop',
    })
  }
})
test('successful reader preserves public values and has no failure report', async () => {
  const trace = snapshotTrace(), header = { id: 'synthetic' }, events = [{ type: 'synthetic' }], calls = []
  const stored = await readSnapshotSession({ open: async () => ({ header, read: async () => ({ events }), close: async () => { calls.push('close') } }) }, 'synthetic', 'seeded-away', trace)
  assert.equal(stored.header, header); assert.equal(stored.events, events); assert.deepEqual(calls, ['close'])
  assert.equal(projectSnapshotFailure({}), undefined)
})
test('aggregate causes are bounded, cycle safe, class/code only, and prior fatal remains specific', async () => {
  const trace = snapshotTrace(), cause = Object.assign(failure('Error'), { code: 'EIO' })
  const aggregate = new AggregateError(Array(100).fill(failure(SECRET)), SECRET, { cause })
  cause.cause = aggregate
  await assert.rejects(trace.run('flush', 'all', () => { throw aggregate }))
  const report = trace.failure(aggregate, 'Foreign or away session emitted relevant event')
  assert.deepEqual(report, { phase: 'flush', owner: 'all', errorKinds: ['AggregateError', 'fs-io', 'unknown'], priorFailure: 'foreign-event' })
  assert.ok(!JSON.stringify(report).includes(SECRET))
  const many = new AggregateError(Array.from({ length: 100 }, () => failure()), SECRET, { cause: failure() })
  const other = snapshotTrace(); await assert.rejects(other.run('flush', 'all', () => { throw many }))
  assert.equal(other.failure(many).errorKinds.length, 5)
})
test('unknown thrown values and arbitrary nested fields never escape projection', async () => {
  const trace = snapshotTrace()
  await assert.rejects(trace.run(SECRET, SECRET, () => { throw { name: SECRET, code: SECRET, message: SECRET, cause: SECRET } }))
  assert.deepEqual(trace.failure({}, SECRET), { phase: 'unknown', owner: 'unknown', errorKinds: ['unknown', 'unknown'], priorFailure: 'unknown' })
  assert.deepEqual(projectSnapshotFailure({ phase: 'read', owner: 'ui-away', errorKinds: ['TypeError', SECRET], priorFailure: 'none',
    raw: SECRET, body: SECRET, url: SECRET, event: { content: SECRET }, cause: { message: SECRET } }),
  { phase: 'read', owner: 'ui-away', errorKinds: ['TypeError', 'unknown'], priorFailure: 'none' })
  const projected = projectSnapshotFailure({ phase: SECRET, owner: SECRET, errorKinds: Array(1000).fill(SECRET), priorFailure: SECRET })
  assert.equal(projected.errorKinds.length, 5); assert.ok(!JSON.stringify(projected).includes(SECRET))
  assert.equal(projectSnapshotFailure(SECRET), undefined)
})
test('diagnostic classification does not read error messages or stacks', async () => {
  const error = { name: 'TypeError', get message() { assert.fail('message must not be read') }, get stack() { assert.fail('stack must not be read') } }
  const trace = snapshotTrace()
  await assert.rejects(trace.run('projection', 'child-b', () => { throw error }), value => value === error)
  assert.deepEqual(trace.failure(error).errorKinds, ['TypeError'])
})
