import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const browser = process.env.BROWSER_BIN ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
let checked = 0
for (const fixtureName of ['content-font-size.html', 'plot-content-font-size.html']) {
  const fixture = pathToFileURL(resolve('tests/browser', fixtureName)).href
  const profile = mkdtempSync(join(tmpdir(), 'dsh-genui-font-browser-'))
  let output
  try {
    output = execFileSync(browser, [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-background-networking', '--no-first-run',
      '--password-store=basic', '--use-mock-keychain', `--user-data-dir=${profile}`, '--dump-dom', fixture,
    ], { encoding: 'utf8', timeout: 30000 })
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
  const document = new JSDOM(output).window.document
  const results = JSON.parse(document.getElementById('results').textContent)
  const rootCount = fixtureName === 'content-font-size.html' ? 2 : 1
  assert.equal(results.samples.length, rootCount * Object.keys(results.tokenSizes).length * 6)
  for (const sample of results.samples) {
    const originalSize = results.tokenSizes[sample.token]
    const expectedSize = Math.max(originalSize, originalSize * (sample.contentSize ?? 14) / 17)
    assert.ok(Number.isFinite(sample.fontSize), `${sample.root}/${sample.token}/${sample.contentSize}: invalid font size`)
    assert.ok(Math.abs(sample.fontSize - expectedSize) < 0.03, `${sample.root}/${sample.token}/${sample.contentSize}: ${sample.fontSize}px, expected ${expectedSize}px`)
  }
  checked += results.samples.length
}
console.log(`Host content font size browser check passed: ${checked} computed styles`)
