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
    resolve: { alias: [
      { find: /^(?:.*\/)?primitive-adapter\.ts$/, replacement: resolve(root, 'src/client/standalone/primitive-adapter.tsx') },
      { find: /^react$/, replacement: resolve(root, 'node_modules/react/index.js') },
      { find: /^react\/jsx-runtime$/, replacement: resolve(root, 'node_modules/react/jsx-runtime.js') },
      { find: /^react-dom\/client$/, replacement: resolve(root, 'node_modules/react-dom/client.js') },
    ] },
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
  if (raw === undefined || raw === 'pending') throw new Error('Browser fixture did not finish; inspect page.html and browser.log')
  const results = JSON.parse(raw.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'))
  await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n')
  if (results.length !== 124) throw new Error(`Expected 124 initial/repeated-control layout checks, got ${results.length}`)
  const failed = results.filter(result => !result.pass)
  if (failed.length > 0) throw new Error(`Browser newline regression failed:\n${JSON.stringify(failed, null, 2)}`)
  await readFile(join(out, 'layout.png'))
  console.log(`Chromium newline layout/selection check passed: ${results.length} checks`)
} finally {
  await server?.close()
  if (profile !== undefined) await rm(profile, { recursive: true, force: true })
}
