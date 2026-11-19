/** Read-only transport evidence for the exact owning Sidebar action request. */
import assert from 'node:assert/strict'
import { bounded } from './sidechat-browser-contracts.mjs'

export function isSidechatActionRequest(request, origin) {
  if (request.method() !== 'POST') return false
  try {
    const url = new URL(request.url())
    return url.origin === origin && url.pathname === '/sidebar/api/sidechat.prompt'
  } catch { return false }
}

export function validateActionTransport({ httpStatus, responseOk, finished, parsed, envelope }) {
  assert.equal(finished, true, 'Owning action response transfer did not finish successfully')
  assert.equal(httpStatus, 200, 'Owning sidechat.prompt HTTP status must be 200')
  assert.equal(responseOk, true, 'Owning sidechat.prompt response must be successful')
  assert.equal(parsed, true, 'Owning sidechat.prompt response must contain valid JSON')
  // src/wire.ts replyOk + sidechat-routes.ts sidechat.prompt return value.
  // Do not place error envelopes or arbitrary response bodies in reports.
  assert.ok(envelope !== null && typeof envelope === 'object' && !Array.isArray(envelope)
    && Object.keys(envelope).length === 2 && envelope.ok === true
    && envelope.value !== null && typeof envelope.value === 'object' && !Array.isArray(envelope.value)
    && Object.keys(envelope.value).length === 1 && envelope.value.accepted === true,
  'Owning sidechat.prompt must return the exact accepted success envelope')
  return { httpStatus: 200, responseOk: true, transferFinished: true, accepted: true }
}

export async function verifyActionResponse(request, { timeoutMs = 15000 } = {}) {
  // Only the passed request object is inspected. No response event spawns an
  // unawaited task, and no auth headers, raw URLs or bodies enter evidence.
  return bounded(async () => {
    const response = await request.response()
    assert.ok(response, 'Owning action request failed without a response')
    const finishError = await response.finished()
    const result = { httpStatus: response.status(), responseOk: response.ok(),
      finished: finishError === null, parsed: false, envelope: undefined }
    if (result.finished) {
      try { result.envelope = await response.json(); result.parsed = true } catch { /* Sanitized validation failure below. */ }
    }
    return validateActionTransport(result)
  }, timeoutMs, 'owning action HTTP response')
}
