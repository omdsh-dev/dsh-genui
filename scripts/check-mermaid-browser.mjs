#!/usr/bin/env node
/** Real Chromium regression/benchmark for #303. No host, model or new dependency.
 * BROWSER_BIN=/path/to/chrome node scripts/check-mermaid-browser.mjs [--baseline REF]
 * Baselines are loaded from Git into virtual modules; the checkout stays intact.
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const out = resolve(root, '.e2e-artifacts/mermaid')
const baseline = process.argv.includes('--baseline')
  ? process.argv[process.argv.indexOf('--baseline') + 1]
  : 'f9d8fefcdcfc01b9c94a29f2aa0b9c8dcb58ab32'
const browser = process.env.BROWSER_BIN ?? 'google-chrome'
const profile = await mkdtemp(join(tmpdir(), 'genui-mermaid-'))
await mkdir(out, { recursive: true })
const fixture = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MermaidNode } from '/src/client/blocks/advanced.tsx'
import { MermaidNode as BaselineNode } from '/src/client/blocks/advanced-baseline.tsx'
import { assertSafeSvg } from '/src/client/mermaid-safe.ts'
import { renderMermaid as renderCurrent } from '/src/client/mermaid-core.ts'
import { renderMermaid as renderBaseline } from '/src/client/mermaid-core-baseline.ts'
window.run = async (mode) => {
  const render = mode === 'baseline' ? renderBaseline : renderCurrent
  const calls = []
  const checks = []
  const check = (name, pass) => {
    checks.push({ name, pass })
    if (!pass) throw new Error(name)
  }
  window.__GenuiAssets__ = {
    mermaid: {
      renderMermaid: async (code, target) => {
        const start = performance.now()
        const svg = await render(code, target)
        assertSafeSvg(svg)
        calls.push({ ms: performance.now() - start, code })
        return svg
      },
    },
  }
  const hostStyle = document.createElement('style')
  hostStyle.textContent =
    'body {font-family: "Helvetica Neue", sans-serif; color: rgb(15,17,21); margin:0} body {--dsw-alias-label-primary:#0f1115;--dsw-alias-bg-layer-2:#eef0f4;--dsw-alias-border-l2:#a0a0a0;--dsw-alias-label-tertiary:#555555}'
  document.head.append(hostStyle)
  hostStyle.textContent +=
    'body[data-theme=dark],html[data-theme=dark] body {color:#f4f5f6;background:#12151a;--dsw-alias-label-primary:#f4f5f6;--dsw-alias-bg-layer-2:#22252b;--dsw-alias-border-l2:#89909a;--dsw-alias-label-tertiary:#aeb6c4}'
  // Synthetic long transcript + costly host cascade, identical in both runs.
  for (let sheet = 0; sheet < 196; sheet++) {
    const s = document.createElement('style')
    s.textContent = Array.from(
      { length: 100 },
      (_, j) =>
        '.transcript .message:nth-child(' +
        (j + 1) +
        ') .unused' +
        sheet +
        ' { color: inherit; }',
    ).join('')
    document.head.append(s)
  }
  const transcript = document.createElement('div')
  transcript.className = 'transcript'
  transcript.innerHTML = Array.from(
    { length: 5000 },
    (_, i) => '<span class="message">message ' + i + '</span>',
  ).join('')
  document.body.append(transcript)
  const source =
    'flowchart TD\\n' +
    Array.from(
      { length: 12 },
      (_, i) => 'N' + i + '["节点 ' + i + ' mixed label"] --> N' + (i + 1),
    ).join('\\n')
  // Evaluate the reporter's isolation idea in a separate realm. Mirrored
  // styles and CSSOM-assigned fonts are required for a fair fidelity check.
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.left = '-100000px'
  frame.style.width = innerWidth + 'px'
  document.body.append(frame)
  const frameDoc = frame.contentDocument
  for (const style of document.querySelectorAll(
    'head style, head link[rel=stylesheet]',
  ))
    frameDoc.head.append(style.cloneNode(true))
  const hostComputed = getComputedStyle(document.body)
  frameDoc.body.style.fontFamily = hostComputed.fontFamily
  frameDoc.body.style.color = hostComputed.color
  for (const name of hostComputed)
    if (name.startsWith('--'))
      frameDoc.body.style.setProperty(name, hostComputed.getPropertyValue(name))
  const probe = (doc) => {
    const el = doc.createElement('span')
    el.textContent = '中文 mixed wide 标签'
    el.style.fontSize = '13px'
    doc.body.append(el)
    const value = {
      width: el.getBoundingClientRect().width,
      color: doc.defaultView.getComputedStyle(el).color,
      font: doc.defaultView.getComputedStyle(el).fontFamily,
    }
    el.remove()
    return value
  }
  const hostFont = probe(document),
    frameFont = probe(frameDoc)
  check(
    'isolation font width',
    Math.abs(hostFont.width - frameFont.width) / hostFont.width <= 0.004,
  )
  check('isolation text color', hostFont.color === frameFont.color)
  const isolated = await frame.contentWindow.eval(
    'import("/src/client/mermaid-core' + (mode === 'baseline' ? '-baseline' : '') + '.ts")',
  )
  await isolated.renderMermaid(source)
  await render(source)
  const isolation = []
  for (let i = 0; i < 3; i++) {
    let t = performance.now()
    const hostSvg = await render(source)
    const hostMs = performance.now() - t
    t = performance.now()
    const isolatedSvg = await isolated.renderMermaid(source)
    const isolatedMs = performance.now() - t
    const box = (svg) =>
      new DOMParser()
        .parseFromString(svg, 'image/svg+xml')
        .documentElement.getAttribute('viewBox')
    check('isolated geometry ' + i, box(hostSvg) === box(isolatedSvg))
    isolation.push({ hostMs, isolatedMs })
  }
  frame.remove()
  // Warm the same engine/parser before collecting scheduling metrics.
  await render('graph TD\\nA --> B')
  await new Promise((r) => setTimeout(r, 50))
  const longTasks = []
  const observer = new PerformanceObserver((list) =>
    longTasks.push(...list.getEntries().map((e) => e.duration)),
  )
  observer.observe({ type: 'longtask', buffered: false })
  let maxGap = 0,
    last = performance.now()
  const heartbeat = setInterval(() => {
    const now = performance.now()
    maxGap = Math.max(maxGap, now - last)
    last = now
  }, 10)
  const mount = document.createElement('div')
  document.body.prepend(mount)
  const app = createRoot(mount)
  const Node = mode === 'baseline' ? BaselineNode : MermaidNode
  const nodes = Array.from({ length: 9 }, (_, i) =>
    React.createElement(
      'section',
      { key: i, style: { minHeight: '900px' } },
      React.createElement(Node, {
        node: { type: 'mermaid', code: source + '\\n%% ' + i },
      }),
    ),
  )
  window.measureReady = true
  await new Promise((r) => (window.beginMeasurement = r))
  const start = performance.now()
  flushSync(() => app.render(nodes))
  const wait = async (predicate) => {
    const deadline = performance.now() + 60000
    while (!predicate()) {
      if (performance.now() > deadline)
        throw new Error('timed out: ' + calls.length + ' renders')
      await new Promise((r) => setTimeout(r, 25))
    }
  }
  // A selected baseline can already have viewport gating. Wait for visible
  // work rather than assuming every historical version starts all nine.
  await wait(() => calls.length >= 1)
  await new Promise((r) => setTimeout(r, 200))
  const initial = {
    renders: calls.length,
    promiseMs: calls.reduce((s, c) => s + c.ms, 0),
    elapsedMs: performance.now() - start,
    maxGap,
    longTasks: [...longTasks],
  }
  window.initialReady = true
  await new Promise((r) => (window.continueMeasurement = r))
  for (const section of mount.children) {
    section.scrollIntoView()
    await new Promise((r) => setTimeout(r, 300))
  }
  await wait(() => mount.querySelectorAll('[data-genui-mermaid]').length === 9)
  const svgs = [...mount.querySelectorAll('[data-genui-mermaid] svg')]
  // Actual source changes and history prepends through the production node.
  check('nine diagrams', svgs.length === 9)
  const originalBox = svgs[0].getAttribute('viewBox')
  for (const svg of svgs) assertSafeSvg(svg.outerHTML)
  check(
    'same geometry for repeated diagrams',
    svgs.every((s) => s.getAttribute('viewBox') === originalBox),
  )
  if (mode === 'current') {
    check('offscreen work deferred', initial.renders < 9)
    const before = calls.length
    document.body.setAttribute('data-theme', 'dark')
    const visibleDiagram = () =>
      mount.lastElementChild.querySelector('[data-genui-mermaid]')
    const hasColor = (svg, color) => {
      if (!svg) return false
      const colors = [...svg.querySelectorAll('text')]
        .filter(label => label.textContent.trim())
        .map(label => getComputedStyle(label).fill)
      for (const label of svg.querySelectorAll('foreignObject')) {
        const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT)
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          if (text.textContent.trim()) colors.push(getComputedStyle(text.parentElement).color)
        }
      }
      return colors.length > 0 && colors.every(actual => actual === color)
    }
    await wait(
      () =>
        calls.length > before &&
        hasColor(visibleDiagram(), 'rgb(244, 245, 246)'),
    )
    check(
      'theme colors refreshed',
      hasColor(visibleDiagram(), 'rgb(244, 245, 246)'),
    )
    const darkCount = calls.length
    document.body.removeAttribute('data-theme')
    document.documentElement.setAttribute('data-theme', 'light')
    await wait(
      () =>
        calls.length > darkCount &&
        hasColor(visibleDiagram(), 'rgb(15, 17, 21)'),
    )
    check('light theme restored', hasColor(visibleDiagram(), 'rgb(15, 17, 21)'))
    flushSync(() =>
      app.render(
        React.createElement(Node, {
          node: { type: 'mermaid', code: 'graph TD\\nX --> Y' },
        }),
      ),
    )
    flushSync(() =>
      app.render(
        React.createElement(Node, {
          node: { type: 'mermaid', code: 'graph TD\\nFinal --> Current' },
        }),
      ),
    )
    scrollTo(0, 0)
    await wait(() =>
      mount
        .querySelector('[data-genui-mermaid]')
        ?.textContent.includes('Current'),
    )
    check(
      'latest streaming source wins',
      !mount.textContent.includes('mixed label'),
    )
    flushSync(() =>
      app.render([
        React.createElement(Node, {
          key: 'history',
          node: {
            type: 'mermaid',
            code: 'sequenceDiagram\\nAlice->>Bob: history',
          },
        }),
        React.createElement(Node, {
          key: 'latest',
          node: { type: 'mermaid', code: 'graph TD\\nFinal --> Current' },
        }),
      ]),
    )
    await wait(
      () => mount.querySelectorAll('[data-genui-mermaid]').length === 2,
    )
    check(
      'history prepend renders both diagrams',
      mount.textContent.includes('history') &&
        mount.textContent.includes('Current'),
    )
  }
  if (mode === 'current') {
    // #328: layout and visible labels must use the same inherited card font.
    // Measuring against body then inheriting from monospace clips CJK suffixes.
    const card = document.createElement('div')
    Object.assign(card.style, { position: 'fixed', top: '0', left: '0', width: '1000px' })
    document.body.append(card)
    const fontApp = createRoot(card)
    try {
      for (const font of ['sans-serif', 'monospace', 'serif']) {
        card.style.fontFamily = font
        const before = calls.length
        flushSync(() => fontApp.render(React.createElement(Node, {
          node: { type: 'mermaid', code: 'flowchart LR\\nA["dsh-ui 围栏"] --> B["表格 / 图表"]' },
        })))
        await wait(() => calls.length > before && card.querySelector('[data-genui-mermaid] svg') !== null
          && getComputedStyle(card.querySelector('svg')).fontFamily === font)
        const labels = [...card.querySelectorAll('foreignObject')].filter(label => label.textContent.trim())
        check('CJK labels present in ' + font, labels.length === 2)
        for (const label of labels) {
          const range = document.createRange()
          range.selectNodeContents(label.querySelector('.nodeLabel') ?? label)
          check('CJK label fits in ' + font + ': ' + label.textContent,
            range.getBoundingClientRect().right <= label.getBoundingClientRect().right + 1)
        }
      }
    } finally { fontApp.unmount(); card.remove() }
  }
  const kinds = [
    'sequenceDiagram\\nAlice->>Bob: Hello',
    'classDiagram\\nAnimal <|-- Duck',
    'stateDiagram-v2\\n[*] --> Active',
    'gantt\\n dateFormat YYYY-MM-DD\\n section Work\\n Task :2026-01-01, 1d',
    'pie\\n"One" : 1',
    'erDiagram\\nPERSON ||--o{ PET : owns',
    'journey\\n title Day\\n section Work\\n Task: 5: Me',
    'gitGraph\\n commit',
  ]
  for (const code of kinds) {
    const svg = await render(code)
    assertSafeSvg(svg)
    check('kind ' + code.split('\\n')[0], svg.includes('<svg'))
  }
  let rejected = false
  try {
    await render('mindmap\\n root((unsupported))')
  } catch {
    rejected = true
  }
  check('kind allowlist', rejected)
  rejected = false
  try {
    await render('graph TD\\n[]')
  } catch {
    rejected = true
  }
  check('invalid source rejected', rejected)
  let attackSvg
  try {
    attackSvg = await render(
      'graph TD\\nA["safe"]\\nclick A "javascript:alert(1)"',
    )
  } catch {}
  if (attackSvg !== undefined) assertSafeSvg(attackSvg)
  check(
    'strict javascript-link handling',
    attackSvg === undefined || !/javascript:/i.test(attackSvg),
  )
  check(
    'label repair',
    (await render('graph TD\\nA[中文 标签] --> B')).includes('<svg'),
  )
  window.previewDark = async () => {
    const before = calls.length
    document.documentElement.setAttribute('data-theme', 'dark')
    await wait(
      () =>
        calls.length >= before + 2 &&
        mount.querySelectorAll('[data-genui-mermaid]').length === 2,
    )
  }
  const result = {
    mode,
    isolation,
    hostFont,
    frameFont,
    checks,
    initial,
    totalRenders: calls.length,
    diagrams: svgs.length,
    viewBoxes: svgs.map((s) => s.getAttribute('viewBox')),
    labels: svgs.map((s) =>
      [...s.querySelectorAll('text, foreignObject')].map(
        (label) => label.textContent,
      ),
    ),
    unsafe: mount.querySelector('script, [onload], [onclick]') !== null,
  }
  clearInterval(heartbeat)
  observer.disconnect()
  window.result = result
  return result
}
`
let server, chrome, socket
try {
  server = await createServer({
    root,
    configFile: false,
    server: {
      host: '127.0.0.1',
      port: 0,
      fs: { allow: [root, resolve(root, 'node_modules')] },
    },
    optimizeDeps: {
      include: [
        'mermaid',
        'react',
        'react-dom/client',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
      ],
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: [
        {
          find: /^(?:.*\/)?primitive-adapter\.ts$/,
          replacement: resolve(
            root,
            'src/client/standalone/primitive-adapter.tsx',
          ),
        },
      ],
    },
    plugins: [
      {
        name: 'mermaid-regression-fixture',
        resolveId(id, importer) {
          if (id === '/mermaid-check.js') return id
          if (id.endsWith('-baseline.ts') || id.endsWith('-baseline.tsx'))
            return id.startsWith('.')
              ? resolve(dirname(importer), id)
              : resolve(root, id.replace(/^\//, ''))
        },
        load(id) {
          if (id === '/mermaid-check.js') return fixture
          if (!id.includes('-baseline.')) return
          const path = id.slice(root.length).replace('-baseline.', '.')
          return execFileSync('git', ['show', baseline + ':' + path], {
            cwd: root,
            encoding: 'utf8',
          }).replace(
            "import('../mermaid-lazy.ts')",
            "import('../mermaid-lazy-baseline.ts')",
          )
        },
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            if (req.url === '/mermaid-check') {
              res.setHeader('Content-Type', 'text/html')
              res.end(
                '<!doctype html><html><head></head><body><script type="module" src="/mermaid-check.js"></script></body></html>',
              )
            } else next()
          })
        },
      },
    ],
  })
  await server.listen()
  const port = server.httpServer.address().port
  chrome = spawn(
    browser,
    [
      '--headless',
      '--password-store=basic',
      '--use-mock-keychain',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--window-size=1200,800',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  const endpoint = await new Promise((ok, no) => {
    let log = ''
    const timeout = setTimeout(
      () => no(new Error('Chrome startup timeout: ' + log)),
      20000,
    )
    chrome.once('error', no)
    chrome.stderr.on('data', (data) => {
      log += data
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(log)
      if (match) {
        clearTimeout(timeout)
        ok(match[1])
      }
    })
  })
  socket = new WebSocket(endpoint)
  await new Promise((ok, no) => {
    socket.onopen = ok
    socket.onerror = no
  })
  let seq = 0
  const pending = new Map()
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error
        ? p.reject(new Error(JSON.stringify(msg.error)))
        : p.resolve(msg.result)
    }
  }
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  const results = []
  const poll = async (sessionId, expression) => {
    for (let i = 0; i < 1200; i++) {
      const r = await send(
        'Runtime.evaluate',
        { expression, returnByValue: true },
        sessionId,
      )
      if (r.result.value) {
        if (typeof r.result.value === 'string') throw new Error(r.result.value)
        return r.result.value
      }
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('Browser wait timed out: ' + expression)
  }
  for (const mode of ['baseline', 'current']) {
    const { targetId } = await send('Target.createTarget', {
      url: 'about:blank',
    })
    const { sessionId } = await send('Target.attachToTarget', {
      targetId,
      flatten: true,
    })
    await send('Page.enable', {}, sessionId)
    await send(
      'Page.navigate',
      { url: `http://127.0.0.1:${port}/mermaid-check` },
      sessionId,
    )
    for (let i = 0; i < 600; i++) {
      const ready = await send(
        'Runtime.evaluate',
        { expression: 'typeof window.run === "function"' },
        sessionId,
      )
      if (ready.result.value) break
      await new Promise((r) => setTimeout(r, 100))
      if (i === 599) throw new Error('Fixture did not load')
    }
    await send('Emulation.setCPUThrottlingRate', { rate: 4 }, sessionId)
    await send('Performance.enable', {}, sessionId)
    await send(
      'Runtime.evaluate',
      {
        expression: `window.runPromise=window.run(${JSON.stringify(mode)}).catch(e=>{window.failure=e.stack;throw e});undefined`,
      },
      sessionId,
    )
    await poll(sessionId, 'window.measureReady || window.failure')
    const before = await send('Performance.getMetrics', {}, sessionId)
    await send(
      'Runtime.evaluate',
      { expression: 'window.beginMeasurement()' },
      sessionId,
    )
    await poll(sessionId, 'window.initialReady || window.failure')
    const after = await send('Performance.getMetrics', {}, sessionId)
    await send(
      'Runtime.evaluate',
      { expression: 'window.continueMeasurement()' },
      sessionId,
    )
    const response = await send(
      'Runtime.evaluate',
      {
        expression: 'window.runPromise',
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    )
    if (response.result?.value) {
      response.result.value.initial.cpu = {}
      for (const name of [
        'TaskDuration',
        'ScriptDuration',
        'LayoutDuration',
        'RecalcStyleDuration',
      ]) {
        const value = (ms) =>
          ms.metrics.find((m) => m.name === name)?.value ?? 0
        response.result.value.initial.cpu[name + 'Ms'] =
          (value(after) - value(before)) * 1000
      }
    }
    if (response.exceptionDetails)
      throw new Error(JSON.stringify(response.exceptionDetails))
    results.push(response.result.value)
    const shot = await send(
      'Page.captureScreenshot',
      { format: 'png' },
      sessionId,
    )
    await writeFile(join(out, mode + '.png'), Buffer.from(shot.data, 'base64'))
    if (mode === 'current') {
      await send(
        'Runtime.evaluate',
        { expression: 'window.previewDark()', awaitPromise: true },
        sessionId,
      )
      const dark = await send(
        'Page.captureScreenshot',
        { format: 'png' },
        sessionId,
      )
      await writeFile(
        join(out, 'current-dark.png'),
        Buffer.from(dark.data, 'base64'),
      )
    }
    await send('Target.closeTarget', { targetId })
  }
  await writeFile(
    join(out, 'results.json'),
    JSON.stringify({ baseline, results }, null, 2) + '\n',
  )
  for (const r of results)
    console.log(
      JSON.stringify(
        { ...r, labels: undefined, viewBoxes: [...new Set(r.viewBoxes)] },
        null,
        2,
      ),
    )
  // Font measurement fixes can legitimately change layout dimensions. The
  // labels must stay identical, and current CJK geometry is checked above.
  if (JSON.stringify(results[0].labels) !== JSON.stringify(results[1].labels))
    throw new Error('Baseline/current label mismatch')
  if (results.some((r) => r.diagrams !== 9 || r.unsafe))
    throw new Error('Diagram count/security regression')
} finally {
  socket?.close()
  chrome?.kill()
  await server?.close()
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  })
}
