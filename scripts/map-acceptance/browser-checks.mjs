/** Actual UI and composited-pixel oracles; no Map instance or state injection. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MAP_TITLE, safeMapError, measureRoutePixels } from './contract.mjs'
export const controls = {
  reset: /^(Reset view|重置视图)$/, clear: /^(Clear selection|清除选择)$/,
  zoomIn: /^(Zoom in|放大)$/, zoomOut: /^(Zoom out|缩小)$/,
}
export const mapSection = root => root.getByRole('region', { name: MAP_TITLE, exact: true })
export const listChoice = (section, name) => section.locator('ul').first().getByRole('button', { name: new RegExp(name) })
export const marker = (section, name) => section.locator('.genui-map-marker').filter({ hasText: '●' }).and(section.getByRole('button', { name: new RegExp(name) }))
export async function until(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  let last
  do {
    try { const value = await check(); if (value) return value } catch (error) { last = error }
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (Date.now() < deadline)
  throw new Error(`${label} did not settle: ${last ? safeMapError(last) : 'predicate remained false'}`)
}
export function watchMapPage(page, allowedOrigins, { allowFile = false } = {}) {
  const evidence = { errors: [], warnings: [], externalRequests: [], workerUrls: [], workerCloses: 0, requests: [], webSockets: [] }
  page.on('pageerror', error => evidence.errors.push(safeMapError(error)))
  page.on('console', message => {
    if (message.type() === 'warning' || message.type() === 'error') evidence.warnings.push(safeMapError(message.text()))
  })
  page.on('worker', worker => {
    evidence.workerUrls.push(worker.url().startsWith('blob:') ? 'blob:' : new URL(worker.url()).protocol)
    worker.on('close', () => { evidence.workerCloses++ })
  })
  page.on('websocket', socket => {
    const url = new URL(socket.url())
    const origin = url.origin.replace(/^ws/u, 'http')
    const safe = `${origin}${url.pathname}`
    evidence.webSockets.push(safe)
    if (!allowedOrigins.includes(origin)) evidence.externalRequests.push(safe)
  })
  page.on('request', request => {
    const url = new URL(request.url())
    if (['blob:', 'data:'].includes(url.protocol) || (allowFile && url.protocol === 'file:')) return
    const safe = `${url.origin}${url.pathname}` // Never persist the host bootstrap token/query.
    evidence.requests.push(safe)
    if (!allowedOrigins.includes(url.origin)) evidence.externalRequests.push(safe)
  })
  return evidence
}
export async function installCspObserver(page) {
  const observe = () => {
    if (Array.isArray(window.__mapCspViolations)) return
    window.__mapCspViolations = []
    document.addEventListener('securitypolicyviolation', event => {
      window.__mapCspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI.startsWith('blob') ? 'blob:' : event.blockedURI.split('?')[0] })
    })
  }
  await page.addInitScript(observe)
  await page.evaluate(observe) // Current host page as well as subsequent reloads.
}
export async function webglEvidence(section) {
  const canvas = section.locator('canvas.maplibregl-canvas')
  await canvas.waitFor({ state: 'visible', timeout: 20000 })
  return canvas.evaluate(element => {
    const gl = element.getContext('webgl2') || element.getContext('webgl')
    if (!gl || gl.isContextLost()) throw new Error('No live WebGL context')
    const extension = gl.getExtension('WEBGL_debug_renderer_info')
    return { version: gl.getParameter(gl.VERSION), renderer: gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
      width: element.width, height: element.height, contextLost: gl.isContextLost() }
  })
}
export async function assertRoutePixels(page, section, path) {
  const canvas = section.locator('canvas.maplibregl-canvas')
  await canvas.scrollIntoViewIfNeeded()
  let observation
  await until(async () => {
    // Fixed camera: endpoints are ~114px from center. This central 80x32 crop
    // excludes both same-blue DOM markers, attribution, and container borders.
    const box = await canvas.boundingBox()
    assert.ok(box && box.width >= 240 && box.height >= 200, 'Map canvas must have usable dimensions')
    const png = await page.screenshot({ clip: { x: box.x + box.width / 2 - 40, y: box.y + box.height / 2 - 16, width: 80, height: 32 }, scale: 'css' })
    const pixels = await page.evaluate(async bytes => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
      const surface = new OffscreenCanvas(image.width, image.height)
      const ctx = surface.getContext('2d'); ctx.drawImage(image, 0, 0)
      const { data, width, height } = ctx.getImageData(0, 0, image.width, image.height)
      image.close()
      return { data: Array.from(data), width, height }
    }, [...png])
    observation = measureRoutePixels(pixels)
    if (observation.pass) {
      await writeFile(path, png)
      return true
    }
    return false
  }, 'Worker-rendered route pixels')
  return observation
}
export async function checkMapUi({ page, root, out, prefix, assertNoActions, dismiss = async () => {} }) {
  const section = mapSection(root)
  const noActions = assertNoActions ?? (async () => {})
  await section.getByRole('button', { name: controls.reset }).waitFor({ state: 'visible', timeout: 20000 })
  await until(() => section.getByRole('button', { name: controls.reset }).isEnabled(), 'Map load/WebGL readiness')
  await dismiss()
  await section.getByRole('button', { name: controls.reset }).click()
  const evidence = { webgl: await webglEvidence(section), route: await assertRoutePixels(page, section, join(out, `${prefix}-route.png`)) }
  const west = listChoice(section, 'Synthetic West'), east = listChoice(section, 'Synthetic East')
  await west.focus(); await page.keyboard.press('Enter')
  await until(async () => await west.getAttribute('aria-pressed') === 'true' && await marker(section, 'Synthetic West').getAttribute('aria-pressed') === 'true', 'Keyboard list → marker selection')
  await noActions()
  await marker(section, 'Synthetic East').click()
  await until(async () => await east.getAttribute('aria-pressed') === 'true' && await west.getAttribute('aria-pressed') === 'false', 'Marker → list selection')
  await noActions()
  const separation = async () => {
    const a = await marker(section, 'Synthetic West').boundingBox(), b = await marker(section, 'Synthetic East').boundingBox()
    assert.ok(a && b)
    return Math.abs((a.x + a.width / 2) - (b.x + b.width / 2))
  }
  const beforeZoom = await separation()
  await section.getByRole('button', { name: controls.zoomIn }).click()
  await until(async () => await separation() > beforeZoom * 1.8, 'Zoom in changes real projected marker spacing')
  await section.getByRole('button', { name: controls.zoomOut }).click()
  await until(async () => Math.abs(await separation() - beforeZoom) < 2, 'Zoom out restores projected spacing')
  await section.getByRole('button', { name: controls.reset }).click()
  const beforeWheel = await separation()
  await section.locator('canvas.maplibregl-canvas').hover()
  await page.mouse.wheel(0, 160)
  await page.waitForTimeout(350)
  assert.ok(Math.abs(await separation() - beforeWheel) < 2, 'Ordinary wheel must not zoom the chat map')
  evidence.camera = { beforeZoom, resetSpacing: beforeWheel, wheelZoomDisabled: true }
  assert.equal(await east.getAttribute('aria-pressed'), 'true', 'View controls must preserve selection')
  await noActions()
  await section.getByRole('button', { name: controls.clear }).click()
  assert.equal(await east.getAttribute('aria-pressed'), 'false')
  assert.equal(await marker(section, 'Synthetic East').getAttribute('aria-pressed'), 'false')
  await east.focus(); await page.keyboard.press('Space')
  await until(async () => await east.getAttribute('aria-pressed') === 'true', 'Space selects East')
  await noActions()
  await section.getByRole('button', { name: controls.reset }).click()
  await section.screenshot({ path: join(out, `${prefix}-selected.png`) })
  evidence.ui = { keyboardListToMarker: true, markerToList: true, controlsPreserveSelection: true, noImplicitActionAudit: assertNoActions ? 'passed' : 'not-covered', clear: true, finalSelection: 'east' }
  return evidence
}
