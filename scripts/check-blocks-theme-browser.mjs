#!/usr/bin/env node
/** #408: actual Chromium, real renderer, synthetic confusion matrix.
 * BROWSER_BIN=chromium node scripts/check-blocks-theme-browser.mjs
 * Optional GENUI_HOST_THEME_CSS injects a real host token sheet, independently
 * of the export fallback. GENUI_BROWSER_OUT retains before/after evidence.
 * GENUI_BLOCKS_CSS can render an immutable baseline sheet with the same fixture.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.env.GENUI_BROWSER_OUT ?? join(root, '.e2e-artifacts/blocks-theme'))
const browser = process.env.BROWSER_BIN ?? 'chromium'
const hostCss = process.env.GENUI_HOST_THEME_CSS ? await readFile(process.env.GENUI_HOST_THEME_CSS, 'utf8') : null
const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/** CDP waits for the fixture rather than Chromium's dump-dom load heuristic.
 * Vite modules (and optional host tokens) finish asynchronously after load. */
async function render(url, screenshot) {
  const profile = await mkdtemp(join(tmpdir(), 'genui-blocks-chrome-'))
  const process = spawn(browser, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-background-networking', '--disable-extensions', '--disable-sync', '--no-first-run',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  process.stderr.on('data', chunk => { stderr += chunk })
  let socket
  try {
    let port
    for (let i = 0; i < 100; i++) {
      try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await pause(100) }
    }
    assert.ok(port, `Chromium CDP did not start: ${stderr}`)
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    let next = 0
    const pending = new Map()
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.id) pending.get(message.id)?.(message)
    }
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++next
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
      pending.set(id, message => {
        clearTimeout(timer)
        pending.delete(id)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else resolve(message.result)
      })
      socket.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async expression => (await command('Runtime.evaluate', { expression, returnByValue: true })).result.value
    await command('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1300, deviceScaleFactor: 1, mobile: false })
    await command('Page.navigate', { url })
    let ready = false
    for (let i = 0; i < 150; i++) {
      ready = await evaluate("Boolean(document.getElementById('results') && document.getElementById('results').textContent !== 'pending')")
      if (ready) break
      const error = await evaluate("document.getElementById('browser-errors')?.textContent")
      assert.ok(!error, `Browser fixture error: ${error}`)
      await pause(100)
    }
    assert.ok(ready, `Browser fixture did not finish: ${stderr}`)
    await command('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true })
    await command('Runtime.evaluate', {
      expression: 'Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect.getComputedTiming().endTime)).map(a => a.finished.catch(() => {})))',
      awaitPromise: true,
    })
    const shot = await command('Page.captureScreenshot', { captureBeyondViewport: true })
    await writeFile(screenshot, Buffer.from(shot.data, 'base64'))
    return { stdout: await evaluate('document.documentElement.outerHTML'), stderr }
  } finally {
    socket?.close()
    process.kill('SIGTERM')
    for (let i = 0; i < 30 && process.exitCode === null; i++) await pause(100)
    if (process.exitCode === null) process.kill('SIGKILL')
    await rm(profile, { recursive: true, force: true })
  }
}
const server = await createServer({
  root, configFile: false,
  plugins: [{ name: 'blocks-theme-fixture', enforce: 'pre', async load(id) {
    if (process.env.GENUI_BLOCKS_CSS && id === resolve(root, 'src/client/GenuiBlock.module.css')) {
      return await readFile(process.env.GENUI_BLOCKS_CSS, 'utf8')
    }
  }, configureServer(server) {
    server.middlewares.use('/__host-theme.css', (_req, res) => {
      res.statusCode = hostCss === null ? 404 : 200
      res.setHeader('Content-Type', 'text/css')
      res.end(hostCss ?? '')
    })
  } }],
  server: { host: '127.0.0.1', port: 0, strictPort: true, watch: { ignored: ['**/.e2e-artifacts/**'] } },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [{ find: /^(?:.*\/)?primitive-adapter\.ts$/, replacement: resolve(root, 'src/client/standalone/primitive-adapter.tsx') }],
  },
  optimizeDeps: { entries: ['tests/browser/blocks-theme.html'], include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', 'katex'] },
})
await mkdir(out, { recursive: true })
try {
  await server.listen()
  const address = server.httpServer.address()
  assert.ok(address && typeof address !== 'string')
  for (const palette of hostCss === null ? ['export'] : ['host', 'export']) {
    for (const theme of ['light', 'dark']) {
      const name = `${palette}-${theme}`
      const { stdout, stderr } = await render(
        `http://127.0.0.1:${address.port}/tests/browser/blocks-theme.html?theme=${theme}&palette=${palette}`,
        join(out, `${name}.png`),
      )
      await writeFile(join(out, `${name}.log`), stderr)
      await writeFile(join(out, `${name}.html`), stdout)
      const dom = new (await import('jsdom')).JSDOM(stdout).window.document
      assert.equal(dom.getElementById('browser-errors')?.textContent, '', `${name}: browser errors`)
      const raw = dom.getElementById('results')?.textContent
      assert.ok(raw && raw !== 'pending', `${name}: fixture did not finish`)
      const results = JSON.parse(raw)
      await writeFile(join(out, `${name}.json`), JSON.stringify(results, null, 2) + '\n')
      assert.equal(results.length, 47, `${name}: real renderer cell count`)
      for (const cell of results) {
        const label = `${name}/${cell.name}/${cell.text}`
        check(cell.contrast >= 4.5, `${label}: text contrast ${cell.contrast.toFixed(2)} < 4.5`)
        check(cell.sharedStrong === '14%', `${label}: shared focus/data accent strength changed`)
        check(cell.sharedTint === (theme === 'dark' ? '18%' : '12%'), `${label}: unrelated semantic surface strength changed`)
        if (!cell.tone && (cell.outline || cell.plain)) check(cell.background[3] === 0, `${label}: unmarked outline/plain must remain unfilled`)
        if (cell.tone && cell.plain) check(cell.borderWidth === '0px', `${label}: plain tone must have no border`)
        if (theme === 'dark' && cell.tone && cell.text !== 'Cell fill') {
          check(cell.background[3] >= 0.27, `${label}: dark semantic wash must remain visible`)
          if (cell.tone !== 'muted') {
            const chroma = Math.max(...cell.effective.slice(0, 3)) - Math.min(...cell.effective.slice(0, 3))
            // The rc.3 accent is a lighter, less saturated blue than the
            // success/error hues. All keep a >=35/255 channel spread on
            // these default backdrops (the original accent was ~26/255).
            check(chroma >= 35, `${label}: dark semantic chroma ${chroma.toFixed(1)} < 35`)
          }
          if (!cell.plain) check(cell.border[3] >= 0.49, `${label}: dark semantic boundary too faint`)
        }
        if (cell.name === 'variants' && cell.text === 'Default' && !cell.outline && !cell.plain) {
          check(Math.abs(cell.background[3] - (theme === 'dark' ? 0.28 : 0.14)) < 0.01, `${label}: default fill strength`)
        }
        if (theme === 'light' && cell.tone && cell.text !== 'Cell fill') {
          check(Math.abs(cell.background[3] - 0.12) < 0.01, `${label}: light tone wash must remain unchanged`)
          if (!cell.plain) check(Math.abs(cell.border[3] - 0.3) < 0.01, `${label}: light boundary must remain unchanged`)
        }
      }
      const tones = results.filter(cell => cell.name === 'variants' && !cell.plain && !cell.outline && cell.tone)
      check(new Set(tones.map(cell => JSON.stringify(cell.effective))).size === 5, `${name}: all five tones must remain distinct`)
      const explicit = results.find(cell => cell.text === 'Cell fill')
      check(explicit.background.join(',') === '31,111,122,1', `${name}: explicit cell fill must win over tone`)
      const row = results.find(cell => cell.text === 'Row fill')
      check(row.background.join(',') === '226,232,240,1', `${name}: explicit row fill must remain unchanged`)
      await readFile(join(out, `${name}.png`))
      console.log(`${name}: measured ${results.length} cells; min text contrast ${Math.min(...results.map(cell => cell.contrast)).toFixed(2)}:1`)
    }
  }
  assert.deepEqual(failures, [], 'Semantic blocks browser regression')
  console.log('Chromium semantic blocks check passed')
} finally { await server.close() }
