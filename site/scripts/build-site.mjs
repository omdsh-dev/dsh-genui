#!/usr/bin/env node
/**
 * build-site.mjs — vendor the REAL dsh-genui standalone renderer for the static site.
 *
 * The site must never ship a lookalike: every demo mounts the renderer produced by
 * the plugin's own build (`lib/assets/standalone-runtime.js`), and every artifact is
 * validated by the plugin's own `createGenuiArtifact` / `parseGenuiArtifact`.
 * This script is the only thing allowed to write into `assets/genui/`.
 *
 * Usage — MUST run through the plugin repo's tsx (plain node cannot load repo .ts):
 *
 *   /Users/changfenhuang/projects/dsh-genui/node_modules/.bin/tsx genui-site/scripts/build-site.mjs
 *   ... --check      validate only, write nothing (CI / spec-author loop)
 *   ... --no-demo    skip proto/demo-specs.json (site content specs only)
 *
 * Outputs (all relative-path based, safe under a GitHub Pages subpath):
 *
 *   assets/genui/standalone-runtime.js   the renderer IIFE (window.__GenuiStandalone__)
 *   assets/genui/<engine>.js             ONLY the engines some spec needs
 *   assets/genui/theme.css               :root + body[data-ds-dark-theme] variables only
 *   assets/genui/artifacts.json          validated artifacts from content/specs/*.json
 *   proto/demo-artifacts.json            same pipeline for the harness proof specs
 *
 * Zero npm dependencies: Node builtins + the plugin repo's TS modules (via tsx).
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SITE = resolve(HERE, '..')

/**
 * Locate the plugin checkout. Precedence:
 *   1. DSH_GENUI_REPO (explicit override, used when the site lives outside the plugin repo)
 *   2. two levels up — when this site is committed as `<plugin>/site`, CI and local builds both work
 *   3. the sibling dev checkout used while the site was authored
 * A candidate only wins if it looks like the plugin (package.json + src/client/spec.ts).
 */
function findRepo() {
  const candidates = [
    process.env.DSH_GENUI_REPO,
    resolve(HERE, '../..'),
    resolve(HERE, '../../..'),
    '/Users/changfenhuang/projects/dsh-genui',
  ].filter(Boolean)
  for (const candidate of candidates) {
    const root = resolve(candidate)
    if (existsSync(join(root, 'package.json')) && existsSync(join(root, 'src/client/spec.ts'))) return root
  }
  throw new Error(`cannot find the dsh-genui plugin checkout (tried: ${candidates.join(', ')}); set DSH_GENUI_REPO`)
}
const REPO = findRepo()
const OUT_DIR = join(SITE, 'assets/genui')
const SPECS_DIR = join(SITE, 'content/specs')
const DEMO_SPECS_FILE = join(SITE, 'proto/demo-specs.json')
const DEMO_OUT_FILE = join(SITE, 'proto/demo-artifacts.json')
const ARTIFACTS_FILE = join(OUT_DIR, 'artifacts.json')
const THEME_FILE = join(OUT_DIR, 'theme.css')
const RUNTIME_FILE = 'standalone-runtime.js'

/** Engine bundle order — must match artifact/portability.ts ASSET_ORDER. */
const ASSET_ORDER = ['mermaid', 'three', 'echarts-core', 'echarts-full', 'icons', 'maplibre']
/** Category order for deterministic artifacts.json output. */
const CATEGORY_ORDER = ['hero', 'surface', 'playground', 'showcase', 'atlas', 'proof']
/**
 * file-tree stores DATA records `{name, type:'file'|'dir'}` in `items`, not GenUI nodes.
 * The plugin's own `analyzeGenuiPortability` recursively scans every `items` array and
 * therefore reports these record types as "custom components" (see its scan(): it only
 * excludes image-group, not file-tree). The renderer itself validates file-tree fine, so
 * this is an upstream false positive — do not fail the build on it.
 * Repro: file-tree with {name:'src', type:'dir'} → customTypes ['dir','file'], errors [].
 */
