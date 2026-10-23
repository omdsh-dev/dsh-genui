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
import { galleryErrorDetails, readGalleryInputCapabilities } from './gallery-input-mode.mjs'

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

/** One read-only DOM snapshot, including CSS-hidden edge buttons for this track only. */
export function readGalleryCarouselPosition(element) {
  const left = element.scrollLeft
  const maximum = Math.max(0, element.scrollWidth - element.clientWidth)
  const start = element.getBoundingClientRect().left
  const stops = [...element.children].map(slide => Math.min(maximum,
    Math.max(0, slide.getBoundingClientRect().left - start + left)))
  // DOM presence, not accessible visibility: touch CSS hides these controls.
  const controls = [...element.parentElement.querySelectorAll('button[aria-controls]')]
    .filter(button => button.getAttribute('aria-controls') === element.id)
  const previousCount = controls.filter(button => /^(上一组卡片|Previous cards)$/u.test(button.getAttribute('aria-label') ?? '')).length
  const nextCount = controls.filter(button => /^(下一组卡片|Next cards)$/u.test(button.getAttribute('aria-label') ?? '')).length
  return { left, maximum, previousCount, nextCount, snapDistance: Math.min(...stops.map(stop => Math.abs(stop - left))) }
}

/** Wait for browser scrolling AND React's rendered edge controls, never repair focus. */
export async function settleGalleryCarousel(readPosition, predicate, label, timeout = STEP_MS) {
  assert.ok(timeout > 0 && timeout <= STEP_MS, 'Carousel settlement stays within the eight-second step budget')
  const deadline = Date.now() + timeout
  let actual
  let expected
  let lastReady = null
  do {
    actual = await bounded(readPosition(), Math.max(1, deadline - Date.now()),
      `${label}: read scroll/snap/edge state; last=${JSON.stringify(actual ?? null)}`)
    expected = { previousCount: actual.maximum > 1 && actual.left > 1 ? 1 : 0,
      nextCount: actual.maximum > 1 && actual.left < actual.maximum - 1 ? 1 : 0 }
    const ready = predicate(actual) && actual.snapDistance <= 2
      && actual.previousCount === expected.previousCount && actual.nextCount === expected.nextCount
    if (ready && lastReady && ['left', 'maximum', 'snapDistance', 'previousCount', 'nextCount']
      .every(field => actual[field] === lastReady[field])) return actual
    lastReady = ready ? { ...actual } : null
    // Condition polling only. Elapsed time alone never makes a state acceptable.
    await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))))
  } while (Date.now() < deadline)
  assert.fail(`${label}: scroll/snap and edge DOM did not settle; actual=${JSON.stringify(actual)}; expected=${JSON.stringify(expected)}; matchingReadySamples=${lastReady ? 1 : 0}`)
}

/** Read-only modal geometry/hit targets; never reposition, focus, or click a control. */
export function readGalleryDialogControls(dialog) {
  const document = dialog.ownerDocument
  const view = document.defaultView
  return [...dialog.querySelectorAll('button')].map(button => {
    const box = button.getBoundingClientRect()
    const style = view.getComputedStyle(button)
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return { label: button.getAttribute('aria-label'), position: style.position,
      display: style.display, visibility: style.visibility,
      left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height,
      inViewport: box.left >= 0 && box.top >= 0 && box.right <= view.innerWidth && box.bottom <= view.innerHeight,
      ownsCenterHit: hit !== null && button.contains(hit) }
  })
}

export function assertGalleryDialogControls(controls, label) {
  assert.equal(controls.length, 3, `${label}: Close/Previous/Next must all be present`)
  for (const control of controls) {
    const detail = `${label}: ${JSON.stringify(control)}`
    assert.ok(['left', 'top', 'right', 'bottom', 'width', 'height'].every(key => Number.isFinite(control[key])),
      `Modal control geometry is finite: ${detail}`)
    assert.ok(control.width > 0 && control.height > 0 && control.inViewport,
      `Modal control must have a visible viewport box: ${detail}`)
    assert.ok(control.position !== 'absolute' && control.position !== 'fixed',
      `Modal controls stay in normal flow, not carousel overlay positioning: ${detail}`)
    assert.ok(control.display !== 'none' && control.visibility === 'visible',
      `Modal controls remain visible for this input profile: ${detail}`)
    assert.ok(control.ownsCenterHit, `Modal control must own its center hit target: ${detail}`)
  }
  for (let index = 0; index < controls.length; index++) {
    for (const other of controls.slice(index + 1)) {
      const current = controls[index]
      const overlap = Math.min(current.right, other.right) > Math.max(current.left, other.left)
        && Math.min(current.bottom, other.bottom) > Math.max(current.top, other.top)
      assert.ok(!overlap, `${label}: Modal controls must not overlap: ${JSON.stringify([current, other])}`)
    }
  }
}

