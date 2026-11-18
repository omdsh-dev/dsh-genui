#!/usr/bin/env node
/**
 * 真实 Chromium 验收：Mermaid 点击放大预览（#314 / #437）。
 *
 * BROWSER_BIN=/path/to/chrome node scripts/check-mermaid-zoom-browser.mjs
 * 与 check-mermaid-browser.mjs 同一套 Vite + CDP 管线，不引入新依赖、不连宿主。
 * 交互全部走 CDP Input 事件（真实用户路径），断言读 DOM 与几何，截图落
 * .e2e-artifacts/mermaid-zoom/。jsdom 没有布局，CSS 尺寸与模态行为只能在这里验。
 */
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, '.e2e-artifacts/mermaid-zoom')
const browser = process.env.BROWSER_BIN ?? 'google-chrome'
const profile = await mkdtemp(resolve(tmpdir(), 'genui-mermaid-zoom-'))
await mkdir(out, { recursive: true })

const SOURCE = [
  'flowchart LR',
  ...Array.from({ length: 18 }, (_, i) =>
    `  N${i}["驱动适配器 ${i} · 输入边界"] --> P${i}("端口 / 应用内核 / 用例 ${i}") --> D${i}["领域服务与仓储 ${i}"]`),
].join(String.fromCharCode(10))

const fixture = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MermaidNode } from '/src/client/blocks/advanced.tsx'
import { renderMermaid } from '/src/client/mermaid-core.ts'
import { assertSafeSvg } from '/src/client/mermaid-safe.ts'

window.renderCount = 0
window.__GenuiAssets__ = {
  mermaid: {
    renderMermaid: async (code, target) => {
      window.renderCount += 1
      if (code.startsWith('WIDE')) {
        return '<svg viewBox="0 0 3000 400" xmlns="http://www.w3.org/2000/svg" style="max-width: 3000px;"><g><rect x="10" y="10" width="2980" height="380" fill="none" stroke="#333"/><text x="40" y="200" font-size="60">WIDE</text></g></svg>'
      }
      const svg = await renderMermaid(code, target)
      assertSafeSvg(svg)
      return svg
    },
  },
}
const spacer = document.createElement('div')
spacer.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:2400px;z-index:-1;pointer-events:none;'
document.body.append(spacer)
const hostStyle = document.createElement('style')
hostStyle.textContent = [
  'html,body { margin:0; font-family: -apple-system, "Helvetica Neue", sans-serif; }',
  ':root { --dsl-g-gap-xs:4px; --dsl-g-gap-sm:8px; --dsl-g-gap-md:12px; --dsl-g-gap-lg:16px;',
  '  --dsl-g-radius-control:8px; --dsl-g-radius-surface:12px; --dsl-g-border:#d0d3d8;',
  '  --dsl-g-border-surface:#c6cad1; --dsl-g-surface:#ffffff; --dsl-g-accent:#3b6cf6;',
  '  --dsl-g-shadow-card:0 12px 36px rgba(0,0,0,.22); --dsl-g-font-h3:16px; --dsl-g-font-meta:12.5px;',
  '  --dsw-alias-label-primary:#0f1115; --dsw-alias-label-secondary:#5a6270;',
  '  --dsw-alias-label-tertiary:#8b929d; --dsw-alias-bg-layer-1:#ffffff;',
  '  --dsw-alias-bg-layer-2:#f4f6f9; --dsw-alias-border-l1:#d8dce2; --dsw-alias-border-l2:#c6cad1; }',
].join('\\n')
document.head.append(hostStyle)

