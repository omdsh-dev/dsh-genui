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

// DSH 0.2.2-alpha.2 发布时使用以下 Cordis 依赖组。
// 固定版本，避免 npm 的 `~` 依赖范围解析到后续预发布版本。
const HOST_DEPENDENCY_OVERRIDES = {
  '0.2.2-alpha.2': {
    '@deepseek-ai/cordis': '4.0.6-alpha.1',
    '@deepseek-ai/cosmokit': '1.8.7-alpha.1',
    '@deepseek-ai/cordis-plugin-group': '1.0.6-alpha.1',
    '@deepseek-ai/cordis-plugin-hmr': '1.0.21-alpha.1',
    '@deepseek-ai/cordis-plugin-include': '1.0.11-alpha.1',
    '@deepseek-ai/cordis-plugin-loader': '1.0.7-alpha.1',
    '@deepseek-ai/cordis-plugin-logger-console': '1.0.6-alpha.1',
    '@deepseek-ai/cordis-plugin-timer': '1.1.8-alpha.1',
    '@deepseek-ai/schemastery': '3.18.6-alpha.1',
  },
}

const version = process.argv[2]
assert.match(version ?? '', /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/, 'Exact published host version required')
const manifest = JSON.parse(execFileSync('pnpm', ['view', `@deepseek-ai/dsh@${version}`, '--json'], { encoding: 'utf8' }))
assert.equal(manifest.version, version)
assert.ok(satisfies(process.versions.node, manifest.engines?.node ?? '*'), 'Node must satisfy the selected host runtime')
const manifestOverrides = Object.fromEntries(Object.entries(manifest.dependencies ?? {})
  .filter(([name]) => name.startsWith('@deepseek-ai/cordis'))
  .map(([name, range]) => {
    const exact = minVersion(range)
    assert.ok(exact, `Expected a versioned host dependency: ${name}`)
    return [name, exact.version]
  }))
// Known pre-release hosts additionally pin their full Cordis/Cordis-adjacent
// family, including packages the manifest prefix filter above does not match.
const overrides = { ...manifestOverrides, ...HOST_DEPENDENCY_OVERRIDES[version] }
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
