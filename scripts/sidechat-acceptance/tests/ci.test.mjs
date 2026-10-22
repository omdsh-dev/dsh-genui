/** Synthetic files and injected command recorder only. No Git/network/host/browser execution. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { hostApplicability, validateSidechatMode, buildPinnedSidebar, runSidechatCI, SIDEBAR_COMMIT, SIDEBAR_REPOSITORY } from '../ci.mjs'
import { checkSidechatBrowser } from '../scripts/sidechat-browser-checks.mjs'

function pack(name, version = '0.28.0', scripts) {
  const body = Buffer.from(JSON.stringify({ name, version, ...(scripts ? { scripts } : {}) }))
  const header = Buffer.alloc(512)
  header.write('package/package.json'); header.write('0000644\0', 100)
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124)
  header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257)
  header.write(header.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148)
  return gzipSync(Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512), Buffer.alloc(1024)]))
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const passed = () => ({ kind: 'real-dual-plugin-sidechat-acceptance', status: 'passed',
  browserAcceptance: true, cleanupCompleted: true, hostVersion: '0.2.1-rc.2' })
async function fixture(t, version = '0.2.1-rc.2') {
  const root = await mkdtemp(join(tmpdir(), 'dsh354-ci-contract-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cli = join(root, 'host/apps/cli')
  await mkdir(join(cli, 'lib'), { recursive: true })
  await writeFile(join(cli, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }))
  await writeFile(join(cli, 'lib/bin.js'), '// synthetic, never executed\n')
  const genuiTarball = join(root, 'genui.tgz'), bytes = pack('@changfenhuang/dsh-genui', '0.14.0')
  await writeFile(genuiTarball, bytes)
  return { root, options: { dshRoot: join(root, 'host'), dshBin: join(cli, 'lib/bin.js'),
    genuiTarball, genuiTarballSha256: sha(bytes), artifactDir: join(root, 'artifacts'),
    browser: { newContext() { throw Error('The pure wrapper contract must never open a browser') } } } }
}
function commandRecorder({ commit = SIDEBAR_COMMIT, name = 'dsh-better-sidebar', version = '0.28.0',
  packageManager = 'pnpm@11.8.0', packedName = name, packedVersion = version, extraPack = false, scripts,
  failAt, linkedPack = false } = {}) {
  const calls = [], roots = []
  return { calls, roots, async executeCommand(command, args, { cwd, env }) {
    calls.push({ command, args, cwd, env }); if (!roots.includes(dirname(cwd))) roots.push(dirname(cwd))
    if (`${command} ${args.join(' ')}` === failAt) throw Error('Synthetic command failure')
    if (command === 'git' && args[0] === 'checkout') {
      await mkdir(join(cwd, '.git'), { recursive: true }); await writeFile(join(cwd, '.git/HEAD'), commit + '\n')
      await writeFile(join(cwd, 'package.json'), JSON.stringify({ name, version, packageManager }))
    }
    if (command === 'pnpm' && args[0] === 'pack') {
      const output = join(args[2], 'dsh-better-sidebar-0.28.0.tgz'), bytes = pack(packedName, packedVersion, scripts)
      if (linkedPack) { const outside = join(dirname(cwd), 'outside.tgz'); await writeFile(outside, bytes); await symlink(outside, output) }
      else await writeFile(output, bytes)
      if (extraPack) await writeFile(join(args[2], 'stale.tgz'), bytes)
    }
  } }
}
async function verdict(options) { return JSON.parse(await readFile(join(options.artifactDir, 'dsh354-host-verdict.json'), 'utf8')) }
async function assertRemoved(roots) { for (const root of roots) await assert.rejects(stat(root), { code: 'ENOENT' }) }

test('explicit sidechat option preserves every previous smoke and model install mode', () => {
  for (const smoke of [false, true]) for (const install of ['link', 'npm', 'tarball']) {
    assert.doesNotThrow(() => validateSidechatMode({ sidechat: false, smoke, install }))
  }
  assert.doesNotThrow(() => validateSidechatMode({ sidechat: true, smoke: true, install: 'tarball' }))
})
test('sidechat requires both smoke and tarball mode instead of adding implicit network work', () => {
  for (const smoke of [false, true]) for (const install of ['link', 'npm', 'tarball']) {
    if (smoke && install === 'tarball') continue
    assert.throws(() => validateSidechatMode({ sidechat: true, smoke, install }), /--sidechat requires --smoke --install tarball/)
  }
})
test('only exact rc.2 requires coverage; minimum is explicit N/A, never PASS', () => {
  assert.equal(hostApplicability('0.2.1-rc.2'), 'required')
  assert.equal(hostApplicability('0.2.0-rc.1'), 'not-applicable')
  for (const version of ['0.2.1-rc.1', '0.2.1', '0.2.2', '', undefined]) assert.throws(() => hostApplicability(version), /silently skipped/)
})
test('minimum lane emits N/A, removes stale evidence, and does no checkout or browser work', async t => {
  const { options } = await fixture(t, '0.2.0-rc.1'), commands = commandRecorder()
  await mkdir(options.artifactDir)
  for (const file of ['dsh354-host-verdict.json', 'dsh354-browser-report.json', 'dsh354-thread-A-block2-fence1.png']) await writeFile(join(options.artifactDir, file), 'stale')
  let calls = 0
  const result = await runSidechatCI({ ...options, browser: undefined, genuiTarball: undefined }, { ...commands, acceptance: async () => { calls++ } })
  assert.equal(result.status, 'not-applicable'); assert.equal(result.browserAcceptance, false)
  assert.equal(commands.calls.length, 0); assert.equal(calls, 0)
  assert.equal((await verdict(options)).status, 'not-applicable')
  for (const file of ['dsh354-browser-report.json', 'dsh354-thread-A-block2-fence1.png']) await assert.rejects(stat(join(options.artifactDir, file)), { code: 'ENOENT' })
})
test('unknown host fails rather than silently bypassing the required gate', async t => {
  const { options } = await fixture(t, '0.2.1-rc.3'), commands = commandRecorder()
  await assert.rejects(runSidechatCI(options, commands), /silently skipped/)
  assert.equal(commands.calls.length, 0); assert.equal((await verdict(options)).status, 'failed')
})
test('source-layout binary must resolve inside the selected host', async t => {
  const { root, options } = await fixture(t)
  const outside = join(root, 'outside.js'); await writeFile(outside, '// synthetic')
  await assert.rejects(runSidechatCI({ ...options, dshBin: outside }), /belong to the source host/)
  assert.equal((await verdict(options)).browserAcceptance, false)
})
test('GenUI digest is checked before any checkout work', async t => {
  const { options } = await fixture(t), commands = commandRecorder()
  await assert.rejects(runSidechatCI({ ...options, genuiTarballSha256: '0'.repeat(64) }, commands), /SHA256 mismatch/)
  assert.equal(commands.calls.length, 0); assert.equal((await verdict(options)).failureStage, 'genui-pack-preflight')
})
test('current gate requires a real caller-owned browser interface', async t => {
  const { options } = await fixture(t), commands = commandRecorder()
  await assert.rejects(runSidechatCI({ ...options, browser: undefined }, commands), /Caller-owned browser/)
  assert.equal(commands.calls.length, 0)
})
test('pinned checkout runs normal frozen install/typecheck/build/pack and passes exact fresh bytes', async t => {
  const { options } = await fixture(t), commands = commandRecorder(); let received
  const result = await runSidechatCI(options, { ...commands, acceptance: async value => {
    received = value
    assert.equal(value.sidebarTarballSha256, sha(await readFile(value.sidebarTarball)))
    return passed()
  } })
  assert.deepEqual(commands.calls.map(({ command, args }) => [command, ...args]), [
    ['git', 'init', '--quiet'], ['git', 'remote', 'add', 'origin', SIDEBAR_REPOSITORY],
    ['git', 'fetch', '--depth', '1', 'origin', SIDEBAR_COMMIT], ['git', 'checkout', '--detach', '--quiet', 'FETCH_HEAD'],
    ['pnpm', 'install', '--frozen-lockfile'], ['pnpm', 'run', 'typecheck'], ['pnpm', 'run', 'build'],
    ['pnpm', 'pack', '--pack-destination', dirname(received.sidebarTarball)],
  ])
  assert.equal(received.browser, options.browser); assert.equal(received.hostLayout, 'source')
  assert.equal(received.checkBrowser, checkSidechatBrowser); assert.equal(received.genuiTarballSha256, options.genuiTarballSha256)
  assert.equal(result.status, 'passed'); assert.equal(result.sidebarCommit, SIDEBAR_COMMIT)
  assert.equal(result.sidebarCheckoutCleaned, true); assert.equal((await verdict(options)).browserAcceptance, true)
  await assertRemoved(commands.roots)
})
test('build environment cannot inherit credentials, provider keys, config overrides or preload hooks', async t => {
  const { root } = await fixture(t), commands = commandRecorder()
  await buildPinnedSidebar(join(root, 'build'), { ...commands, own() {}, sourceEnvironment: {
    PATH: '/synthetic/path', HOME: '/private/home', GITHUB_TOKEN: 'synthetic-token', NODE_OPTIONS: '--require synthetic',
    NPM_CONFIG_USERCONFIG: '/private/npmrc', DSH_HOME: '/private/dsh', DEEPSEEK_API_KEY: 'synthetic-key',
  } })
  const env = commands.calls[0].env
  for (const key of ['GITHUB_TOKEN', 'NODE_OPTIONS', 'NPM_CONFIG_USERCONFIG', 'DEEPSEEK_API_KEY']) assert.equal(env[key], undefined)
  assert.equal(env.GIT_CONFIG_NOSYSTEM, undefined); assert.equal(env.GIT_TERMINAL_PROMPT, '0')
  assert.ok(env.HOME.startsWith(root)); assert.ok(env.DSH_HOME.startsWith(root)); assert.equal(env.PATH, '/synthetic/path')
})
for (const [name, settings, expected] of [
  ['wrong checkout object', { commit: 'f'.repeat(40) }, /reviewed commit/],
  ['wrong package manager', { packageManager: 'pnpm@11.7.0' }, /package manager/],
  ['wrong package name', { name: 'not-sidebar' }, /dsh-better-sidebar/],
  ['wrong packed name', { packedName: 'not-sidebar' }, /dsh-better-sidebar/],
  ['wrong packed version', { packedVersion: '9.9.9' }, /Packed Sidebar version/],
  ['unexpected second pack', { extraPack: true }, /Exactly one fresh/],
  ['linked pack outside output', { linkedPack: true }, /owned output directory/],
  ['candidate lifecycle execution', { scripts: { install: 'synthetic' } }, /lifecycle execution/],
  ['install failure', { failAt: 'pnpm install --frozen-lockfile' }, /Synthetic command failure/],
  ['typecheck failure', { failAt: 'pnpm run typecheck' }, /Synthetic command failure/],
  ['build failure', { failAt: 'pnpm run build' }, /Synthetic command failure/],
]) test(`${name} fails closed, cleans its checkout, and never enters browser acceptance`, async t => {
  const { options } = await fixture(t), commands = commandRecorder(settings); let acceptanceCalls = 0
  await assert.rejects(runSidechatCI(options, { ...commands, acceptance: async () => { acceptanceCalls++; return passed() } }), expected)
  assert.equal(acceptanceCalls, 0); assert.equal((await verdict(options)).status, 'failed'); await assertRemoved(commands.roots)
})
for (const [name, result] of [
  ['no result', undefined], ['incomplete', { ...passed(), status: 'incomplete' }],
  ['not applicable on rc.2', { ...passed(), status: 'not-applicable' }],
  ['artifact-only success', { ...passed(), browserAcceptance: false }],
  ['missing cleanup', { ...passed(), cleanupCompleted: false }],
]) test(`${name} cannot produce a CI PASS`, async t => {
  const { options } = await fixture(t), commands = commandRecorder()
  await assert.rejects(runSidechatCI(options, { ...commands, acceptance: async () => result }))
  assert.equal((await verdict(options)).browserAcceptance, false); await assertRemoved(commands.roots)
})
test('browser gate rejection is awaited, propagated once and cleaned without retry', async t => {
  const { options } = await fixture(t), commands = commandRecorder(); let calls = 0
  await assert.rejects(runSidechatCI(options, { ...commands, acceptance: async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 5)); throw Error('Synthetic browser failure')
  } }), /Synthetic browser failure/)
  assert.equal(calls, 1); assert.equal((await verdict(options)).failureStage, 'real-dual-plugin-acceptance')
  await assertRemoved(commands.roots)
})
test('checkout cleanup failure invalidates an otherwise passing browser verdict', async t => {
  const { options } = await fixture(t), commands = commandRecorder()
  t.after(async () => { for (const root of commands.roots) await rm(root, { recursive: true, force: true }) })
  await assert.rejects(runSidechatCI(options, { ...commands, acceptance: async () => passed(), remove: async () => { throw Error('Synthetic cleanup failure') } }), /Owned cleanup failed/)
  const report = await verdict(options)
  assert.equal(report.status, 'failed'); assert.equal(report.browserAcceptance, false); assert.equal(report.failureStage, 'sidebar-cleanup')
})
test('existing smoke awaits the gate before closing its caller-owned browser or emitting PASS', async () => {
  const source = await readFile(new URL('../../e2e.mjs', import.meta.url), 'utf8')
  const gate = source.indexOf('const sidechat = await runSidechatCI(')
  assert.ok(gate > source.indexOf('if (SMOKE)'))
  assert.match(source.slice(gate - 32, gate), /if \(SIDECHAT\) \{/u)
  const preflight = source.indexOf('validateSidechatMode({ sidechat: SIDECHAT, smoke: SMOKE, install: INSTALL })')
  assert.ok(preflight > 0 && preflight < source.indexOf('const DSH_HOME = await mkdtemp'))
  assert.ok(gate < source.indexOf('finally { await browser.close() }', gate))
  assert.ok(gate < source.indexOf("console.log('PASS smoke e2e"))
  assert.match(source.slice(gate, gate + 220), /genuiTarball: TARBALL, genuiTarballSha256: TARBALL_SHA/u)
})
test('same CI job runs pure contracts and uploads only bounded synthetic evidence', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.match(workflow, /node --test scripts\/sidechat-acceptance\/tests\/\*\.test\.mjs/u)
  assert.match(workflow, /node scripts\/e2e\.mjs --smoke --sidechat --install tarball/u)
  const block = workflow.split('      - name: Archive dual-plugin sidechat evidence\n')[1].split('      - name: Archive e2e artifacts\n')[0]
  assert.match(block, /if: always\(\)/u); assert.match(block, /uses: actions\/upload-artifact@v4/u)
  assert.match(block, /name: sidechat-node-\$\{\{ matrix.node \}\}-\$\{\{ matrix.role \}\}/u)
  assert.match(block, /retention-days: 7/u)
  assert.deepEqual([...block.matchAll(/^            (.+)$/gmu)].map(match => match[1]), [
    '.e2e-artifacts/sidechat/dsh354-thread-A-block2-fence1.png',
    '.e2e-artifacts/sidechat/dsh354-thread-B-block0-fence1.png',
    '.e2e-artifacts/sidechat/dsh354-main-unchanged.png',
    '.e2e-artifacts/sidechat/dsh354-thread-B-after-actions.png', '.e2e-artifacts/sidechat/dsh354-host-verdict.json', '.e2e-artifacts/sidechat/dsh354-browser-report.json',
  ])
  assert.ok(workflow.indexOf('Archive dual-plugin sidechat evidence') < workflow.indexOf('\n  browser-text-newlines:'))
})

test('acceptance failure retains only bounded allowlisted onboarding diagnostics', async t => {
  const { options } = await fixture(t), commands = commandRecorder()
  const sensitive = 'synthetic-private-title-url-value-sentinel'
  await assert.rejects(runSidechatCI(options, { ...commands, acceptance: async ({ onboardingReport }) => {
    Object.assign(onboardingReport, { status: 'failed', reason: 'unrecognized-dialog',
      rawTitle: sensitive, body: sensitive, url: sensitive, credentialValue: sensitive,
      actions: [{ kind: 'preview-notice', locale: 'en', action: 'Continue', disappeared: true, raw: sensitive }],
      pendingAction: { kind: 'optional-model-setup', locale: 'en', action: 'Sign in', secret: sensitive },
      lastDialog: { titleKind: 'unknown', locale: null, visibleDialogs: 1, controls: 3, extraControls: 1,
        alerts: 0, busy: false, exactShape: false, title: sensitive, href: sensitive } })
    throw Error('Synthetic acceptance failure')
  } }), /Synthetic acceptance failure/)
  const result = await verdict(options)
  assert.equal(result.status, 'failed'); assert.equal(result.failureStage, 'real-dual-plugin-acceptance')
  assert.deepEqual(result.onboarding, { status: 'failed', reason: 'unrecognized-dialog',
    actions: [{ kind: 'preview-notice', locale: 'en', action: 'Continue', disappeared: true }],
    lastDialog: { titleKind: 'unknown', locale: null, visibleDialogs: 1, controls: 3, extraControls: 1,
      alerts: 0, exactShape: false, busy: false } })
  assert.ok(!JSON.stringify(result).includes(sensitive))
  await assertRemoved(commands.roots)
})
test('onboarding writer rejects unknown enums, wrong types and unbounded diagnostics', async t => {
  const { options } = await fixture(t), commands = commandRecorder()
  await assert.rejects(runSidechatCI(options, { ...commands, acceptance: async ({ onboardingReport }) => {
    Object.assign(onboardingReport, { status: 'arbitrary-text', reason: 'arbitrary-error',
      actions: Array(1000).fill({ kind: 'preview-notice', locale: 'en', action: 'Continue', disappeared: true }),
      workspaceActionabilityChecked: 'arbitrary',
      lastDialog: { titleKind: 'arbitrary-title', locale: 'arbitrary', visibleDialogs: 123456,
        controls: -1, extraControls: 'arbitrary', alerts: Infinity, busy: 'arbitrary', exactShape: 'arbitrary' } })
    throw Error('Synthetic failure')
  } }), /Synthetic failure/)
  const result = await verdict(options)
  assert.equal(result.onboarding.actions.length, 2)
  assert.deepEqual(result.onboarding.lastDialog, { visibleDialogs: 100 })
  assert.deepEqual(Object.keys(result.onboarding).sort(), ['actions', 'lastDialog'])
  assert.ok(!JSON.stringify(result).includes('arbitrary'))
})

test('acceptance failure retains bounded snapshot diagnostics and excludes arbitrary error material', async t => {
  const { options } = await fixture(t), commands = commandRecorder(), secret = 'synthetic-secret-shaped-token-path-url-sentinel'
  await assert.rejects(runSidechatCI(options, { ...commands, acceptance: async ({ snapshotReport }) => {
    Object.assign(snapshotReport, { phase: 'read', owner: 'child-a', errorKinds: ['SessionPersistenceCorruptionError', 'SyntaxError'],
      priorFailure: 'agent-loop', error: secret, message: secret, stack: secret, events: secret, path: secret, url: secret, token: secret })
    throw Error('Synthetic snapshot failure')
  } }), /Synthetic snapshot failure/)
  const result = await verdict(options)
  assert.equal(result.status, 'failed'); assert.equal(result.failureStage, 'real-dual-plugin-acceptance')
  assert.deepEqual(result.snapshotFailure, { phase: 'read', owner: 'child-a',
    errorKinds: ['SessionPersistenceCorruptionError', 'SyntaxError'], priorFailure: 'agent-loop' })
  assert.ok(!JSON.stringify(result).includes(secret)); await assertRemoved(commands.roots)
})
test('final snapshot writer rejects unknown enums and limits aggregate categories', async t => {
  const { options } = await fixture(t), commands = commandRecorder(), secret = 'synthetic-secret-sentinel'
  await assert.rejects(runSidechatCI(options, { ...commands, acceptance: async ({ snapshotReport }) => {
    Object.assign(snapshotReport, { phase: secret, owner: secret, errorKinds: Array(1000).fill(secret), priorFailure: secret, nested: { secret } })
    throw Error('Synthetic failure')
  } }), /Synthetic failure/)
  const result = await verdict(options)
  assert.deepEqual(result.snapshotFailure, { phase: 'unknown', owner: 'unknown', errorKinds: Array(5).fill('unknown'), priorFailure: 'unknown' })
  assert.ok(!JSON.stringify(result).includes(secret)); await assertRemoved(commands.roots)
})
