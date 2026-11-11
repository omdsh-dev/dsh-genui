/** Install a fresh exact npm host for packed browser acceptance; never use an active profile. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { minVersion, satisfies } from 'semver'
import { parse, stringify } from 'yaml'
import { mergeExactVersionExceptions } from './host-dependency-policy.mjs'
import { resolveExactHost } from './sidechat-acceptance/scripts/sidechat-host-contract.mjs'

const version = process.argv[2]
assert.match(version ?? '', /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/, 'Exact published host version required')
const manifest = JSON.parse(execFileSync('pnpm', ['view', `@deepseek-ai/dsh@${version}`, '--json'], { encoding: 'utf8' }))
assert.equal(manifest.version, version)
assert.ok(satisfies(process.versions.node, manifest.engines?.node ?? '*'), 'Node must satisfy the selected host runtime')
// Published workspace ranges can resolve different Cordis copies over time.
// Use the versions recorded when this exact host was published, matching its
// official workspace graph rather than mixing a newer loader/runtime into it.
const overrides = Object.fromEntries(Object.entries(manifest.dependencies)
  .filter(([name]) => name.startsWith('@deepseek-ai/cordis'))
  .map(([name, range]) => {
    const exact = minVersion(range)
    assert.ok(exact, `Expected a versioned host dependency: ${name}`)
    return [name, exact.version]
  }))
const root = await mkdtemp(join(tmpdir(), 'dsh-genui-published-host-'))
await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'genui-published-host-acceptance', version: '0.0.0', private: true, type: 'module', packageManager: 'pnpm@11.7.0' }))
await writeFile(join(root, 'pnpm-workspace.yaml'), stringify({ overrides, allowBuilds: {
  esbuild: true,
  [`@deepseek-ai/dsh-subprocess-local@${version}`]: true,
  '@google/genai': false, koffi: false, 'node-pty': false, protobufjs: false,
} }))
execFileSync('pnpm', ['add', '--save-exact', ...['dsh', 'dsh-agent', 'dsh-subagent', 'dsh-llm', 'dsh-llm-replay'].map(name => `@deepseek-ai/${name}@${version}`), 'playwright@1.61.1'], { cwd: root, stdio: 'inherit' })
const policyFile = join(root, 'pnpm-workspace.yaml')
const policy = parse(await readFile(policyFile, 'utf8'))
policy.minimumReleaseAgeExclude = mergeExactVersionExceptions(policy.minimumReleaseAgeExclude ?? [])
await writeFile(policyFile, stringify(policy))
const bin = join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const host = await resolveExactHost({ dshRoot: root, dshBin: bin, hostLayout: 'registry', expectedVersion: version })
createRequire(join(root, 'package.json')).resolve('playwright')
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `root=${host.root}\nbin=${host.bin}\n`)
console.log(JSON.stringify({ root: host.root, bin: host.bin, version: host.hostVersion }))
