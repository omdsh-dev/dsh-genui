/**
 * dsh-genui build: node-half lib (host plugin, prompt injection) + browser
 * client bundle (the dsh-ui renderer) speaking the dsh module-loader
 * protocol (`window.__ModuleLoader__.load`). Mirrors the dsh repo's
 * packages/client/tsdown.client.ts preset, simplified for one package.
 *
 * Deterministic output: the CSS Modules class map is emitted in fixed
 * UTF-16 local-name order (never localeCompare — system-locale drift), and
 * the production browser bundle carries no sourcemap, so the same source
 * builds byte-identical client.js every time.
 */
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const ID = '@changfenhuang/dsh-genui'
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url))

/** Module-table entries this bundle may leave external: platform seed rows
 * (react family, cordis, ui-primitives) answered by the loader's require.
 * `react-dom/client` joins the list for the DOM render channel (pure-plugin
 * fence rendering on pristine hosts mounts its own React roots). */
const EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-primitives',
]

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'


function cssModulesPlugin(): NonNullable<UserConfig['plugins']>[number] {
  return {
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      // The bundle builds straight from src, so the importer's directory is
      // always the source tree — no lib/types backtracking needed.
      const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
      const stableId = relative(PROJECT_ROOT, abs).replaceAll('\\', '/')
      return CSS_VIRTUAL_PREFIX + stableId + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const stableId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      const fileId = resolvePath(PROJECT_ROOT, stableId)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: stableId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      // Deterministic key order: fixed UTF-16 comparison on the LOCAL class
      // names (localeCompare depends on the system locale). Values unchanged.
      const entries = Object.entries(cssExports ?? {})
        .map(([local, exp]) => [local, exp.name] as const)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      const classMap = Object.fromEntries(entries)
      const tagId = `${ID}/${basename(fileId)}`
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
        `  const tag = document.createElement('style');`,
        `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }
}

function purityGate(): NonNullable<UserConfig['plugins']>[number] {
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (EXTERNALS.includes(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not in the module table (EXTERNALS) — `
        + 'cross-plugin value imports are forbidden; collaborate through cordis services',
      )
    },
  }
}

function standaloneAliasPlugin(): NonNullable<UserConfig['plugins']>[number] {
  const adapterPath = resolvePath(PROJECT_ROOT, 'src/client/primitive-adapter.ts')
  const standaloneAdapterPath = resolvePath(PROJECT_ROOT, 'src/client/standalone/primitive-adapter.tsx')
  const assetLoaderPath = resolvePath(PROJECT_ROOT, 'src/client/asset-loader.ts')
  const standaloneAssetLoaderPath = resolvePath(PROJECT_ROOT, 'src/client/standalone/asset-loader.ts')
  return {
    name: 'dsh-genui-standalone-primitives',
    resolveId(source: string, importer: string | undefined) {
      if (importer === undefined) return null
      const resolved = resolvePath(dirname(importer), source)
      if (resolved === adapterPath) return standaloneAdapterPath
      return resolved === assetLoaderPath ? standaloneAssetLoaderPath : null
    },
  }
}

function standaloneKatexCssPlugin(): NonNullable<UserConfig['plugins']>[number] {
  const sourcePath = resolvePath(PROJECT_ROOT, 'src/client/standalone/katex-style.ts')
  const virtualId = '\0dsh-genui-standalone-katex'
  const cssPath = resolvePath(PROJECT_ROOT, 'node_modules/katex/dist/katex.min.css')
  return {
    name: 'dsh-genui-standalone-katex',
    resolveId(source: string, importer: string | undefined) {
      if (importer !== undefined && resolvePath(dirname(importer), source) === sourcePath) return virtualId
      return null
    },
    async load(id: string) {
      if (id !== virtualId) return null
      const transformed = transform({
        filename: cssPath,
        code: await readFile(cssPath),
        analyzeDependencies: true,
        visitor: {
          Rule: {
            /** 独立 HTML 面向支持 WOFF2 的浏览器，每种字体只需内嵌一份。 */
            'font-face'(rule) {
              const source = rule.value.properties.find(property => property.type === 'source')
              if (source === undefined) throw new Error('KaTeX font face has no source')
              const woff2 = source.value.filter(entry => entry.type === 'url' && entry.value.format?.type === 'woff2')
              if (woff2.length !== 1) throw new Error('KaTeX font face must have exactly one WOFF2 source')
              source.value = woff2
              return rule
            },
          },
        },
      })
      let css = transformed.code.toString()
      for (const dependency of transformed.dependencies ?? []) {
        if (dependency.type !== 'url' || dependency.url.startsWith('data:') || dependency.url.startsWith('#')) continue
        const fontPath = resolvePath(dirname(cssPath), dependency.url)
        const extension = extname(new URL(dependency.url, 'https://genui.invalid/').pathname)
        if (extension !== '.woff2') throw new Error(`unsupported KaTeX asset: ${dependency.url}`)
        const font = await readFile(fontPath)
        css = css.replaceAll(dependency.placeholder, `data:font/woff2;base64,${font.toString('base64')}`)
      }
      return `const style = document.createElement('style'); style.dataset.genuiStandaloneKatex = ''; style.textContent = ${JSON.stringify(css)}; document.head.appendChild(style);`
    },
  }
}

const clientConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  // Minified production bundles: the host serves plugin bytes uncompressed,
  // so every byte counts at first-load time.
  minify: true,
  // No sourcemap in the production bundle: nothing ships the map, nothing
  // rewrites paths, builds are byte-identical.
  sourcemap: false,
  clean: false,
  deps: {
    neverBundle: [...EXTERNALS],
    alwaysBundle: (id: string) => !EXTERNALS.includes(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [purityGate(), cssModulesPlugin()],
  outputOptions: {
    entryFileNames: 'client.js',
    // The loader fetches one script per plugin; the lazy mermaid/three
    // engines are NOT part of this bundle anymore — they ship as standalone
    // IIFE assets under lib/assets/, fetched on demand by the runtime loaders
    // (see asset-loader.ts). Nothing heavy may re-enter this bundle.
    codeSplitting: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

const standaloneConfig: UserConfig = {
  name: `${ID}/standalone`,
  entry: { 'assets/standalone-runtime': 'src/client/standalone/runtime.tsx' },
  outDir: 'lib',
  format: 'iife',
  platform: 'browser',
  dts: false,
  minify: true,
  sourcemap: false,
  clean: false,
  deps: { alwaysBundle: () => true },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [standaloneAliasPlugin(), cssModulesPlugin(), standaloneKatexCssPlugin()],
  outputOptions: { entryFileNames: '[name].js', codeSplitting: false },
}

/**
 * Lazy engine assets: mermaid and three ship as standalone single-entry
 * IIFEs that register themselves on `window.__GenuiAssets__` (no
 * module-loader protocol — the loaders read the global directly after script
 * injection). Two configs because rolldown refuses IIFE with multiple
 * entries; each bundle is fully independent (no cross-entry chunks). The
 * main client bundle never contains either engine, so the eager download
 * drops from ~9 MB to the small renderer core.
 */
function assetConfig(name: 'mermaid' | 'three' | 'echarts' | 'echarts-core' | 'echarts-full' | 'icons', entry: string): UserConfig {
  return {
    name: `${ID}/assets/${name}`,
    entry: { [`assets/${name}`]: entry },
    outDir: 'lib',
    format: 'iife',
    platform: 'browser',
    dts: false,
    // Minified: these engines are huge unminified (6.7 MB / 1.8 MB) and the
    // host serves uncompressed bytes; on-demand loads still want them small.
    minify: true,
    sourcemap: false,
    clean: false,
    deps: {
      neverBundle: [...EXTERNALS],
      alwaysBundle: (id: string) => !EXTERNALS.includes(id),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    plugins: [purityGate()],
    outputOptions: {
      entryFileNames: '[name].js',
    },
  }
}

const libConfig: UserConfig = {
  name: ID,
  // Keep the root plugin bundle at lib/index.js, built from src/index.ts.
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  // Keep the output name aligned with the package's root export.
  outputOptions: { entryFileNames: '[name].js' },
  // Cleanup happens in the build script (`rm -rf lib` before tsc): tsdown
  // must never wipe lib/types (tsc's declaration output) mid-pipeline.
  clean: false,
}

export default [
  libConfig,
  clientConfig,
  standaloneConfig,
  assetConfig('mermaid', 'src/client/asset-mermaid.ts'),
  assetConfig('three', 'src/client/asset-three.ts'),
  assetConfig('echarts-core', 'src/client/asset-echarts-core.ts'),
  assetConfig('echarts-full', 'src/client/asset-echarts.ts'),
  // Full 749-glyph icon catalogue (~1 MB of path data): fetched once, only
  // when a spec names a glyph outside the 64 inlined in icon-data.ts.
  assetConfig('icons', 'src/client/icons/asset-icons.ts'),
]
