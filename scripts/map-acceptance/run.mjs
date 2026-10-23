/** CI-only real Map acceptance on the existing sandboxed host browser. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import { createMapSpec, MAP_TITLE, MAP_ACTION, MAP_SUBMIT, safeMapError, assertOfflineMapArtifact, recordMapCheckFailure, assertMapChecksPassed } from './contract.mjs'
import { checkMapUi, controls, mapSection, listChoice, marker, until, watchMapPage, installCspObserver, assertRoutePixels } from './browser-checks.mjs'

const noErrors = evidence => {
  assert.deepEqual(evidence.errors, [], 'No browser page errors')
  assert.deepEqual(evidence.externalRequests, [], 'No external map/font/tile/sprite requests')
}
async function assertSelection(section, name = 'Synthetic East') {
  await until(async () => await listChoice(section, name).getAttribute('aria-pressed') === 'true'
    && await marker(section, name).getAttribute('aria-pressed') === 'true', 'Restored selection')
}
export async function runMapAcceptance({ browser, page, readyUrl, repoRoot, tarball, conversation, dismiss }) {
  const out = join(repoRoot, '.e2e-artifacts/map')
  await mkdir(out, { recursive: true })
  const report = { passed: false, stage: 'host', identity: { revision: process.env.GITHUB_SHA ?? null,
    hostSha: process.env.HOST_SHA ?? null, browser: browser.version() },
  browserPolicy: { sandboxRequested: true, softwareGpu: 'ANGLE SwiftShader OpenGL ES driver', unsafeFallback: false },
  hostAction: conversation ? 'pending' : 'not-covered-minimum-rc.1', contexts: {}, failures: [] }
  let server, packed, active = page
  const ownedContexts = []
  const independentCheck = async (stage, check) => {
    report.stage = stage
    const passed = await recordMapCheckFailure(report.failures, stage, check)
    if (!passed) {
      try { await active.screenshot({ path: join(out, `map-${stage}-failure.png`) }) }
      catch (error) { report.failures.at(-1).screenshotError = safeMapError(error) }
    }
    return passed
  }
  page.setDefaultTimeout(10000)
  const hostEvidence = watchMapPage(page, [new URL(readyUrl).origin])
  report.contexts.host = hostEvidence
  try {
    const session = await browser.newBrowserCDPSession()
    try {
      const command = await session.send('Browser.getBrowserCommandLine')
      const forbidden = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu-sandbox', '--disable-web-security', '--disable-gpu', '--enable-unsafe-swiftshader']
      assert.ok(!command.arguments.some(argument => forbidden.some(flag => argument === flag || argument.startsWith(flag + '='))), 'Running Chrome must not disable sandboxes/WebGL or enable unsafe fallback')
      report.browserPolicy.observedDriverFlags = command.arguments.filter(argument => argument.startsWith('--use-gl=') || argument.startsWith('--use-angle='))
      assert.deepEqual(report.browserPolicy.observedDriverFlags, ['--use-gl=angle', '--use-angle=swiftshader'])
      report.browserPolicy.observedUnsafeFlags = []
    } finally { await session.detach() }
    await installCspObserver(page)
    let root
    if (conversation) root = await conversation.openConversation({ page, dismissCredentialsOverlay: dismiss })
    else {
      // Supported minimum has no official replay fixture. Feed the existing DOM
      // fence channel, not React/store internals; never claim host action routing.
      await page.evaluate(spec => {
        const fixture = document.createElement('div'); fixture.dataset.mapMinimum = ''
        const host = document.createElement('div'); host.className = 'md-code-block'
        const label = document.createElement('div'); label.textContent = 'dsh-ui'
        const pre = document.createElement('pre'); pre.textContent = JSON.stringify(spec)
        host.append(label, pre); fixture.append(host); document.body.prepend(fixture)
      }, createMapSpec())
      root = page.locator('[data-map-minimum] [data-genui]')
    }
    const auditNoActions = conversation ? async () => {
      await page.waitForTimeout(350)
      report.hostBeforeSubmit = await conversation.assertNoActions()
    } : undefined
    hostEvidence.checks = await checkMapUi({ page, root, out, prefix: 'map-host', dismiss, assertNoActions: auditNoActions })
    assert.ok(hostEvidence.workerUrls.includes('blob:'), 'Host must create the real bundled worker')
    hostEvidence.csp = await page.evaluate(() => window.__mapCspViolations)
    if (conversation) {
      root = await conversation.openExistingConversation({ page, dismissCredentialsOverlay: dismiss })
      await assertSelection(mapSection(root))
      await auditNoActions()
      hostEvidence.csp.push(...await page.evaluate(() => window.__mapCspViolations))
      report.hostAction = await conversation.verifySubmit({ page, renderedRoot: root, dismissCredentialsOverlay: dismiss })
      await mapSection(root).screenshot({ path: join(out, 'map-host-after-submit.png') })
    }
    noErrors(hostEvidence)
    assert.deepEqual(hostEvidence.csp, [], 'Host Map CSP must allow its real worker')

    report.stage = 'packed-embed'
    // Test the actual packed public ./embed source and built IIFE, not an
    // accidental working-copy import or a rebuilt empty worker placeholder.
    packed = await mkdtemp(join(out, 'packed-'))
    const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n')
    assert.ok(entries.every(name => name.startsWith('package/') && !name.split('/').includes('..')), 'Only package-relative archive entries')
    execFileSync('tar', ['-xzf', tarball, '-C', packed])
    const packageRoot = join(packed, 'package')
    const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    assert.equal(pkg.exports['./embed'], './src/client/embed.ts')
    const assetBytes = Object.fromEntries(await Promise.all(['maplibre.js', 'standalone-runtime.js'].map(async name => [name, await readFile(join(packageRoot, 'lib/assets', name))])))
    server = await createServer({ root: repoRoot, configFile: false,
      server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false },
      plugins: [{ name: 'synthetic-packed-map-assets', configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          const url = new URL(req.url, 'http://127.0.0.1')
          if (url.pathname === '/tests/browser/map.html' && url.searchParams.has('block-worker')) res.setHeader('Content-Security-Policy', "worker-src 'none'")
          if (url.pathname.startsWith('/__map-assets__/')) {
            const bytes = assetBytes[url.pathname.slice('/__map-assets__/'.length)]
            res.statusCode = bytes ? 200 : 404; res.setHeader('Content-Type', 'text/javascript'); res.end(bytes ?? 'not found'); return
          }
          next()
        })
      } }],
      resolve: { dedupe: ['react', 'react-dom'], alias: [
        { find: '@changfenhuang/dsh-genui/embed', replacement: join(packageRoot, pkg.exports['./embed']) },
        { find: '@map-test/i18n', replacement: join(packageRoot, 'src/client/i18n/runtime.ts') },
        { find: '@map-test/theme', replacement: join(packageRoot, 'src/client/artifact/standalone-theme.ts') },
        { find: /^(?:.*\/)?primitive-adapter\.ts$/, replacement: join(packageRoot, 'src/client/standalone/primitive-adapter.tsx') },
      ] }, optimizeDeps: { include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'], force: true },
    })
    await server.listen()
    const address = server.httpServer.address()
    assert.ok(address && typeof address !== 'string')
    const origin = `http://127.0.0.1:${address.port}`
    const embedContext = await browser.newContext({ viewport: { width: 1000, height: 1100 }, locale: 'en' })
    ownedContexts.push(embedContext)
    const embed = await embedContext.newPage(); embed.setDefaultTimeout(10000); active = embed
    const embedEvidence = watchMapPage(embed, [origin]); report.contexts.embed = embedEvidence
    await installCspObserver(embed)
    await embed.goto(`${origin}/tests/browser/map.html`, { waitUntil: 'networkidle' })
    assert.equal(embedEvidence.workerUrls.length, 0, 'No eager Map worker')
    assert.ok(!embedEvidence.requests.some(url => url.endsWith('/maplibre.js')), 'No eager Map engine request')
    assert.equal(await embed.locator('[data-genui-maplibre-css]').count(), 0, 'No eager vendor CSS')
    await embed.getByRole('button', { name: 'Mount map', exact: true }).click()
    const assertNoEmbedActions = async () => {
      await embed.waitForTimeout(350)
      assert.deepEqual(JSON.parse(await embed.locator('#map-actions').textContent()), [])
    }
    embedEvidence.checks = await checkMapUi({ page: embed, root: embed, out, prefix: 'map-embed', assertNoActions: assertNoEmbedActions })
    assert.equal(embedEvidence.requests.filter(url => url.endsWith('/maplibre.js')).length, 1, 'Engine loaded exactly once')
    assert.ok(embedEvidence.workerUrls.includes('blob:'))
    const section = mapSection(embed)
    const originalCanvas = await section.locator('canvas.maplibregl-canvas').elementHandle()
    await embed.getByRole('button', { name: 'Stream label update', exact: true }).click()
    await assertSelection(section, 'Synthetic East renamed')
    assert.ok(await originalCanvas.evaluate(element => element.isConnected), 'Streaming stable IDs must not recreate the Map')
    await embed.getByRole('button', { name: 'Remove selected location', exact: true }).click()
    await until(async () => JSON.parse(await embed.locator('#map-snapshot').textContent()).fields.destination === '', 'Removed selected field cleared')
    assert.equal(await embed.getByRole('button', { name: MAP_SUBMIT, exact: true }).isEnabled(), false)
    await embed.getByRole('button', { name: 'Restore locations', exact: true }).click()
    assert.equal(await listChoice(section, 'Synthetic East').getAttribute('aria-pressed'), 'false')
    await listChoice(section, 'Synthetic East').click()
    await embed.getByRole('button', { name: 'Toggle theme', exact: true }).click()
    await section.getByRole('button', { name: controls.reset }).click()
    embedEvidence.darkRoute = await assertRoutePixels(embed, section, join(out, 'map-embed-dark-route.png'))
    assert.ok(await originalCanvas.evaluate(element => element.isConnected), 'Theme changes must not recreate the Map')
    await embed.getByRole('button', { name: 'Toggle trusted style', exact: true }).click()
    await until(() => section.getByRole('button', { name: controls.reset }).isEnabled(), 'Trusted style ready')
    await assertSelection(section)
    await section.getByRole('button', { name: controls.reset }).click()
    embedEvidence.trustedStyleRoute = await assertRoutePixels(embed, section, join(out, 'map-embed-trusted-route.png'))
    await assertNoEmbedActions()
    // Export through the public API fixture's actual UI; snapshot originates
    // exclusively from real user interactions and public onStateSnapshot.
    const downloadPromise = embed.waitForEvent('download')
    await embed.getByRole('button', { name: 'Export offline HTML', exact: true }).click()
    const download = await downloadPromise
    const offlinePath = join(out, 'map-offline.html')
    await download.saveAs(offlinePath)
    const html = await readFile(offlinePath, 'utf8')
    assert.ok(html.includes("connect-src 'none'"))
    assert.ok(html.includes("script-src 'unsafe-inline' blob:"))
    assert.ok(!html.includes('host-background'), 'Trusted host configuration must not be exported')
    const encoded = /id="genui-artifact">([^<]+)<\/script>/u.exec(html)?.[1]
    assert.ok(encoded)
    assertOfflineMapArtifact(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')))
    await embed.getByRole('button', { name: MAP_SUBMIT, exact: true }).click()
    await until(async () => JSON.parse(await embed.locator('#map-actions').textContent()).length === 1, 'One explicit embed action')
    assert.deepEqual(JSON.parse(await embed.locator('#map-actions').textContent()), [{ action: MAP_ACTION,
      payload: { type: 'submit', answers: {}, fields: { destination: 'east' }, total: 1, answered: 1 } }])
    const workerCleanupPassed = await independentCheck('embed-worker-cleanup', async () => {
      try {
        const workerUrls = embed.workers().map(worker => worker.url())
        await embed.getByRole('button', { name: 'Unmount map', exact: true }).click()
        await until(() => embed.workers().length === 0, 'Workers stop after last Map unmount')
        assert.ok(embedEvidence.workerCloses >= 1)
        embedEvidence.workerUrlsRevoked = await embed.evaluate(async urls => Promise.all(urls.map(async url => {
          try { await fetch(url); return false } catch { return true }
        })), workerUrls)
        assert.ok(embedEvidence.workerUrlsRevoked.length > 0 && embedEvidence.workerUrlsRevoked.every(Boolean), 'Worker blob URLs revoked after termination')
        embedEvidence.csp = await embed.evaluate(() => window.__mapCspViolations)
        assert.deepEqual(embedEvidence.csp, [])
        noErrors(embedEvidence)
      } finally {
        // Sample at the check boundary, before screenshots or context.close().
        // Later teardown events cannot repair this verdict or these counts.
        embedEvidence.workerCleanup = { workersRemaining: embed.workers().length,
          workerClosesBeforeContextCleanup: embedEvidence.workerCloses }
      }
    })
    embedEvidence.workerCleanup.passed = workerCleanupPassed

    await independentCheck('offline-file', async () => {
      // This file navigation happens ONLY on CI, not through any local/cloud CUA
      // route. New offline context before its FIRST navigation, original CSP.
      const offlineContext = await browser.newContext({ viewport: { width: 1000, height: 1100 }, locale: 'en', offline: true })
      ownedContexts.push(offlineContext)
      const offline = await offlineContext.newPage(); offline.setDefaultTimeout(10000); active = offline
      const offlineEvidence = watchMapPage(offline, [], { allowFile: true }); report.contexts.offline = offlineEvidence
      await installCspObserver(offline)
      await offline.goto(pathToFileURL(offlinePath).href, { waitUntil: 'load' })
      await assertSelection(mapSection(offline))
      offlineEvidence.checks = await checkMapUi({ page: offline, root: offline, out, prefix: 'map-offline' })
      assert.equal(await offline.getByRole('button', { name: MAP_SUBMIT, exact: true }).isEnabled(), false, 'Offline actions cannot call a model')
      offlineEvidence.csp = await offline.evaluate(() => window.__mapCspViolations)
      offlineEvidence.modelSubmitDisabled = true
      await offline.reload({ waitUntil: 'load' })
      await assertSelection(mapSection(offline))
      await until(() => mapSection(offline).getByRole('button', { name: controls.reset }).isEnabled(), 'Independent offline reload')
      await mapSection(offline).getByRole('button', { name: controls.reset }).click()
      offlineEvidence.reloadRoute = await assertRoutePixels(offline, mapSection(offline), join(out, 'map-offline-reloaded-route.png'))
      assert.ok(offlineEvidence.workerUrls.includes('blob:'))
      offlineEvidence.csp.push(...await offline.evaluate(() => window.__mapCspViolations))
      assert.deepEqual(offlineEvidence.csp, [])
      assert.deepEqual(offlineEvidence.requests, [], 'Offline HTML must make zero network requests')
      assert.deepEqual(offlineEvidence.webSockets, [], 'Offline HTML must make zero WebSocket connections')
      noErrors(offlineEvidence)
    })

    await independentCheck('touch-embed', async () => {
      const touchContext = await browser.newContext({ viewport: { width: 390, height: 1000 }, locale: 'en', hasTouch: true, isMobile: true })
      ownedContexts.push(touchContext)
      const touch = await touchContext.newPage(); touch.setDefaultTimeout(10000); active = touch
      const touchEvidence = watchMapPage(touch, [origin]); report.contexts.touch = touchEvidence
      await installCspObserver(touch)
      await touch.goto(`${origin}/tests/browser/map.html`, { waitUntil: 'networkidle' })
      await touch.getByRole('button', { name: 'Mount map', exact: true }).tap()
      const touchMap = mapSection(touch)
      await until(() => touchMap.getByRole('button', { name: controls.reset }).isEnabled(), 'Touch Map ready')
      await listChoice(touchMap, 'Synthetic East').tap()
      await assertSelection(touchMap)
      // Selection recenters the camera. Refit before targeting the opposite
      // endpoint in a 390px viewport, where it would otherwise be clipped.
      await touchMap.getByRole('button', { name: controls.reset }).tap()
      await marker(touchMap, 'Synthetic West').tap()
      await until(async () => await listChoice(touchMap, 'Synthetic West').getAttribute('aria-pressed') === 'true', 'Touch marker → list')
      assert.deepEqual(JSON.parse(await touch.locator('#map-actions').textContent()), [])
      await touchMap.getByRole('button', { name: controls.reset }).tap()
      touchEvidence.route = await assertRoutePixels(touch, touchMap, join(out, 'map-touch-route.png'))
      await touchMap.screenshot({ path: join(out, 'map-touch-selected.png') })
      touchEvidence.csp = await touch.evaluate(() => window.__mapCspViolations)
      assert.deepEqual(touchEvidence.csp, [])
      noErrors(touchEvidence)
    })

    await independentCheck('blocked-worker-fallback', async () => {
      const failureContext = await browser.newContext({ viewport: { width: 1000, height: 1100 }, locale: 'en' })
      ownedContexts.push(failureContext)
      const failure = await failureContext.newPage(); failure.setDefaultTimeout(10000); active = failure
      const failureEvidence = watchMapPage(failure, [origin]); report.contexts.blockedWorker = failureEvidence
      await installCspObserver(failure)
      await failure.goto(`${origin}/tests/browser/map.html?block-worker=1`, { waitUntil: 'networkidle' })
      await failure.getByRole('button', { name: 'Mount map', exact: true }).click()
      const failedMap = mapSection(failure)
      await failedMap.getByRole('status').filter({ hasText: 'Map unavailable' }).waitFor({ state: 'visible' })
      await listChoice(failedMap, 'Synthetic East').focus(); await failure.keyboard.press('Enter')
      assert.equal(await listChoice(failedMap, 'Synthetic East').getAttribute('aria-pressed'), 'true')
      assert.equal(await failedMap.getByRole('button', { name: controls.reset }).isEnabled(), false)
      assert.deepEqual(JSON.parse(await failure.locator('#map-actions').textContent()), [])
      await failure.getByRole('button', { name: MAP_SUBMIT, exact: true }).click()
      await until(async () => JSON.parse(await failure.locator('#map-actions').textContent()).length === 1, 'List fallback explicit submit')
      failureEvidence.csp = await failure.evaluate(() => window.__mapCspViolations)
      assert.ok(failureEvidence.csp.length > 0 && failureEvidence.csp.every(event => event.directive === 'worker-src'), 'Only the deliberately blocked worker may violate CSP')
      noErrors(failureEvidence)
      await failedMap.screenshot({ path: join(out, 'map-blocked-worker-list.png') })
    })

    report.stage = 'aggregate'
    assertMapChecksPassed(report.failures)
    report.stage = 'complete'
    report.passed = true
  } catch (error) {
    report.error = safeMapError(error)
    try { await active.screenshot({ path: join(out, 'map-failure.png') }) } catch (failure) { report.screenshotError = safeMapError(failure) }
    throw new Error(safeMapError(error)) // Do not retain raw URL-bearing cause/stack.
  } finally {
    const cleanup = []
    for (const context of ownedContexts.reverse()) {
      try { await context.close() } catch (error) { cleanup.push(safeMapError(error)) }
    }
    try { await server?.close() } catch (error) { cleanup.push(safeMapError(error)) }
    if (packed) await rm(packed, { recursive: true, force: true })
    report.cleanupErrors = cleanup
    if (cleanup.length) report.passed = false
    await writeFile(join(out, 'map-browser-results.json'), JSON.stringify(report, null, 2) + '\n')
    if (cleanup.length) throw new Error('Map acceptance resource cleanup failed')
  }
  return report
}
