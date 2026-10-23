/**
 * Real Chromium layout/input checks against the installed renderer and host CSS.
 * The minimum-host adapter uses the DOM fence; the current host passes a real conversation root.
 * Touch scrolling uses native Chromium input; no physical-device, mouse-drag, or lightbox-swipe claim.
 * checkGalleryBrowser accepts a rendered-root locator for real-session reuse.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkGalleryTouch } from './gallery-touch-checks.mjs'
import { createGalleryInputMode } from './gallery-input-mode.mjs'

const TITLE = 'Gallery browser regression'
const CAROUSEL = 'Gallery browser cards'
const FIXTURE = '[data-gallery-browser-smoke]'
const STEP_MS = 8000
const TOTAL_MS = 120000

// Fixed synthetic files only: no filesystem reads, redirects, remote images, or fetch interception.
const IMAGES = {
  '/wide.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240" viewBox="0 0 480 240"><rect width="480" height="240" fill="#2563eb"/><circle cx="120" cy="120" r="72" fill="#fbbf24"/><path d="M250 60h170v120H250z" fill="#fff"/></svg>',
  '/tall.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="300" viewBox="0 0 180 300"><rect width="180" height="300" fill="#047857"/><path d="M90 30 160 220H20z" fill="#fda4af"/><circle cx="90" cy="260" r="20" fill="#fff"/></svg>',
}

export function galleryImageResponse(path) {
  const body = Object.hasOwn(IMAGES, path) ? IMAGES[path] : 'Synthetic image not found'
  return { status: Object.hasOwn(IMAGES, path) ? 200 : 404,
    headers: { 'Content-Type': Object.hasOwn(IMAGES, path) ? 'image/svg+xml' : 'text/plain',
      'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body),
      'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' }, body }
}

export function createGallerySpec(baseURL) {
  const origin = new URL(baseURL)
  assert.equal(origin.protocol, 'http:')
  assert.equal(origin.hostname, '127.0.0.1', 'Gallery fixtures must remain on loopback')
  return { items: [
    { type: 'carousel', title: CAROUSEL, itemWidth: 280, gap: 12,
      items: ['One', 'Two', 'Three', 'Four'].map(name => ({ type: 'card', title: name,
        items: [{ type: 'text', content: `Synthetic card ${name}. Local browsing only.` },
          ...(name === 'One' ? [{ type: 'button', label: 'Choose One', action: 'gallery-choose-one' }] : [])] })) },
    { type: 'image-group', title: TITLE, items: [
      { src: new URL('/wide.svg', origin).href, alt: 'Gallery wide', caption: 'Synthetic landscape, 480 × 240' },
      { src: new URL('/tall.svg', origin).href, alt: 'Gallery tall', caption: 'Synthetic portrait, 180 × 300' },
      { src: new URL('/missing.svg', origin).href, alt: 'Gallery missing', caption: 'Deliberate local 404' },
    ] },
  ] }
}

// Each operation has a bound; an overall deadline also limits subsequent steps.
function budget() {
  const deadline = Date.now() + TOTAL_MS
  return () => {
    assert.ok(Date.now() < deadline, 'Gallery browser checks exceeded 120 seconds')
    return Math.max(1, Math.min(STEP_MS, deadline - Date.now()))
  }
}

async function bounded(promise, ms, label) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms)
    })])
  } finally { clearTimeout(timer) }
}

/** Reusable visual/input checks. Caller owns rendering and removing renderedRoot.
 * restoreColorScheme is the caller's previous Playwright override (null = system).
 * The smoke adapter runs before e2e.mjs changes media, hence restores null.
 */