const FILE_TREE_RECORD_TYPES = new Set(['file', 'dir'])
const LOCALES = ['zh', 'en']

const ARGS = process.argv.slice(2)
const CHECK_ONLY = ARGS.includes('--check')
const NO_DEMO = ARGS.includes('--no-demo')

class BuildError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BuildError'
  }
}

const rel = path => relative(SITE, path) || path
const indent = text => text.split('\n').map(line => `  ${line}`).join('\n')
const kb = bytes => `${(bytes / 1024).toFixed(bytes > 1024 * 100 ? 0 : 1)} KB`

/** Read a JSON file; throws a BuildError naming the file on parse failure. */
function readJson(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    throw new BuildError(`${rel(file)}: cannot read (${error.code ?? error.message})`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new BuildError(`${rel(file)}: invalid JSON — ${error.message}`)
  }
}

function readJsonIfExists(file) {
  return existsSync(file) ? readJson(file) : undefined
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** Load the plugin repo's own validation modules. These are the source of truth. */
async function loadRepo() {
  const required = [
    'package.json',
    'lib/assets/standalone-runtime.js',
    'src/client/artifact/create.ts',
    'src/client/artifact/parse.ts',
    'src/client/artifact/portability.ts',
    'src/client/artifact/standalone-theme.ts',
    'src/client/genui-runtime/schema.ts',
    'src/client/guard.ts',
  ]
  const missing = required.filter(file => !existsSync(join(REPO, file)))
  if (missing.length > 0) {
    throw new BuildError(`plugin repo is missing files under ${REPO}: ${missing.join(', ')}`)
  }
  const load = file => import(pathToFileURL(join(REPO, file)).href)
  const [create, parse, portability, theme, schema, guard] = await Promise.all([
    load('src/client/artifact/create.ts'),
    load('src/client/artifact/parse.ts'),
    load('src/client/artifact/portability.ts'),
    load('src/client/artifact/standalone-theme.ts'),
    load('src/client/genui-runtime/schema.ts'),
    load('src/client/guard.ts'),
  ])
  const pkg = readJson(join(REPO, 'package.json'))
  return {
    pkg,
    createGenuiArtifact: create.createGenuiArtifact,
    parseGenuiArtifact: parse.parseGenuiArtifact,
    analyzeGenuiPortability: portability.analyzeGenuiPortability,
    STANDALONE_THEME_CSS: theme.STANDALONE_THEME_CSS,
    GENUI_NATIVE_TYPES: schema.GENUI_NATIVE_TYPES,
    processGenuiSpec: guard.processGenuiSpec,
  }
}

/* ------------------------------------------------------------------ */
/* Theme CSS: keep the renderer's variables, drop the page layout rules */
/* ------------------------------------------------------------------ */

/** Split a stylesheet into top-level `{ selector, body }` rules (no @-rule nesting needed here). */
function splitTopLevelRules(css) {
  const rules = []
  let index = 0
  while (index < css.length) {
    // Skip whitespace and top-level comments between rules.
    while (index < css.length && /\s/.test(css[index])) index += 1
    if (index >= css.length) break
    if (css.startsWith('/*', index)) {
      const end = css.indexOf('*/', index + 2)
      index = end === -1 ? css.length : end + 2
      continue
    }
    const brace = css.indexOf('{', index)
    if (brace === -1) break
    const selector = css.slice(index, brace).trim()
    // Walk to the matching close brace, honouring strings and comments.
    let depth = 1
    let cursor = brace + 1
    let quote = null
    while (cursor < css.length && depth > 0) {
      const char = css[cursor]
      if (quote !== null) {
        if (char === '\\') cursor += 1
        else if (char === quote) quote = null
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === '/' && css[cursor + 1] === '*') {
        const end = css.indexOf('*/', cursor + 2)
        cursor = end === -1 ? css.length : end + 1
      } else if (char === '{') {
        depth += 1
      } else if (char === '}') {
        depth -= 1
      }
      cursor += 1
    }
    rules.push({ selector, body: css.slice(brace + 1, cursor - 1), start: index, end: cursor })
    index = cursor
  }
  return rules
}

/** Render a theme stylesheet that owns only the renderer variables, never page layout. */
function buildThemeCss(repo) {
  const css = repo.STANDALONE_THEME_CSS
  const dropped = new Set(['html', 'body', '#genui-root'])
  const kept = splitTopLevelRules(css).filter(rule => !dropped.has(rule.selector.replace(/\s+/g, ' ')))
  const keptSelectors = kept.map(rule => rule.selector)
  if (!keptSelectors.includes(':root')) throw new BuildError('theme.css: :root variable block not found in STANDALONE_THEME_CSS')
  if (!keptSelectors.includes('body[data-ds-dark-theme]')) {
    throw new BuildError('theme.css: body[data-ds-dark-theme] variable block not found in STANDALONE_THEME_CSS')
  }
  for (const forbidden of dropped) {
    if (keptSelectors.includes(forbidden)) throw new BuildError(`theme.css: page-layout rule '${forbidden}' was not stripped`)
  }
  const body = kept.map(rule => `${rule.selector} {${rule.body}}`).join('\n\n')
  return `/* Generated by site/scripts/build-site.mjs — do not edit by hand.\n` +
    ` * Source: ${repo.pkg.name}@${repo.pkg.version} src/client/artifact/standalone-theme.ts\n` +
    ` * Renderer --dsw-* variables only: html / body / #genui-root layout rules are stripped\n` +
    ` * so the site owns page layout and its own body styling. */\n\n` +
    `${body}\n`
}

/* ------------------------------------------------------------------ */
/* Spec loading + validation (the plugin's own pipeline)               */
/* ------------------------------------------------------------------ */

/** Load spec entries from one file; supports a single object or an array of objects. */
function loadSpecFile(file) {
  const value = readJson(file)
  const entries = Array.isArray(value) ? value : [value]
  if (entries.length === 0) throw new BuildError(`${rel(file)}: empty spec array`)
  entries.forEach((entry, index) => {
    if (!isRecord(entry)) throw new BuildError(`${rel(file)}: ${index}: spec entry must be an object`)
  })
  return entries.map((entry, index) => ({ file, index, entry }))
}

function collectSpecs(dir, warnings) {
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter(name => name.endsWith('.json')).sort()
  const collected = []
  for (const name of files) {
    const file = join(dir, name)
    for (const record of loadSpecFile(file)) {
      const id = record.entry.id
      if (typeof id === 'string' && id !== name.slice(0, -5)) {
        warnings.push(`${rel(file)}: id '${id}' does not match filename '${name.slice(0, -5)}'`)
      }
      collected.push(record)
    }
  }
  return collected
}

/**
 * Validate one `{ id, category, zh, en }` entry through the plugin's own pipeline and
 * produce the two artifacts the bridge will mount. Throws BuildError at the first
 * invalid locale, naming file + JSON path (e.g. `content/specs/x.json: zh: items[2].kind must be ...`).
 */
function buildSpecArtifacts(repo, record, seenIds, warnings) {
  const { file, index, entry } = record
  const label = `${rel(file)}${Array.isArray(readJson(file)) ? `[${index}]` : ''}`
  const problems = []

  if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(entry.id)) {
    throw new BuildError(`${label}: id must be a non-empty kebab-case string (got ${JSON.stringify(entry.id)})`)
  }
  if (seenIds.has(entry.id)) throw new BuildError(`${label}: duplicate id '${entry.id}' (also in ${seenIds.get(entry.id)})`)
  seenIds.set(entry.id, rel(file))
  if (typeof entry.category !== 'string' || entry.category.length === 0) {
    throw new BuildError(`${label}: category must be a non-empty string`)
  }
  if (!CATEGORY_ORDER.includes(entry.category)) {
    warnings.push(`${label}: category '${entry.category}' is not one of ${CATEGORY_ORDER.join(' | ')}`)
  }
  for (const key of Object.keys(entry)) {
    if (!['id', 'category', 'note', 'zh', 'en'].includes(key)) warnings.push(`${label}: unknown envelope key '${key}' (ignored)`)
  }

  const artifacts = {}
  const reports = {}
  for (const locale of LOCALES) {
    const spec = entry[locale]
    if (!isRecord(spec)) {
      problems.push(`${locale}: missing or non-object spec`)
      continue
    }
    // Step 1: the renderer's own guard — gives us the exact JSON path of each problem.
    const processed = repo.processGenuiSpec(spec)
    if (processed.errors.length > 0) {
      problems.push(...processed.errors.map(error => `${locale}: ${error}`))
      continue
    }
    if (processed.spec === null) {
      problems.push(`${locale}: spec was rejected by processGenuiSpec()`)
      continue
    }
    for (const diagnostic of processed.warnings) {
      warnings.push(`${label}: ${locale}: ${diagnostic.kind} ${diagnostic.path} — ${diagnostic.message}`)
    }
    // Step 2: canonical artifact (format/version/presentation) + round-trip through the parser
    // the runtime actually uses at mount time.
    let artifact
    try {
      artifact = repo.createGenuiArtifact(processed.spec, undefined, { locale, theme: 'dark' })
    } catch (error) {
      problems.push(`${locale}: createGenuiArtifact failed — ${error.message}`)
      continue
    }
    if (repo.parseGenuiArtifact(artifact) === null) {
      problems.push(`${locale}: artifact failed parseGenuiArtifact round-trip (runtime would throw 'invalid GenUI artifact')`)
      continue
    }
    const report = repo.analyzeGenuiPortability(artifact.spec)
    // Drop file-tree data-record types before judging portability (upstream false positive above).
    const customTypes = report.customTypes.filter(type => !FILE_TREE_RECORD_TYPES.has(type))
    if (customTypes.length > 0) {
      problems.push(`${locale}: custom (non-whitelisted) node types cannot render standalone: ${customTypes.join(', ')}`)
      continue
    }
    artifacts[locale] = artifact
    reports[locale] = report
  }

  if (problems.length > 0) {
    throw new BuildError(`${label}:\n${problems.map(problem => `  • ${problem}`).join('\n')}`)
  }

  const requiredAssets = ASSET_ORDER.filter(name =>
    LOCALES.some(locale => reports[locale].requiredAssets.includes(name)))
  const externalMedia = [...new Set(LOCALES.flatMap(locale => reports[locale].externalMedia))].sort()
  return {
    id: entry.id,
    category: entry.category,
    requiredAssets,
    hasModelActions: LOCALES.some(locale => reports[locale].hasModelActions),
    externalMedia,
    artifacts,
  }
}

