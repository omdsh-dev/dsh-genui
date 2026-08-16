#!/usr/bin/env node
/**
 * Pack verification gate: packs a REAL tarball and asserts the published
 * surface — required entries present, forbidden entries absent, all runtime
 * export targets resolvable inside the tarball, sizes under the targets.
 * Fails non-zero with the concrete offenders; thresholds are overridable
 * via env (tuning), never silently widened.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MAX_TARBALL = Number(process.env.GENUI_PACK_MAX_TARBALL ?? 3 * 1024 * 1024)
const MAX_UNPACKED = Number(process.env.GENUI_PACK_MAX_UNPACKED ?? 10 * 1024 * 1024)

const pkgJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// All runtime export targets (strings under each export entry) must exist.
const exportTargets = []
for (const entry of Object.values(pkgJson.exports)) {
  if (typeof entry === 'string') exportTargets.push(entry)
  else if (entry !== null && typeof entry === 'object') {
    for (const v of Object.values(entry)) {
      if (typeof v === 'string') exportTargets.push(v)
    }
  }
}

// Everything the loader / installer / TS consumers resolve — plus the lazy
// engine assets the node-half route serves to the browser on demand.
const required = [
  'package.json', 'LICENSE', 'SKILL.md', 'README.md', 'CHANGELOG.md', 'demo-prompts.md', 'cordis.patch.yml',
  'lib/assets/mermaid.js', 'lib/assets/three.js',
  // plugin_check 发布规范（issue #15）：tarball 必须携带可复现构建所需的
  // 源码入口与构建配置，prepack 已在打包前重建 lib。
  'src/index.ts', 'tsconfig.json', 'tsdown.config.ts',
  ...exportTargets,
]

const dir = mkdtempSync(join(tmpdir(), 'genui-pack-'))
try {
  const out = execFileSync('npm', ['pack', '--pack-destination', dir, '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const [packed] = JSON.parse(out)
  const paths = new Set(packed.files.map(f => f.path))
  // npm pack reports paths without the leading './' that exports use.
  const at = (p) => (p.startsWith('./') ? p.slice(2) : p)

  const missing = required.filter(p => !paths.has(at(p)))
  if (missing.length > 0) {
    console.error(`verify-pack: FAIL — missing required entries: ${missing.join(', ')}`)
    process.exit(1)
  }

  const forbidden = [...paths].filter(p =>
    p.endsWith('.map')
    || p.includes('.tsbuildinfo')
    || /^lib\/types\/.*\.js$/.test(p),
  )
  if (forbidden.length > 0) {
    console.error(`verify-pack: FAIL — forbidden entries in pack:\n  ${forbidden.join('\n  ')}`)
    process.exit(1)
  }

  const tarballBytes = statSync(join(dir, packed.filename)).size
  const problems = []
  if (tarballBytes > MAX_TARBALL) problems.push(`tarball ${tarballBytes} > ${MAX_TARBALL}`)
  if (packed.unpackedSize > MAX_UNPACKED) problems.push(`unpacked ${packed.unpackedSize} > ${MAX_UNPACKED}`)
  if (problems.length > 0) {
    console.error(`verify-pack: FAIL — ${problems.join('; ')}`)
    process.exit(1)
  }

  console.log(`verify-pack: OK — ${packed.filename}`)
  console.log(`  tarball ${(tarballBytes / 1048576).toFixed(2)} MB (max ${(MAX_TARBALL / 1048576).toFixed(0)} MB), unpacked ${(packed.unpackedSize / 1048576).toFixed(2)} MB (max ${(MAX_UNPACKED / 1048576).toFixed(0)} MB), ${packed.entryCount} files`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
