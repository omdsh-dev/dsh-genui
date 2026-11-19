#!/usr/bin/env node
// Native focus and date input behavior cannot be established by jsdom alone.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.env.GENUI_BROWSER_OUT ?? join(root, '.e2e-artifacts/interaction-state'))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const server = await createServer({
  root, configFile: false,
  server: { host: '127.0.0.1', watch: { ignored: ['**/.e2e-artifacts/**'] } },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [{ find: /^(?:.*\/)?primitive-adapter\.ts$/, replacement: resolve(root, 'src/client/standalone/primitive-adapter.tsx') }],
  },
  optimizeDeps: { entries: ['tests/browser/interaction-state.html'], include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', 'katex'] },
})
const profile = await mkdtemp(join(tmpdir(), 'genui-interaction-chrome-'))
let browser, socket
const errors = []
try {
  await mkdir(out, { recursive: true })
  await server.listen()
  const address = server.httpServer.address()
  browser = spawn(process.env.BROWSER_BIN ?? 'chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-background-networking', '--disable-extensions', '--disable-sync', '--no-first-run',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: 'ignore' })
  let port
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await pause(100) }
  }
  assert.ok(port, 'Chromium CDP did not start')
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let next = 0
  const pending = new Map()
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id) pending.get(message.id)?.(message)
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  }
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
    pending.set(id, message => {
      clearTimeout(timer); pending.delete(id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description)
    return result.result.value
  }
  const waitFor = async (expression, label) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expression)) return
      assert.deepEqual(errors, [], 'Browser runtime errors')
      await pause(100)
    }
    assert.fail(`Timed out: ${label}`)
  }
  const mount = async (items, reset = true) => {
    await evaluate(`window.genuiInteraction.mount(${JSON.stringify({ items })}, ${reset})`)
    await pause(100)
  }
  const click = async selector => {
    const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
    for (const type of ['mousePressed', 'mouseReleased']) await command('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
  }
  const submit = { type: 'submit', label: 'Send', action: 'send' }
  const send = () => evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Send').click()")
  await command('Runtime.enable')
  await command('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false })
  await command('Page.navigate', { url: `http://127.0.0.1:${address.port}/tests/browser/interaction-state.html` })
  await waitFor('Boolean(window.genuiInteraction)', 'fixture load')

  await mount([
    { type: 'input', id: 'name', label: 'Name', action: 'saveName' },
    { type: 'popover', label: 'Hover info', content: 'Details', trigger: 'hover' },
  ])
  await evaluate("document.querySelector('input').focus()")
  await command('Input.insertText', { text: 'Ada' })
  const point = await evaluate("(() => { const r = document.querySelector('[data-genui-popover] button').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()")
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await waitFor("Boolean(document.querySelector('[role=dialog]'))", 'hover popover')
  assert.equal(await evaluate('document.activeElement.tagName'), 'INPUT', 'Hover must preserve the active draft focus')
  assert.deepEqual(await evaluate('window.genuiInteraction.events'), [], 'Hover must not emit a blur action')
  assert.equal(await evaluate("document.querySelector('[role=dialog]').getAttribute('aria-label')"), 'Hover info')
  await writeFile(join(out, 'hover-focus.png'), Buffer.from((await command('Page.captureScreenshot')).data, 'base64'))
  for (const type of ['keyDown', 'keyUp']) await command('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor("!document.querySelector('[role=dialog]')", 'Escape dismiss')

  await mount([{ type: 'popover', label: 'Click info', content: 'Details' }])
  await click('[data-genui-popover] button')
  await waitFor("document.activeElement?.closest('[role=dialog]') !== null", 'click focus')
  await click('[role=dialog] button')
  await waitFor("!document.querySelector('[role=dialog]')", 'close button')

  const gated = { type: 'popover', label: 'Gated info', content: '[Link](https://example.com)', enableWhen: { field: 'allow', op: 'eq', value: 'yes' } }
  await mount([gated, { type: 'input', id: 'allow', value: 'yes' }])
  await click('[data-genui-popover] button')
  await waitFor("Boolean(document.querySelector('[role=dialog]'))", 'enabled portal')
  await mount([{ ...gated, enableWhen: { field: 'allow', op: 'eq', value: 'no' } }, { type: 'input', id: 'allow', value: 'yes' }], false)
  assert.equal(await evaluate("Boolean(document.querySelector('[role=dialog]'))"), false, 'Disabled popover must remove its portal')

  for (const id of ['constructor', 'toString', '__proto__']) {
    await mount([{ type: 'editor', id, label: 'Draft', value: 'Hello' }, submit])
    assert.equal(await evaluate("document.querySelector('textarea').value"), 'Hello')
    await send()
    assert.deepEqual(await evaluate('window.genuiInteraction.events[0].payload.fields'), { [id]: 'Hello' })
    await mount([{ type: 'date-picker', id, label: 'Date', value: '2026-10-20' }, submit])
    assert.equal(await evaluate("document.querySelector('input').value"), '2026-10-20')
    await send()
    assert.deepEqual(await evaluate('window.genuiInteraction.events[0].payload.fields'), { [id]: '2026-10-20' })
  }
  await mount([{ type: 'date-picker', id: 'date', label: 'Date', value: '0000-01-01' }, submit])
  assert.equal(await evaluate("document.querySelector('input').value"), '')
  assert.equal(await evaluate("document.querySelector('button').disabled"), true)

  const date = { type: 'date-picker', id: 'date', label: 'Date', max: '2026-10-22' }
  await mount([date, submit])
  await evaluate("(() => { const input=document.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2026-10-30'); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()")
  assert.equal(await evaluate("document.querySelector('button').disabled"), true)
  await mount([{ ...date, max: '2026-10-31' }, submit], false)
  assert.equal(await evaluate("document.querySelector('input').value"), '2026-10-30')
  await send()
  assert.deepEqual(await evaluate('window.genuiInteraction.events[0].payload.fields'), { date: '2026-10-30' })
  assert.deepEqual(errors, [], 'Browser runtime errors')
  await writeFile(join(out, 'result.json'), JSON.stringify({ passed: true, cases: ['hover focus and no action', 'click focus', 'Escape and close', 'disabled portal removal', 'editor and date prototype keys', 'year zero', 'expanded date bounds'] }, null, 2) + '\n')
  console.log('Chromium interaction state checks passed')
} finally {
  socket?.close()
  browser?.kill('SIGTERM')
  for (let i = 0; i < 30 && browser?.exitCode === null; i++) await pause(100)
  if (browser?.exitCode === null) browser.kill('SIGKILL')
  await server.close()
  await rm(profile, { recursive: true, force: true })
}
