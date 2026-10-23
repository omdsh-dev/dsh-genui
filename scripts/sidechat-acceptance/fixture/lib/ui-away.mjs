/** Pure, test-only identity/ownership checks for the one native UI-created blank. */
import assert from 'node:assert/strict'

export function validateUiAway(binding, originalIds) {
  assert.deepEqual(Object.keys(binding ?? {}).sort(), ['sessionId', 'workspaceId'])
  assert.match(binding.sessionId, /^session-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'UI away must be a freshly minted session UUID')
  assert.match(binding.workspaceId, /^[0-9a-f-]{36}$/, 'Exact synthetic workspace ID required')
  assert.ok(!originalIds.includes(binding.sessionId), 'UI away must differ from all four original IDs')
  return { sessionId: binding.sessionId, workspaceId: binding.workspaceId }
}

export function verifyUiAwayOwnership(binding, header, workspace, ownedCwd, originalIds) {
  validateUiAway(binding, originalIds)
  assert.equal(header.id, binding.sessionId)
  assert.equal(header.cwd, ownedCwd, 'UI away cwd must be the owned synthetic workspace')
  assert.equal(header.isSeeded, false)
  assert.equal(header.parentSession, undefined)
  assert.equal(header.origin, undefined)
  assert.ok(header.delegationDepth === undefined || header.delegationDepth === 0)
  assert.equal(workspace?.id, binding.workspaceId)
  assert.equal(workspace.path, ownedCwd)
  assert.ok(workspace.sessionIds.includes(binding.sessionId), 'UI away must belong to the exact workspace')
  assert.ok(workspace.sessionIds.every(id => [...originalIds, binding.sessionId].includes(id)), 'No extra workspace session is allowed')
  return { ...binding, root: true, cwdOwned: true, workspaceMember: true }
}
