import assert from 'node:assert/strict'
import { join } from 'node:path'

/** Exercise the installed DOM renderer; no model calls or real user content. */
export async function runFenceContentBrowserChecks({ page, artifactsDir }) {
  const explanation = 'The explanation after the component must remain visible.'
  const suffix = `${explanation}\n<script>window.genuiTailExecuted = true</script>`
  const spec = JSON.stringify({ items: [{ type: 'callout', content: 'Fence content preservation' }] })
  await page.evaluate(({ spec, suffix }) => {
    const row = document.createElement('div')
    row.dataset.fenceContentSmoke = ''
    row.dataset.chatFlowKind = 'assistant-step'
    row.dataset.chatNodeKey = 'fence-content-smoke'
    row.dataset.chatAnchorKey = 'fence-content-smoke'
    row.dataset.streaming = ''
    row.style.cssText = 'padding:20px;max-width:720px;background:white;color:black'
    const block = document.createElement('div')
    block.className = 'md-code-block'
    const banner = document.createElement('div')
    banner.dataset.codeBlockBanner = ''
    const label = document.createElement('div')
    label.textContent = 'dsh-ui'
    banner.append(label)
    const pre = document.createElement('pre')
    pre.style.whiteSpace = 'pre-wrap'
    pre.textContent = `${spec}\n${suffix}`
    block.append(banner, pre)
    row.append(block)
    document.body.prepend(row)
  }, { spec, suffix })
  const fixture = page.locator('[data-fence-content-smoke]')
  try {
    await fixture.locator('[data-genui]').waitFor({ state: 'visible' })
    // Streaming still renders progressively. Completion must restore the source.
    await fixture.evaluate(row => row.removeAttribute('data-streaming'))
    await fixture.locator('[role=alert]').waitFor({ state: 'visible' })
    const raw = fixture.locator('.md-code-block > pre')
    await raw.waitFor({ state: 'visible' })
    assert.equal(await raw.textContent(), `${spec}\n${suffix}`)
    assert.equal(await fixture.locator('[data-genui-export]').count(), 0)
    assert.equal(await page.evaluate(() => window.genuiTailExecuted), undefined)
    await fixture.screenshot({ path: join(artifactsDir, 'fence-content-preserved.png') })
    // A corrected reply has a proper fence and a separate paragraph.
    await fixture.evaluate((row, { spec, suffix }) => {
      row.querySelector('pre').textContent = spec
      const paragraph = document.createElement('p')
      paragraph.textContent = suffix
      row.append(paragraph)
    }, { spec, suffix })
    await fixture.locator('[data-genui]').waitFor({ state: 'visible' })
    await fixture.locator('[role=alert]').waitFor({ state: 'detached' })
    await fixture.locator('p').waitFor({ state: 'visible' })
    assert.equal(await fixture.locator('p').textContent(), suffix)
    assert.equal(await page.evaluate(() => window.genuiTailExecuted), undefined)
    await fixture.screenshot({ path: join(artifactsDir, 'fence-content-corrected.png') })
  } finally {
    await fixture.evaluate(row => row.remove())
  }
}
