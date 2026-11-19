#!/usr/bin/env node
/** #410: inherited body line height must not displace fixed-size step markers.
 * Reuses the Chromium/CDP and Vite fixture approach of check-blocks-theme-browser.
 * GENUI_STEPS_CSS substitutes only the source stylesheet for a baseline run.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.env.GENUI_BROWSER_OUT ?? join(root, '.e2e-artifacts/steps-marker'))
const browser = process.env.BROWSER_BIN ?? 'chromium'
const hostCss = process.env.GENUI_HOST_THEME_CSS ? await readFile(process.env.GENUI_HOST_THEME_CSS, 'utf8') : null
const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/** CDP waits for the fixture rather than Chromium's dump-dom load heuristic.
 * Vite modules (and optional host tokens) finish asynchronously after load. */
async function render(url, screenshot, width) {
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
    await command('Emulation.setDeviceMetricsOverride', { width, height: 1300, deviceScaleFactor: 1, mobile: false })
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
    const { cssContentSize } = await command('Page.getLayoutMetrics')
    const shot = await command('Page.captureScreenshot', {
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: cssContentSize.height, scale: 1 },
    })
    await writeFile(screenshot, Buffer.from(shot.data, 'base64'))
    const region = await evaluate(`(() => {
      const box = document.querySelector('[data-font="20"][data-line-height="2.1"]').getBoundingClientRect()
      return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height, scale: 1 }
    })()`)
    const detail = await command('Page.captureScreenshot', { captureBeyondViewport: true, clip: region })
    await writeFile(screenshot.replace(/\.png$/, '-20px.png'), Buffer.from(detail.data, 'base64'))
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
  plugins: [{ name: 'steps-marker-fixture', enforce: 'pre', async load(id) {
    if (process.env.GENUI_STEPS_CSS && id === resolve(root, 'src/client/GenuiBlock.module.css')) {
      return await readFile(process.env.GENUI_STEPS_CSS, 'utf8')
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
  optimizeDeps: { entries: ['tests/browser/steps-marker.html'], include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', 'katex'] },
})
await mkdir(out, { recursive: true })
let checked = 0
try {
  await server.listen()
  const address = server.httpServer.address()
  assert.ok(address && typeof address !== 'string')
  for (const palette of hostCss === null ? ['export'] : ['host', 'export']) {
    for (const theme of ['light', 'dark']) {
      for (const width of [390, 1100]) {
        const name = `${palette}-${theme}-${width}`
        const { stdout, stderr } = await render(
          `http://127.0.0.1:${address.port}/tests/browser/steps-marker.html?theme=${theme}&palette=${palette}`,
          join(out, `${name}.png`), width,
        )
        const document = new JSDOM(stdout).window.document
        assert.equal(document.getElementById('browser-errors')?.textContent, '', `${name}: browser errors`)
        const results = JSON.parse(document.getElementById('results').textContent)
        await writeFile(join(out, `${name}.json`), JSON.stringify(results, null, 2) + '\n')
        await writeFile(join(out, `${name}.log`), stderr)
        assert.equal(results.samples.length, 48, `${name}: real renderer marker count`)
        check(!results.overflow, `${name}: horizontal overflow`)
        if (width === 390) check(results.samples.some(sample => sample.hostFont === 20 && sample.titleLines > 1.5), `${name}: narrow case must exercise title wrapping`)
        for (const sample of results.samples) {
          const label = `${name}/${sample.hostFont}/${sample.hostLineHeight}/${sample.state}/${sample.text}`
          check(Math.abs(sample.width - 24) < 0.01 && Math.abs(sample.height - 24) < 0.01, `${label}: marker size changed`)
          // The marker's own line box must fit and remain independent of body leading.
          check(Math.abs(sample.lineHeight - sample.font) < 0.02, `${label}: inherited line-height ${sample.lineHeight}px`)
          // Range includes font ascent/descent, not just visible ink. Some
          // fallback fonts use all 24px; require containment and centering,
          // rather than pretending this measures raster glyph padding.
          check(sample.textTop >= 0 && sample.textBottom <= 24, `${label}: text range escapes marker`)
          check(Math.abs(sample.textCenterOffset) <= 1.5, `${label}: text range is off center`)
          check(sample.titleClear, `${label}: marker/title overlap or clipped title`)
          // Only marker leading changes; readable title/description leading stays intact.
          check(Math.abs(sample.titleLineHeight / Math.max(14.5, sample.hostFont * 0.852941176) - 1.45) < 0.01, `${label}: title leading changed`)
          check(Math.abs(sample.descLineHeight / Math.max(12.5, sample.hostFont * 0.735294118) - 1.55) < 0.01, `${label}: description leading changed`)
          const peer = results.samples.find(other => other.hostFont === sample.hostFont && other.state === sample.state && other.text === sample.text && other.hostLineHeight !== sample.hostLineHeight)
          check(Math.abs(sample.textCenterOffset - peer.textCenterOffset) < 0.05, `${label}: body leading moves text`)
        }
        checked += results.samples.length
        console.log(`${name}: measured ${results.samples.length} markers`)
      }
    }
  }
  assert.deepEqual(failures, [], 'Step marker browser regression')
  console.log(`Chromium step marker check passed: ${checked} markers`)
} finally { await server.close() }