function buildSpecs(repo, records, warnings) {
  const seenIds = new Map()
  const specs = records.map(record => buildSpecArtifacts(repo, record, seenIds, warnings))
  specs.sort((left, right) => {
    const category = CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category)
    return category !== 0 ? category : left.id.localeCompare(right.id)
  })
  return specs
}

/* ------------------------------------------------------------------ */
/* Asset vendoring                                                    */
/* ------------------------------------------------------------------ */

function previousAssetHashes(previousManifest) {
  const hashes = new Map()
  const assets = previousManifest?.assets
  if (!isRecord(assets)) return hashes
  for (const entry of [assets.runtime, ...Object.values(assets.engines ?? {})]) {
    if (isRecord(entry) && typeof entry.file === 'string' && typeof entry.sha256 === 'string') {
      hashes.set(entry.file, entry.sha256)
    }
  }
  return hashes
}

/**
 * Copy one plugin bundle into assets/genui/ (skipped when the previous manifest proves the
 * content is unchanged) and return its manifest record.
 */
function vendorAsset(sourceFile, destName, previousHashes) {
  if (!existsSync(sourceFile)) throw new BuildError(`missing plugin asset: ${sourceFile}`)
  const bytes = statSync(sourceFile).size
  const sha256 = sha256File(sourceFile)
  const destFile = join(OUT_DIR, destName)
  const unchanged = existsSync(destFile) && previousHashes.get(destName) === sha256
  if (CHECK_ONLY) {
    return { file: destName, bytes, sha256, status: existsSync(destFile) ? 'present' : 'would-copy' }
  }
  mkdirSync(OUT_DIR, { recursive: true })
  if (!unchanged) copyFileSync(sourceFile, destFile)
  return { file: destName, bytes, sha256, status: unchanged ? 'unchanged' : 'copied' }
}