const card = document.createElement('div')
card.style.cssText = 'width:760px;margin:24px;padding:16px;border:1px solid #d8dce2;border-radius:12px;background:#fff;'
document.body.append(card)
card.append(Object.assign(document.createElement('h2'), { textContent: '对话里的 Mermaid 卡片', style: 'font-size:15px;margin:0 0 12px' }))
const mount = document.createElement('div')
card.append(mount)
createRoot(mount).render(React.createElement(MermaidNode, {
  node: { type: 'mermaid', code: ${JSON.stringify(SOURCE)} },
}))
window.mountWide = () => {
  const wide = document.createElement('div')
  wide.style.cssText = 'width:760px;margin:24px;padding:16px;border:1px solid #d8dce2;border-radius:12px;background:#fff;'
  document.body.append(wide)
  wide.append(Object.assign(document.createElement('h2'), { textContent: '宽图卡片', style: 'font-size:15px;margin:0 0 12px' }))
  const wideMount = document.createElement('div')
  wide.append(wideMount)
  createRoot(wideMount).render(React.createElement(MermaidNode, {
    node: { type: 'mermaid', code: 'WIDE' },
  }))
}
window.fixtureReady = true
`

let server, chrome, socket
try {
  server = await createServer({
    root,
    configFile: false,
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, resolve(root, 'node_modules')] } },
    optimizeDeps: { noDiscovery: true, include: ['mermaid', 'react', 'react-dom/client', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: [{
        find: /^(?:.*\/)?primitive-adapter\.ts$/,
        replacement: resolve(root, 'src/client/standalone/primitive-adapter.tsx'),
      }],
    },
    plugins: [{
      name: 'mermaid-zoom-fixture',
      resolveId(id) { if (id === '/zoom-check.js') return id },
      load(id) { if (id === '/zoom-check.js') return fixture },
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url === '/zoom-check') {
            res.setHeader('Content-Type', 'text/html')
            res.end('<!doctype html><html><head></head><body><script type="module" src="/zoom-check.js"></script></body></html>')
          } else next()
        })
      },
    }],
  })
  await server.listen()
  const port = server.httpServer.address().port

  chrome = spawn(browser, [
    '--headless=new', '--password-store=basic', '--use-mock-keychain', '--no-sandbox',
    '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const endpoint = await new Promise((ok, no) => {
    let log = ''
    const timeout = setTimeout(() => no(new Error('Chrome startup timeout: ' + log)), 20000)
    chrome.once('error', no)
    chrome.stderr.on('data', data => {
      log += data
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(log)
      if (match) { clearTimeout(timeout); ok(match[1]) }
    })
  })
  socket = new WebSocket(endpoint)
  await new Promise((ok, no) => { socket.onopen = ok; socket.onerror = no })
  let seq = 0
  const pending = new Map()
  socket.onmessage = event => {
    const msg = JSON.parse(event.data)
    if (!msg.id) return
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result)
  }
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
    const id = ++seq
    pending.set(id, { resolve: ok, reject: no })
    socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const evaluate = async (sessionId, expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
    return r.result.value
  }
  const poll = async (sessionId, expression, label) => {
    for (let i = 0; i < 400; i++) {
      const value = await evaluate(sessionId, expression)
      if (value) return value
      await new Promise(r => setTimeout(r, 100))
    }
    throw new Error('timed out waiting for ' + label)
  }
  const shot = async (sessionId, name) => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)
    await writeFile(resolve(out, name), Buffer.from(r.data, 'base64'))
  }
  const rectOf = async (sessionId, selector) => {
    const r = await evaluate(sessionId, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; })()`)
    if (r === null) throw new Error('element not found: ' + selector)
    return r
  }
  const mouse = async (sessionId, type, x, y, extra = {}) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseWheel' ? 'none' : 'left', clickCount: 1, ...extra }, sessionId)

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/zoom-check` }, sessionId)

  await poll(sessionId, 'typeof window.fixtureReady === "boolean"', 'fixture')
  await poll(sessionId, '!!document.querySelector("[data-genui-mermaid] svg")', 'rendered svg')
  await new Promise(r => setTimeout(r, 400))

  const report = { checks: [], passed: false }
  const check = (name, pass, detail) => {
    report.checks.push({ name, pass, detail })
    if (!pass) throw new Error('FAILED: ' + name + ' ' + JSON.stringify(detail))
  }

  const before = await evaluate(sessionId, `(() => {
    const svg = document.querySelector('[data-genui-mermaid] svg');
    const b = svg.getBoundingClientRect();
    return { renderCount: window.renderCount, cardWidth: Math.round(b.width), intrinsic: svg.getAttribute('viewBox'), opener: !!document.querySelector('button[aria-haspopup="dialog"]'), dialogOpen: !!document.querySelector('dialog')?.open };
  })()`)
  report.before = before
  check('完成态有放大入口且未打开弹层', before.opener === true && before.dialogOpen === false, before)
  check('卡片里的图被约束在可读宽度内', before.cardWidth <= 730, before)
  await shot(sessionId, 'before.png')

  const opener = await rectOf(sessionId, 'button[aria-haspopup="dialog"]')
  await mouse(sessionId, 'mousePressed', opener.x, opener.y)
  await mouse(sessionId, 'mouseReleased', opener.x, opener.y)
  await poll(sessionId, '!!document.querySelector("dialog")?.open', 'dialog open')

  const opened = await evaluate(sessionId, `(() => {
    const d = document.querySelector('dialog');
    const s = document.querySelector('[data-genui-mermaid-surface]');
    return { modal: d.matches(':modal'), open: d.open, focus: document.activeElement?.getAttribute('aria-label'), svgCount: d.querySelectorAll('svg').length, transform: s?.style.transform, renderCount: window.renderCount, closedby: d.getAttribute('closedby') };
  })()`)
  report.opened = opened
  const geom = await evaluate(sessionId, `(() => {
    const s = document.querySelector('[data-genui-mermaid-surface]');
    const svg = s.querySelector('svg');
    const cs = getComputedStyle(svg);
    const r = svg.getBoundingClientRect();
    const sr = s.getBoundingClientRect();
    const st = document.querySelector('[data-genui-mermaid-stage]').getBoundingClientRect();
    return { svgAttrs: { width: svg.getAttribute('width'), height: svg.getAttribute('height'), style: svg.getAttribute('style') },
      svgRect: { w: r.width, h: r.height, x: r.x, y: r.y },
      surfaceRect: { w: sr.width, h: sr.height }, stageRect: { w: st.width, h: st.height },
      computed: { width: cs.width, height: cs.height, maxWidth: cs.maxWidth, maxHeight: cs.maxHeight, display: cs.display } };
  })()`)
  report.geom = geom
  check('原生模态打开，焦点在关闭按钮', opened.modal === true && opened.focus === '关闭图表预览', opened)
  check('弹层内是同一份 SVG，且没有重跑 Mermaid', opened.svgCount === 1 && opened.renderCount === 1, opened)
  check('closedby=any 渐进增强已声明', opened.closedby === 'any', opened)
  await shot(sessionId, 'after.png')

  await evaluate(sessionId, 'window.scrollTo(0, 1200)')
  const scrollBefore = await evaluate(sessionId, 'window.scrollY')
  const stage = await rectOf(sessionId, '[data-genui-mermaid-stage]')
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: stage.x, y: stage.y, deltaX: 0, deltaY: -240, button: 'none' }, sessionId)
  await new Promise(r => setTimeout(r, 250))
  const zoomed = await evaluate(sessionId, `(() => ({ transform: document.querySelector('[data-genui-mermaid-surface]').style.transform, renderCount: window.renderCount, scrollY: window.scrollY, scrollBefore: ${scrollBefore}, scrollable: document.documentElement.scrollHeight > innerHeight }))()`)
  report.zoomed = zoomed
  check('页面确实可滚，滚轮放大时不带动页面', zoomed.scrollable === true && zoomed.scrollBefore > 0 && zoomed.scrollY === zoomed.scrollBefore && /scale\(1\.25\)/.test(zoomed.transform), zoomed)
  const svgIsolation = await evaluate(sessionId, `(() => {
    const card = document.querySelector('[data-genui-mermaid] svg').getBoundingClientRect();
    const pane = document.querySelector('[data-genui-mermaid-surface] svg').getBoundingClientRect();
    return { cardWidth: Math.round(card.width), paneWidth: Math.round(pane.width), paneHeight: Math.round(pane.height) };
  })()`)
  report.svgIsolation = svgIsolation
  check('弹层 SVG 不受卡片尺寸规则影响', svgIsolation.paneHeight > 600 && svgIsolation.cardWidth <= 730, svgIsolation)
  await shot(sessionId, 'after-zoom.png')

  await mouse(sessionId, 'mousePressed', stage.x, stage.y, { buttons: 1 })
  await mouse(sessionId, 'mouseMoved', stage.x + 90, stage.y + 50, { buttons: 1 })
  await mouse(sessionId, 'mouseReleased', stage.x + 90, stage.y + 50)
  await new Promise(r => setTimeout(r, 150))
  const panned = await evaluate(sessionId, `document.querySelector('[data-genui-mermaid-surface]').style.transform`)
  report.panned = panned
  check('拖拽平移改变位移', /translate\(90px, 50px\)/.test(panned), panned)

  const reset = await rectOf(sessionId, 'button[aria-label="重置"]')
  await mouse(sessionId, 'mousePressed', reset.x, reset.y)
  await mouse(sessionId, 'mouseReleased', reset.x, reset.y)
  await new Promise(r => setTimeout(r, 150))
  const resetTransform = await evaluate(sessionId, `document.querySelector('[data-genui-mermaid-surface]').style.transform`)
  report.reset = resetTransform
  check('重置回到 1 倍零位移', /scale\(1\)/.test(resetTransform) && /translate\(0px, 0px\)/.test(resetTransform), resetTransform)

  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, sessionId)
  await new Promise(r => setTimeout(r, 300))
  const closed = await evaluate(sessionId, `(() => ({ open: !!document.querySelector('dialog')?.open, focus: document.activeElement?.getAttribute('aria-label'), renderCount: window.renderCount }))()`)
  report.closed = closed
  check('Esc 关闭且焦点还给放大按钮', closed.open === false && closed.focus === '放大图表', closed)
  check('全程只渲染一次 Mermaid', closed.renderCount === 1, closed)
  await shot(sessionId, 'after-close.png')

  // 宽图：Mermaid 会给 SVG 写 inline max-width: 3000px，弹层必须按舞台宽度
  // 收住它，否则初始视图会横向溢出、用户只能靠拖拽找内容。
  await evaluate(sessionId, 'window.mountWide()')
  await poll(sessionId, "document.querySelectorAll('button[aria-haspopup=\"dialog\"]').length === 2", 'wide rendered')
  await evaluate(sessionId, `(() => { const b = [...document.querySelectorAll('button[aria-haspopup="dialog"]')][1]; b.click(); })()`)
  await poll(sessionId, 'document.querySelectorAll("dialog[open]").length >= 1', 'wide dialog open')
  const wide = await evaluate(sessionId, `(() => {
    const d = [...document.querySelectorAll('dialog')].find(x => x.open);
    const svg = d.querySelector('svg');
    const r = svg.getBoundingClientRect();
    const st = d.querySelector('[data-genui-mermaid-stage]').getBoundingClientRect();
    return { svgWidth: Math.round(r.width), svgHeight: Math.round(r.height), stageWidth: Math.round(st.width), stageHeight: Math.round(st.height), renderCount: window.renderCount, scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
  })()`)
  report.wide = wide
  check('宽图初始按舞台收住，不横向溢出', wide.svgWidth <= wide.stageWidth + 2 && wide.svgHeight > 0 && wide.scrollWidth <= wide.clientWidth + 2, wide)
  check('两张图共渲染两次，弹层仍不重跑', wide.renderCount === 2, wide)
  await shot(sessionId, 'after-wide.png')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, sessionId)

  report.passed = true
  await writeFile(resolve(out, 'results.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  await writeFile(resolve(out, 'failure.txt'), String(error?.stack ?? error))
  throw error
} finally {
  socket?.close()
  chrome?.kill()
  await server?.close()
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
