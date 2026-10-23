/** rc.2-only real conversation oracle for the existing no-key smoke job.
 * Runtime files live under the caller's disposable DSH_HOME. No installation,
 * credentials, persisted session seeding, production patches, or new server.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, access, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ACK = 'Synthetic map selection received.'
const INITIAL = 'Display the synthetic map fixture.'
const TITLE = 'Map browser synthetic conversation'

export function mapConversationTitle(page) {
  // The active conversation also appears in the breadcrumb. Target the
  // session navigation region, retaining strict uniqueness within that region.
  return page.getByLabel('会话', { exact: true }).getByText(TITLE, { exact: true }).and(page.locator(':visible'))
}

export function assertMapSubmission(text) {
  assert.ok(text.startsWith('[genui-action] map-confirm。'))
  const payload = JSON.parse(text.split(' 组件数据: ')[1])
  assert.deepEqual(payload, { type: 'submit', answers: {}, fields: { destination: 'east' }, total: 1, answered: 1 })
  return payload
}

export function replayChunks(text) {
  return { kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] }
}

export async function prepareMapConversation({ dshRoot, dshHome, spec }) {
  const host = JSON.parse(await readFile(join(dshRoot, 'apps/cli/package.json'), 'utf8'))
  // Minimum rc.1 continues to run the reusable DOM-fence visual checks only.
  if (host.version === '0.2.0-rc.1') return null
  assert.equal(host.version, '0.2.1-rc.2', 'Unrecognized host must not silently skip conversation coverage')
  const replayModule = join(dshRoot, 'packages/test-support/llm-replay/lib/index.js')
  await access(replayModule) // Missing official build output is a failure, not a skip.
  const root = join(dshHome, 'map-e2e')
  await mkdir(join(root, 'workspace'), { recursive: true })
  const sessionId = `session-e2e-map-${randomUUID()}`
  const initialRequestId = `map-initial-${randomUUID()}`
  const auditFile = join(root, 'events.jsonl')
  const replayFile = join(root, 'replay.json')
  const config = { sessionId, provider: 'map-e2e-replay', model: 'map-e2e', replayModule, replayFile, auditFile }
  await writeFile(auditFile, '')
  await writeFile(replayFile, JSON.stringify([
    replayChunks(`\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``), replayChunks(ACK),
  ]))
  const patchFile = join(root, 'cordis.patch.yml')
  // Loader discovers client packages through the nearest package.json. Mounting
  // scripts/fixtures directly would make this a second GenUI client source next
  // to the installed tarball. Give the unchanged host-only fixture its own
  // disposable package boundary; do not symlink back into the repository.
  const fixtureRoot = join(root, 'host-fixture')
  await mkdir(fixtureRoot, { recursive: true })
  await writeFile(join(fixtureRoot, 'package.json'), JSON.stringify({
    name: 'dsh-genui-map-e2e-host-fixture', version: '0.0.0', private: true, type: 'module',
  }))
  const plugin = join(fixtureRoot, 'index.mjs')
  await copyFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/map-host.mjs'), plugin)
  // JSON is YAML-compatible; the official --patch loader owns application.
  await writeFile(patchFile, JSON.stringify([
    { id: 'agent-default-model', config: { provider: config.provider, model: config.model } },
    { insert: [{ id: 'e2e-map-host', name: plugin, config }] },
  ]))
  const readAudit = async () => (await readFile(auditFile, 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
  const audit = async () => {
    const rows = await readAudit()
    assert.deepEqual(rows.filter(row => row.type === 'agent-error' || row.allowed === false), [], 'Synthetic host reported a rejected request or AgentLoop error')
    return rows
  }
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 30000
    do {
      const rows = await audit()
      if (predicate(rows)) return rows
      await new Promise(resolve => setTimeout(resolve, 50))
    } while (Date.now() < deadline)
    assert.fail(`${label} did not settle within 30 seconds`)
  }
  const textOf = row => row.message.content.filter(part => part.type === 'text').map(part => part.text).join('')
  // The host also appends user-role runtime-context/time-context snapshots.
  // Only source.kind=user represents admitted client input and carries rpcId.
  const users = rows => rows.filter(row => row.type === 'user-message' && row.message.source.kind === 'user')
  const assertNoActions = async () => {
    const rows = await audit()
    const inputs = users(rows)
    assert.equal(inputs.length, 1, 'Browsing must not submit another user message')
    assert.equal(inputs[0].sessionId, sessionId)
    assert.equal(inputs[0].message.source.rpcId, initialRequestId)
    assert.equal(textOf(inputs[0]), INITIAL)
    assert.equal(rows.filter(row => row.type === 'llm-route').length, 1, 'Browsing must not invoke the model')
    return { userMessages: 1, genuiActions: 0, replayCalls: 1 }
  }
  let workspaceId = null
  const openExistingConversation = async ({ page, dismissCredentialsOverlay }) => {
    assert.ok(workspaceId, 'Create the one map session before selecting it in another context')
    await assertNoActions()
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
    await dismissCredentialsOverlay()
    const workspaceRow = page.locator(`[data-row-key="workspace:${workspaceId}"]`)
    await workspaceRow.waitFor({ state: 'visible', timeout: 15000 })
    if (await workspaceRow.getAttribute('aria-expanded', { timeout: 15000 }) === 'false') await workspaceRow.click({ timeout: 15000 })
    const title = mapConversationTitle(page)
    await title.waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await title.count(), 1, 'Created session title must have one visible UI target')
    await title.click({ timeout: 15000 })
    const renderedRoot = page.locator('[data-chat-flow-kind="assistant-step"] [data-genui]').filter({ has: page.getByRole('region', { name: 'Map browser locations', exact: true }) })
    await renderedRoot.waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await renderedRoot.count(), 1, 'Real assistant must render one map fence')
    await assertNoActions()
    return renderedRoot
  }
  return {
    webArgs: ['--patch', patchFile], cwd: join(root, 'workspace'), sessionId, auditFile,
    openExistingConversation,
    async openConversation({ page, dismissCredentialsOverlay }) {
      assert.equal(workspaceId, null, 'The replay fixture must be created and prompted only once')
      await waitFor(rows => rows.some(row => row.type === 'ready'), 'Replay configuration')
      const rpc = async (method, request) => {
        const response = await page.request.post(new URL(`/api/${method}`, page.url()).href, {
          data: { type: 'client-request', rpcId: randomUUID(), method, payload: { args: { request } } }, timeout: 15000,
        })
        assert.ok(response.ok(), `${method}: HTTP ${response.status()}`)
        const payload = await response.json()
        assert.equal(payload.result?.ok, true, `${method}: ${JSON.stringify(payload)}`)
        return payload.result.value
      }
      const { workspace } = await rpc('workspace/create', { path: join(root, 'workspace') })
      workspaceId = workspace.workspaceId
      const created = await rpc('session/create', { workspaceId: workspace.workspaceId, sessionId })
      assert.equal(created.sessionId, sessionId, 'Must use the actual created session')
      await rpc('session/rename', { sessionId, title: TITLE })
      const receipt = await rpc('session/prompt', { sessionId, requestId: initialRequestId, mode: 'queue', content: [{ type: 'text', text: INITIAL }] })
      assert.equal(receipt.accepted, true)
      const rows = await waitFor(rows => rows.some(row => row.type === 'turn-end' && row.turn === 1), 'Initial real assistant turn')
      assert.equal(rows.find(row => row.type === 'turn-end' && row.turn === 1).reason.kind, 'completed')
      const assistant = rows.filter(row => row.type === 'assistant-message')
      assert.equal(assistant.length, 1)
      assert.equal(textOf(assistant[0]), `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``)
      return openExistingConversation({ page, dismissCredentialsOverlay })
    },
    assertNoActions,
    async verifySubmit({ page, renderedRoot, dismissCredentialsOverlay }) {
      await assertNoActions()
      await dismissCredentialsOverlay()
      await renderedRoot.getByRole('button', { name: 'Submit map selection', exact: true }).click({ timeout: 15000 })
      await waitFor(rows => rows.some(row => row.type === 'replay-consumed'), 'Real Submit action and second replay turn')
      await page.getByText(ACK, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
      // Include the renderer's trailing debounce window before final counts.
      await page.waitForTimeout(1000)
      const rows = await audit()
      const inputs = users(rows)
      assert.equal(inputs.length, 2, 'One Submit click must create exactly one additional user input')
      const action = inputs[1]
      assert.equal(action.sessionId, sessionId)
      assert.equal(action.message.source.kind, 'user')
      assert.ok(typeof action.message.source.rpcId === 'string' && action.message.source.rpcId.length > 0)
      assert.notEqual(action.message.source.rpcId, initialRequestId)
      assertMapSubmission(textOf(action))
      const assistants = rows.filter(row => row.type === 'assistant-message')
      assert.equal(assistants.length, 2)
      assert.equal(textOf(assistants[1]), ACK)
      assert.equal(rows.filter(row => row.type === 'llm-route').length, 2)
      assert.deepEqual(rows.filter(row => row.type === 'turn-end').map(row => row.reason.kind), ['completed', 'completed'])
      return { sessionId, genuiActions: 1, replayCalls: 2, actionRequestId: action.message.source.rpcId }
    },
  }
}