function repoGitHead() {
  try {
    return execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

/* ------------------------------------------------------------------ */
/* Manifest writing                                                   */
/* ------------------------------------------------------------------ */

function buildManifest({ repo, assetRecords, specs, generatedAt, gitHead, warnings, nativeTypes }) {
  const engines = {}
  for (const name of ASSET_ORDER) {
    if (assetRecords.engines[name] !== undefined) engines[name] = assetRecords.engines[name]
  }
  const payloadBytes = assetRecords.runtime.bytes + Object.values(engines).reduce((sum, asset) => sum + asset.bytes, 0)
  return {
    generatedAt,
    generator: 'site/scripts/build-site.mjs',
    plugin: { name: repo.pkg.name, version: repo.pkg.version, ...(gitHead === undefined ? {} : { git: gitHead }) },
    artifactFormat: { format: 'dsh-genui', version: 1 },
    presentation: { theme: 'dark', locales: LOCALES },
    nodeTypes: nativeTypes,
    nodeTypeCount: nativeTypes.length,
    requiredAssets: Object.keys(engines),
    assets: {
      runtime: assetRecords.runtime,
      engines,
      totalBytes: payloadBytes,
    },
    specs,
    warnings,
  }
}

function writeIfChanged(file, content) {
  if (CHECK_ONLY) return false
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return false
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
  return true
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const started = Date.now()
  const warnings = []
  console.log(`build-site${CHECK_ONLY ? ' --check' : ''}: repo ${REPO}`)
  if (!existsSync(REPO)) throw new BuildError(`plugin repo not found at ${REPO} (set DSH_GENUI_REPO)`)
  const repo = await loadRepo()
  console.log(`  plugin   ${repo.pkg.name}@${repo.pkg.version}${repoGitHead() === undefined ? '' : ` (${repoGitHead()})`}`)
  const nativeTypes = [...repo.GENUI_NATIVE_TYPES].sort()
  console.log(`  vocabulary ${nativeTypes.length} whitelisted node types`)

  // 1. Content specs (may legitimately be empty while specs are still being authored).
  const contentRecords = collectSpecs(SPECS_DIR, warnings)
  const contentSpecs = buildSpecs(repo, contentRecords, warnings)
  console.log(`  specs    ${contentSpecs.length} from ${rel(SPECS_DIR)}/*.json (${contentSpecs.map(spec => spec.id).join(', ') || 'none'})`)

  // 2. Harness proof specs (validated by the same pipeline, so the build works with zero content specs).
  const demoRecords = NO_DEMO || !existsSync(DEMO_SPECS_FILE) ? [] : loadSpecFile(DEMO_SPECS_FILE)
  const demoSpecs = buildSpecs(repo, demoRecords, warnings)
  if (!NO_DEMO) console.log(`  demos    ${demoSpecs.length} from ${rel(DEMO_SPECS_FILE)} (${demoSpecs.map(spec => spec.id).join(', ') || 'none'})`)

  // 3. Vendor the runtime plus the union of engines any spec needs.
  const previous = readJsonIfExists(ARTIFACTS_FILE)
  const previousHashes = previousAssetHashes(previous)
  const requiredEngines = ASSET_ORDER.filter(name =>
    [...contentSpecs, ...demoSpecs].some(spec => spec.requiredAssets.includes(name)))
  const runtimeRecord = vendorAsset(join(REPO, 'lib/assets', RUNTIME_FILE), RUNTIME_FILE, previousHashes)
  // Fail loudly if the built runtime does not publish the mount contract the bridge depends on.
  const runtimeSource = readFileSync(join(REPO, 'lib/assets', RUNTIME_FILE), 'utf8')
  if (!runtimeSource.includes('__GenuiStandalone__')) {
    throw new BuildError(`lib/assets/${RUNTIME_FILE} does not expose window.__GenuiStandalone__ — plugin build is stale or wrong`)
  }
  const engineRecords = {}
  for (const name of requiredEngines) {
    engineRecords[name] = vendorAsset(join(REPO, 'lib/assets', `${name}.js`), `${name}.js`, previousHashes)
  }

  // 4. Theme CSS — renderer variables only.
  const themeCss = buildThemeCss(repo)

  // 5. Manifests.
  const generatedAt = new Date().toISOString()
  const gitHead = repoGitHead()
  const artifactManifest = buildManifest({
    repo, assetRecords: { runtime: runtimeRecord, engines: engineRecords },
    specs: contentSpecs, generatedAt, gitHead, warnings, nativeTypes,
  })
  const demoManifest = buildManifest({
    repo, assetRecords: { runtime: runtimeRecord, engines: engineRecords },
    specs: demoSpecs, generatedAt, gitHead,
    warnings: warnings.filter(warning => demoSpecs.some(spec => warning.includes(spec.id))),
    nativeTypes,
  })

  const wroteTheme = writeIfChanged(THEME_FILE, themeCss)
  const wroteArtifacts = writeIfChanged(ARTIFACTS_FILE, `${JSON.stringify(artifactManifest, null, 2)}\n`)
  const wroteDemo = NO_DEMO ? false : writeIfChanged(DEMO_OUT_FILE, `${JSON.stringify(demoManifest, null, 2)}\n`)

  // 6. Summary.
  const assetLines = [runtimeRecord, ...Object.values(engineRecords)]
    .map(asset => `    ${asset.file.padEnd(26)} ${kb(asset.bytes).padStart(9)}  ${asset.status}`)
    .join('\n')
  console.log(`  assets   router ${CHECK_ONLY ? '(check)' : ''}\n${assetLines}`)
  console.log(`  payload  ${kb(artifactManifest.assets.totalBytes)} renderer+engines (lazy-loaded, never blocks first paint)`)
  console.log(`  wrote    ${[
    wroteTheme ? 'theme.css' : 'theme.css (unchanged)',
    wroteArtifacts ? 'artifacts.json' : 'artifacts.json (unchanged)',
    ...(NO_DEMO ? [] : [wroteDemo ? 'proto/demo-artifacts.json' : 'proto/demo-artifacts.json (unchanged)']),
  ].join(', ')}`)
  if (CHECK_ONLY) {
    console.log('  check    OK — no files written')
  }

  // 7. Warnings (unknown envelope keys, unknown categories, guard truncations, filename/id drift…).
  const uniqueWarnings = [...new Set(warnings)]
  if (uniqueWarnings.length > 0) {
    console.log(`\n  ${uniqueWarnings.length} warning(s):`)
    for (const warning of uniqueWarnings) console.log(`    ! ${warning}`)
  }
  const actionSpecs = [...contentSpecs, ...demoSpecs].filter(spec => spec.hasModelActions)
  if (actionSpecs.length > 0) {
    console.log(`\n  note     ${actionSpecs.length} spec(s) contain model actions — the site renders them locally (no model turn): ${actionSpecs.map(spec => spec.id).join(', ')}`)
  }
  console.log(`\nbuild-site: OK in ${Date.now() - started}ms`)
}

main().catch(error => {
  if (error instanceof BuildError) {
    console.error(`\nbuild-site: FAILED\n  ${error.message}`)
  } else {
    console.error('\nbuild-site: FAILED with an unexpected error')
    console.error(process.env.DEBUG ? error : error.stack ?? error)
  }
  process.exitCode = 1
})
