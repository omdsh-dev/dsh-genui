/** Pure synthetic contracts, not browser/host acceptance. No network or DOM. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { validateUiAway, verifyUiAwayOwnership } from '../fixture/lib/ui-away.mjs'
import { isSessionCreate, verifyCreateExchange, verifyUiAwaySelection, observeUiAwayCreate } from '../scripts/sidechat-away-navigation.mjs'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const sessionId = 'session-22222222-2222-4222-8222-222222222222'
const originalIds = ['session-parent', 'session-a', 'session-b', 'session-away']
const binding = { sessionId, workspaceId }, origin = 'http://127.0.0.1:12345'
const requestBody = () => ({ type: 'client-request', rpcId: 'synthetic-rpc-1', method: 'session/create', payload: { args: { request: { workspaceId } } } })
const responseBody = () => ({ type: 'server-response', rpcId: 'synthetic-rpc-1', result: { ok: true, value: { sessionId } } })
function exchange(change = {}) {
  const response = { status: () => 200, finished: async () => null, json: async () => responseBody(), ...change.response }
  return { method: () => 'POST', url: () => origin + '/api/session/create', postDataJSON: requestBody,
    response: async () => response, ...change.request }
}
test('native source-shaped creation accepts only the returned fresh ID in exact workspace', () => {
  assert.deepEqual(verifyCreateExchange(requestBody(), responseBody(), workspaceId, originalIds), binding)
  const body = responseBody(); body.result.value.agentPreset = 'synthetic-default'
  assert.deepEqual(verifyCreateExchange(requestBody(), body, workspaceId, originalIds), binding)
})
for (const [label, mutate] of [
  ['named reuse', r => { r.payload.args.request.sessionId = sessionId }],
  ['cwd instead of workspace', r => { r.payload.args.request = { cwd: '/synthetic' } }],
  ['wrong workspace', r => { r.payload.args.request.workspaceId = 'other' }],
  ['wrong method', r => { r.method = 'session/select' }],
  ['missing RPC correlation', r => { delete r.rpcId }],
  ['unexpected request fields', r => { r.payload.extra = true }],
]) test(`create exchange rejects ${label}`, () => {
  const body = requestBody(); mutate(body)
  assert.throws(() => verifyCreateExchange(body, responseBody(), workspaceId, originalIds))
})
for (const [label, mutate] of [
  ['failed result', r => { r.result.ok = false }],
  ['wrong RPC correlation', r => { r.rpcId = 'another-call' }],
  ['wrong envelope', r => { r.type = 'client-request' }],
  ['unbound result', r => { delete r.result.value.sessionId }],
  ['foreign response fields', r => { r.result.value.other = true }],
  ['multiple IDs', r => { r.result.value.sessionId = [sessionId, sessionId] }],
]) test(`create exchange rejects ${label}`, () => {
  const body = responseBody(); mutate(body)
  assert.throws(() => verifyCreateExchange(requestBody(), body, workspaceId, originalIds))
})
test('fresh identity cannot be reused from any original session', () => {
  for (const id of originalIds) assert.throws(() => validateUiAway({ ...binding, sessionId: id }, originalIds))
  assert.throws(() => validateUiAway(binding, [...originalIds, sessionId]), /all four original/)
  assert.throws(() => validateUiAway({ ...binding, sessionId: sessionId.replace('-4222-', '-1222-') }, originalIds))
})
test('actual selected row must match the returned native ID, not any prior row', () => {
  const selected = { rowKey: `session:${sessionId}`, selected: 'true', onScreen: true }
  verifyUiAwaySelection(binding, selected)
  for (const id of originalIds) assert.throws(() => verifyUiAwaySelection(binding, { ...selected, rowKey: `session:${id}` }))
  assert.throws(() => verifyUiAwaySelection(binding, { ...selected, selected: 'false' }))
  assert.throws(() => verifyUiAwaySelection(binding, { ...selected, onScreen: false }))
})
const ownership = () => ({ header: { id: sessionId, cwd: '/synthetic/workspace', isSeeded: false },
  workspace: { id: workspaceId, path: '/synthetic/workspace', sessionIds: [...originalIds, sessionId] } })
test('read-only durable root and workspace ownership is independently required', () => {
  const { header, workspace } = ownership()
  assert.deepEqual(verifyUiAwayOwnership(binding, header, workspace, '/synthetic/workspace', originalIds),
    { ...binding, root: true, cwdOwned: true, workspaceMember: true })
})
for (const [label, mutate] of [
  ['different persisted ID', x => { x.header.id = originalIds[0] }],
  ['outside owned cwd', x => { x.header.cwd = '/another' }],
  ['seeded root', x => { x.header.isSeeded = true }],
  ['fork parent', x => { x.header.parentSession = originalIds[0] }],
  ['subagent origin', x => { x.header.origin = 'subagent' }],
  ['delegated child', x => { x.header.delegationDepth = 1 }],
  ['wrong workspace identity', x => { x.workspace.id = 'another' }],
  ['wrong workspace path', x => { x.workspace.path = '/another' }],
  ['not a workspace member', x => { x.workspace.sessionIds = originalIds }],
  ['extra workspace root', x => { x.workspace.sessionIds.push('session-extra') }],
]) test(`ownership rejects ${label}`, () => {
  const value = ownership(); mutate(value)
  assert.throws(() => verifyUiAwayOwnership(binding, value.header, value.workspace, '/synthetic/workspace', originalIds))
})
test('passive observer awaits a delayed native request and full response then detaches listeners', async () => {
  const page = new EventEmitter(), observer = observeUiAwayCreate(page, origin, workspaceId, originalIds)
  let completed = false
  observer.arm()
  const request = exchange({ response: { finished: async () => { completed = true; return null } } })
  const pending = observer.finish(1000)
  page.emit('request', request)
  assert.deepEqual(await pending, binding); assert.equal(completed, true); observer.assertOnce()
  observer.dispose(); assert.equal(page.listenerCount('request'), 0); assert.equal(page.listenerCount('requestfailed'), 0)
})
for (const kind of ['unarmed', 'multiple', 'wrong-method', 'failed-request', 'query', 'HTTP-failure', 'missing-response', 'unfinished-response']) {
  test(`passive observer rejects ${kind} without creating or retrying anything`, async () => {
    const page = new EventEmitter(), observer = observeUiAwayCreate(page, origin, workspaceId, originalIds)
    if (kind !== 'unarmed') observer.arm()
    const change = kind === 'wrong-method' ? { request: { method: () => 'GET' } }
      : kind === 'query' ? { request: { url: () => origin + '/api/session/create?unexpected=1' } }
      : kind === 'HTTP-failure' ? { response: { status: () => 500 } }
      : kind === 'missing-response' ? { request: { response: async () => null } }
      : kind === 'unfinished-response' ? { response: { finished: async () => 'failed' } } : {}
    const request = exchange(change); page.emit('request', request)
    if (kind === 'multiple') page.emit('request', exchange())
    if (kind === 'failed-request') page.emit('requestfailed', request)
    try { await assert.rejects(observer.finish(1000)) } finally { observer.dispose() }
    assert.equal(page.listenerCount('request'), 0)
  })
}
test('unbound/missing native request times out; finish is never an attestation by itself', async () => {
  const page = new EventEmitter(), observer = observeUiAwayCreate(page, origin, workspaceId, originalIds)
  observer.arm()
  try { await assert.rejects(observer.finish(25)); assert.throws(() => observer.assertOnce()) }
  finally { observer.dispose() }
})
test('a late second native creation cannot be silently ignored', async () => {
  const page = new EventEmitter(), observer = observeUiAwayCreate(page, origin, workspaceId, originalIds)
  observer.arm(); page.emit('request', exchange()); await observer.finish(1000)
  page.emit('request', exchange()); assert.throws(() => observer.assertOnce()); observer.dispose()
})
test('matching is exact origin/route, while any method on that route is counted for rejection', () => {
  assert.equal(isSessionCreate(exchange(), origin), true)
  assert.equal(isSessionCreate(exchange({ request: { url: () => 'http://foreign/api/session/create' } }), origin), false)
  assert.equal(isSessionCreate(exchange({ request: { url: () => origin + '/api/session/create-other' } }), origin), false)
})
test('helper uses one native hovered control, verifies selected ID before binding, and returns to parent', async () => {
  const source = await readFile(new URL('../scripts/sidechat-browser-checks.mjs', import.meta.url), 'utf8')
  const hover = source.indexOf('await workspaceRow.hover('), click = source.indexOf('await click(newSessionControl)')
  const selected = source.indexOf('verifyUiAwaySelection(uiAway,'), bind = source.indexOf('bindUiAwaySession(uiAway.sessionId)')
  assert.ok(hover > 0 && click > hover && selected > click && bind > selected)
  assert.equal(source.split('await click(newSessionControl)').length - 1, 1)
  assert.ok(source.indexOf('await selectSession(parentId)', bind) > bind)
  assert.match(source, /uiAwayCreate\.dispose\(\)/)
})
