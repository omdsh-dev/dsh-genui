/** Pure oracle contracts. Passing these tests is NOT browser/host acceptance. */
import assert from 'node:assert/strict'

export const TITLE = 'DSH354 isolation fixture'
export const FIELD_LABEL = 'Fixture value'
export const BUTTON_LABEL = 'Send fixture action'
export const SUBMIT_LABEL = 'Submit fixture form'
export const POSITIONS = Object.freeze([[0, 0], [0, 1], [2, 0], [2, 1]])

export function fixtureValues(owner) {
  assert.ok(['main', 'A', 'B'].includes(owner))
  return POSITIONS.map(([block, fence]) => `synthetic-${owner}-b${block}-f${fence}`)
}

export function actionText(action, payload) {
  return `[genui-action] ${action} ${JSON.stringify(payload)}`
}

export function actionPlan(childIds) {
  assert.equal(childIds.length, 2, 'Both A and B are mandatory')
  return childIds.flatMap((ownerId, index) => [
    { ownerId, action: 'dsh354-check', payload: { type: 'button', label: BUTTON_LABEL }, fence: 0, label: BUTTON_LABEL },
    { ownerId, action: 'dsh354-submit', payload: { type: 'submit', answers: {},
      fields: { name: fixtureValues(index === 0 ? 'A' : 'B')[index === 0 ? 3 : 1] }, total: 1, answered: 1 },
    fence: index === 0 ? 3 : 1, label: SUBMIT_LABEL },
  ])
}

export function validateInputs(options) {
  for (const key of ['readBackendSnapshot', 'waitForBackendAction', 'bindUiAwaySession']) {
    assert.equal(typeof options[key], 'function', `Required awaited backend oracle missing: ${key}`)
  }
  const { parentId, childIds, awaySessionId, seed } = options
  assert.match(options.workspaceId, /^[0-9a-f-]{36}$/, 'Exact synthetic workspace ID required')
  assert.ok(Array.isArray(childIds) && childIds.length === 2, 'Exactly two child IDs required; no skipped A/B')
  for (const id of [parentId, ...childIds, awaySessionId]) {
    assert.equal(typeof id, 'string', 'All synthetic session IDs are required')
    assert.match(id, /^session-[A-Za-z0-9-]+$/, 'IDs must be safe, explicit synthetic session IDs')
  }
  assert.equal(new Set([parentId, ...childIds, awaySessionId]).size, 4, 'Parent, A, B and away session must differ')
  assert.ok(seed && Number.isSafeInteger(seed.assistantEventSeq) && seed.assistantEventSeq >= 0)
  assert.deepEqual(seed.textBlockIndexes, [0, 2], 'Original reasoning gap must not be collapsed')
  assert.equal(seed.fenceCountPerTextBlock, 2)
  assert.equal(seed.expectedFormsPerSession, 4)
  return [parentId, ...childIds]
}

export function initialExpected(ids) {
  return Object.fromEntries(ids.map(id => [id, { actions: [], completedTurns: [1] }]))
}

export function appendExpected(expected, step) {
  assert.ok(Object.hasOwn(expected, step.ownerId), 'Unknown action owner')
  const next = structuredClone(expected)
  const turn = next[step.ownerId].actions.length + 2
  next[step.ownerId].actions.push({ action: step.action, payload: structuredClone(step.payload),
    text: actionText(step.action, step.payload), turn })
  next[step.ownerId].completedTurns.push(turn)
  return next
}

/** Validate actual durable public user/message evidence, never an invented RPC ID.
 * Only GenUI action messages belong in actions; official first-contact context
 * is separate and must not be counted as a GenUI action by the host adapter.
 */
