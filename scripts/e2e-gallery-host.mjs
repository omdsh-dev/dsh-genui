/** rc.3-only real conversation oracle for the existing no-key smoke job.
 * Runtime files live under the caller's disposable DSH_HOME. No installation,
 * credentials, persisted session seeding, production patches, or new server.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, access, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { computedSpec, panelBase, panelAppend, editPanelBeforeAppend, checkPanelAfterAppend, runComputedBrowserChecks } from './computed-browser-checks.mjs'

const fence = spec => `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
const COMPUTED_ACK = 'Synthetic computed submission received.'
const ACK = 'Synthetic gallery choice received.'
const INITIAL = 'Display the synthetic gallery fixture.'
const TITLE = 'Gallery browser synthetic conversation'

export function replayChunks(text) {
  return { kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] }
}

export function gallerySmokeEnvironment(source, dshHome) {
  const allow = new Set(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LANGUAGE',
    'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR'])
  // Provider/account keys, NODE_OPTIONS preload hooks, DSH_* settings and user
  // configuration overrides are deliberately not inherited by the test host.
  return { ...Object.fromEntries(Object.entries(source).filter(([key]) => allow.has(key) || /_proxy$/iu.test(key))), DSH_HOME: dshHome }
}

export async function prepareGalleryConversation({ dshRoot, dshHome, spec }) {
  const host = JSON.parse(await readFile(join(dshRoot, 'apps/cli/package.json'), 'utf8'))
  // Minimum rc.1 continues to run the reusable DOM-fence visual checks only.
  if (host.version === '0.2.0-rc.1') return null
  assert.equal(host.version, '0.2.1-rc.3', 'Unrecognized host must not silently skip conversation coverage')
  const replayModule = join(dshRoot, 'packages/test-support/llm-replay/lib/index.js')
  await access(replayModule) // Missing official build output is a failure, not a skip.
  const root = join(dshHome, 'gallery-e2e')
  await mkdir(join(root, 'workspace'), { recursive: true })
  const sessionId = `session-e2e-gallery-${randomUUID()}`
  const initialRequestId = `gallery-initial-${randomUUID()}`
  const auditFile = join(root, 'events.jsonl')
  const replayFile = join(root, 'replay.json')
  const config = { sessionId, provider: 'gallery-e2e-replay', model: 'gallery-e2e', replayModule, replayFile, auditFile }
  await writeFile(auditFile, '')
  const initialText = [spec, computedSpec, panelBase].map(fence).join('\n\n')
  const choiceText = `${ACK}\n\n${fence(panelAppend)}`
  await writeFile(replayFile, JSON.stringify([replayChunks(initialText), replayChunks(choiceText), replayChunks(COMPUTED_ACK)]))
  const patchFile = join(root, 'cordis.patch.yml')
  // Loader discovers client packages through the nearest package.json. Mounting
  // scripts/fixtures directly would make this a second GenUI client source next
  // to the installed tarball. Give the unchanged host-only fixture its own
  // disposable package boundary; do not symlink back into the repository.
  const fixtureRoot = join(root, 'host-fixture')
  await mkdir(fixtureRoot, { recursive: true })
  await writeFile(join(fixtureRoot, 'package.json'), JSON.stringify({
    name: 'dsh-genui-gallery-e2e-host-fixture', version: '0.0.0', private: true, type: 'module',
  }))
  const plugin = join(fixtureRoot, 'index.mjs')
  await copyFile(fileURLToPath(new URL('./fixtures/gallery-host.mjs', import.meta.url)), plugin)
  // JSON is YAML-compatible; the official --patch loader owns application.
  await writeFile(patchFile, JSON.stringify([
    { id: 'agent-default-model', config: { provider: config.provider, model: config.model } },
    { insert: [{ id: 'e2e-gallery-host', name: plugin, config }] },
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
    assert.ok(workspaceId, 'Create the one gallery session before selecting it in another context')
    await assertNoActions()
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
    await dismissCredentialsOverlay()
    const workspaceRow = page.locator(`[data-row-key="workspace:${workspaceId}"]`)
    await workspaceRow.waitFor({ state: 'visible', timeout: 15000 })
    if (await workspaceRow.getAttribute('aria-expanded', { timeout: 15000 }) === 'false') await workspaceRow.click({ timeout: 15000 })
    const title = page.getByText(TITLE, { exact: true }).and(page.locator(':visible'))
    await title.waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await title.count(), 1, 'Created session title must have one visible UI target')
    await title.click({ timeout: 15000 })
    const renderedRoot = page.locator('[data-chat-flow-kind="assistant-step"] [data-genui]').filter({ has: page.getByRole('group', { name: 'Gallery browser cards', exact: true }) })
    await renderedRoot.waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await renderedRoot.count(), 1, 'Real assistant must render one gallery fence')
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
      assert.equal(textOf(assistant[0]), initialText)
      return openExistingConversation({ page, dismissCredentialsOverlay })
    },
    assertNoActions,
    editPanelBeforeAppend, checkPanelAfterAppend,
    async verifyComputed({ page, browser, artifactsDir }) {
      return runComputedBrowserChecks({ page, browser, artifactsDir, verifySubmit: async renderedRoot => {
        await renderedRoot.getByRole('button', { name: 'Send computed', exact: true }).click()
        await waitFor(rows => rows.some(row => row.type === 'replay-consumed'), 'Computed Submit and third replay turn')
        await page.getByText(COMPUTED_ACK, { exact: true }).waitFor({ state: 'visible' })
        await page.waitForTimeout(1000)
        const rows = await audit()
        const inputs = users(rows)
        assert.equal(inputs.length, 3, 'Computed submit must create exactly one new input')
        const action = inputs[2]
        assert.equal(action.sessionId, sessionId)
        assert.ok(textOf(action).startsWith('[genui-action] computed-submit。'))
        const payload = JSON.parse(textOf(action).split(' 组件数据: ')[1])
        assert.deepEqual(payload.fields, { note: 'safe note', amount: '3' })
        assert.deepEqual(payload.answers.choices, ['Choose 6'])
        assert.ok(!JSON.stringify(rows).includes('SYNTHETIC_SECRET_TEST_ONLY'))
        assert.equal(rows.filter(row => row.type === 'llm-route').length, 3)
        assert.deepEqual(rows.filter(row => row.type === 'turn-end').map(row => row.reason.kind), ['completed', 'completed', 'completed'])
        return { userMessages: 3, genuiActions: 2, replayCalls: 3, fields: payload.fields, choices: payload.answers.choices }
      } })
    },
    async verifyChoose({ page, renderedRoot, dismissCredentialsOverlay }) {
      await assertNoActions()
      await dismissCredentialsOverlay()
      await renderedRoot.getByRole('button', { name: 'Choose One', exact: true }).click({ timeout: 15000 })
      await waitFor(rows => rows.some(row => row.type === 'turn-end' && row.turn === 2), 'Real Choose action and second replay turn')
      await page.getByText(ACK, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
      // Include the renderer's trailing debounce window before final counts.
      await page.waitForTimeout(1000)
      const rows = await audit()
      const inputs = users(rows)
      assert.equal(inputs.length, 2, 'One Choose click must create exactly one additional user input')
      const action = inputs[1]
      assert.equal(action.sessionId, sessionId)
      assert.equal(action.message.source.kind, 'user')
      assert.ok(typeof action.message.source.rpcId === 'string' && action.message.source.rpcId.length > 0)
      assert.notEqual(action.message.source.rpcId, initialRequestId)
      assert.ok(textOf(action).startsWith('[genui-action] gallery-choose-one。'))
      const payload = JSON.parse(textOf(action).split(' 组件数据: ')[1])
      assert.equal(payload.type, 'button')
      assert.equal(payload.label, 'Choose One')
      const assistants = rows.filter(row => row.type === 'assistant-message')
      assert.equal(assistants.length, 2)
      assert.equal(textOf(assistants[1]), choiceText)
      assert.equal(rows.filter(row => row.type === 'llm-route').length, 2)
      assert.deepEqual(rows.filter(row => row.type === 'turn-end').map(row => row.reason.kind), ['completed', 'completed'])
      return { sessionId, genuiActions: 1, replayCalls: 2, actionRequestId: action.message.source.rpcId }
    },
  }
}
