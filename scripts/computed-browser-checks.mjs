/** Regression acceptance through the installed renderer, actual session and exported standalone runtime. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const computedSpec = {
  title: 'Computed acceptance', computed: [{ id: 'total', expr: 'amount*2' }], items: [
    { type: 'tabs', tabs: [
      { label: 'Private', items: [{ type: 'input', id: 'secret', inputType: 'password', label: 'Private field' }] },
      { label: 'Public', items: [{ type: 'input', id: 'note', label: 'Public field' }] },
    ] },
    { type: 'accordion', items: [{ title: 'Amount section', items: [{ type: 'input', id: 'amount', inputType: 'number', label: 'Amount', value: '2' }] }] },
    { type: 'text', content: 'Result {{total}}' },
    { type: 'checkbox', group: 'choices', label: 'Choose {{total}}' },
    { type: 'echart', preset: 'heatmap', height: 180, series: [{ label: 'S', data: [{ label: 'Zero', value: 0 }, { label: 'Computed', value: { $computed: 'total' } }] }] },
    { type: 'submit', label: 'Send computed', action: 'computed-submit', groups: ['note', 'amount', 'choices'] },
  ],
}
export const panelBase = { panel: true, title: 'Computed panel acceptance',
  computed: [{ id: 'base', expr: 'panelAmount*2' }], items: [{ type: 'input', id: 'panelAmount', inputType: 'number', label: 'Panel amount', value: '3' }],
}
export const panelAppend = { panel: true, append: true,
  computed: [{ id: 'answer', expr: 'base+1' }], items: [{ type: 'text', content: 'Panel answer {{answer}}' }],
}
export async function editPanelBeforeAppend(page) {
  const panel = page.locator('[data-genui-panel]')
  await panel.waitFor({ state: 'visible' })
  await panel.locator('button[aria-expanded="false"]').first().click()
  await panel.getByLabel('Panel amount', { exact: true }).fill('5')
  await panel.locator('button[aria-expanded="true"]').first().click()
}
export async function checkPanelAfterAppend(page) {
  const panel = page.locator('[data-genui-panel]')
  await panel.locator('button[aria-expanded="false"]').first().click()
  assert.equal(await panel.getByLabel('Panel amount', { exact: true }).inputValue(), '5')
  await panel.getByText('Panel answer 11', { exact: true }).waitFor({ state: 'visible' })
  await panel.locator('button[aria-expanded="true"]').first().click()
}

export async function runComputedBrowserChecks({ page, browser, artifactsDir, verifySubmit }) {
  const report = { fixture: 'Official rc.3 replay conversation; installed tarball and exported HTML', passed: false }
  let standalone
  try {
    let root = page.locator('[data-chat-flow-kind="assistant-step"] [data-genui-artifact]').filter({ has: page.getByText('Computed acceptance', { exact: true }) })
    await root.getByLabel('Private field', { exact: true }).fill('SYNTHETIC_SECRET_TEST_ONLY')
    await root.getByRole('tab', { name: 'Public', exact: true }).click()
    assert.equal(await root.getByLabel('Public field', { exact: true }).inputValue(), '')
    await root.getByLabel('Public field', { exact: true }).fill('safe note')
    await root.getByRole('checkbox', { name: 'Choose 4', exact: true }).check()
    await root.getByRole('textbox', { name: /^Amount/ }).fill('3')
    assert.equal(await root.getByRole('checkbox', { name: 'Choose 6', exact: true }).isChecked(), true)
    await root.getByRole('textbox', { name: /^Amount/ }).fill('-')
    await root.getByRole('button', { name: 'Amount section', exact: true }).click()
    assert.equal(await root.getByRole('button', { name: 'Send computed', exact: true }).isDisabled(), true)
    await root.getByRole('button', { name: 'Amount section', exact: true }).click()
    assert.equal(await root.getByRole('textbox', { name: /^Amount/ }).inputValue(), '-')
    await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('dsh.genui.interaction') || '{"blocks":{}}').blocks)
      .some(state => state.fields?.amount === '-' && state.fields?.note === 'safe note'))
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('SYNTHETIC_SECRET_TEST_ONLY')), false)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await root.getByRole('textbox', { name: /^Amount/ }).waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await root.getByRole('textbox', { name: /^Amount/ }).inputValue(), '-')
    assert.equal(await root.getByRole('button', { name: 'Send computed', exact: true }).isDisabled(), true)
    report.hostDraftAndSecret = true
    const download = async format => {
      await root.getByRole('button', { name: /^(导出|Export)$/ }).click()
      const pending = page.waitForEvent('download')
      await root.getByRole('menuitem', { name: format === 'html' ? 'HTML' : 'GenUI JSON', exact: true }).click()
      const file = join(artifactsDir, `computed-acceptance.${format}`)
      await (await pending).saveAs(file)
      return file
    }
    const jsonFile = await download('json')
    const artifactText = await readFile(jsonFile, 'utf8')
    const artifact = JSON.parse(artifactText)
    assert.deepEqual(artifact.state.fields, { note: 'safe note', amount: '-' })
    assert.deepEqual(artifact.state.multiAnswers.choices, ['Choose {{total}}'])
    assert.ok(!artifactText.includes('SYNTHETIC_SECRET_TEST_ONLY'))
    const htmlFile = await download('html')
    standalone = await browser.newPage({ viewport: { width: 480, height: 640 }, locale: 'zh-CN' })
    const errors = []
    standalone.on('pageerror', error => errors.push(error.message))
    await standalone.goto(pathToFileURL(htmlFile).href)
    await standalone.getByRole('textbox', { name: /^Amount/ }).waitFor({ state: 'visible' })
    assert.equal(await standalone.getByRole('textbox', { name: /^Amount/ }).inputValue(), '-')
    assert.equal(await standalone.getByRole('checkbox').isChecked(), true)
    await standalone.getByRole('textbox', { name: /^Amount/ }).fill('3')
    await standalone.getByText('Result 6', { exact: true }).waitFor({ state: 'visible' })
    assert.equal(await standalone.getByRole('checkbox', { name: 'Choose 6', exact: true }).isChecked(), true)
    await standalone.getByRole('textbox', { name: /^Amount/ }).fill('')
    await standalone.locator('canvas').first().waitFor({ state: 'visible' })
    // Read the actual heatmap canvas: the zero category is painted, while the
    // cleared computed category has no cell. Sample inside each cell away
    // from labels, borders and axes; wait for ECharts' normal repaint.
    await assertHeatmapPixels(standalone, true)
    await standalone.screenshot({ path: join(artifactsDir, 'computed-standalone-missing-value.png'), fullPage: true })
    await standalone.getByRole('textbox', { name: /^Amount/ }).fill('0')
    await assertHeatmapPixels(standalone, false)
    await standalone.screenshot({ path: join(artifactsDir, 'computed-standalone-zero-value.png'), fullPage: true })
    report.heatmapPixels = { realZeroPainted: true, missingCellAbsent: true, repairedZeroPainted: true }
    assert.deepEqual(errors, [])
    report.exportAndStandalone = true
    await root.getByRole('tab', { name: 'Public', exact: true }).click()
    assert.equal(await root.getByLabel('Public field', { exact: true }).inputValue(), 'safe note')
    await root.getByRole('textbox', { name: /^Amount/ }).fill('3')
    assert.equal(await root.getByRole('checkbox', { name: 'Choose 6', exact: true }).isChecked(), true)
    await root.screenshot({ path: join(artifactsDir, 'computed-host-ready.png') })
    report.action = await verifySubmit(root)
    report.passed = true
  } catch (error) {
    report.error = String(error)
    throw error
  } finally {
    await standalone?.close()
    await writeFile(join(artifactsDir, 'computed-browser-results.json'), `${JSON.stringify(report, null, 2)}\n`)
  }
}

export async function assertHeatmapPixels(page, missing) {
  await page.waitForFunction(missing => {
        const canvas = document.querySelector('canvas')
        if (!canvas) return false
        const context = canvas.getContext('2d')
        const alpha = fraction => context.getImageData(Math.floor(canvas.width * fraction), Math.floor(canvas.height * 0.3), 1, 1).data[3]
        return alpha(0.4) > 240 && (missing ? alpha(0.8) === 0 : alpha(0.8) > 240)
      }, missing, { timeout: 10000 })
}
