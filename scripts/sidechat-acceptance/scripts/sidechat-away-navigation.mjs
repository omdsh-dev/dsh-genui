/** Passive observation of the official workspace New session control's one RPC.
 * Does not send, intercept, replay or modify any request or selection.
 */
import assert from 'node:assert/strict'
import { bounded } from './sidechat-browser-contracts.mjs'
import { validateUiAway } from '../fixture/lib/ui-away.mjs'

export function isSessionCreate(request, origin) {
  try { const url = new URL(request.url()); return url.origin === origin && url.pathname === '/api/session/create' }
  catch { return false }
}
export function verifyCreateExchange(request, response, workspaceId, awaySessionId) {
  assert.deepEqual(Object.keys(request ?? {}).sort(), ['method', 'payload', 'rpcId', 'type'])
  assert.equal(request.type, 'client-request'); assert.equal(request.method, 'session/create')
  assert.ok(typeof request.rpcId === 'string' && request.rpcId.length > 0 && request.rpcId.length <= 64)
  assert.deepEqual(request.payload, { args: { request: { workspaceId, sessionId: awaySessionId } } }, 'Native New Session must reuse the exact empty root in its workspace')
  assert.deepEqual(Object.keys(response ?? {}).sort(), ['result', 'rpcId', 'type'])
  assert.equal(response.type, 'server-response'); assert.equal(response.rpcId, request.rpcId)
  assert.deepEqual(Object.keys(response.result ?? {}).sort(), ['ok', 'value'])
  assert.equal(response.result.ok, true, 'Official session reuse must succeed')
  const value = response.result.value
  assert.ok(value && Object.keys(value).every(key => ['sessionId', 'agentPreset'].includes(key)))
  if (Object.hasOwn(value, 'agentPreset')) assert.equal(typeof value.agentPreset, 'string')
  return validateUiAway({ sessionId: value.sessionId, workspaceId }, awaySessionId)
}
export function verifyUiAwaySelection(binding, { rowKey, selected, onScreen }) {
  assert.equal(rowKey, `session:${binding.sessionId}`, 'Selected native row must match the returned ID')
  assert.equal(selected, 'true', 'Returned native row must be selected')
  assert.equal(onScreen, true, 'Returned native row must be on-screen')
}
export function observeUiAwayCreate(page, origin, workspaceId, awaySessionId) {
  let count = 0, armed = false, invalid = false, failed = false, handle, finished = false
  const onRequest = request => {
    if (!isSessionCreate(request, origin)) return
    count++
    if (!armed || count !== 1 || request.method() !== 'POST' || new URL(request.url()).search !== '') invalid = true
    if (count === 1) handle = request
  }
  const onFailed = request => { if (isSessionCreate(request, origin)) failed = true }
  page.on('request', onRequest); page.on('requestfailed', onFailed)
  const assertOnce = () => {
    assert.equal(count, 1, 'Exactly one native UI session reuse is required')
    assert.equal(invalid, false, 'Unexpected, repeated or unarmed session reuse')
    assert.equal(failed, false, 'Native UI session reuse failed transport')
    assert.equal(finished, true, 'Native UI reuse response must be fully awaited')
  }
  return {
    arm() { assert.equal(count, 0); assert.equal(armed, false); assert.equal(finished, false); armed = true },
    async finish(timeoutMs) {
      return bounded(async () => {
        const deadline = Date.now() + timeoutMs
        while (!handle && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
        assert.equal(count, 1, 'Native New session click must emit exactly one request')
        assert.equal(invalid, false); assert.equal(failed, false)
        const response = await handle.response()
        assert.ok(response); assert.equal(response.status(), 200)
        assert.equal(await response.finished(), null)
        const binding = verifyCreateExchange(handle.postDataJSON(), await response.json(), workspaceId, awaySessionId)
        armed = false; finished = true; assertOnce()
        return binding
      }, timeoutMs, 'Native UI session reuse response')
    },
    assertOnce,
    dispose() { page.off('request', onRequest); page.off('requestfailed', onFailed) },
  }
}