/** Reusable visual/input checks. Caller owns rendering and removing renderedRoot.
 * restoreColorScheme is the caller's previous Playwright override (null = system).
 * The smoke adapter runs before e2e.mjs changes media, hence restores null.
 */
export async function checkGalleryBrowser({ page, renderedRoot, artifactsDir,
  dismissCredentialsOverlay, restoreColorScheme = null, assertNoActions, inputProfile = 'desktop',
  artifactPrefix = `gallery-${inputProfile}`, report = {} }) {
  assert.ok(inputProfile === 'desktop' || inputProfile === 'touch')
  assert.equal(artifactPrefix, `gallery-${inputProfile}`)
  const touchContext = inputProfile === 'touch'
  const artifact = name => `${artifactPrefix}-${name}`
  report.inputChecks ??= []
  const checkInput = phase => readGalleryInputCapabilities(page, inputProfile, { phase, observations: report.inputChecks })
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
  report.context = { inputProfile, hasTouch: touchContext, isMobile: false, rootContinuity: 'within this context only' }
  report.visualScope = touchContext
    ? 'Fixed touch-capable desktop Chromium: CSS, images, modal, keyboard, wheel and native touch scrolling; no physical-device, mouse-drag, or lightbox-swipe claim'
    : 'Fixed desktop Chromium: CSS, images, native modal, keyboard, mouse controls and wheel at wide and narrow viewports'
  report.scenarios = []
  try {
    const initialInput = await checkInput('before-first-scenario')
    const screenshot = async file => {
      const options = { path: join(artifactsDir, artifact(file)), timeout: remaining() }
      // Playwright 1.61.1 captureBeyondViewport can alter touch capability.
      // Neither fixed context uses locator/full-page captures or their capability-restoration path.
      await page.screenshot({ ...options, fullPage: false })
      assert.deepEqual(await checkInput(`after-screenshot:${file}`), initialInput)
    }
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
    const position = () => read(track, readGalleryCarouselPosition)
    const settle = (predicate, label) => settleGalleryCarousel(position, predicate, label, remaining())
    const decoded = async (image, size) => {
      await image.waitFor({ state: 'visible', timeout: remaining() })
      await poll(() => read(image, img => [img.complete, img.naturalWidth, img.naturalHeight]),
        value => value[0] && value[1] === size[0] && value[2] === size[1], 'Real image load/dimensions')
      // Invoke the browser decoder, not a fetch stub or synthetic load event.
      await bounded(image.evaluate(img => img.decode()), remaining(), 'image decode')
    }
    const states = [
      { name: 'wide-light', width: 1100, mode: 'light', interactions: true },
      { name: 'narrow-light', width: 420, mode: 'light', interactions: true },
      { name: 'narrow-dark', width: 420, mode: 'dark' },
      { name: 'wide-dark', width: 1100, mode: 'dark' },
      { name: 'wide-light-return', width: 1100, mode: 'light' },
    ]
    for (const state of states) {
      const inputBefore = await checkInput(`before:${state.name}`)
      assert.deepEqual(inputBefore, initialInput)
      await bounded(page.setViewportSize({ width: state.width, height: 960 }), remaining(), 'resize gallery viewport')
      await bounded(page.emulateMedia({ colorScheme: state.mode }), remaining(), 'switch host theme')
      await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark,
        state.mode === 'dark', { timeout: remaining() })
      const input = await checkInput(`after-viewport-theme:${state.name}`)
      assert.deepEqual(input, initialInput)
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
      if (touchContext) {
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
        if (!touchContext) {
          assert.equal(await previous.count(), 0, 'Previous is absent at the first edge')
          await next.click({ timeout: remaining() })
          const moved = await settle(value => value.left > 2, 'Trusted next click moves to a snap point')
          if (moved.left >= moved.maximum - 1) {
            assert.equal(await next.count(), 0, 'Next disappears at the last edge after trusted Next click')
            assert.ok(await active(track), 'Removed Next hands focus to the track')
          } else {
            assert.ok(await active(next), 'Remaining Next keeps focus after trusted Next click')
            await key('Tab')
            assert.ok(await active(track), 'Tab after remaining Next reaches track')
          }
        }
        await key('End')
        await settle(value => value.left >= value.maximum - 1, 'End reaches the last edge (within the one-pixel threshold)')
        assert.equal(await next.count(), 0, 'Next is absent at the last edge')
        assert.ok(await active(track), 'Keyboard edge movement retains track focus')
        if (!touchContext) {
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
      if (touchContext && state.name === 'narrow-light') {
        await dismiss()
        report.touch = await checkGalleryTouch({ page, track, assertNoActions, timeout: remaining() })
        assert.deepEqual(await checkInput('after-native-touch'), initialInput)
        await screenshot('narrow-gesture.png')
        report.screenshots.push({ file: artifact('narrow-gesture.png'), state: state.name, target: 'viewport after native touch scroll' })
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
      const modalControls = await read(dialog, readGalleryDialogControls)
      report.modalControlChecks ??= []
      report.modalControlChecks.push({ state: state.name, controls: modalControls })
      assertGalleryDialogControls(modalControls, `${inputProfile}/${state.name}`)
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
        await screenshot('narrow-dark-modal.png')
        report.screenshots.push({ file: artifact('narrow-dark-modal.png'), state: state.name,
          target: 'viewport with native modal', focused: await close.getAttribute('aria-label', { timeout: remaining() }),
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
        await screenshot(`${state.name}.png`)
        report.screenshots.push({ file: artifact(`${state.name}.png`), state: state.name,
          target: 'viewport with rendered gallery' })
      }
      const inputAfter = await checkInput(`after:${state.name}`)
      assert.deepEqual(inputAfter, initialInput)
      report.scenarios.push({ inputBefore, input, inputAfter, name: state.name, geometry, images, theme, modal, modalControls,
        interactions: Boolean(state.interactions), sameMountedRoot: true,
        focus: { closeOnOpen: true, openerAfterEscape: true, tabCycleTrapped: state.interactions ? true : null,
          backgroundClickBlocked: state.interactions ? true : null, openerAfterCloseClick: state.interactions ? true : null } })
    }
    assert.notEqual(report.scenarios[0].theme.background, report.scenarios[3].theme.background, 'Host light/dark surfaces genuinely differ')
    assert.equal(report.scenarios[0].theme.background, report.scenarios[4].theme.background, 'Light theme round trip restores original surface')
    report.passed = true
  } catch (error) {
    report.passed = false
    report.errorDetails = galleryErrorDetails(error)
    report.error = report.errorDetails.message
    errors.push(error)
    await page.screenshot({ path: join(artifactsDir, artifact('failure.png')), fullPage: false, timeout: STEP_MS }).catch(() => {})
  } finally {
    for (const [label, cleanup] of [
      ['close gallery viewer', async () => {
        const dialog = renderedRoot.locator('dialog')
        if (await dialog.count() === 1 && await dialog.evaluate(el => el.open)) await page.keyboard.press('Escape')
      }],
      ['remove background probe', () => probe.evaluate(el => el.remove())],
      ['restore viewport', () => page.setViewportSize(originalViewport)],
      ['restore media', () => page.emulateMedia({ colorScheme: restoreColorScheme })],
      ['verify unchanged fixed input', async () => { report.finalInput = await checkInput('after-cleanup') }],
      ['dispose root handle', () => originalRoot.dispose()],
    ]) {
      try { await bounded(cleanup(), STEP_MS, label) } catch (error) { errors.push(error) }
    }
    report.cleanupErrors = errors.slice(report.error ? 1 : 0).map(galleryErrorDetails)
    if (errors.length) report.passed = false
    await writeFile(join(artifactsDir, artifact('results.json')), `${JSON.stringify(report, null, 2)}\n`)
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
export async function runGalleryBrowserChecks({ page, artifactsDir, dismissCredentialsOverlay, log = console.log,
  inputProfile = 'desktop', report = {} }) {
  let assets
  report.fixture = 'Minimum-host DOM fence; no conversation or host action routing claim'
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
    await checkGalleryBrowser({ page, renderedRoot, artifactsDir, dismissCredentialsOverlay, inputProfile, report })
    for (const path of ['/wide.svg', '/tall.svg', '/missing.svg']) {
      assert.ok(assets.requests.some(request => request.path === path), `Browser must request ${path} from the real local server`)
    }
    log('Gallery browser layout, decoded images, native modal, focus, keyboard, and wheel checks passed (DOM fixture; no session routing claim)')
  } catch (error) {
    failure = error
    report.passed = false
    report.errorDetails ??= galleryErrorDetails(error)
    report.error ??= report.errorDetails.message
  } finally {
    // Only remove this fixture and close this server. Do not touch host state/browser lifecycle.
    try {
      await bounded(page.locator(FIXTURE).evaluateAll(elements => elements.forEach(el => el.remove())), STEP_MS, 'remove gallery fixture')
    } catch (error) { failure ??= error; report.cleanupErrors = [...report.cleanupErrors ?? [], galleryErrorDetails(error)] }
    try { await assets?.close() } catch (error) { failure ??= error; report.cleanupErrors = [...report.cleanupErrors ?? [], galleryErrorDetails(error)] }
    if (failure) report.passed = false
    await writeFile(join(artifactsDir, `gallery-${inputProfile}-results.json`), `${JSON.stringify(report, null, 2)}\n`)
  }
  if (failure) throw failure
  return report
}
