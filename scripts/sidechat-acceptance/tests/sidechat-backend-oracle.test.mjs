import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDS, PROVIDER, MODEL, ACK } from '../scripts/sidechat-host-contract.mjs'
import { AWAY_ID, INITIAL_TEXT, initialExpected, finalExpected, durableSnapshot, PendingSettlement } from '../scripts/sidechat-backend-oracle.mjs'
import { CONTENT } from '../fixture/lib/spec.mjs'
const SEQ = 8
const message = (id, content, source = { kind: 'user' }) => ({ id, role: source.kind === 'user' ? 'user' : 'assistant', source, content })
const text = value => [{ type: 'text', text: value }]
const event = (type, seq, data) => ({ type, seq, data })
function fixture(expected = initialExpected()) {
  const record = { requestId: 'synthetic-read-1', phase: 'resume', audit: [], sessions: {}, replayConsumed: false, createdUiSessionIds: [] }
  for (const id of IDS) {
    const events = [event('turn/start', 3, { turn: 1 }), event('step/start', 4, { turn: 1, step: 1 }),
      event('user/message', 5, message(`fixture-user-${id}`, text(INITIAL_TEXT))),
      event('assistant/message', SEQ, { turn: 1, step: 1, message: message(`fixture-assistant-${id}`, CONTENT, { kind: 'model', provider: PROVIDER, model: MODEL }) }),
      event('step/end', 9, { turn: 1, step: 1 }), event('turn/end', 10, { turn: 1, reason: { kind: 'completed' } })]
    for (const action of expected[id].actions) {
      const seq = 11 + (action.turn - 2) * 8
      events.push(event('turn/start', seq, { turn: action.turn }), event('step/start', seq + 1, { turn: action.turn, step: 1 }),
        event('user/message', seq + 2, { id: `boundary-${id}-${action.turn}`, source: { kind: 'plugin:dsh-better-sidebar' }, content: [], containsAction: false }),
        event('user/message', seq + 3, message(`actual-${id}-${action.turn}`, text(action.text))),
        event('assistant/message', seq + 4, { turn: action.turn, step: 1, message: message(`actual-assistant-${id}-${action.turn}`, text(ACK), { kind: 'model', provider: PROVIDER, model: MODEL }) }),
        event('step/end', seq + 5, { turn: action.turn, step: 1 }), event('turn/end', seq + 6, { turn: action.turn, reason: { kind: 'completed' } }))
      for (const type of ['agent-request-route', 'llm-route']) record.audit.push({ type, phase: 'resume', sessionId: id, provider: PROVIDER, model: MODEL, turn: action.turn, step: 1, allowed: true })
    }
    record.sessions[id] = events
  }
  record.sessions[AWAY_ID] = []
  record.replayConsumed = expected[IDS[1]].actions.length + expected[IDS[2]].actions.length === 4
  return record
}
const evaluate = (record, expected = finalExpected(), extra = {}) => durableSnapshot(record, { expected, assistantEventSeq: SEQ, ...extra })
test('fresh durable seed is exactly parent/A/B turn 1 with no actions and away empty', () => {
  const expected = initialExpected(); const result = evaluate(fixture(expected), expected)
  assert.deepEqual(result, { sessions: expected })
})
test('four real durable IDs and turn/end receipts with exact owner payloads', () => {
  const expected = finalExpected(), result = evaluate(fixture(expected), expected)
  assert.equal(result.sessions[IDS[0]].actions.length, 0)
  assert.equal(result.sessions[IDS[1]].actions[0].messageId, `actual-${IDS[1]}-2`)
  assert.equal(result.sessions[IDS[1]].actions[0].eventSeq, 14)
  assert.equal(result.sessions[IDS[1]].actions[0].endSeq, 17)
  assert.deepEqual(result.sessions[IDS[2]].completedTurns, [1, 2, 3])
})
for (const [name, mutate] of [
  ['wrong owner', r => { r.sessions[IDS[0]].push(...r.sessions[IDS[1]].slice(6)); r.sessions[IDS[1]] = r.sessions[IDS[1]].slice(0, 6) }],
  ['away actions', r => { r.sessions[AWAY_ID] = r.sessions[IDS[1]] }],
  ['duplicate real user ID', r => { r.sessions[IDS[2]][9].data.id = r.sessions[IDS[1]][9].data.id }],
  ['seed hidden reasoning block', r => { r.sessions[IDS[1]][2].data.content.push({ type: 'reasoning', text: 'synthetic' }) }],
  ['action hidden reasoning block', r => { r.sessions[IDS[1]][9].data.content.push({ type: 'reasoning', text: 'synthetic' }) }],
  ['seed wrong user role', r => { r.sessions[IDS[1]][2].data.role = 'assistant' }],
  ['seed wrong assistant role', r => { r.sessions[IDS[1]][3].data.message.role = 'user' }],
  ['seed wrong assistant source kind', r => { r.sessions[IDS[1]][3].data.message.source.kind = 'plugin:synthetic' }],
  ['wrong user role', r => { r.sessions[IDS[1]][9].data.role = 'assistant' }],
  ['hidden nontext action block', r => { r.sessions[IDS[1]][9].data.content.push({ type: 'image', url: 'synthetic-not-fetched' }) }],
  ['multiple text action blocks', r => { r.sessions[IDS[1]][9].data.content.push({ type: 'text', text: '' }) }],
  ['wrong assistant role', r => { r.sessions[IDS[1]][10].data.message.role = 'user' }],
  ['wrong assistant source kind', r => { r.sessions[IDS[1]][10].data.message.source.kind = 'plugin:synthetic' }],
  ['wrong source text', r => { r.sessions[IDS[1]][9].data.content[0].text += ' extra' }],
  ['wrong owning payload', r => { r.sessions[IDS[1]][16].data.content[0].text = finalExpected()[IDS[2]].actions[1].text }],
  ['wrong ACK', r => { r.sessions[IDS[1]][10].data.message.content[0].text = 'fake' }],
  ['cancelled turn', r => { r.sessions[IDS[1]][12].data.reason = { kind: 'cancelled' } }],
  ['duplicate sequence', r => { r.sessions[IDS[1]][9].seq = r.sessions[IDS[1]][8].seq }],
  ['missing route', r => { r.audit.pop() }],
  ['extra route', r => { r.audit.push(structuredClone(r.audit.at(-1))) }],
  ['foreign route', r => { r.audit[0].sessionId = 'foreign' }],
  ['wrong phase', r => { r.audit[0].phase = 'seed' }],
  ['agent error', r => { r.audit.push({ type: 'agent-error' }) }],
  ['unconsumed replay', r => { r.replayConsumed = false }],
  ['changed seed content', r => { r.sessions[IDS[1]][3].data.message.content = text('fake') }],
  ['hidden context action', r => { r.sessions[IDS[1]][8].data.containsAction = true }],
  ['missing owner stream', r => { delete r.sessions[IDS[2]] }],
  ['missing fresh receipt', r => { delete r.requestId }],
]) test(`${name} fails closed`, () => { const record = structuredClone(fixture(finalExpected())); mutate(record); assert.throws(() => evaluate(record)) })
test('incomplete settlement can be polled, malformed settlement cannot', () => {
  const expected = finalExpected(), record = fixture(expected)
  record.sessions[IDS[2]].pop()
  assert.throws(() => evaluate(record, expected, { allowPending: true }), PendingSettlement)
  assert.throws(() => evaluate(record, expected))
  record.sessions[IDS[2]][16].data.content[0].text = 'bad'
  assert.throws(() => evaluate(record, expected, { allowPending: true }), error => !(error instanceof PendingSettlement))
})
test('baseline absence cannot pass as completion', () => {
  assert.throws(() => evaluate(fixture(), finalExpected()))
})