export function validateSnapshot(snapshot, expected, assistantEventSeq) {
  assert.ok(snapshot && typeof snapshot.sessions === 'object', 'Backend snapshot is required')
  const ids = Object.keys(expected)
  assert.deepEqual(Object.keys(snapshot.sessions).sort(), [...ids].sort(), 'Snapshot must include exactly parent, A and B')
  const seen = new Set()
  const normalized = { sessions: {} }
  for (const id of ids) {
    const actual = snapshot.sessions[id]
    const wanted = expected[id]
    assert.ok(actual && Array.isArray(actual.actions), `Missing actions for ${id}`)
    assert.equal(actual.actions.length, wanted.actions.length, `Exact cumulative action count for ${id}`)
    assert.deepEqual(actual.completedTurns, wanted.completedTurns, `Exact settled turn/end sequence for ${id}`)
    let previousEnd = assistantEventSeq
    const actions = actual.actions.map((record, index) => {
      const want = wanted.actions[index]
      assert.equal(record.action, want.action, `Wrong action for ${id}`)
      assert.equal(record.text, want.text, `Wrong durable action text for ${id}`)
      assert.deepEqual(record.payload, want.payload, `Wrong owning-fence payload for ${id}`)
      assert.equal(record.turn, want.turn, `Wrong owning turn for ${id}`)
      assert.equal(typeof record.messageId, 'string', 'Actual durable messageId is required')
      assert.ok(record.messageId.trim() !== '' && record.messageId.length <= 512, 'Durable messageId must be bounded and nonempty')
      assert.ok(!seen.has(record.messageId), 'Durable action message IDs must be unique across all owners')
      seen.add(record.messageId)
      assert.ok(Number.isSafeInteger(record.eventSeq) && record.eventSeq > previousEnd,
        'Action must be newer than seeded assistant and the previous settled action')
      assert.ok(Number.isSafeInteger(record.endSeq) && record.endSeq > record.eventSeq,
        'A later real turn/end is mandatory; acceptance/inbox alone is insufficient')
      previousEnd = record.endSeq
      return { messageId: record.messageId, action: record.action, text: record.text,
        payload: structuredClone(record.payload), eventSeq: record.eventSeq, turn: record.turn, endSeq: record.endSeq }
    })
    normalized.sessions[id] = { actions, completedTurns: [...actual.completedTurns] }
  }
  return normalized
}

export async function bounded(operation, ms, label) {
  let timer
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    })])
  } finally { clearTimeout(timer) }
}

/** One real UI action transaction. click is a Playwright locator.click in the
 * browser helper; pure tests replace only this orchestration input, not a DOM.
 * No action retry: an uncertain click/transport outcome fails the lane closed.
 */
export async function executeOwnedAction({ step, stage, expected, assistantEventSeq,
  previousSnapshot, click, readBackendSnapshot, waitForBackendAction, timeoutMs = 30000 }) {
  for (const [name, fn] of Object.entries({ click, readBackendSnapshot, waitForBackendAction })) {
    assert.equal(typeof fn, 'function', `Required awaited callback missing: ${name}`)
  }
  const before = validateSnapshot(await bounded(() => readBackendSnapshot({ stage: `${stage}:before`,
    expected: structuredClone(expected) }), timeoutMs, 'pre-action backend read'), expected, assistantEventSeq)
  if (previousSnapshot) assert.deepEqual(before, previousSnapshot, 'Prior durable identities changed before action')
  const next = appendExpected(expected, step)
  const wanted = next[step.ownerId].actions.at(-1)
  // This await is the safety boundary: no wait/oracle call races the input.
  await bounded(click, timeoutMs, 'trusted UI click')
  const received = await bounded(() => waitForBackendAction({ stage, ownerId: step.ownerId,
    action: wanted.action, payload: structuredClone(wanted.payload), text: wanted.text,
    expectedCounts: Object.fromEntries(Object.entries(next).map(([id, item]) => [id, item.actions.length])),
    expectedTurn: wanted.turn, expected: structuredClone(next), timeoutMs }), timeoutMs, 'owning replay settlement')
  const settled = validateSnapshot(received, next, assistantEventSeq)
  // Freeze/check ALL previous receipts so an oracle cannot rewrite earlier
  // IDs, event sequences or payloads while returning the expected new count.
  for (const id of Object.keys(expected)) {
    assert.deepEqual(settled.sessions[id].actions.slice(0, before.sessions[id].actions.length),
      before.sessions[id].actions, `Prior action evidence changed for ${id}`)
  }
  const reread = validateSnapshot(await bounded(() => readBackendSnapshot({ stage: `${stage}:after`,
    expected: structuredClone(next) }), timeoutMs, 'fresh post-action backend read'), next, assistantEventSeq)
  assert.deepEqual(reread, settled, 'Settlement receipt must match a fresh durable reread')
  return { expected: next, snapshot: reread }
}
