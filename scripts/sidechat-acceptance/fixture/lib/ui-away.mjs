/** 检查原生界面复用现有空白会话时的会话身份和归属。 */
import assert from 'node:assert/strict'

/** 检查 UI away 会话绑定是否使用指定会话身份。 */
export function validateUiAway(binding, awaySessionId) {
  assert.deepEqual(Object.keys(binding ?? {}).sort(), ['sessionId', 'workspaceId'])
  assert.ok(typeof awaySessionId === 'string' && awaySessionId.length > 0)
  assert.equal(binding.sessionId, awaySessionId, 'UI away must reuse the exact existing empty root')
  assert.match(binding.workspaceId, /^[0-9a-f-]{36}$/, 'Exact synthetic workspace ID required')
  return { sessionId: binding.sessionId, workspaceId: binding.workspaceId }
}

/** 核对 UI away 绑定到原有空白会话和对应工作区。 */
export function verifyUiAwayOwnership(binding, header, workspace, ownedCwd, originalIds, awaySessionId) {
  validateUiAway(binding, awaySessionId)
  assert.equal(header.id, binding.sessionId)
  assert.equal(header.cwd, ownedCwd, 'UI away cwd must be the owned synthetic workspace')
  assert.equal(header.isSeeded, false)
  assert.equal(header.parentSession, undefined)
  assert.equal(header.origin, undefined)
  assert.ok(header.delegationDepth === undefined || header.delegationDepth === 0)
  assert.equal(workspace?.id, binding.workspaceId)
  assert.equal(workspace.path, ownedCwd)
  assert.ok(workspace.sessionIds.includes(binding.sessionId), 'UI away must belong to the exact workspace')
  assert.ok(workspace.sessionIds.every(id => originalIds.includes(id)), 'No extra workspace session is allowed')
  return { ...binding, root: true, cwdOwned: true, workspaceMember: true }
}
