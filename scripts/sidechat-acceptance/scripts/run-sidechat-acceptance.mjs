/** New isolated runner. Source-layout full acceptance and registry-layout backend
 * rehearsal are distinct outcomes. Full mode uses official normal package add;
 * rehearsal installs nothing. Browser launching remains caller-owned.
 */
import assert from 'node:assert/strict'
import { projectSnapshotFailure } from '../fixture/lib/snapshot-diagnostics.mjs'
import { validateUiAway } from '../fixture/lib/ui-away.mjs'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rename, cp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyHostAndArtifacts, resolveExactHost, sidechatSmokeEnvironment, IDS, PROVIDER, MODEL,
  withOwnedResources, invokeBrowserCheck } from './sidechat-host-contract.mjs'
import { AWAY_ID, initialExpected, finalExpected, durableSnapshot, PendingSettlement } from './sidechat-backend-oracle.mjs'
import { spawnOwned, delay, timeout } from './owned-process.mjs'
import { inspectPack, verifyInstalledPack } from './exact-pack.mjs'
import { completeSyntheticOnboarding, projectOnboardingReport } from './sidechat-onboarding.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const PLUGINS = ['@changfenhuang/dsh-genui', 'dsh-better-sidebar']
async function json(file) { return JSON.parse(await readFile(file, 'utf8')) }
async function maybeJSON(file) { try { return await json(file) } catch (error) { if (error.code === 'ENOENT') return; throw error } }
async function atomicJSON(file, value) { await writeFile(file + '.tmp', JSON.stringify(value) + '\n'); await rename(file + '.tmp', file) }
async function poll(read, accepts, label, alive, ms = 60000) {
  const deadline = Date.now() + ms
  do { alive(); const value = await read(); if (accepts(value)) return value; await delay(50) } while (Date.now() < deadline)
  throw new Error(`${label} did not settle`)
}
function cleanOrigin(url) {
  const parsed = new URL(url)
  assert.equal(parsed.protocol, 'http:'); assert.equal(parsed.hostname, '127.0.0.1')
  assert.ok(/^\?token=[A-Za-z0-9_-]+$/u.test(parsed.search), 'Official loopback token required')
  return parsed.origin
}
async function http(url, init = {}) {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(15000), redirect: 'manual' }) }
  catch { throw new Error('Synthetic loopback HTTP request failed; auth-bearing URL withheld') }
}
export async function openAuthenticatedPage(page, launchUrl, origin) {
  try { await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }) }
  catch { throw new Error('Official browser token exchange failed; auth-bearing URL withheld') }
  assert.ok(page.url() === origin + '/', 'Browser must exchange token and end on clean official origin')
}
async function authentication(url) {
  const origin = cleanOrigin(url)
  const unauthenticated = await http(origin)
  assert.equal(unauthenticated.status, 401, 'Official root authentication must remain intact'); await unauthenticated.arrayBuffer()
  const exchanged = await http(url)
  assert.equal(exchanged.status, 303, 'Official token-to-cookie exchange required'); await exchanged.arrayBuffer()
  const cookie = exchanged.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(cookie, 'Official session cookie is required')
  const rpc = async (method, request) => {
    // Only these setup methods, never session/prompt or private action APIs.
    assert.ok(['workspace/create', 'session/create'].includes(method), 'Only public setup RPC allowed')
    const response = await http(`${origin}/api/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args: { request } } }) })
    assert.equal(response.status, 200, `Setup RPC ${method} HTTP failure`)
    const data = await response.json(); assert.equal(data.result?.ok, true, `Setup RPC ${method} rejected`)
    return data.result.value
  }
  return { origin, rpc }
}
async function prepareFixture(root, host) {
  const output = join(root, 'synthetic-evidence'), fixtureRoot = join(root, 'host-fixture')
  await mkdir(output); await cp(join(here, '../fixture'), fixtureRoot, { recursive: true })
  await writeFile(join(fixtureRoot, 'package.json'), JSON.stringify({ name: 'dsh354-bounded-host-fixture', version: '0.0.2', private: true, type: 'module' }))
  const patch = async phase => {
    const file = join(root, `${phase}.patch.json`)
    await atomicJSON(file, [
      { id: 'agent-default-model', config: { provider: PROVIDER, model: MODEL } },
      { insert: [{ id: 'fixture-dsh354-dual', name: join(fixtureRoot, 'lib/index.mjs'), config: { phase, output, ownedRoot: root, awayId: AWAY_ID, ...host.modules } }] },
    ])
    return file
  }
  return { output, seedPatch: await patch('seed'), resumePatch: await patch('resume') }
}
async function installCandidates(options, host, env, cwd, own) {
  // Full CI uses ordinary official consumer installation and its existing build
  // policy. Never auto-approve a dependency build or alter compatibility policy.
  const packs = await Promise.all([inspectPack(options.genuiTarball, PLUGINS[0]), inspectPack(options.sidebarTarball, PLUGINS[1])])
  for (const tarball of [options.genuiTarball, options.sidebarTarball]) {
    const install = spawnOwned(process.execPath, [host.bin, 'plugin', '--profile', 'web', 'add', tarball], { env, cwd, label: 'Exact candidate official install', rejectBlockedBuilds: true })
    own(() => install.stop()); await install.finish()
  }
  const profile = await json(join(env.DSH_HOME, 'profiles/web/package.json'))
  assert.ok(Array.isArray(profile.dsh?.profile?.bundles), 'Actual profile bundles required')
  for (const name of PLUGINS) {
    assert.equal(profile.dsh.profile.bundles.filter(item => item === name).length, 1, `Actual profile must contain ${name} exactly once`)
    assert.ok(profile.dependencies?.[name], 'Candidate dependency missing from profile')
  }
  const installed = []
  for (const pack of packs) installed.push(await verifyInstalledPack(pack, join(env.DSH_HOME, 'profiles/web'), dirname(env.DSH_HOME)))
  return { plugins: PLUGINS, officialNormalAdd: true, installed }
}
async function lifecycle({ root, host, env, own, snapshotReport }) {
  const cwd = join(root, 'workspace')
  const fixture = await prepareFixture(root, host)
  const launch = async (phase, patchFile) => {
    const process = spawnOwned(globalThis.process.execPath, [host.bin, 'web', '--patch', patchFile, '--port', '0', '--no-open'], { cwd, env, label: `${phase} official rc.2 host`, expectedStopCode: 130 })
    const stop = async () => {
      const result = await process.stop()
      assert.deepEqual(await json(join(fixture.output, `fixture-${phase}-disposed.json`)),
        { phase, ownedChildrenClosed: 2, flushCompleted: true }, 'Owned fixture must finish child disposal and flush before exit')
      return result
    }
    own(stop)
    const url = await process.launch()
    await poll(() => maybeJSON(join(fixture.output, 'fixture-ready.json')), value => value?.phase === phase, `${phase} fixture ready`, process.alive)
    return { process, url, stop }
  }
  const seedHost = await launch('seed', fixture.seedPatch)
  const seedAuth = await authentication(seedHost.url)
  const { workspace } = await seedAuth.rpc('workspace/create', { path: cwd })
  assert.equal(typeof workspace?.workspaceId, 'string')
  // Create away first, then parent. Away has zero model, action and turn events.
  for (const sessionId of [AWAY_ID, IDS[0]]) {
    const created = await seedAuth.rpc('session/create', { workspaceId: workspace.workspaceId, sessionId })
    assert.equal(created.sessionId, sessionId)
  }
  const stateFile = join(fixture.output, 'fixture-state.json')
  const seed = await poll(() => maybeJSON(stateFile), value => value?.status === 'seed-persisted-restart-required', 'Durable seed flush/readback', seedHost.process.alive)
  assert.deepEqual(seed.sessionIds, IDS)
  seedHost.process.alive()
  const seedExit = await seedHost.stop() // Mandatory before a separate process resumes.
  const resume = await launch('resume', fixture.resumePatch)
  const resumed = await poll(() => maybeJSON(stateFile), value => value?.phase === 'resume' && value.status === 'resumed-from-durable-seed', 'Separate durable resume', resume.process.alive)
  assert.equal(resumed.assistantEventSeq, seed.assistantEventSeq)
  const origin = cleanOrigin(resume.url)
  const unauthenticated = await http(origin); assert.equal(unauthenticated.status, 401); await unauthenticated.arrayBuffer()
  let inRead = false, lastSnapshot, uiAway
  async function readRaw() {
    assert.equal(inRead, false, 'Durable reads must be serialized'); inRead = true
    try {
      resume.process.alive()
      const requestId = randomUUID()
      await atomicJSON(join(fixture.output, 'snapshot-request.json'), { requestId, ...(uiAway ? { uiAway } : {}) })
      const record = await poll(() => maybeJSON(join(fixture.output, 'snapshot-response.json')), value => value?.requestId === requestId,
        'Fresh flush/open/read/close response', resume.process.alive, 15000)
      if (record.snapshotFailure && snapshotReport) Object.assign(snapshotReport, projectSnapshotFailure(record.snapshotFailure))
      assert.equal(record.fatal, undefined, 'Host fixture reported an error')
      return record
    } finally { inRead = false }
  }
  const readBackendSnapshot = async ({ expected }) => {
    const snapshot = durableSnapshot(await readRaw(), { expected, assistantEventSeq: seed.assistantEventSeq, uiAway })
    // Prior real receipts cannot be rewritten by a subsequent snapshot.
    if (lastSnapshot) for (const id of IDS) assert.deepEqual(snapshot.sessions[id].actions.slice(0, lastSnapshot.sessions[id].actions.length), lastSnapshot.sessions[id].actions)
    lastSnapshot = snapshot; return snapshot
  }
  const waitForBackendAction = async ({ ownerId, action, payload, text, expectedCounts, expectedTurn, expected, timeoutMs = 30000 }) => {
    assert.ok(IDS.slice(1).includes(ownerId)); const target = expected[ownerId].actions.at(-1)
    assert.deepEqual(target, { action, payload, text, turn: expectedTurn })
    assert.deepEqual(expectedCounts, Object.fromEntries(IDS.map(id => [id, expected[id].actions.length])))
    const deadline = Date.now() + Math.min(30000, timeoutMs)
    do {
      const raw = await readRaw()
      try { durableSnapshot(raw, { expected, assistantEventSeq: seed.assistantEventSeq, allowPending: true, uiAway }); return await readBackendSnapshot({ expected }) }
      catch (error) { if (!(error instanceof PendingSettlement)) throw error }
      await delay(50)
    } while (Date.now() < deadline)
    throw new Error('Owning action did not reach a durable completed replay turn')
  }
  const bindUiAwaySession = async sessionId => {
    assert.equal(uiAway, undefined, 'Only one UI away session can be bound')
    uiAway = validateUiAway({ sessionId, workspaceId: workspace.workspaceId }, [...IDS, AWAY_ID])
    await readBackendSnapshot({ expected: initialExpected() })
    return { ...uiAway, durableRelevantEvents: 0, actions: 0, completedTurns: [] }
  }
  return { ...resume, origin, seed, workspaceId: workspace.workspaceId, seedExit, readBackendSnapshot, waitForBackendAction,
    bindUiAwaySession, uiAway: () => uiAway }
}
async function setupRoot(own) {
  const root = await mkdtemp(join(tmpdir(), 'dsh354-owned-'))
  own(() => rm(root, { recursive: true, force: true }))
  const env = sidechatSmokeEnvironment(process.env, root)
  await Promise.all(['workspace', 'tool-home', 'home', 'cache', 'config', 'tmp'].map(name => mkdir(join(root, name))))
  return { root, env }
}
async function verifyBrowserBoot(page) {
  const entries = await page.evaluate(() => Array.isArray(window.__DSH_BOOT__?.entries)
    ? window.__DSH_BOOT__.entries.map(({ id, url }) => ({ id, url })) : null)
  assert.ok(entries?.length, 'Actual host browser boot graph required')
  const seen = []
  for (const name of PLUGINS) {
    const matches = entries.filter(item => item.id === name)
    assert.equal(matches.length, 1, `Actual browser must load ${name} exactly once`)
    const url = new URL(matches[0].url, page.url())
    assert.equal(url.origin, new URL(page.url()).origin, 'Plugin asset must be same official loopback host')
    const response = await page.request.get(url.href, { timeout: 15000 })
    assert.equal(response.status(), 200, `Actual ${name} client asset must load`)
    seen.push(name)
  }
  return seen
}
/** Browser is mandatory and caller-owned. Only context/page/processes we create are closed. */
export async function runSidechatAcceptance(options) {
  const host = await verifyHostAndArtifacts(options)
  await mkdir(options.artifactDir, { recursive: true })
  const report = { kind: 'real-dual-plugin-sidechat-acceptance', status: 'incomplete', hostVersion: host.hostVersion,
    hostLayout: host.hostLayout, genuiSha256: host.genuiSha256, sidebarSha256: host.sidebarSha256, browserAcceptance: false }
  try {
    const result = await withOwnedResources(async ({ own }) => {
      const { root, env } = await setupRoot(own)
      report.install = await installCandidates(options, host, env, join(root, 'workspace'), own)
      const snapshotReport = options.snapshotReport ?? {}
      report.snapshotFailure = snapshotReport
      const run = await lifecycle({ root, host, env, own, snapshotReport })
      const context = await options.browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
      own(() => timeout(() => context.close(), 10000, 'Owned browser context cleanup'))
      const page = await context.newPage(), pageErrors = []
      page.on('pageerror', () => pageErrors.push(true))
      await openAuthenticatedPage(page, run.url, run.origin)
      report.browserBootPlugins = await verifyBrowserBoot(page)
      const workspaceRow = page.locator(`[data-row-key="workspace:${run.workspaceId}"]`)
      await workspaceRow.waitFor({ state: 'visible', timeout: 20000 })
      report.onboarding = options.onboardingReport ?? {}
      await completeSyntheticOnboarding(page, workspaceRow, report.onboarding)
      if (await workspaceRow.getAttribute('aria-expanded') === 'false') await workspaceRow.click({ timeout: 15000 })
      const browserReport = await timeout(() => invokeBrowserCheck(options.checkBrowser, { page, artifactsDir: options.artifactDir,
        parentId: IDS[0], childIds: IDS.slice(1), awaySessionId: AWAY_ID, workspaceId: run.workspaceId, seed: run.seed, bindUiAwaySession: run.bindUiAwaySession,
        readBackendSnapshot: run.readBackendSnapshot, waitForBackendAction: run.waitForBackendAction, report: {} }), 300000, 'Mandatory browser acceptance callback')
      assert.equal(browserReport?.status, 'passed-real-host-checks', 'Mandatory browser callback must attest all checks')
      assert.ok(run.uiAway(), 'Actual native UI-created away must be durably bound')
      const final = await run.readBackendSnapshot({ stage: 'host-final', expected: finalExpected() })
      await delay(1000) // Bounded trailing debounce/duplicate observation window.
      assert.deepEqual(await run.readBackendSnapshot({ stage: 'host-quiet-reread', expected: finalExpected() }), final)
      assert.equal(pageErrors.length, 0, 'Page errors invalidate acceptance')
      run.process.alive()
      return { backend: final, seededAssistantSeq: run.seed.assistantEventSeq, seedGracefulExit: run.seedExit.code,
        quietWindowMs: 1000, replayCalls: 4, replayScriptsConsumed: 2,
        away: { sessionId: AWAY_ID, durableRelevantEvents: 0, actions: 0, completedTurns: [] },
        uiAway: { ...run.uiAway(), durableRelevantEvents: 0, actions: 0, completedTurns: [] } }
    })
    Object.assign(report, result, { status: 'passed', browserAcceptance: true, cleanupCompleted: true })
    return report
  } catch (error) { report.status = 'failed'; report.failure = 'Required host, browser, durable oracle or cleanup gate failed'; throw error }
  finally {
    if (report.onboarding) report.onboarding = projectOnboardingReport(report.onboarding)
    if (report.snapshotFailure) report.snapshotFailure = projectSnapshotFailure(report.snapshotFailure)
    await atomicJSON(join(options.artifactDir, 'dsh354-host-verdict.json'), report)
  }
}
/** Explicitly backend-only: no candidates installed, browser, actions or UI claim. */
export async function runBackendRehearsal(options) {
  assert.ok(isAbsolute(options.artifactDir), 'Absolute artifact directory required')
  const host = await resolveExactHost(options)
  await mkdir(options.artifactDir, { recursive: true })
  const report = { kind: 'backend-lifecycle-rehearsal-only', status: 'incomplete', hostVersion: host.hostVersion, hostLayout: host.hostLayout,
    browserAcceptance: false, dualPluginAcceptance: false, installedCandidatePacks: false, actionReplayExercised: false }
  try {
    const result = await withOwnedResources(async ({ own }) => {
      const { root, env } = await setupRoot(own)
      const snapshotReport = options.snapshotReport ?? {}
      report.snapshotFailure = snapshotReport
      const run = await lifecycle({ root, host, env, own, snapshotReport })
      const first = await run.readBackendSnapshot({ expected: initialExpected() })
      await delay(1000)
      assert.deepEqual(await run.readBackendSnapshot({ expected: initialExpected() }), first)
      run.process.alive()
      return { backend: first, seededAssistantSeq: run.seed.assistantEventSeq, seedGracefulExit: run.seedExit.code, freshDurableReads: 2,
        defaultProvider: PROVIDER, modelCalls: 0, actions: 0, quietWindowMs: 1000,
        away: { sessionId: AWAY_ID, durableRelevantEvents: 0, actions: 0, completedTurns: [] } }
    })
    Object.assign(report, result, { status: 'passed-backend-rehearsal-only', cleanupCompleted: true })
    return report
  } catch (error) { report.status = 'failed-backend-rehearsal'; report.failure = 'Lifecycle, durable oracle, host or cleanup failed'; throw error }
  finally {
    if (report.snapshotFailure) report.snapshotFailure = projectSnapshotFailure(report.snapshotFailure)
    await atomicJSON(join(options.artifactDir, 'dsh354-backend-rehearsal.json'), report)
  }
}
