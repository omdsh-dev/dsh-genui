#!/usr/bin/env node
/** Actual Chromium layout/selection regression for #249; synthetic data only.
 * Uses the runner's installed Chrome (or BROWSER_BIN), Vite, and the standalone
 * primitive adapter. No DSH instance, model calls, credentials, or new deps.
 * Run: BROWSER_BIN=/usr/bin/google-chrome node scripts/check-text-newlines-browser.mjs
 */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createServer } from 'vite'

const exec = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, '.e2e-artifacts/text-newlines')
let profile
let server
try {
  await mkdir(out, { recursive: true })
  profile = await mkdtemp(join(out, 'chrome-profile-'))
  const candidates = process.env.BROWSER_BIN ? [process.env.BROWSER_BIN] : ['google-chrome', 'chromium', 'chromium-browser']
  let browser
  for (const candidate of candidates) {
    try { await exec(candidate, ['--version']); browser = candidate; break } catch { /* try another installed browser */ }
  }
  if (browser === undefined) throw new Error('Install Chrome/Chromium or set BROWSER_BIN to an installed browser executable')
  server = await createServer({
    root, configFile: false,
    server: { host: '127.0.0.1', port: 0, strictPort: true },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: [
        { find: /^(?:.*\/)?primitive-adapter\.ts$/, replacement: resolve(root, 'src/client/standalone/primitive-adapter.tsx') },
      ],
    },
    optimizeDeps: {
      include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'],
      force: true,
    },
  })
  await server.listen()
  const address = server.httpServer.address()
  if (address === null || typeof address === 'string') throw new Error('Vite did not bind a loopback TCP port')
  const { stdout, stderr } = await exec(browser, [
    '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-extensions', '--disable-sync', `--user-data-dir=${profile}`,
    '--virtual-time-budget=5000', '--window-size=1500,1800',
    `--screenshot=${join(out, 'layout.png')}`, '--dump-dom',
    `http://127.0.0.1:${address.port}/tests/browser/text-newlines.html`,
  ], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 })
  await writeFile(join(out, 'page.html'), stdout)
  await writeFile(join(out, 'browser.log'), stderr)
  const raw = /<pre id="results">([^<]*)<\/pre>/.exec(stdout)?.[1]
  const browserErrors = /<pre id="browser-errors">([\s\S]*?)<\/pre>/.exec(stdout)?.[1]
  /** 解码 Chromium dump-dom 输出的 HTML 文本。 */
  const decodeBrowserText = value => value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
  const errorSummary = browserErrors === undefined ? '' : decodeBrowserText(browserErrors).trim().slice(0, 2000)
  if (raw === undefined || raw === 'pending') {
    const detail = errorSummary === '' ? 'inspect page.html and browser.log' : `Browser errors:\n${errorSummary}`
    throw new Error(`Browser fixture did not finish; ${detail}`)
  }
  if (errorSummary !== '') throw new Error(`Browser reported client errors:\n${errorSummary}`)
  const results = JSON.parse(decodeBrowserText(raw))
  await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n')
  if (results.length !== 128) throw new Error(`Expected 128 browser layout checks, got ${results.length}`)
  const failed = results.filter(result => !result.pass)
  if (failed.length > 0) throw new Error(`Browser newline regression failed:\n${JSON.stringify(failed, null, 2)}`)
  await readFile(join(out, 'layout.png'))
  console.log(`Chromium newline layout/selection check passed: ${results.length} checks`)
} finally {
  await server?.close()
  if (profile !== undefined) await rm(profile, { recursive: true, force: true })
}