export async function checkGalleryBrowser({ page, renderedRoot, artifactsDir,
  dismissCredentialsOverlay, restoreColorScheme = null, assertNoActions, report = {} }) {
  const remaining = budget()
  const read = (locator, fn, arg) => bounded(locator.evaluate(fn, arg), remaining(), 'gallery DOM read')
  const attribute = (locator, name) => locator.getAttribute(name, { timeout: remaining() })
  const key = value => bounded(page.keyboard.press(value), remaining(), 'trusted keyboard input')
  const dismiss = () => bounded(dismissCredentialsOverlay(), remaining(), 'dismiss credentials overlay')
  const poll = async (readValue, predicate, label) => {
    const deadline = Date.now() + remaining()
    let value
    do {
      value = await readValue()
      if (predicate(value)) return value
      await new Promise(resolve => setTimeout(resolve, 50))
    } while (Date.now() < deadline)
    assert.fail(`${label}: ${JSON.stringify(value)}`)
  }
  const originalViewport = page.viewportSize()
  report.identity = { hostSha: process.env.HOST_SHA ?? null, revision: process.env.GITHUB_SHA ?? null,
    browser: page.context().browser()?.version() ?? null, originalViewport,
    galleryTitle: TITLE, carouselTitle: CAROUSEL,
    images: [{ path: '/wide.svg', width: 480, height: 240 }, { path: '/tall.svg', width: 180, height: 300 }, { path: '/missing.svg', status: 404 }] }
  report.screenshots = []
  assert.ok(originalViewport, 'The smoke browser must have an explicit viewport')
  const originalRoot = await renderedRoot.elementHandle({ timeout: remaining() })
  assert.ok(originalRoot, 'Gallery root must already be rendered')
  const probeId = `gallery-background-${Date.now()}`
  const probe = page.locator(`[data-gallery-background="${probeId}"]`)
  const errors = []
  let inputMode
  report.visualScope = 'Installed renderer CSS, images, native modal, keyboard, pointer, wheel and native Chromium touch scrolling; not physical-device, mouse-drag, or lightbox-swipe validation'
  report.scenarios = []
  try {
    inputMode = await createGalleryInputMode(page)
    await bounded(page.evaluate(id => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.galleryBackground = id
      button.dataset.clicks = '0'
      button.textContent = 'BG'
      button.setAttribute('aria-label', 'Gallery inert background probe')
      // This synthetic control stays outside the centred modal even when the root scrolls.
      button.style.cssText = 'position:fixed;left:2px;top:2px;width:24px;height:24px;padding:0;z-index:2147483646'
      button.addEventListener('click', event => {
        button.dataset.clicks = String(Number(button.dataset.clicks) + 1)
        button.dataset.trusted = String(event.isTrusted)
      })
      document.body.append(button)
    }, probeId), remaining(), 'create gallery background probe')
    const carousel = renderedRoot.getByRole('region', { name: CAROUSEL, exact: true })
    const track = carousel.getByRole('group', { name: CAROUSEL, exact: true })
    const gallery = renderedRoot.getByRole('region', { name: TITLE, exact: true })
    const dialog = gallery.locator('dialog')
    // The two pinned hosts can expose either supported locale. Never mutate host locale state.
    const previous = carousel.getByRole('button', { name: /^(上一组卡片|Previous cards)$/u })
    const next = carousel.getByRole('button', { name: /^(下一组卡片|Next cards)$/u })
    const opener = gallery.getByRole('button', { name: /^(放大 Gallery wide|Enlarge Gallery wide)$/u })
    const close = dialog.getByRole('button', { name: /^(关闭图片查看器|Close image viewer)$/u })
    const imageNext = dialog.getByRole('button', { name: /^(下一张图片|Next image)$/u })
    const imagePrevious = dialog.getByRole('button', { name: /^(上一张图片|Previous image)$/u })
    const active = locator => read(locator, element => element === document.activeElement)
    const position = () => read(track, element => {
      const left = element.scrollLeft
      const maximum = element.scrollWidth - element.clientWidth
      const start = element.getBoundingClientRect().left
      const stops = [...element.children].map(slide => Math.min(maximum,
        Math.max(0, slide.getBoundingClientRect().left - start + left)))
      return { left, maximum, snapDistance: Math.min(...stops.map(stop => Math.abs(stop - left))) }
    })
    const settle = (predicate, label) => poll(position,
      value => predicate(value) && value.snapDistance <= 2, label)
    const decoded = async (image, size) => {
      await image.waitFor({ state: 'visible', timeout: remaining() })
      await poll(() => read(image, img => [img.complete, img.naturalWidth, img.naturalHeight]),
        value => value[0] && value[1] === size[0] && value[2] === size[1], 'Real image load/dimensions')
      // Invoke the browser decoder, not a fetch stub or synthetic load event.
      await bounded(image.evaluate(img => img.decode()), remaining(), 'image decode')
    }
    const states = [
      { name: 'wide-light', width: 1100, mode: 'light', interactions: true },
      { name: 'narrow-light', width: 420, mode: 'light', interactions: true, touch: true },
      { name: 'narrow-dark', width: 420, mode: 'dark', touch: true },
      { name: 'wide-dark', width: 1100, mode: 'dark' },
      { name: 'wide-light-return', width: 1100, mode: 'light' },
    ]
    for (const state of states) {
      const input = await inputMode.set(state.touch === true)
      await bounded(page.setViewportSize({ width: state.width, height: 960 }), remaining(), 'resize gallery viewport')
      await bounded(page.emulateMedia({ colorScheme: state.mode }), remaining(), 'switch host theme')
      await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark,
        state.mode === 'dark', { timeout: remaining() })
      await carousel.scrollIntoViewIfNeeded({ timeout: remaining() })
      await poll(() => read(renderedRoot, root => root.getAnimations({ subtree: true })
        .filter(animation => animation.playState === 'running').length), count => count === 0, 'Gallery entrance animation')
      assert.ok(await bounded(originalRoot.evaluate(element => element.isConnected), remaining(), 'mounted root identity'),
        'Viewport/theme changes must not remount the gallery')
      const geometry = await read(renderedRoot, root => {
        const section = [...root.querySelectorAll('section')].find(el => el.querySelector('h3')?.textContent === 'Gallery browser cards')
        const track = section.querySelector('[tabindex="0"]')
        const bounds = root.getBoundingClientRect()
        const style = getComputedStyle(track)
        return { root: { width: bounds.width, left: bounds.left, right: bounds.right }, viewport: innerWidth,
          rootScrollWidth: root.scrollWidth, rootClientWidth: root.clientWidth,
          trackWidth: track.clientWidth, scrollWidth: track.scrollWidth,
          overflowX: style.overflowX, snapType: style.scrollSnapType,
          slides: [...track.children].map(el => ({ width: el.getBoundingClientRect().width,
            snapAlign: getComputedStyle(el).scrollSnapAlign })) }
      })
      assert.ok(geometry.root.width > 100 && geometry.root.left >= -1 && geometry.root.right <= geometry.viewport + 1)
      assert.ok(geometry.rootScrollWidth <= geometry.rootClientWidth + 1, 'Carousel overflow stays inside its own track')
      assert.ok(geometry.scrollWidth > geometry.trackWidth + 20, 'Fixture must genuinely overflow at both widths')
      assert.equal(geometry.overflowX, 'auto')
      assert.equal(geometry.snapType, 'x mandatory')
      for (const slide of geometry.slides) {
        assert.ok(slide.width > 100 && slide.width <= geometry.trackWidth + 1)
        assert.equal(slide.snapAlign, 'start')
      }
      if (state.touch) {
        assert.equal(await next.isVisible(), false, 'Touch devices hide mouse navigation')
        assert.equal(await previous.isVisible(), false, 'Touch devices hide mouse navigation')
      }
      if (state.interactions) {
        await dismiss()
        // Initial keyboard setup only. Never reset focus after an edge control disappears.
        await track.focus({ timeout: remaining() })
        assert.ok(await active(track), 'Initial keyboard setup focuses the track')
        await key('Home')
        await settle(value => value.left <= 1, 'Home reaches first edge')
        if (!state.touch) {
          assert.equal(await previous.count(), 0, 'Previous is absent at the first edge')
          await next.click({ timeout: remaining() })
          const moved = await settle(value => value.left > 2, 'Trusted next click moves to a snap point')
          if (moved.left >= moved.maximum - 1) {
            assert.equal(await next.count(), 0)
            assert.ok(await active(track), 'Removed Next hands focus to the track')
          } else {
            assert.ok(await active(next))
            await key('Tab')
            assert.ok(await active(track), 'Tab after remaining Next reaches track')
          }
        }
        await key('End')
        await settle(value => Math.abs(value.left - value.maximum) <= 2, 'End reaches the last edge')
        assert.equal(await next.count(), 0, 'Next is absent at the last edge')
        assert.ok(await active(track), 'Keyboard edge movement retains track focus')
        if (!state.touch) {
          await key('Shift+Tab')
          assert.ok(await active(previous), 'Previous is keyboard reachable from track at the last edge')
          for (let step = 0; step < 8 && await previous.count(); step++) {
            const before = await position()
            await key('Enter')
            await settle(value => value.left < before.left - 2, 'Keyboard Previous moves left and snaps')
          }
          assert.equal(await previous.count(), 0, 'Previous disappears on reaching the first edge')
          assert.ok(await active(track), 'Removed Previous hands focus to the track')
        } else {
          await key('Home')
          await settle(value => value.left <= 1, 'Touch-mode keyboard Home returns to first edge')
        }
        await dismiss()
        await track.hover({ timeout: remaining() })
        await bounded(page.mouse.wheel(370, 0), remaining(), 'native wheel input')
        await settle(value => value.left > 2, 'Native horizontal wheel scrolls and snaps')
        assert.ok(await active(track), 'Wheel navigation does not steal keyboard focus')
        await key('Home')
        await settle(value => value.left <= 1, 'Return track to start after wheel')
      }
      if (state.name === 'narrow-light') {
        await dismiss()
        report.touch = await checkGalleryTouch({ page, track, assertNoActions, timeout: remaining() })
        await track.screenshot({ path: join(artifactsDir, 'gallery-narrow-touch.png'), timeout: remaining() })
        report.screenshots.push({ file: 'gallery-narrow-touch.png', state: state.name, target: 'carousel after native touch scroll' })
      }
      await gallery.scrollIntoViewIfNeeded({ timeout: remaining() })
      await decoded(gallery.locator('img[alt="Gallery wide"]').first(), [480, 240])
      await decoded(gallery.locator('img[alt="Gallery tall"]').first(), [180, 300])
      const missing = gallery.getByRole('button', { name: /^(放大 Gallery missing|Enlarge Gallery missing)$/u })
      await missing.getByText(/^(图片无法加载|Image failed to load)$/u).waitFor({ state: 'visible', timeout: remaining() })
      assert.equal(await missing.locator('img').count(), 0, '404 becomes a real image-error placeholder')
      const images = await read(gallery, section => [...section.querySelectorAll('figure')]
        .filter(figure => !figure.closest('dialog')).map(figure => {
          const box = figure.getBoundingClientRect()
          const image = figure.querySelector('img')
          return { ratio: Number(figure.style.getPropertyValue('--gallery-image-ratio')),
            width: box.width, right: box.right, left: box.left,
            natural: image && [image.naturalWidth, image.naturalHeight],
            fit: image && getComputedStyle(image).objectFit }
        }))
      assert.deepEqual(images.slice(0, 2).map(image => image.ratio), [2, 0.6], 'Decoded ratios drive thumbnail layout')
      for (const image of images) assert.ok(image.width > 0 && image.left >= -1 && image.right <= state.width + 1)
      for (const image of images.slice(0, 2)) assert.equal(image.fit, 'contain')
      const theme = await read(gallery, section => {
        const probe = document.createElement('span')
        probe.style.cssText = 'background:var(--dsl-g-surface);color:var(--dsw-alias-label-primary)'
        section.append(probe)
        const expected = { background: getComputedStyle(probe).backgroundColor, color: getComputedStyle(probe).color }
        probe.remove()
        const thumb = section.querySelector('button[aria-haspopup="dialog"]')
        return { expected, background: getComputedStyle(thumb).backgroundColor, color: getComputedStyle(section).color,
          hostToken: getComputedStyle(section).getPropertyValue('--dsw-alias-label-primary').trim() }
      })
      assert.ok(theme.hostToken, 'Official host theme tokens must be present')
      assert.equal(theme.background, theme.expected.background)
      assert.equal(theme.color, theme.expected.color)
      if (state.interactions) {
        await dismiss()
        await probe.click({ timeout: remaining() })
        assert.equal(await attribute(probe, 'data-trusted'), 'true', 'Background probe accepts trusted input before modal')
      }
      const clicks = await attribute(probe, 'data-clicks')
      await dismiss()
      await opener.click({ timeout: remaining() })
      await poll(() => read(dialog, el => el.matches(':modal')), Boolean, 'Native modal top layer')
      assert.ok(await active(close), 'Opening the modal focuses Close')
      await decoded(dialog.locator('img'), [480, 240])
      const modal = await read(dialog, el => {
        const box = el.getBoundingClientRect()
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
          viewportWidth: innerWidth, viewportHeight: innerHeight,
          background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color,
          fit: getComputedStyle(el.querySelector('img')).objectFit }
      })
      assert.ok(modal.left >= 0 && modal.top >= 0 && modal.right <= modal.viewportWidth && modal.bottom <= modal.viewportHeight,
        `Modal fits ${state.name}: ${JSON.stringify(modal)}`)
      assert.equal(modal.background, theme.expected.background)
      assert.equal(modal.color, theme.expected.color)
      assert.equal(modal.fit, 'contain')
      if (state.interactions) {
        await key('Shift+Tab')
        assert.ok(await active(imageNext), 'Shift+Tab wraps to last modal control')
        await key('Tab')
        assert.ok(await active(close), 'Tab wraps back to Close')
        await key('Tab')
        assert.ok(await active(imagePrevious), 'Tab reaches previous image control')
        await key('Tab')
        assert.ok(await active(imageNext), 'Tab reaches next image control')
        await key('Tab')
        assert.ok(await active(close), 'Full Tab cycle remains within modal')
        const box = await probe.boundingBox({ timeout: remaining() })
        assert.ok(box && (box.x + box.width < modal.left || box.y + box.height < modal.top), 'Probe must lie outside dialog bounds')
        await bounded(page.mouse.click(box.x + box.width / 2, box.y + box.height / 2), remaining(), 'trusted background click')
        assert.equal(await attribute(probe, 'data-clicks'), clicks, 'Native modal blocks physical background click')
        assert.ok(await read(dialog, el => el.matches(':modal')), 'Background click must not dismiss viewer')
        await imageNext.click({ timeout: remaining() })
        await decoded(dialog.locator('img'), [180, 300])
        await key('End')
        await dialog.getByRole('alert').getByText(/^(图片无法加载|Image failed to load)$/u)
          .waitFor({ state: 'visible', timeout: remaining() })
        assert.equal(await attribute(imageNext, 'aria-disabled'), 'true')
        await key('Home')
        await decoded(dialog.locator('img'), [480, 240])
        assert.equal(await attribute(imagePrevious, 'aria-disabled'), 'true')
        await key('ArrowRight')
        await decoded(dialog.locator('img'), [180, 300])
        await imagePrevious.click({ timeout: remaining() })
        await decoded(dialog.locator('img'), [480, 240])
      }
      if (state.name === 'narrow-dark') {
        await dialog.screenshot({ path: join(artifactsDir, 'gallery-narrow-dark-modal.png'), timeout: remaining() })
        report.screenshots.push({ file: 'gallery-narrow-dark-modal.png', state: state.name,
          target: 'native modal', focused: await close.getAttribute('aria-label', { timeout: remaining() }),
          nativeModal: await read(dialog, el => el.matches(':modal')), closeFocused: await active(close) })
      }
      await key('Escape')
      await poll(() => read(dialog, el => !el.open && !el.matches(':modal')), Boolean, 'Escape closes native modal')
      assert.ok(await active(opener), 'Escape restores focus to the thumbnail opener')
      if (state.interactions) {
        await probe.click({ timeout: remaining() })
        assert.equal(Number(await attribute(probe, 'data-clicks')), Number(clicks) + 1, 'Background is interactive after close')
        await opener.click({ timeout: remaining() })
        await close.click({ timeout: remaining() })
        assert.ok(await active(opener), 'Trusted Close click also restores the opener')
      }
      if (state.name === 'wide-light' || state.name === 'narrow-dark') {
        await renderedRoot.screenshot({ path: join(artifactsDir, `gallery-${state.name}.png`), timeout: remaining() })
        report.screenshots.push({ file: `gallery-${state.name}.png`, state: state.name, target: 'rendered gallery root' })
      }
      report.scenarios.push({ input, name: state.name, geometry, images, theme, modal,
        interactions: Boolean(state.interactions), sameMountedRoot: true,
        focus: { closeOnOpen: true, openerAfterEscape: true, tabCycleTrapped: state.interactions ? true : null,
          backgroundClickBlocked: state.interactions ? true : null, openerAfterCloseClick: state.interactions ? true : null } })
    }
    assert.notEqual(report.scenarios[0].theme.background, report.scenarios[3].theme.background, 'Host light/dark surfaces genuinely differ')
    assert.equal(report.scenarios[0].theme.background, report.scenarios[4].theme.background, 'Light theme round trip restores original surface')
    report.passed = true
  } catch (error) {
    report.passed = false
    report.error = String(error)
    errors.push(error)
    await page.screenshot({ path: join(artifactsDir, 'gallery-failure.png'), timeout: STEP_MS }).catch(() => {})
  } finally {
    for (const [label, cleanup] of [
      ['restore input capability', () => inputMode?.restore()],
      ['close gallery viewer', async () => {
        const dialog = renderedRoot.locator('dialog')
        if (await dialog.count() === 1 && await dialog.evaluate(el => el.open)) await page.keyboard.press('Escape')
      }],
      ['remove background probe', () => probe.evaluate(el => el.remove())],
      ['restore viewport', () => page.setViewportSize(originalViewport)],
      ['restore media', () => page.emulateMedia({ colorScheme: restoreColorScheme })],
      ['dispose root handle', () => originalRoot.dispose()],
    ]) {
      try { await bounded(cleanup(), STEP_MS, label) } catch (error) { errors.push(error) }
    }
    report.cleanupErrors = errors.slice(report.error ? 1 : 0).map(String)
    if (errors.length) report.passed = false
    await writeFile(join(artifactsDir, 'gallery-browser-results.json'), `${JSON.stringify(report, null, 2)}\n`)
  }
  if (errors.length) throw new AggregateError(errors, 'Gallery browser checks failed')
  return report
}

