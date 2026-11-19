import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { validateAcceptanceOptions, verifyTarball, sidechatSmokeEnvironment, assertOwnedRoute,
  assertOwnedAuditRow, IDS, PROVIDER, MODEL, withOwnedResources, invokeBrowserCheck } from '../scripts/sidechat-host-contract.mjs'

test('required caller browser, callback and exact artifact arguments fail closed', () => {
  const options = { browser: { newContext() {} }, checkBrowser() {}, dshRoot: '/host', dshBin: '/host/apps/cli/lib/bin.js',
    genuiTarball: '/g.tgz', sidebarTarball: '/s.tgz', artifactDir: '/artifacts', genuiTarballSha256: 'a'.repeat(64), sidebarTarballSha256: 'b'.repeat(64) }
  validateAcceptanceOptions(options)
  for (const key of Object.keys(options)) {
    const partial = { ...options }; delete partial[key]
    assert.throws(() => validateAcceptanceOptions(partial), undefined, key)
  }
  assert.throws(() => validateAcceptanceOptions({ ...options, dshRoot: 'relative' }))
})

test('digest is checked against actual bytes before any installation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh354-contract-'))
  try {
    const file = join(root, 'synthetic.tgz'), bytes = 'Synthetic bytes; not a real package'
    await writeFile(file, bytes)
    const sha = createHash('sha256').update(bytes).digest('hex')
    assert.equal(await verifyTarball(file, sha), sha)
    await assert.rejects(verifyTarball(file, '0'.repeat(64)), /SHA256 mismatch/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('fresh host environment excludes credentials, inherited config and proxies', () => {
  const env = sidechatSmokeEnvironment({ PATH: '/bin', DEEPSEEK_API_KEY: 'synthetic', HOME: '/other',
    DSH_HOME: '/other', NODE_OPTIONS: '--require malicious', HTTPS_PROXY: 'https://other', NPM_TOKEN: 'synthetic' }, '/owned')
  assert.equal(env.PATH, '/bin'); assert.equal(env.HOME, '/owned/tool-home'); assert.equal(env.DSH_HOME, '/owned/home')
  for (const key of ['DEEPSEEK_API_KEY', 'NODE_OPTIONS', 'HTTPS_PROXY', 'NPM_TOKEN']) assert.equal(env[key], undefined)
})

test('foreign session, main inference, seed inference and non-replay model rejected', () => {
  const route = { phase: 'resume', sessionId: IDS[1], provider: PROVIDER, model: MODEL, turn: 2, step: 1 }
  assertOwnedRoute(route)
  for (const patch of [{ sessionId: 'foreign' }, { sessionId: IDS[0] }, { phase: 'seed' }, { model: 'live' }, { provider: 'live' }, { turn: 4 }, { step: 2 }]) {
    assert.throws(() => assertOwnedRoute({ ...route, ...patch }))
  }
})

test('foreign audit event, rejection and malformed durable sequence fail closed', () => {
  const row = { sessionId: IDS[1], event: { type: 'user/message', seq: 5 } }
  assertOwnedAuditRow(row)
  assert.throws(() => assertOwnedAuditRow({ ...row, sessionId: 'foreign' }))
  assert.throws(() => assertOwnedAuditRow({ ...row, event: { type: 'user/message' } }))
  assert.throws(() => assertOwnedAuditRow({ ...row, event: { type: 'unknown', seq: 5 } }))
  for (const type of ['fixture-failed', 'agent-error', 'rejected-event']) assert.throws(() => assertOwnedAuditRow({ type }))
})

test('browser callback is mandatory, awaited and errors propagate', async () => {
  const order = []
  const result = await invokeBrowserCheck(async () => { await new Promise(resolve => setTimeout(resolve, 5)); order.push('done'); return 7 }, {})
  assert.equal(result, 7); assert.deepEqual(order, ['done'])
  await assert.rejects(invokeBrowserCheck(undefined, {}), /must not be skipped/u)
  await assert.rejects(invokeBrowserCheck(async () => { throw new Error('browser failure') }, {}), /browser failure/u)
})

test('owned cleanup is reverse order, awaited and cannot silently PASS on failure', async () => {
  const order = []
  const result = await withOwnedResources(async ({ own }) => {
    own(async () => { await new Promise(resolve => setTimeout(resolve, 5)); order.push('first') })
    own(async () => { order.push('second') }); return 9
  })
  assert.equal(result, 9); assert.deepEqual(order, ['second', 'first'])
  await assert.rejects(withOwnedResources(async ({ own }) => { own(async () => { throw new Error('close failure') }); return 'PASS' }), /Owned cleanup failed/u)
})

test('work and cleanup failures are both retained', async () => {
  await assert.rejects(withOwnedResources(async ({ own }) => {
    own(async () => { throw new Error('cleanup') }); throw new Error('browser')
  }), error => error instanceof AggregateError && error.errors[0].message === 'browser' && error.errors[1].message === 'cleanup')
})

// Navigation orchestration only, not a browser/DOM or token-exchange test.
const { openAuthenticatedPage } = await import('../scripts/run-sidechat-acceptance.mjs')
test('auth navigation errors cannot expose the launch token through caller logs', async () => {
  const secret = 'synthetic-token-not-a-credential'
  await assert.rejects(openAuthenticatedPage({ async goto() { throw new Error(`Navigation failed http://127.0.0.1:1/?token=${secret}`) } }, `http://127.0.0.1:1/?token=${secret}`, 'http://127.0.0.1:1'), error => !error.message.includes(secret) && !error.cause)
})
test('failure to clear auth URL fails without an assertion dumping the actual token', async () => {
  const secret = 'synthetic-token-not-a-credential', url = `http://127.0.0.1:1/?token=${secret}`
  await assert.rejects(openAuthenticatedPage({ async goto() {}, url() { return url } }, url, 'http://127.0.0.1:1'), error => !error.message.includes(secret) && error.actual === false)
})
