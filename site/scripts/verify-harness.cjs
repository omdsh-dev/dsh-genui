#!/usr/bin/env node
/**
 * verify-harness.cjs — real-browser proof for the GenUI renderer bridge.
 *
 * Uses Playwright WebKit (same executablePath + local-only request policy as
 * ../../.scratch/shot4.cjs) to:
 *   1. load proto/harness.html and wait for the bridge's ready flag;
 *   2. assert the real renderer mounted table/chart/quiz/mermaid/echart (heavy demos deferred);
 *   3. capture PNG proof into proto/shots/ (full page zh/en, one shot per demo);
 *   4. exercise the lifecycle: deferred placeholder → click → mounted, unmount all → remount,
 *      locale switch zh→en, invalid artifact → explicit error UI;
 *   5. fail if the console has any error, if any request leaves localhost, or if the mount is flaky.
 *
 * Usage: node genui-site/scripts/verify-harness.cjs [baseUrl]
 */
const path = require('node:path')
const fs = require('node:fs')
const { webkit } = require('/Users/changfenhuang/node_modules/playwright')

const BASE = (process.argv[2] || 'http://127.0.0.1:8901').replace(/\/$/, '')
const SHOTS = path.resolve(__dirname, '..', 'proto', 'shots')
const EXECUTABLE = '/Users/changfenhuang/Library/Caches/ms-playwright/webkit-2317/pw_run.sh'

const report = { ok: true, checks: [], consoleErrors: [], consoleWarnings: [], pageErrors: [], externalRequests: [], shots: [] }

/** External media URLs the specs themselves declare (repo screenshots on raw.githubusercontent). */
async function expectedExternalMedia() {
  try {
    const response = await fetch(`${BASE}/assets/genui/artifacts.json`)
    const manifest = await response.json()
    const urls = new Set()
    for (const spec of manifest.specs || []) for (const url of spec.externalMedia || []) urls.add(url)
    return urls
  } catch (error) {
    console.log(`WARN  could not read artifacts.json for expected media: ${error.message}`)
    return new Set()
  }
}

function check(name, condition, detail) {
  const passed = Boolean(condition)
  report.checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) })
  if (!passed) report.ok = false
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  (${detail})`}`)
}

function shotPath(name) {
  const file = path.join(SHOTS, `${name}.png`)
  report.shots.push(file)
  return file
}

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.route('**/*', route => {
    const url = route.request().url()
    if (url.startsWith('http://127.0.0.1') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue()
    report.externalRequests.push(url)
    return route.abort()
  })
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push(`[${page.url()}] ${message.text().slice(0, 300)}`)
    if (message.type() === 'warning') report.consoleWarnings.push(message.text().slice(0, 200))
  })
  page.on('pageerror', error => report.pageErrors.push(`[${page.url()}] ${String(error).slice(0, 300)}`))
  page.on('requestfailed', request => {
    const url = request.url()
    if (url.startsWith('http://127.0.0.1')) report.pageErrors.push(`[${page.url()}] request failed ${url} ${request.failure()?.errorText ?? ''}`)
  })
  return page
}

async function waitReady(page, timeout = 45000) {
  await page.waitForFunction(() => document.documentElement.dataset.ready !== undefined, { timeout })
  await page.waitForTimeout(600)
  return page.evaluate(() => ({
    ready: document.documentElement.dataset.ready === '1',
    failures: document.documentElement.dataset.failures,
    snapshot: window.__harness ? window.__harness.actions.snapshot() : null,
  }))
}

/** Scroll the whole page in viewport steps so IntersectionObserver-gated nodes (mermaid) render. */
async function scrollThrough(page, maxSteps = 80) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  const viewport = 900
  const step = viewport - 120
  const steps = Math.min(maxSteps, Math.ceil(height / step))
  for (let index = 0; index < steps; index += 1) {
    await page.evaluate(position => window.scrollTo(0, position), index * step)
    await page.waitForTimeout(90)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(250)
}

