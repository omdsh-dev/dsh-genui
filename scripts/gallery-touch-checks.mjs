/** Native Chromium touch input on the e2e-owned page, not DOM-dispatched events.
 * Playwright newCDPSession is supported since 1.11; both pinned hosts use >=1.49.
 * Only Input.dispatchTouchEvent is sent. No endpoint discovery, target inventory,
 * browser launch, device/security override, or connection to an external browser.
 */
import assert from 'node:assert/strict'

const TIMEOUT = 8000
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function bounded(promise, label, timeout = TIMEOUT) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout} ms`)), timeout)
    })])
  } finally { clearTimeout(timer) }
}

/** A single leftward finger trajectory using the browser's native input path. */
export async function dispatchGalleryTouchPan(page, { startX, endX, y }, timeout = TIMEOUT) {
  const deadline = Date.now() + timeout
  const remaining = () => {
    assert.ok(Date.now() < deadline, 'Native touch input exceeded its total time budget')
    return Math.min(TIMEOUT, deadline - Date.now())
  }
  assert.equal(new URL(page.url()).hostname, '127.0.0.1', 'Touch checks are restricted to the isolated local host')
  assert.ok([startX, endX, y].every(Number.isFinite) && startX > endX && y >= 0)
  const session = await bounded(page.context().newCDPSession(page), 'Attach owned-page input session', remaining())
  let touching = false
  const errors = []
  try {
    touching = true // An uncertain start is cancelled before detaching, never retried.
    await bounded(session.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: startX, y, id: 1 }],
    }), 'Native touch start', remaining())
    for (let step = 1; step <= 12; step++) {
      await pause(30)
      await bounded(session.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: startX + (endX - startX) * step / 12, y, id: 1 }],
      }), 'Native touch move', remaining())
    }
    await pause(120) // Release a held finger, avoiding an unbounded inertial fling.
    await bounded(session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }), 'Native touch end', remaining())
    touching = false
  } catch (error) { errors.push(error) }
  finally {
    if (touching) {
      try { await bounded(session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }), 'Cancel owned touch') }
      catch (error) { errors.push(error) }
    }
    try { await bounded(session.detach(), 'Detach owned-page input session') } catch (error) { errors.push(error) }
  }
  if (errors.length) throw new AggregateError(errors, 'Native gallery touch input failed')
}

/** The caller has already mounted the real renderer at the 420px viewport. */
export async function checkGalleryTouch({ page, track, assertNoActions, timeout = TIMEOUT }) {
  const deadline = Date.now() + timeout
  const remaining = () => {
    assert.ok(Date.now() < deadline, 'Native touch check exceeded its total time budget')
    return Math.min(TIMEOUT, deadline - Date.now())
  }
  assert.equal(page.viewportSize()?.width, 420)
  const capability = await bounded(page.evaluate(() => ({ maxTouchPoints: navigator.maxTouchPoints,
    coarsePointer: matchMedia('(pointer: coarse)').matches })), 'Read touch capability', remaining())
  assert.ok(capability.maxTouchPoints > 0, 'The owned page must have touch capability enabled for this scenario')
  await track.scrollIntoViewIfNeeded({ timeout: remaining() })
  const before = await bounded(track.evaluate(element => {
    const box = element.getBoundingClientRect()
    return { left: element.scrollLeft, maximum: element.scrollWidth - element.clientWidth,
      x: box.left, y: box.top, width: box.width, height: box.height,
      viewportHeight: innerHeight, touchAction: getComputedStyle(element).touchAction }
  }), 'Measure touch track', remaining())
  assert.ok(before.left <= 1 && before.maximum > 20, 'Touch test starts at the real first scroll edge')
  const gesture = { startX: before.x + before.width - 24, endX: before.x + 24,
    y: before.y + Math.min(40, before.height / 3) }
  assert.ok(gesture.startX - gesture.endX > 150 && gesture.endX >= 0 && gesture.startX < 420)
  assert.ok(gesture.y >= 0 && gesture.y < before.viewportHeight)
  assert.ok(await bounded(track.evaluate((element, point) => {
    const target = document.elementFromPoint(point.startX, point.y)
    return target !== null && element.contains(target) && !target.closest('button, input, textarea, select, a')
  }, gesture), 'Hit-test native touch start', remaining()), 'Touch starts on visible, non-interactive carousel content')
  // Passive observation does not preventDefault, synthesize events, or change scroll/style/app state.
  const observer = await bounded(track.evaluateHandle(element => {
    const events = []
    const observe = event => events.push({ type: event.type, trusted: event.isTrusted,
      button: event.target instanceof Element && event.target.closest('button') !== null })
    const types = ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'click']
    for (const type of types) element.addEventListener(type, observe, { capture: true, passive: true })
    return { events, dispose() { for (const type of types) element.removeEventListener(type, observe, true) } }
  }), 'Observe native touch input', remaining())
  try {
    const actionsBefore = assertNoActions ? await bounded(assertNoActions(), 'Read pre-touch session actions', remaining()) : null
    await dispatchGalleryTouchPan(page, gesture, remaining())
    let after
    let previousLeft = NaN
    let stable = 0
    do {
      await pause(80)
      after = await bounded(track.evaluate(element => {
        const left = element.scrollLeft
        const maximum = element.scrollWidth - element.clientWidth
        const x = element.getBoundingClientRect().left
        const stops = [...element.children].map(slide => Math.min(maximum,
          Math.max(0, slide.getBoundingClientRect().left - x + left)))
        return { left, maximum, snapDistance: Math.min(...stops.map(stop => Math.abs(stop - left))) }
      }), 'Observe native touch scroll', remaining())
      stable = Math.abs(after.left - previousLeft) < 0.5 ? stable + 1 : 0
      previousLeft = after.left
      if (after.left > before.left + 20 && after.snapDistance <= 2 && stable >= 3) break
    } while (Date.now() < deadline)
    assert.ok(after.left > before.left + 20 && after.snapDistance <= 2 && stable >= 3,
      `Native touch must scroll and settle at a snap point: ${JSON.stringify(after)}`)
    const events = await bounded(observer.evaluate(probe => probe.events), 'Read observed touch input', remaining())
    assert.ok(events.some(event => event.type === 'touchstart') && events.some(event => event.type === 'touchmove')
      && events.some(event => event.type === 'touchend'), 'Browser must deliver a complete native touch gesture')
    assert.ok(events.every(event => event.trusted), 'All observed gesture events must be browser-trusted')
    assert.equal(events.filter(event => event.type === 'click').length, 0, 'Touch scrolling must not activate a card')
    const actionsAfter = assertNoActions ? await bounded(assertNoActions(), 'Read post-touch session actions', remaining()) : null
    return { input: 'Chromium Input.dispatchTouchEvent on the e2e-owned page', viewportWidth: 420,
      capability, gesture, before, after, events, actionsBefore, actionsAfter,
      actionScope: assertNoActions ? 'Real session: zero GenUI actions before and after gesture' : 'DOM fixture: no click; session routing not assessed',
      excludes: ['physical-device validation', 'mouse drag', 'image-lightbox swipe'] }
  } finally {
    try { await bounded(observer.evaluate(probe => probe.dispose()), 'Remove native touch observers') }
    finally { await bounded(observer.dispose(), 'Dispose touch observer handle') }
  }
}