const UI_AWAY = { sessionId: AWAY_ID, workspaceId: '11111111-1111-4111-8111-111111111111' }
function withUiAway(expected = initialExpected()) {
  const record = fixture(expected)
  record.uiAwayOwnership = { ...UI_AWAY, root: true, cwdOwned: true, workspaceMember: true }
  return record
}
test('unbound empty native creation cannot pass the baseline', () => {
  const record = fixture(initialExpected()); record.createdUiSessionIds = [UI_AWAY.sessionId]
  assert.throws(() => evaluate(record, initialExpected()))
})
test('reused away remains zero before and after all four child actions', () => {
  for (const expected of [initialExpected(), finalExpected()]) {
    const snapshot = evaluate(withUiAway(expected), expected, { uiAway: UI_AWAY })
    assert.deepEqual(Object.keys(snapshot.sessions), IDS)
    assert.equal(snapshot.sessions[IDS[0]].actions.length, 0)
  }
})
for (const [label, mutate] of [
  ['unexpected fresh creation', r => { r.createdUiSessionIds = ['session-extra'] }],
  ['wrong captured ID', r => { r.createdUiSessionIds = [AWAY_ID] }],
  ['missing ownership', r => { delete r.uiAwayOwnership }],
  ['forged root ownership', r => { r.uiAwayOwnership.root = false }],
  ['forged workspace ownership', r => { r.uiAwayOwnership.workspaceMember = false }],
  ['forged cwd ownership', r => { r.uiAwayOwnership.cwdOwned = false }],
  ['wrong workspace ID', r => { r.uiAwayOwnership.workspaceId = 'other' }],
  ['missing UI-away durable stream', r => { delete r.sessions[UI_AWAY.sessionId] }],
  ['extra durable root', r => { r.sessions['session-extra'] = [] }],
  ['UI-away relevant context', r => { r.sessions[UI_AWAY.sessionId].push(event('user/message', 1, { source: { kind: 'plugin:context' }, content: [], containsAction: false })) }],
  ['UI-away model route', r => { r.audit.push({ type: 'llm-route', phase: 'resume', sessionId: UI_AWAY.sessionId, provider: PROVIDER, model: MODEL, turn: 1, step: 1, allowed: true }) }],
]) test(`bound durable oracle rejects ${label}`, () => {
  const record = withUiAway(); mutate(record)
  assert.throws(() => evaluate(record, initialExpected(), { uiAway: UI_AWAY }))
})
test('binding cannot name a new root or omit the observed reuse', () => {
  assert.throws(() => evaluate(withUiAway(), initialExpected(), { uiAway: { ...UI_AWAY, sessionId: 'session-22222222-2222-4222-8222-222222222222' } }))
  assert.throws(() => evaluate(withUiAway(), initialExpected()))
})