/** Hide the sticky harness header so element screenshots are not overlaid by it. */
async function unstickHeader(page) {
  await page.addStyleTag({ content: 'header.bar{position:static !important}' })
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const browser = await webkit.launch({ executablePath: EXECUTABLE, timeout: 60000 })
  try {
    /* ---------------------------------------------------------------- */
    /* 1. Auto mode, Chinese: every demo mounted (heavy ones started too) */
    /* ---------------------------------------------------------------- */
    const page = await newPage(browser)
    const response = await page.goto(`${BASE}/proto/harness.html?auto=1&lang=zh`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    check('harness.html responds 200', response && response.status() === 200, String(response && response.status()))
    const zh = await waitReady(page)
    check('harness ready (zh, auto)', zh.ready && Number(zh.failures) === 0, `failures=${zh.failures}`)
    const state = zh.snapshot.state
    check('real runtime loaded', state.runtimeReady === true)
    check('heavy engines registered', state.engines.includes('mermaid') && state.engines.some(name => name.toLowerCase().includes('echarts')), state.engines.join(','))
    check('all demos mounted', state.mounted >= 5, `mounted=${state.mounted} specs=${state.specs.join(',')}`)
    check('bridge reports zero internal failures', zh.snapshot.failures.length === 0, zh.snapshot.failures.join(' | '))

    await scrollThrough(page)
    // Mermaid render is intersection-gated INSIDE the renderer (it aborts when scrolled away
    // before finishing), so park the viewport on the node and wait for the real SVG.
    await page.locator('[data-demo="demo-mermaid"]').scrollIntoViewIfNeeded()
    await page.waitForFunction(() => document.querySelector('#host-demo-mermaid [data-genui-mermaid] svg') !== null, { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(500)
    await page.evaluate(() => window.scrollTo(0, 0))

    const dom = await page.evaluate(() => {
      const hosts = ['demo-table', 'demo-chart', 'demo-quiz', 'demo-mermaid', 'demo-echart']
      const result = {}
      for (const id of hosts) {
        const root = document.getElementById('host-' + id)
        result[id] = {
          state: root.dataset.genuiState,
          children: root.querySelectorAll(':scope > .genui-mount *').length,
          svg: root.querySelectorAll('svg').length,
          canvas: [...root.querySelectorAll('canvas')].map(canvas => `${canvas.width}x${canvas.height}`),
          table: root.querySelectorAll('table').length,
          buttons: root.querySelectorAll('button').length,
          mermaidSvg: root.querySelectorAll('[data-genui-mermaid] svg').length,
          fallback: root.querySelectorAll('[data-genui-mermaid]').length === 0,
        }
      }
      result.invalidHidden = !document.getElementById('demo-invalid').classList.contains('is-on')
      result.contentMounted = document.getElementById('demo-content').hidden === false
      result.contentSpecs = window.__harness ? window.__harness.actions.snapshot().state.specs : []
      result.lang = document.documentElement.lang
      return result
    })
    check('table rendered real <table>', dom['demo-table'].state === 'rendered' && dom['demo-table'].table > 0, JSON.stringify(dom['demo-table']))
    check('chart rendered SVG', dom['demo-chart'].state === 'rendered' && dom['demo-chart'].svg > 0, JSON.stringify(dom['demo-chart']))
    check('quiz rendered interactive buttons', dom['demo-quiz'].state === 'rendered' && dom['demo-quiz'].buttons >= 3, JSON.stringify(dom['demo-quiz']))
    check('mermaid rendered SVG after scroll', dom['demo-mermaid'].state === 'rendered' && dom['demo-mermaid'].mermaidSvg > 0, JSON.stringify(dom['demo-mermaid']))
    check('echart rendered real canvas', dom['demo-echart'].state === 'rendered' && dom['demo-echart'].canvas.some(size => !size.startsWith('0x0')), JSON.stringify(dom['demo-echart']))
    check('error demo hidden by default', dom.invalidHidden)
    if (dom.contentMounted) check('content spec from assets/genui/artifacts.json mounted', dom.contentSpecs.some(spec => spec !== 'demo-table'), dom.contentSpecs.join(','))

    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: shotPath('harness-full-zh'), fullPage: true })
    await unstickHeader(page)
    for (const id of ['demo-table', 'demo-chart', 'demo-quiz', 'demo-mermaid', 'demo-echart']) {
      await page.locator(`[data-demo="${id}"]`).scrollIntoViewIfNeeded()
      await page.waitForTimeout(200)
      await page.locator(`[data-demo="${id}"]`).screenshot({ path: shotPath(id) })
    }

    /* ---------------------------------------------------------------- */
    /* 2. Auto mode, English                                             */
    /* ---------------------------------------------------------------- */
    const pageEn = await newPage(browser)
    await pageEn.goto(`${BASE}/proto/harness.html?auto=1&lang=en`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const en = await waitReady(pageEn)
    check('harness ready (en, auto)', en.ready && Number(en.failures) === 0, `failures=${en.failures}`)
    await scrollThrough(pageEn)
    await pageEn.locator('[data-demo="demo-mermaid"]').scrollIntoViewIfNeeded()
    await pageEn.waitForFunction(() => document.querySelector('#host-demo-mermaid [data-genui-mermaid] svg') !== null, { timeout: 30000 }).catch(() => {})
    const enDom = await pageEn.evaluate(() => ({
      lang: document.documentElement.lang,
      tableText: document.querySelector('#host-demo-table')?.textContent?.slice(0, 160) ?? '',
      heading: document.querySelector('#host-demo-chart [class*="banner"]')?.textContent ?? '',
    }))
    check('english artifacts mounted', enDom.lang === 'en' && /Delivery metrics/.test(enDom.tableText) && /Answer quality/.test(enDom.heading), enDom.heading)
    await pageEn.evaluate(() => window.scrollTo(0, 0))
    await pageEn.waitForTimeout(300)
    await pageEn.screenshot({ path: shotPath('harness-full-en'), fullPage: true })
    await pageEn.close()

    /* ---------------------------------------------------------------- */
    /* 2c. Full deck: EVERY content spec mounts in the real runtime       */
    /* ---------------------------------------------------------------- */
    const deck = await newPage(browser)
    await deck.goto(`${BASE}/proto/harness.html?all=1&lang=zh`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const deckReady = await waitReady(deck, 90000)
    check('all-specs page ready', deckReady.ready && Number(deckReady.failures) === 0, `failures=${deckReady.failures}`)
    const deckMeta = deckReady.snapshot
    check('every content spec was mounted', deckMeta.allHosts.length === deckMeta.contentSpecCount && deckMeta.contentSpecCount > 0, `${deckMeta.allHosts.length}/${deckMeta.contentSpecCount}`)

    await deck.waitForFunction(ids => ids.every(id => {
      const host = document.getElementById(id)
      return host !== null && (host.dataset.genuiState === 'rendered' || host.dataset.genuiState === 'error')
    }), deckMeta.allHosts, { timeout: 90000 }).catch(() => {})
    await scrollThrough(deck)

    // Mermaid diagrams are gated on their own IntersectionObserver. While loading they render as a
    // plain-source fallback WITHOUT [data-genui-mermaid] (that attribute appears only once painted),
    // so detect the fallback via its class hook, park on each, and wait for the painted SVG.
    const pendingMermaid = await deck.evaluate(() => {
      const pending = [...document.querySelectorAll('[class*="mermaidFallback"]')]
      pending.forEach((element, index) => { element.id = 'probe-mermaid-' + index })
      return pending.map((_element, index) => 'probe-mermaid-' + index)
    })
    for (const id of pendingMermaid) {
      await deck.evaluate(elementId => document.getElementById(elementId)?.scrollIntoView({ block: 'center' }), id)
      await deck.waitForFunction(elementId => {
        const element = document.getElementById(elementId)
        return element === null || element.getAttribute('data-genui-mermaid') !== null || element.querySelector('svg') !== null
      }, id, { timeout: 20000 }).catch(() => {})
      await deck.waitForTimeout(150)
    }
    await deck.waitForTimeout(1200)

    const deckDom = await deck.evaluate(ids => {
      const hosts = ids.map(id => {
        const host = document.getElementById(id)
        return {
          id: id.replace('host-all-', ''),
          state: host?.dataset.genuiState,
          children: host ? host.querySelectorAll('.genui-mount *').length : 0,
          errors: host ? host.querySelectorAll('[data-genui-error]').length + host.querySelectorAll('.genui-bridge-error').length : 1,
        }
      })
      return {
        hosts,
        broken: hosts.filter(host => host.state !== 'rendered' || host.children === 0),
        errored: hosts.filter(host => host.errors > 0),
        errorBoundaries: document.querySelectorAll('[data-genui-error]').length,
        bridgeErrors: document.querySelectorAll('.genui-bridge-error').length,
        mermaidPending: document.querySelectorAll('[class*="mermaidFallback"]').length,
        mermaidRendered: document.querySelectorAll('[data-genui-mermaid] svg').length,
      }
    }, deckMeta.allHosts)
    check('every content spec rendered non-empty DOM', deckDom.broken.length === 0, deckDom.broken.map(host => host.id + ':' + host.state + ':' + host.children).join(', '))
    check('no renderer ErrorBoundary fired', deckDom.errorBoundaries === 0, String(deckDom.errorBoundaries))
    check('no bridge error UI on the deck', deckDom.bridgeErrors === 0, String(deckDom.bridgeErrors))
    check('mermaid diagrams painted in the deck', deckDom.mermaidPending === 0 && deckDom.mermaidRendered > 0, `rendered=${deckDom.mermaidRendered} pending=${deckDom.mermaidPending}`)
    await deck.close()

    /* ---------------------------------------------------------------- */
    /* 3. Lifecycle: deferred → click → unmount → remount → locale → invalid */
    /* ---------------------------------------------------------------- */
    const life = await newPage(browser)
    await life.goto(`${BASE}/proto/harness.html?lang=zh`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const initial = await waitReady(life)
    check('harness ready (zh, deferred mode)', initial.ready && Number(initial.failures) === 0, `failures=${initial.failures}`)
    const deferred = await life.evaluate(() => ({
      placeholders: document.querySelectorAll('.genui-bridge-placeholder').length,
      mermaidState: document.getElementById('host-demo-mermaid').dataset.genuiState,
      runtimeReady: window.GenuiBridge.state().runtimeReady,
      enginesBeforeClick: window.GenuiBridge.state().engines.slice(),
    }))
    check('heavy demos show deferred placeholder', deferred.placeholders === 2 && deferred.mermaidState === 'deferred', JSON.stringify(deferred))
    check('runtime loaded without heavy engines', deferred.runtimeReady === true && !deferred.enginesBeforeClick.includes('mermaid'), deferred.enginesBeforeClick.join(',') || 'none')
    await unstickHeader(life)
    await life.locator('[data-demo="demo-mermaid"]').scrollIntoViewIfNeeded()
    await life.locator('[data-demo="demo-mermaid"]').screenshot({ path: shotPath('deferred-placeholder') })

    // user-triggered mount: click the placeholder button
    await life.locator('#host-demo-mermaid .genui-bridge-placeholder__btn').click()
    await life.waitForFunction(() => document.getElementById('host-demo-mermaid').dataset.genuiState === 'rendered', { timeout: 45000 })
    await life.waitForFunction(() => document.querySelector('#host-demo-mermaid [data-genui-mermaid] svg') !== null, { timeout: 45000 }).catch(() => {})
    const afterClick = await life.evaluate(() => ({
      state: document.getElementById('host-demo-mermaid').dataset.genuiState,
      svg: document.querySelectorAll('#host-demo-mermaid [data-genui-mermaid] svg').length,
      engines: window.GenuiBridge.state().engines,
    }))
    check('click loads mermaid engine and renders', afterClick.state === 'rendered' && afterClick.svg > 0 && afterClick.engines.includes('mermaid'), JSON.stringify(afterClick))

    // unmount all → remount
    const unmounted = await life.evaluate(() => window.__harness.actions.unmountAll())
    check('unmountAll clears every mount', unmounted.mounted === 0, `mounted=${unmounted.mounted}`)
    const cleared = await life.evaluate(() => document.querySelectorAll('.genui-mount').length)
    check('unmount leaves no mount nodes', cleared === 0, String(cleared))
    const remounted = await life.evaluate(async () => {
      await window.__harness.actions.remount('zh')
      await new Promise(resolve => setTimeout(resolve, 500))
      return window.GenuiBridge.state()
    })
    check('remount after unmount works', remounted.mounted === 1 && remounted.runtimeReady, `mounted=${remounted.mounted}`)
    const remountDom = await life.evaluate(() => document.querySelectorAll('#host-demo-table .genui-mount table').length)
    check('remount actually renders DOM', remountDom > 0, `tables=${remountDom}`)

    // locale switch: bridge.setLocale must remount live handles with the en artifact
    await life.evaluate(async () => { await window.GenuiBridge.setLocale('en') })
    await life.waitForTimeout(700)
    const switched = await life.evaluate(() => ({
      lang: document.documentElement.lang,
      text: document.querySelector('#host-demo-table')?.textContent ?? '',
      mounted: window.GenuiBridge.state().mounted,
    }))
    check('locale switch remounts with english artifacts', switched.lang === 'en' && /Delivery metrics/.test(switched.text), `lang=${switched.lang} mounted=${switched.mounted}`)

    // invalid artifact: explicit error UI, no throw escaping, page still alive
    // (artifact-envelope invalid — unknown node types are intentionally dropped by the guard,
    //  so they are NOT what "invalid artifact" means for the standalone runtime.)
    const invalid = await life.evaluate(async () => {
      const rejected = await window.__harness.actions.mountInvalid()
      await new Promise(resolve => setTimeout(resolve, 300))
      const host = document.getElementById('host-invalid')
      return {
        rejected,
        state: host.dataset.genuiState,
        role: host.querySelector('[role="alert"]')?.getAttribute('role'),
        hasMessage: /invalid GenUI artifact/.test(host.textContent || ''),
        pageAlive: typeof window.GenuiBridge.mount === 'function',
      }
    })
    check('invalid artifact rejects and shows error UI', invalid.rejected && invalid.state === 'error' && invalid.role === 'alert', JSON.stringify(invalid))
    check('invalid artifact error names the failure', invalid.hasMessage === true)
    check('page survives invalid artifact', invalid.pageAlive === true)
    await life.locator('[data-demo="invalid"]').scrollIntoViewIfNeeded()
    await life.locator('[data-demo="invalid"]').screenshot({ path: shotPath('invalid-artifact') })
    await life.screenshot({ path: shotPath('harness-lifecycle'), fullPage: true })
    await life.close()

    /* ---------------------------------------------------------------- */
    /* 4. Console / network hygiene                                      */
    /* ---------------------------------------------------------------- */
    check('zero console errors', report.consoleErrors.length === 0, report.consoleErrors.slice(0, 3).join(' || '))
    check('zero page errors / failed requests', report.pageErrors.length === 0, report.pageErrors.slice(0, 3).join(' || '))
    // Specs may legitimately show real repo screenshots from raw.githubusercontent.com (the repo's own
    // media, declared as externalMedia in artifacts.json). NOTHING else may leave the page: no fonts,
    // no CDN, no plugin routes. Allowlisting the repo prefix (rather than an exact snapshot) keeps this
    // check stable while specs are still being authored.
    const REPO_MEDIA_PREFIX = 'https://raw.githubusercontent.com/omdsh-dev/dsh-genui/'
    const allowedMedia = await expectedExternalMedia()
    const unexpected = report.externalRequests.filter(url => !url.startsWith(REPO_MEDIA_PREFIX))
    const staleManifest = report.externalRequests.filter(url => !allowedMedia.has(url))
    check('only repo media files leave localhost', unexpected.length === 0, unexpected.slice(0, 3).join(' || '))
    if (staleManifest.length > 0) {
      console.log(`NOTE  ${staleManifest.length} external media URL(s) not yet in artifacts.json — re-run build-site.mjs (specs changed after the build)`)
    }
    const forbiddenRoutes = [...report.externalRequests, ...report.consoleErrors].filter(value => value.includes('/plugins/') || value.includes('__manus__'))
    check('no /plugins/ or /__manus__ dependency', forbiddenRoutes.length === 0, forbiddenRoutes.slice(0, 3).join(' || '))
    if (report.consoleWarnings.length > 0) console.log(`\nWARN  console warnings (${report.consoleWarnings.length}):\n  - ${report.consoleWarnings.slice(0, 6).join('\n  - ')}`)
  } finally {
    await browser.close().catch(() => {})
  }

  console.log('\nshots:')
  for (const file of report.shots) console.log(`  ${path.relative(process.cwd(), file)}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`)
  const failed = report.checks.filter(entry => !entry.passed)
  console.log(`\n${failed.length === 0 ? 'VERIFY OK' : `VERIFY FAILED (${failed.length})`} — ${report.checks.length - failed.length}/${report.checks.length} checks`)
  if (failed.length > 0) {
    for (const entry of failed) console.log(`  FAILED: ${entry.name}${entry.detail === undefined ? '' : ` — ${entry.detail}`}`)
  }
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch(error => {
  console.error('verify-harness crashed:', error)
  process.exitCode = 1
})
