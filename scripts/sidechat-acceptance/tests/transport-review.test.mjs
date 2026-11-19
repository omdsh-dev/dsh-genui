/** Pure synthetic callbacks only. No HTTP request, browser, DOM or host. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { isSidechatActionRequest, validateActionTransport, verifyActionResponse } from '../scripts/sidechat-browser-transport.mjs'
import { initialExpected, actionPlan, appendExpected, executeOwnedAction } from '../scripts/sidechat-browser-contracts.mjs'
const origin = 'http://127.0.0.1:12345'
const good = () => ({ httpStatus: 200, responseOk: true, finished: true, parsed: true, envelope: { ok: true, value: { accepted: true } } })
const request = (url, method = 'POST') => ({ url: () => url, method: () => method })
test('only exact same-origin action POST is observed, never unrelated requests', () => {
  assert.equal(isSidechatActionRequest(request(`${origin}/sidebar/api/sidechat.prompt`), origin), true)
  for (const url of [`${origin}/sidebar/api/sidechat.events`, `${origin}/other/sidebar/api/sidechat.prompt`,
    'http://127.0.0.1:12346/sidebar/api/sidechat.prompt', 'https://example.com/sidebar/api/sidechat.prompt', 'invalid']) {
    assert.equal(isSidechatActionRequest(request(url), origin), false)
  }
  assert.equal(isSidechatActionRequest(request(`${origin}/sidebar/api/sidechat.prompt`, 'GET'), origin), false)
})
test('only safe transport success metadata is retained', () => {
  assert.deepEqual(validateActionTransport(good()), { httpStatus: 200, responseOk: true, transferFinished: true, accepted: true })
})
for (const [name, change] of [
  ['HTTP 500', x => { x.httpStatus = 500; x.responseOk = false }],
  ['HTTP 204 without body', x => { x.httpStatus = 204 }],
  ['failed transfer', x => { x.finished = false }],
  ['invalid JSON', x => { x.parsed = false }],
  ['error envelope despite HTTP 200', x => { x.envelope = { ok: false, error: { code: 'synthetic' } } }],
  ['missing accepted flag', x => { x.envelope = { ok: true, value: {} } }],
  ['accepted false', x => { x.envelope.value.accepted = false }],
  ['extra arbitrary response fields', x => { x.envelope.token = 'not-a-real-token' }],
]) test(`transport gate rejects ${name}`, () => { const value = good(); change(value); assert.throws(() => validateActionTransport(value)) })
test('response acquisition, finished transfer and JSON are strictly awaited', async () => {
  const log = [], tick = () => new Promise(resolve => setImmediate(resolve))
  const response = {
    finished: async () => { log.push('finish:start'); await tick(); log.push('finish:end'); return null },
    status: () => 200, ok: () => true,
    json: async () => { assert.equal(log.at(-1), 'finish:end'); log.push('json:start'); await tick(); log.push('json:end'); return good().envelope },
  }
  const result = await verifyActionResponse({ response: async () => { await tick(); log.push('response'); return response } })
  assert.deepEqual(log, ['response', 'finish:start', 'finish:end', 'json:start', 'json:end'])
  assert.equal(result.accepted, true)
})
test('network failure without response rejects', async () => {
  await assert.rejects(verifyActionResponse({ response: async () => null }), /without a response/)
})
test('request/response callback rejection is not swallowed', async () => {
  const sentinel = Error('synthetic-read-rejection')
  await assert.rejects(verifyActionResponse({ response: async () => { throw sentinel } }), error => error === sentinel)
  await assert.rejects(verifyActionResponse({ response: async () => ({ finished: async () => { throw sentinel } }) }), error => error === sentinel)
})
test('stalled response transfer is bounded', async () => {
  await assert.rejects(verifyActionResponse({ response: async () => ({ finished: () => new Promise(() => {}) }) }, { timeoutMs: 10 }), /HTTP response timed out/)
})
test('durable action success cannot excuse a failed action response', async () => {
  const ids = ['session-parent', 'session-a', 'session-b'], expected = initialExpected(ids), step = actionPlan(ids.slice(1))[0]
  const next = appendExpected(expected, step)
  const evidence = value => ({ sessions: Object.fromEntries(Object.entries(value).map(([id, x]) => [id, {
    completedTurns: x.completedTurns, actions: x.actions.map(a => ({ ...a, messageId: 'real-durable-id', eventSeq: 20, endSeq: 25 })),
  }])) })
  let reads = 0
  const durable = await executeOwnedAction({ expected, step, stage: 'success-with-broken-http', assistantEventSeq: 11,
    readBackendSnapshot: async () => evidence(reads++ === 0 ? expected : next),
    click: async () => {}, waitForBackendAction: async () => evidence(next),
  })
  assert.equal(durable.snapshot.sessions['session-a'].actions.length, 1)
  await assert.rejects(verifyActionResponse({ response: async () => ({ status: () => 500, ok: () => false,
    finished: async () => null, json: async () => ({ ok: false, error: { code: 'post-admission-error' } }),
  }) }), /HTTP status must be 200/)
})
