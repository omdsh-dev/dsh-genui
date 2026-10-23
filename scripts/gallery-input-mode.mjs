/** Bounded input-capability emulation on the existing isolated e2e-owned page.
 * No browser discovery, external connection, security flag, or application-state mutation.
 */
import assert from 'node:assert/strict'
const TIMEOUT = 8000
async function bounded(promise, label) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT)
  })]) } finally { clearTimeout(timer) }
}
export async function createGalleryInputMode(page) {
  const url = new URL(page.url())
  assert.equal(url.protocol, 'http:')
  assert.equal(url.hostname, '127.0.0.1', 'Input modes require the isolated local host')
  const original = await bounded(page.evaluate(() => ({ points: navigator.maxTouchPoints,
    hover: matchMedia('(hover: hover)').matches, coarse: matchMedia('(pointer: coarse)').matches })), 'Read original input mode')
  assert.deepEqual(original, { points: 0, hover: true, coarse: false }, 'The smoke page must start in desktop mode')
  const session = await bounded(page.context().newCDPSession(page), 'Attach owned-page input capability session')
  const apply = async (enabled, points = 1) => {
    await bounded(session.send('Emulation.setTouchEmulationEnabled', { enabled, ...(enabled ? { maxTouchPoints: points } : {}) }), 'Set owned-page touch capability')
  }
  return {
    async set(touch) {
      assert.equal(typeof touch, 'boolean')
      await apply(touch)
      await page.waitForFunction(expected => (navigator.maxTouchPoints > 0) === expected
        && matchMedia('(hover: none)').matches === expected
        && matchMedia('(pointer: coarse)').matches === expected, touch, { timeout: TIMEOUT })
      return { touch, hover: !touch, coarsePointer: touch }
    },
    async restore() {
      const errors = []
      try {
        await apply(original.points > 0, original.points)
      } catch (error) { errors.push(error) }
      try { await bounded(session.detach(), 'Detach owned-page input capability session') } catch (error) { errors.push(error) }
      // Detach can reset the emulation domain: verify the final page, not only the attached session.
      try {
        await page.waitForFunction(expected => navigator.maxTouchPoints === expected.points
          && matchMedia('(hover: hover)').matches === expected.hover
          && matchMedia('(pointer: coarse)').matches === expected.coarse, original, { timeout: TIMEOUT })
      } catch (error) { errors.push(error) }
      if (errors.length) throw new AggregateError(errors, 'Restore gallery input mode failed')
    },
  }
}
