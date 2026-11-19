/** Read-only input evidence for fixed Playwright contexts. Never changes capability. */
import assert from 'node:assert/strict'
const TIMEOUT = 8000
export async function readGalleryInputCapabilities(page, profile, { phase = 'input', observations = [] } = {}) {
  const url = new URL(page.url())
  assert.equal(url.protocol, 'http:')
  assert.equal(url.hostname, '127.0.0.1', 'Input evidence requires the isolated local host')
  assert.ok(profile === 'desktop' || profile === 'touch', 'Use an explicit fixed input profile')
  let timer
  let actual
  try {
    actual = await Promise.race([page.evaluate(() => ({ points: navigator.maxTouchPoints,
      hover: matchMedia('(hover: hover)').matches, hoverNone: matchMedia('(hover: none)').matches,
      coarsePointer: matchMedia('(pointer: coarse)').matches, finePointer: matchMedia('(pointer: fine)').matches })),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Read fixed input capabilities timed out')), TIMEOUT) })])
  } finally { clearTimeout(timer) }
  // Save primitive observations before assertion so failures retain the actual media values.
  observations.push({ phase, profile, ...actual })
  const touch = profile === 'touch'
  assert.ok(Number.isInteger(actual.points) && (touch ? actual.points > 0 : actual.points === 0)
    && actual.hover === !touch && actual.hoverNone === touch
    && actual.coarsePointer === touch && actual.finePointer === !touch,
  `Fixed ${profile} capability mismatch at ${phase}: ${JSON.stringify(actual)}`)
  return { profile, ...actual }
}

/** Keep nested assertion details without emitting the local host's ready-URL token. */
export function galleryErrorDetails(error) {
  const known = new Set(['gallery-browser-checks.mjs', 'gallery-fixed-contexts.mjs',
    'gallery-input-mode.mjs', 'gallery-touch-checks.mjs'])
  const location = [...String(error?.stack ?? '').matchAll(/[\\/](gallery-[a-z0-9-]+\.mjs):(\d+):(\d+)(?=[)\s]|$)/gu)]
    .find(match => known.has(match[1]))
  return { ...(location ? { location: `${location[1]}:${location[2]}:${location[3]}` } : {}), name: error?.name ?? 'Error', message: String(error?.message ?? error).replace(/([?&]token=)[A-Za-z0-9_-]+/gu, '$1[redacted]'),
    ...(Array.isArray(error?.errors) ? { errors: error.errors.map(galleryErrorDetails) } : {}) }
}

/** Safe to throw into e2e's existing console.error path; do not retain raw cause/stack. */
export function gallerySafeError(error) {
  const detail = galleryErrorDetails(error)
  const safe = Array.isArray(error?.errors)
    ? new AggregateError(error.errors.map(gallerySafeError), detail.message)
    : new Error(detail.location ? `${detail.message} (${detail.location})` : detail.message)
  safe.name = detail.name
  return safe
}
