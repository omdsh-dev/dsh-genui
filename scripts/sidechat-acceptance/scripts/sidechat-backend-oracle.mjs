/** Strict oracle over fresh sessionPersistence handle reads, not live projections. */
import assert from 'node:assert/strict'
import { IDS, ACK, PROVIDER, MODEL, assertOwnedAuditRow, childActionText } from './sidechat-host-contract.mjs'
import { validateUiAway } from '../fixture/lib/ui-away.mjs'
import { CONTENT } from '../fixture/lib/spec.mjs'
export const AWAY_ID = 'session-e2e-dsh354-away'
const originalIds = [...IDS, AWAY_ID]
export const INITIAL_TEXT = 'Synthetic DSH354 fixture. Display the isolation form.'
export const textOf = message => (message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('')
export function initialExpected() { return Object.fromEntries(IDS.map(id => [id, { actions: [], completedTurns: [1] }])) }
export function finalExpected() {
  const expected = initialExpected()
  for (const [index, id] of IDS.slice(1).entries()) {
    for (const [action, payload] of [
      ['dsh354-check', { type: 'button', label: 'Send fixture action' }],
      ['dsh354-submit', { type: 'submit', answers: {}, fields: { name: index === 0 ? 'synthetic-A-b2-f1' : 'synthetic-B-b0-f1' }, total: 1, answered: 1 }],
    ]) { const turn = expected[id].actions.length + 2; expected[id].actions.push({ action, payload, text: childActionText(action, payload), turn }); expected[id].completedTurns.push(turn) }
  }
  return expected
}
export function assertAudit(audit) {
  assert.ok(Array.isArray(audit) && audit.length <= 512, 'Bounded audit required')
  for (const row of audit) assertOwnedAuditRow(row)
}
/** A pending result may be polled; an invalid result must immediately fail. */
export class PendingSettlement extends Error {}
export function durableSnapshot(record, { expected, assistantEventSeq, allowPending = false, uiAway }) {
  assert.equal(record.fatal, undefined, 'Fixture failure invalidates durable snapshot')
  assert.equal(record.phase, 'resume', 'Only separately resumed persisted data qualifies')
  assert.ok(record.requestId && typeof record.requestId === 'string', 'Fresh read receipt required')
  assertAudit(record.audit)
  if (uiAway) validateUiAway(uiAway, originalIds)
  const all = [...originalIds, ...(uiAway ? [uiAway.sessionId] : [])]
  assert.deepEqual(record.createdUiSessionIds, uiAway ? [uiAway.sessionId] : [], 'Exactly the bound UI-created root, or none before binding, is allowed')
  assert.deepEqual(record.uiAwayOwnership, uiAway ? { ...uiAway, root: true, cwdOwned: true, workspaceMember: true } : undefined, 'Exact independently verified UI-away ownership is required')
  assert.deepEqual(Object.keys(record.sessions).sort(), [...all].sort(), 'All owned and away sessions must be read')
  assert.deepEqual(Object.keys(expected).sort(), [...IDS].sort(), 'Exact oracle ownership required')
  const result = { sessions: {} }, seenMessages = new Set(), pending = []
  let totalActions = 0
  for (const id of all) {
    const events = record.sessions[id]
    assert.ok(Array.isArray(events) && events.length <= 256, 'Bounded durable stream required')
    let previousSeq = -1, turn, current, seedUser = 0, seedAssistant = 0
    const actions = [], completedTurns = [], turns = new Map()
    for (const event of events) {
      assert.ok(Number.isSafeInteger(event.seq) && event.seq > previousSeq, 'Durable sequences must be unique and ordered')
      previousSeq = event.seq
      const data = event.data
      if (event.type === 'turn/start') {
        assert.equal(turn, undefined, 'Previous turn must settle before the next starts')
        turn = data.turn
        assert.ok([1, 2, 3].includes(turn) && !turns.has(turn), 'Unexpected or duplicate turn')
        current = { start: event.seq, actions: [], assistants: [], starts: [], ends: [] }; turns.set(turn, current)
      } else if (event.type === 'user/message') {
        const text = textOf(data)
        if (data.source?.kind !== 'user') {
          assert.ok(!text.includes('[genui-action]') && !data.containsAction, 'Context injection cannot hide an action')
          continue // Official runtime/first-contact context is not a user action.
        }
        assert.equal(data.role, 'user', 'Durable user input must have user role')
        assert.deepEqual(data.content, [{ type: 'text', text }], 'Only the exact single text block is accepted for fixture user input')
        assert.ok(typeof data.id === 'string' && data.id.length > 0 && !seenMessages.has(data.id), 'Real unique durable user message ID required')
        seenMessages.add(data.id)
        if (data.id === `fixture-user-${id}`) {
          assert.equal(turn, 1); assert.equal(text, INITIAL_TEXT); seedUser++; continue
        }
        assert.ok(IDS.slice(1).includes(id), 'Parent/away/foreign user action refused')
        assert.ok(turn === 2 || turn === 3, 'Action must be inside its owning next turn')
        const want = expected[id].actions[actions.length]
        assert.ok(want, `Unexpected extra action in ${id}`)
        assert.equal(text, want.text, 'Durable GenUI text must exactly match the owning UI action')
        assert.equal(want.text, childActionText(want.action, want.payload), 'Expected action is not canonical')
        assert.equal(turn, want.turn)
        const action = { messageId: data.id, text, action: want.action, payload: structuredClone(want.payload), eventSeq: event.seq, turn }
        current.actions.push(action); actions.push(action)
      } else if (event.type === 'assistant/message') {
        assert.ok(current && data.turn === turn && data.step === 1, 'Assistant must belong to owning turn/step')
        assert.equal(data.message.role, 'assistant', 'Durable assistant receipt must have assistant role')
        assert.equal(data.message.source?.kind, 'model', 'Durable assistant source must be model')
        assert.equal(data.message.source?.provider, PROVIDER); assert.equal(data.message.source?.model, MODEL)
        if (turn === 1) {
          assert.equal(data.message.id, `fixture-assistant-${id}`); assert.equal(event.seq, assistantEventSeq)
          assert.deepEqual(data.message.content, CONTENT); seedAssistant++
        } else {
          assert.equal(textOf(data.message), ACK, 'Only actual replay ACK is accepted')
          assert.deepEqual(data.message.content, [{ type: 'text', text: ACK }])
        }
        assert.ok(typeof data.message.id === 'string' && data.message.id.length > 0 && !seenMessages.has(data.message.id), 'Real unique assistant ID required')
        seenMessages.add(data.message.id); current.assistants.push(event.seq)
      } else if (event.type === 'step/start' || event.type === 'step/end') {
        assert.ok(current && data.turn === turn && data.step === 1, 'Only owning one-step replay accepted')
        current[event.type === 'step/start' ? 'starts' : 'ends'].push(event.seq)
      } else if (event.type === 'turn/end') {
        assert.ok(current && data.turn === turn, 'Turn end must close its active turn')
        assert.deepEqual(data.reason, { kind: 'completed' }, 'Only completed owning turns accepted')
        assert.equal(current.assistants.length, 1, 'Exactly one assistant per completed turn')
        assert.equal(current.starts.length, 1); assert.equal(current.ends.length, 1)
        assert.ok(current.starts[0] < current.assistants[0] && current.assistants[0] < current.ends[0] && current.ends[0] < event.seq)
        if (turn !== 1) {
          assert.equal(current.actions.length, 1, 'Exactly one action per child turn')
          assert.ok(current.actions[0].eventSeq > current.starts[0] && current.actions[0].eventSeq < current.assistants[0])
          current.actions[0].endSeq = event.seq
        }
        completedTurns.push(turn); turn = undefined; current = undefined
      } else assert.fail(`Unexpected exported durable event: ${event.type}`)
    }
    if (id === AWAY_ID || id === uiAway?.sessionId) { assert.equal(events.length, 0, 'Away session must have no user input, model or turn events'); continue }
    assert.equal(seedUser, 1); assert.equal(seedAssistant, 1)
    const want = expected[id]
    assert.ok(actions.length <= want.actions.length && completedTurns.length <= want.completedTurns.length, 'Unexpected additional action/turn')
    assert.deepEqual(completedTurns, want.completedTurns.slice(0, completedTurns.length), 'Completed-turn sequence changed')
    if (actions.length < want.actions.length || completedTurns.length < want.completedTurns.length || turn !== undefined) pending.push(id)
    totalActions += actions.length
    result.sessions[id] = { actions, completedTurns }
  }
  const routes = record.audit.filter(row => row.type === 'agent-request-route')
  const streams = record.audit.filter(row => row.type === 'llm-route')
  for (const id of IDS) {
    const actions = result.sessions[id].actions
    const wantedTurns = expected[id].actions.map(action => action.turn)
    for (const group of [routes, streams]) {
      const own = group.filter(row => row.sessionId === id)
      assert.ok(own.length <= wantedTurns.length, 'Extra model route/call')
      assert.deepEqual(own.map(row => row.turn), wantedTurns.slice(0, own.length), 'Wrong/duplicate model turn routing')
      if (own.length !== actions.length) pending.push(id)
    }
  }
  if (pending.length) {
    if (allowPending) throw new PendingSettlement(`Awaiting exact settlement for ${[...new Set(pending)].join(', ')}`)
    assert.fail('Durable snapshot has missing or unsettled expected actions')
  }
  assert.equal(routes.length, totalActions); assert.equal(streams.length, totalActions)
  if (totalActions === 4) assert.equal(record.replayConsumed, true, 'Both bounded two-call scripts must be consumed')
  return result
}
