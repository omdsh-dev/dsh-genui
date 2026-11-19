/** Pure synthetic orchestration tests only. No browser, DOM, host or network. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { actionPlan, initialExpected, appendExpected, validateSnapshot, validateInputs,
  executeOwnedAction, fixtureValues } from '../scripts/sidechat-browser-contracts.mjs'

const ids = ['session-parent', 'session-a', 'session-b']
const seed = { assistantEventSeq: 11, textBlockIndexes: [0, 2], fenceCountPerTextBlock: 2, expectedFormsPerSession: 4 }
const inputs = () => ({ parentId: ids[0], childIds: ids.slice(1), awaySessionId: 'session-away', workspaceId: '00000000-0000-4000-8000-000000000000', seed,
  readBackendSnapshot: async () => {}, waitForBackendAction: async () => {}, bindUiAwaySession: async () => {} })
const evidence = expected => ({ sessions: Object.fromEntries(Object.entries(expected).map(([id, value]) => [id, {
  actions: value.actions.map((action, index) => ({ ...structuredClone(action), messageId: `${id}-real-${index}`,
    eventSeq: 20 + index * 10, endSeq: 25 + index * 10 })), completedTurns: [...value.completedTurns],
}])) })
const initial = initialExpected(ids)
const step = actionPlan(ids.slice(1))[0]
const next = appendExpected(initial, step)
const fixture = () => evidence(next)

for (const missing of ['readBackendSnapshot', 'waitForBackendAction', 'bindUiAwaySession']) {
  test(`fails closed when ${missing} is missing`, () => {
    const options = inputs(); delete options[missing]
    assert.throws(() => validateInputs(options), /oracle missing/)
  })
}
test('requires both children and a distinct away conversation', () => {
  assert.throws(() => validateInputs({ ...inputs(), childIds: [ids[1]] }))
  assert.throws(() => validateInputs({ ...inputs(), awaySessionId: ids[0] }))
})
test('requires original text indexes 0 and 2, and four forms', () => {
  assert.throws(() => validateInputs({ ...inputs(), seed: { ...seed, textBlockIndexes: [0, 1] } }))
  assert.throws(() => validateInputs({ ...inputs(), seed: { ...seed, expectedFormsPerSession: 2 } }))
})
test('all twelve synthetic field values are distinct', () => {
  assert.equal(new Set(['main', 'A', 'B'].flatMap(fixtureValues)).size, 12)
})
test('action order is A button/submit then B button/submit, never main', () => {
  const plan = actionPlan(ids.slice(1))
  assert.deepEqual(plan.map(x => [x.ownerId, x.action]), [[ids[1], 'dsh354-check'], [ids[1], 'dsh354-submit'], [ids[2], 'dsh354-check'], [ids[2], 'dsh354-submit']])
  assert.equal(plan[1].payload.fields.name, 'synthetic-A-b2-f1')
  assert.equal(plan[3].payload.fields.name, 'synthetic-B-b0-f1')
})
test('accepts exact real-message metadata shaped synthetic evidence', () => {
  assert.deepEqual(validateSnapshot(fixture(), next, 11), fixture())
})
for (const [name, mutate] of [
  ['unchanged callback result', s => { s.sessions[ids[1]] = evidence(initial).sessions[ids[1]] }],
  ['wrong thread', s => { [s.sessions[ids[1]], s.sessions[ids[2]]] = [s.sessions[ids[2]], s.sessions[ids[1]]] }],
  ['fallback to main', s => { [s.sessions[ids[1]], s.sessions[ids[0]]] = [s.sessions[ids[0]], s.sessions[ids[1]]] }],
  ['wrong exact payload', s => { s.sessions[ids[1]].actions[0].payload.label = 'Other' }],
  ['wrong exact text', s => { s.sessions[ids[1]].actions[0].text += 'x' }],
  ['missing actual message ID', s => { delete s.sessions[ids[1]].actions[0].messageId }],
  ['invented rpcId instead of messageId', s => { s.sessions[ids[1]].actions[0].rpcId = 'test'; delete s.sessions[ids[1]].actions[0].messageId }],
  ['stale event sequence', s => { s.sessions[ids[1]].actions[0].eventSeq = 11 }],
  ['unsettled action', s => { s.sessions[ids[1]].actions[0].endSeq = 20 }],
  ['wrong owning turn', s => { s.sessions[ids[1]].actions[0].turn = 1 }],
  ['missing turn end', s => { s.sessions[ids[1]].completedTurns = [1] }],
  ['unexpected sibling turn', s => { s.sessions[ids[2]].completedTurns.push(2) }],
  ['missing sibling snapshot', s => { delete s.sessions[ids[2]] }],
]) test(`rejects ${name}`, () => {
  const snapshot = fixture(); mutate(snapshot)
  assert.throws(() => validateSnapshot(snapshot, next, 11))
})
test('duplicate durable message IDs across owners fail', () => {
  const expected = appendExpected(next, actionPlan(ids.slice(1))[2])
  const snapshot = evidence(expected)
  snapshot.sessions[ids[2]].actions[0].messageId = snapshot.sessions[ids[1]].actions[0].messageId
  assert.throws(() => validateSnapshot(snapshot, expected, 11), /unique/)
})
test('awaits pre-read, click, settlement and fresh post-read in strict order', async () => {
  const log = []
  const delay = () => new Promise(resolve => setImmediate(resolve))
  const result = await executeOwnedAction({ step, stage: 'test', expected: initial, assistantEventSeq: 11,
    previousSnapshot: evidence(initial),
    readBackendSnapshot: async ({ stage }) => {
      log.push(`${stage}:start`); await delay(); log.push(`${stage}:end`)
      return stage.endsWith(':before') ? evidence(initial) : fixture()
    },
    click: async () => { assert.equal(log.at(-1), 'test:before:end'); log.push('click:start'); await delay(); log.push('click:end') },
    waitForBackendAction: async request => {
      assert.equal(log.at(-1), 'click:end'); assert.deepEqual(request.expectedCounts, { 'session-parent': 0, 'session-a': 1, 'session-b': 0 })
      log.push('wait:start'); await delay(); log.push('wait:end'); return fixture()
    },
  })
  assert.deepEqual(log, ['test:before:start', 'test:before:end', 'click:start', 'click:end', 'wait:start', 'wait:end', 'test:after:start', 'test:after:end'])
  assert.deepEqual(result.snapshot, fixture())
})
test('stale baseline prevents any click', async () => {
  let clicked = false
  await assert.rejects(executeOwnedAction({ step, stage: 'test', expected: initial, assistantEventSeq: 11,
    readBackendSnapshot: async () => fixture(), click: async () => { clicked = true }, waitForBackendAction: async () => fixture() }))
  assert.equal(clicked, false)
})
test('rejected click does not run settlement or retry', async () => {
  let waited = 0; let clicks = 0
  await assert.rejects(executeOwnedAction({ step, stage: 'test', expected: initial, assistantEventSeq: 11,
    readBackendSnapshot: async () => evidence(initial), click: async () => { clicks++; throw Error('uncertain') },
    waitForBackendAction: async () => { waited++; return fixture() } }))
  assert.equal(clicks, 1); assert.equal(waited, 0)
})
test('missing or unchanged settlement is rejected, never silently accepted', async () => {
  for (const value of [undefined, evidence(initial)]) await assert.rejects(executeOwnedAction({ step,
    stage: 'test', expected: initial, assistantEventSeq: 11, readBackendSnapshot: async () => evidence(initial),
    click: async () => {}, waitForBackendAction: async () => value }))
})
test('fresh post-read must preserve exact durable ID', async () => {
  let reads = 0
  await assert.rejects(executeOwnedAction({ step, stage: 'test', expected: initial, assistantEventSeq: 11,
    readBackendSnapshot: async () => { if (reads++ === 0) return evidence(initial); const s = fixture(); s.sessions[ids[1]].actions[0].messageId = 'changed'; return s },
    click: async () => {}, waitForBackendAction: async () => fixture() }), /fresh durable reread/)
})
test('no fake UI, protocol interception, browser startup or external APIs in helper source', async () => {
  const source = await readFile(new URL('../scripts/sidechat-browser-checks.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /page\.evaluate\s*\(|\.route\s*\(|\.dispatchEvent\s*\(|\.setContent\s*\(|\.launch\s*\(|page\.request|createElement|localStorage|__DSH/)
  assert.match(source, /await click\(newSessionControl\)/)
  assert.match(source, /await selectSession\(parentId\)/)
  assert.match(source, /await executeOwnedAction/)
})
