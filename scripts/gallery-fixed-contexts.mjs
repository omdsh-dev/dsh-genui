/** Two fixed input contexts on the already-owned smoke browser. One real session and one Choose. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkGalleryBrowser, runGalleryBrowserChecks } from './gallery-browser-checks.mjs'
import { galleryErrorDetails, gallerySafeError, readGalleryInputCapabilities } from './gallery-input-mode.mjs'

async function bounded(promise, timeout, label) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout} ms`)), timeout)
  })]) } finally { clearTimeout(timer) }
}

export async function runGalleryFixedContexts({ browser, page, readyUrl, artifactsDir,
  galleryConversation, galleryAssets, createDismissCredentialsOverlay, log = console.log }) {
  const fixture = galleryConversation
    ? 'Official rc.2 real conversation with deterministic local replay'
    : 'Minimum-host DOM fence; no conversation or host action routing claim'
  const report = { fixture, identity: { hostSha: process.env.HOST_SHA ?? null,
    revision: process.env.GITHUB_SHA ?? null, browser: browser.version() },
  contexts: { desktop: { fixture, inputChecks: [] }, touch: { fixture, inputChecks: [] } },
  hostActionPassed: galleryConversation ? false : null,
  ...(galleryAssets ? { assetRequests: galleryAssets.requests } : {}) }
  const input = (target, profile, phase) => readGalleryInputCapabilities(target, profile,
    { phase, observations: report.contexts[profile].inputChecks })
  let touchPage = null
  let touchCloseAttempted = false
  const errors = []
  const cleanupErrors = []
  const closeTouch = async () => {
    if (!touchPage || touchCloseAttempted) return
    touchCloseAttempted = true
    report.touchContextCleanup = { attempted: true, closed: false, fallback: null }
    try {
      await bounded(touchPage.close(), 8000, 'Close owned touch page/context')
      touchPage = null
      report.touchContextCleanup.closed = true
    } catch (error) {
      cleanupErrors.push(galleryErrorDetails(error))
      report.touchContextCleanup.fallback = 'Existing e2e common cleanup must close the owned browser'
      throw error // No retry after an uncertain close; outer browser.close owns the fallback.
    }
  }
  try {
    report.stage = 'desktop-visual'
    const originalDesktopInput = await input(page, 'desktop', 'after-navigation-onboarding')
    const dismissDesktop = createDismissCredentialsOverlay(page)
    let renderedRoot
    if (galleryConversation) {
      renderedRoot = await galleryConversation.openConversation({ page, dismissCredentialsOverlay: dismissDesktop })
      await input(page, 'desktop', 'after-conversation-navigation')
      await checkGalleryBrowser({ page, renderedRoot, artifactsDir, dismissCredentialsOverlay: dismissDesktop,
        inputProfile: 'desktop', assertNoActions: galleryConversation.assertNoActions, report: report.contexts.desktop })
    } else {
      await runGalleryBrowserChecks({ page, artifactsDir, dismissCredentialsOverlay: dismissDesktop,
        inputProfile: 'desktop', report: report.contexts.desktop, log })
    }

    // Supported Playwright construction owns a second isolated context. No copied
    // storageState, permissions, browser connection, credentials, or profile writes.
    report.stage = 'touch-navigation'
    touchPage = await bounded(browser.newPage({ viewport: { width: 1440, height: 1200 },
      locale: 'zh-CN', hasTouch: true }), 15000, 'Create fixed touch context')
    const touchErrors = []
    let touchClientActive = false
    touchPage.on('pageerror', error => touchErrors.push(galleryErrorDetails(error)))
    touchPage.on('console', message => {
      if (message.text().includes('[genui] client active; fence-channel=')) touchClientActive = true
    })
    // The in-memory URL is the same synthetic host. Never save its auth token.
    await touchPage.goto(readyUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await touchPage.waitForTimeout(5000)
    await input(touchPage, 'touch', 'after-navigation')
    assert.deepEqual(touchErrors, [], 'Touch page must boot without script errors')
    assert.ok(touchClientActive, 'Touch context must activate the installed GenUI client')
    const dismissTouch = createDismissCredentialsOverlay(touchPage)
    const continueButton = touchPage.getByRole('button', { name: '继续', exact: true })
    const continueVisible = await bounded(continueButton.isVisible(), 8000, 'Read known onboarding visibility')
    report.contexts.touch.onboarding = { continueVisible, continued: false }
    if (continueVisible) {
      await continueButton.click({ timeout: 15000 })
      report.contexts.touch.onboarding.continued = true
      await touchPage.waitForTimeout(500)
    }
    await bounded(dismissTouch(), 8000, 'Dismiss touch-context onboarding overlay')
    await input(touchPage, 'touch', 'after-onboarding')
    report.stage = 'touch-visual'
    if (galleryConversation) {
      const touchRoot = await galleryConversation.openExistingConversation({ page: touchPage, dismissCredentialsOverlay: dismissTouch })
      await input(touchPage, 'touch', 'after-existing-conversation-navigation')
      await checkGalleryBrowser({ page: touchPage, renderedRoot: touchRoot, artifactsDir,
        dismissCredentialsOverlay: dismissTouch, inputProfile: 'touch',
        assertNoActions: galleryConversation.assertNoActions, report: report.contexts.touch })
    } else {
      await runGalleryBrowserChecks({ page: touchPage, artifactsDir, dismissCredentialsOverlay: dismissTouch,
        inputProfile: 'touch', report: report.contexts.touch, log })
    }
    assert.deepEqual(touchErrors, [], 'Touch browsing must not cause script errors')
    report.stage = 'close-touch'
    await closeTouch()
    report.stage = 'verify-desktop-unchanged'
    assert.deepEqual(await input(page, 'desktop', 'after-touch-context-closed'), originalDesktopInput,
      'Closing the independent touch context must not change the desktop page')
    if (galleryConversation) {
      report.stage = 'single-desktop-choose'
      report.beforeChoose = await galleryConversation.assertNoActions()
      report.choice = await galleryConversation.verifyChoose({ page, renderedRoot, dismissCredentialsOverlay: dismissDesktop })
      for (const path of ['/wide.svg', '/tall.svg', '/missing.svg']) {
        assert.ok(galleryAssets.requests.some(request => request.path === path), `Browser must request ${path}`)
      }
      report.hostActionPassed = true
    }
    report.stage = 'complete'
    report.passed = true
    log('Gallery fixed desktop/touch contexts passed; ' + (galleryConversation
      ? 'one existing real session and exactly one desktop Choose' : 'minimum-host DOM fixtures; no session routing claim'))
  } catch (error) {
    errors.push(error)
    report.passed = false
    report.errorDetails = galleryErrorDetails(error)
    report.error = report.errorDetails.message
  } finally {
    try { await closeTouch() } catch (error) { errors.push(error); report.passed = false }
    report.cleanupErrors = cleanupErrors
    // Re-save both context reports after final input checks and aggregate without losing failure evidence.
    for (const profile of ['desktop', 'touch']) {
      await writeFile(join(artifactsDir, `gallery-${profile}-results.json`), `${JSON.stringify(report.contexts[profile], null, 2)}\n`)
    }
    await writeFile(join(artifactsDir, 'gallery-browser-results.json'), `${JSON.stringify(report, null, 2)}\n`)
  }
  if (errors.length) throw new AggregateError(errors.map(gallerySafeError), 'Fixed-context gallery regression failed')
  return report
}
