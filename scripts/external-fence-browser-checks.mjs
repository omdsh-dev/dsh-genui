import assert from 'node:assert/strict'
import { join } from 'node:path'

/** Known external projections must remain live after discovery and reparenting. */
export async function runExternalFenceBrowserChecks({ page, artifactsDir }) {
  await page.evaluate(() => {
    const transcript = document.createElement('div')
    transcript.dataset.chatFlow = ''
    transcript.dataset.externalFenceTranscript = ''
    const fixture = document.createElement('section')
    fixture.dataset.externalFenceAcceptance = ''
    fixture.innerHTML = '<div class="md-code-block"><div data-code-block-banner><div>dsh-ui</div></div><pre></pre></div>'
    fixture.querySelector('pre').textContent = JSON.stringify({ items: [{ type: 'text', content: 'External original' }] })
    document.body.prepend(transcript, fixture)
  })
  const fixture = page.locator('[data-external-fence-acceptance]')
  const visibleText = text => fixture.locator('[data-genui]').getByText(text, { exact: true }).waitFor({ state: 'visible', timeout: 2500 })
  try {
    await visibleText('External original')
    await fixture.locator('.md-code-block > pre').evaluate(pre => {
      pre.textContent = JSON.stringify({ items: [{ type: 'text', content: 'External updated' }] })
    })
    await visibleText('External updated')
    await fixture.locator('.genui-dom-fence').evaluate(container => container.replaceChildren())
    await visibleText('External updated')
    await fixture.locator('.md-code-block').evaluate(block => { block.style.display = '' })
    await page.waitForFunction(() => document.querySelector('[data-external-fence-acceptance] .md-code-block')?.style.display === 'none', null, { timeout: 2500 })
    // Move an already known projection into a previously empty wrapper.
    await fixture.evaluate(scope => {
      const next = document.createElement('div')
      scope.append(next)
      next.append(scope.querySelector('.md-code-block'), scope.querySelector('.genui-dom-fence'))
    })
    await fixture.locator('.md-code-block > pre').evaluate(pre => {
      pre.textContent = JSON.stringify({ items: [{ type: 'text', content: 'External moved' }] })
    })
    await visibleText('External moved')
    await fixture.screenshot({ path: join(artifactsDir, 'external-fence-updated.png') })
    // Completion is on an ancestor above the source's immediate parent.
    await fixture.evaluate(scope => {
      scope.setAttribute('data-streaming', '')
      scope.querySelector('pre').textContent = '{"items":[{"type":"text","content":'
    })
    await fixture.locator('[data-genui-skeleton]').waitFor({ state: 'visible', timeout: 2500 })
    await fixture.evaluate(scope => scope.removeAttribute('data-streaming'))
    await fixture.locator('[role=alert]').waitFor({ state: 'visible', timeout: 2500 })
    assert.equal(await fixture.locator('.md-code-block').isVisible(), true)
    assert.equal(await fixture.locator('[data-genui-skeleton]').count(), 0)
    await fixture.screenshot({ path: join(artifactsDir, 'external-fence-settled.png') })
  } finally {
    await fixture.evaluate(scope => scope.remove())
    await page.locator('[data-external-fence-transcript]').evaluate(scope => scope.remove())
  }
}