/** Local asset lifecycle, also reusable by a real conversation/replay fixture. */
export async function startGalleryImageServer() {
  const requests = []
  const server = createServer((req, res) => {
    const response = galleryImageResponse(req.url)
    requests.push({ path: req.url, status: response.status })
    res.writeHead(response.status, response.headers)
    res.end(response.body)
  })
  const close = () => bounded(new Promise(resolve => {
    server.close(resolve)
    server.closeAllConnections()
  }), STEP_MS, 'close synthetic gallery image server')
  try {
    await bounded(new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    }), STEP_MS, 'start synthetic gallery image server')
    return { origin: `http://127.0.0.1:${server.address().port}`, requests, close }
  } catch (error) { await close(); throw error }
}

/** Adapter for the existing no-key smoke. No app state or conversation is fabricated. */
export async function runGalleryBrowserChecks({ page, artifactsDir, dismissCredentialsOverlay, log = console.log }) {
  let assets
  const report = { fixture: 'DOM fence; no conversation or host action routing claim' }
  let failure
  try {
    assets = await startGalleryImageServer()
    report.assetRequests = assets.requests
    const spec = createGallerySpec(assets.origin)
    await bounded(page.evaluate(spec => {
      if (document.querySelector('[data-gallery-browser-smoke]')) throw new Error('Gallery fixture already exists')
      const fixture = document.createElement('div')
      fixture.setAttribute('data-gallery-browser-smoke', '')
      fixture.style.cssText = 'width:800px;max-width:calc(100vw - 32px);margin:16px'
      const host = document.createElement('div')
      host.className = 'md-code-block'
      const label = document.createElement('div')
      label.textContent = 'dsh-ui'
      const pre = document.createElement('pre')
      pre.textContent = JSON.stringify(spec)
      host.append(label, pre)
      fixture.append(host)
      document.body.prepend(fixture)
    }, spec), STEP_MS, 'mount gallery DOM fence')
    const renderedRoot = page.locator(`${FIXTURE} [data-genui]`).first()
    await renderedRoot.waitFor({ state: 'visible', timeout: STEP_MS })
    await checkGalleryBrowser({ page, renderedRoot, artifactsDir, dismissCredentialsOverlay, report })
    for (const path of ['/wide.svg', '/tall.svg', '/missing.svg']) {
      assert.ok(assets.requests.some(request => request.path === path), `Browser must request ${path} from the real local server`)
    }
    log('Gallery browser layout, decoded images, native modal, focus, keyboard, and wheel checks passed (DOM fixture; no session routing claim)')
  } catch (error) {
    failure = error
    report.passed = false
    report.error ??= String(error)
  } finally {
    // Only remove this fixture and close this server. Do not touch host state/browser lifecycle.
    try {
      await bounded(page.locator(FIXTURE).evaluateAll(elements => elements.forEach(el => el.remove())), STEP_MS, 'remove gallery fixture')
    } catch (error) { failure ??= error; report.cleanupErrors = [...report.cleanupErrors ?? [], String(error)] }
    try { await assets?.close() } catch (error) { failure ??= error; report.cleanupErrors = [...report.cleanupErrors ?? [], String(error)] }
    if (failure) report.passed = false
    await writeFile(join(artifactsDir, 'gallery-browser-results.json'), `${JSON.stringify(report, null, 2)}\n`)
  }
  if (failure) throw failure
  return report
}
