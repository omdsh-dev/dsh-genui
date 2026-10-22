/** Dependency-free preflight/lifetime contracts only. No host is launched here. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { createRequire } from 'node:module'

export const HOST_VERSION = '0.2.1-rc.2'
export const IDS = Object.freeze(['session-e2e-dsh354-parent', 'session-e2e-dsh354-thread-a', 'session-e2e-dsh354-thread-b'])
export const PROVIDER = 'dsh354-replay'
export const MODEL = 'dsh354-fixture'
export const ACK = 'Synthetic replay acknowledgment. No provider I/O.'

export function validateAcceptanceOptions(options) {
  assert.ok(options && typeof options === 'object', 'Acceptance options required')
  assert.equal(typeof options.browser?.newContext, 'function', 'Caller-owned browser required')
  assert.equal(typeof options.checkBrowser, 'function', 'Awaitable checkBrowser callback required')
  for (const key of ['dshRoot', 'dshBin', 'genuiTarball', 'sidebarTarball', 'artifactDir']) {
    assert.ok(typeof options[key] === 'string' && isAbsolute(options[key]), `${key} must be an absolute path`)
  }
  for (const key of ['genuiTarballSha256', 'sidebarTarballSha256']) {
    assert.match(options[key] ?? '', /^[a-f0-9]{64}$/iu, `${key} must be a SHA256 digest`)
  }
}

export function isChildPath(root, child) {
  const rel = relative(root, child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export async function verifyTarball(file, expected) {
  assert.ok(isAbsolute(file), 'Tarball path must be absolute')
  assert.match(expected ?? '', /^[a-f0-9]{64}$/iu, 'Tarball SHA256 required')
  assert.ok((await stat(file)).isFile(), 'Tarball must be a regular file')
  const sha256 = createHash('sha256').update(await readFile(file)).digest('hex')
  assert.equal(sha256, expected.toLowerCase(), 'Tarball SHA256 mismatch')
  return sha256
}

export async function resolveExactHost({ dshRoot, dshBin, hostLayout = 'source' }) {
  assert.ok(['source', 'registry'].includes(hostLayout), 'Explicit source or registry host layout required')
  const root = await realpath(dshRoot), bin = await realpath(dshBin)
  const cliPackage = await realpath(hostLayout === 'source' ? join(root, 'apps/cli/package.json') : join(root, 'node_modules/@deepseek-ai/dsh/package.json'))
  assert.ok(isChildPath(root, cliPackage) && isChildPath(root, bin), 'CLI must belong to exact host root')
  const host = JSON.parse(await readFile(cliPackage, 'utf8'))
  assert.equal(host.name, '@deepseek-ai/dsh'); assert.equal(host.version, HOST_VERSION, 'Only exact rc.2 is covered')
  assert.equal(bin, await realpath(join(dirname(cliPackage), 'lib/bin.js')), 'Use exact official built bin.js, not an unrelated executable/shim')
  const require = createRequire(cliPackage)
  const modules = {}
  for (const [key, name] of Object.entries({ agentModule: '@deepseek-ai/dsh-agent', subagentModule: '@deepseek-ai/dsh-subagent', llmModule: '@deepseek-ai/dsh-llm', replayModule: '@deepseek-ai/dsh-llm-replay' })) {
    let entry
    try { entry = require.resolve(name) } catch (error) {
      if (key !== 'replayModule' || hostLayout !== 'source' || error.code !== 'MODULE_NOT_FOUND') throw error
      entry = join(root, 'packages/test-support/llm-replay/lib/index.js')
    }
    entry = await realpath(entry)
    assert.ok(isChildPath(root, entry), 'Built dependency escaped the exact host graph')
    const pkg = JSON.parse(await readFile(join(dirname(dirname(entry)), 'package.json'), 'utf8'))
    assert.equal(pkg.name, name); assert.equal(pkg.version, HOST_VERSION, 'Mixed host graph refused')
    assert.ok((await stat(entry)).isFile()); modules[key] = entry
  }
  return { root, bin, hostVersion: host.version, hostLayout, modules }
}

export async function verifyHostAndArtifacts(options) {
  validateAcceptanceOptions(options)
  const host = await resolveExactHost(options)
  const [genuiSha256, sidebarSha256] = await Promise.all([
    verifyTarball(options.genuiTarball, options.genuiTarballSha256),
    verifyTarball(options.sidebarTarball, options.sidebarTarballSha256),
  ])
  return { ...host, genuiSha256, sidebarSha256 }
}

export function sidechatSmokeEnvironment(source, ownedRoot) {
  assert.ok(isAbsolute(ownedRoot), 'Fresh owned root must be absolute')
  const allow = new Set(['PATH', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM',
    'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR'])
  // No inherited HOME, config, provider key, DSH_* or NODE_OPTIONS. Loopback
  // calls must not inherit proxies that could send generated auth off-host.
  return {
    ...Object.fromEntries(Object.entries(source).filter(([key]) => allow.has(key))),
    HOME: join(ownedRoot, 'tool-home'), DSH_HOME: join(ownedRoot, 'home'),
    XDG_CACHE_HOME: join(ownedRoot, 'cache'), XDG_CONFIG_HOME: join(ownedRoot, 'config'),
    TMPDIR: join(ownedRoot, 'tmp'), TMP: join(ownedRoot, 'tmp'), TEMP: join(ownedRoot, 'tmp'),
  }
}

export function assertOwnedRoute({ phase, sessionId, provider, model, turn, step }) {
  assert.equal(phase, 'resume', 'Seed must never invoke a model')
  assert.ok(IDS.slice(1).includes(sessionId), 'Only owned child sessions may invoke replay')
  assert.equal(provider, PROVIDER, 'Non-replay provider refused')
  assert.equal(model, MODEL, 'Non-replay model refused')
  assert.ok(turn === 2 || turn === 3, 'Only two action turns per child')
  assert.equal(step, 1, 'Only one replay step per action')
}

export function assertOwnedAuditRow(row) {
  assert.ok(row && typeof row === 'object', 'Audit row required')
  assert.ok(!['fixture-failed', 'agent-error', 'rejected-event'].includes(row.type), 'Host reported fixture/agent/rejection failure')
  assert.notEqual(row.allowed, false, 'Host rejected route')
  if (row.event) {
    assert.ok(IDS.includes(row.sessionId), 'Foreign session event refused')
    assert.ok(['agent/inbox/spliced', 'user/message', 'assistant/message', 'turn/start', 'turn/end', 'step/start', 'step/end'].includes(row.event.type), 'Unrecognized event refused')
    assert.ok(Number.isSafeInteger(row.event.seq) && row.event.seq >= 0, 'Durable event sequence required')
  }
  if (row.type === 'llm-route' || row.type === 'agent-request-route') assertOwnedRoute(row)
}

export function childActionText(action, payload) {
  assert.ok(action === 'dsh354-check' || action === 'dsh354-submit', 'Unknown fixture action')
  return `[genui-action] ${action} ${JSON.stringify(payload)}`
}

/** Only locally registered owned cleanup callbacks run; never closes browser. */
export async function withOwnedResources(work) {
  assert.equal(typeof work, 'function', 'Work callback required')
  const closers = []
  let result, failure
  try {
    result = await work({ own(close) {
      assert.equal(typeof close, 'function', 'Owned cleanup callback required')
      closers.push(close)
    } })
  } catch (error) { failure = error }
  const errors = []
  for (const close of closers.reverse()) {
    try { await close() } catch (error) { errors.push(error) }
  }
  if (failure && errors.length) throw new AggregateError([failure, ...errors], 'Acceptance and owned cleanup failed')
  if (failure) throw failure
  if (errors.length) throw new AggregateError(errors, 'Owned cleanup failed')
  return result
}

export async function invokeBrowserCheck(checkBrowser, context) {
  assert.equal(typeof checkBrowser, 'function', 'checkBrowser must not be skipped')
  return await checkBrowser(context)
}
