/** Exact dual-plugin gate for the existing source-host smoke job. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { inspectPack } from './scripts/exact-pack.mjs'
import { spawnOwned } from './scripts/owned-process.mjs'
import { runSidechatAcceptance } from './scripts/run-sidechat-acceptance.mjs'
import { checkSidechatBrowser } from './scripts/sidechat-browser-checks.mjs'
import { projectSnapshotFailure } from './fixture/lib/snapshot-diagnostics.mjs'
import { projectOnboardingReport } from './scripts/sidechat-onboarding.mjs'
import { HOST_VERSION, isChildPath, sidechatSmokeEnvironment, verifyTarball, withOwnedResources } from './scripts/sidechat-host-contract.mjs'

export const SIDEBAR_REPOSITORY = 'https://github.com/sunxiuguo/DSH-better-sidebar.git'
export const SIDEBAR_COMMIT = '34fbad8a75ca4e80af0375800378bcf7c4119d1d'
const MINIMUM_HOST_VERSION = '0.2.0-rc.1'
const VERDICT = 'dsh354-host-verdict.json'

export function validateSidechatMode({ sidechat, smoke, install }) {
  if (!sidechat) return
  assert.ok(smoke === true && install === 'tarball', '--sidechat requires --smoke --install tarball')
}

export function hostApplicability(version) {
  if (version === HOST_VERSION) return 'required'
  if (version === MINIMUM_HOST_VERSION) return 'not-applicable'
  throw new Error('Unreviewed host version: dual-plugin acceptance cannot be silently skipped')
}

async function sourceHostVersion(dshRoot, dshBin) {
  assert.ok(isAbsolute(dshRoot) && isAbsolute(dshBin), 'Absolute source host paths required')
  const root = await realpath(dshRoot)
  const manifest = await realpath(join(root, 'apps/cli/package.json'))
  const bin = await realpath(dshBin)
  assert.ok(isChildPath(root, manifest) && isChildPath(root, bin), 'CLI must belong to the source host')
  assert.equal(bin, await realpath(join(root, 'apps/cli/lib/bin.js')), 'Exact official source-layout CLI required')
  const pkg = JSON.parse(await readFile(manifest, 'utf8'))
  assert.equal(pkg.name, '@deepseek-ai/dsh')
  return pkg.version
}

async function execute(command, args, { cwd, env, own }) {
  // Uses the reviewed owned-command lifecycle; output stays in bounded memory.
  const child = spawnOwned(command, args, { cwd, env, label: `${command} ${args[0]}`, rejectBlockedBuilds: true })
  own(() => child.stop())
  await child.finish(600000)
}

export async function buildPinnedSidebar(root, { executeCommand = execute, own, sourceEnvironment = process.env } = {}) {
  const checkout = join(root, 'sidebar'), packs = join(root, 'packs')
  const env = { ...sidechatSmokeEnvironment(sourceEnvironment, root), GIT_TERMINAL_PROMPT: '0' }
  for (const path of [env.HOME, env.XDG_CACHE_HOME, env.XDG_CONFIG_HOME, env.TMPDIR, checkout, packs]) await mkdir(path, { recursive: true })
  const run = (command, args, cwd = checkout) => executeCommand(command, args, { cwd, env, own })
  await run('git', ['init', '--quiet'])
  await run('git', ['remote', 'add', 'origin', SIDEBAR_REPOSITORY])
  await run('git', ['fetch', '--depth', '1', 'origin', SIDEBAR_COMMIT])
  await run('git', ['checkout', '--detach', '--quiet', 'FETCH_HEAD'])
  // A detached checkout records the complete object ID, never a mutable branch.
  assert.equal((await readFile(join(checkout, '.git/HEAD'), 'utf8')).trim(), SIDEBAR_COMMIT, 'Sidebar checkout must match the reviewed commit')
  const pkg = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'dsh-better-sidebar')
  assert.equal(pkg.version, '0.28.0')
  assert.equal(pkg.packageManager, 'pnpm@11.8.0', 'Use the pinned repository package manager without overrides')
  await run('pnpm', ['install', '--frozen-lockfile'])
  await run('pnpm', ['run', 'typecheck'])
  await run('pnpm', ['run', 'build'])
  await run('pnpm', ['pack', '--pack-destination', packs])
  const files = await readdir(packs)
  assert.deepEqual(files, ['dsh-better-sidebar-0.28.0.tgz'], 'Exactly one fresh, expected Sidebar pack required')
  const sidebarTarball = join(packs, files[0])
  assert.ok(isChildPath(await realpath(packs), await realpath(sidebarTarball)), 'Sidebar pack must stay in the owned output directory')
  const packed = await inspectPack(sidebarTarball, pkg.name)
  assert.equal(packed.version, pkg.version, 'Packed Sidebar version must match its pinned source')
  const sidebarTarballSha256 = createHash('sha256').update(await readFile(sidebarTarball)).digest('hex')
  return { sidebarTarball, sidebarTarballSha256 }
}

/** Test seams replace external work only; the production entry supplies none. */
export async function runSidechatCI(options, { executeCommand = execute, acceptance = runSidechatAcceptance, remove = rm } = {}) {
  assert.ok(isAbsolute(options.artifactDir), 'Absolute dedicated artifact directory required')
  await mkdir(options.artifactDir, { recursive: true })
  // Remove only this gate's bounded evidence so an earlier attempt cannot look current.
  for (const name of await readdir(options.artifactDir)) {
    if (name === VERDICT || name === 'dsh354-browser-report.json' || /^dsh354-[a-zA-Z0-9-]+\.png$/u.test(name)) {
      await rm(join(options.artifactDir, name), { force: true })
    }
  }
  let stage = 'source-host-preflight'
  let report = { kind: 'real-dual-plugin-sidechat-acceptance', status: 'incomplete', browserAcceptance: false }
  const save = () => {
    if (report.onboarding) report.onboarding = projectOnboardingReport(report.onboarding)
    if (report.snapshotFailure) report.snapshotFailure = projectSnapshotFailure(report.snapshotFailure)
    return writeFile(join(options.artifactDir, VERDICT), JSON.stringify(report, null, 2) + '\n')
  }
  await save()
  try {
    const version = await sourceHostVersion(options.dshRoot, options.dshBin)
    report.hostVersion = version
    report.hostLayout = 'source'
    const applicability = hostApplicability(version)
    if (applicability === 'not-applicable') {
      report.status = 'not-applicable'
      report.reason = 'The minimum 0.2.0-rc.1 lane runs the existing GenUI smoke; dual-plugin coverage requires exact 0.2.1-rc.3.'
      return report
    }
    stage = 'genui-pack-preflight'
    await verifyTarball(options.genuiTarball, options.genuiTarballSha256)
    await inspectPack(options.genuiTarball, '@changfenhuang/dsh-genui')
    assert.equal(typeof options.browser?.newContext, 'function', 'Caller-owned browser is mandatory')
    const result = await withOwnedResources(async ({ own }) => {
      const root = await mkdtemp(join(tmpdir(), 'dsh354-ci-sidebar-'))
      own(() => remove(root, { recursive: true, force: true }))
      stage = 'pinned-sidebar-build'
      const sidebar = await buildPinnedSidebar(root, { executeCommand, own })
      stage = 'real-dual-plugin-acceptance'
      const onboardingReport = {}, snapshotReport = {}
      report.onboarding = onboardingReport
      report.snapshotFailure = snapshotReport
      const verdict = await acceptance({ browser: options.browser, hostLayout: 'source', dshRoot: options.dshRoot,
        dshBin: options.dshBin, genuiTarball: options.genuiTarball, genuiTarballSha256: options.genuiTarballSha256,
        ...sidebar, checkBrowser: checkSidechatBrowser, artifactDir: options.artifactDir, onboardingReport, snapshotReport })
      assert.equal(verdict?.kind, report.kind)
      assert.equal(verdict?.status, 'passed', 'Required dual-plugin gate must not skip or return incomplete')
      assert.equal(verdict.hostVersion, HOST_VERSION)
      assert.equal(verdict.browserAcceptance, true, 'Artifact creation is not browser acceptance')
      assert.equal(verdict.cleanupCompleted, true, 'Owned host/browser-context cleanup must complete')
      stage = 'sidebar-cleanup'
      return verdict
    })
    report = { ...result, sidebarRepository: SIDEBAR_REPOSITORY, sidebarCommit: SIDEBAR_COMMIT, sidebarCheckoutCleaned: true }
    return report
  } catch (error) {
    report.status = 'failed'
    report.browserAcceptance = false
    report.failureStage = stage
    report.failure = 'Required CI gate failed; no fallback, policy bypass, or silent skip was attempted.'
    throw error
  } finally { await save() }
}
