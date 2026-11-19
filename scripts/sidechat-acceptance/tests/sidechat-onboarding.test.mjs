/** Pure shape/orchestration and locator-call contracts, not browser/host acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ONBOARDING_DIALOGS, classifyOnboardingDialog, runOnboardingSequence,
  readOnboardingDialog, completeSyntheticOnboarding } from '../scripts/sidechat-onboarding.mjs'
const normalized = value => value.replace(/\s+/gu, ' ').trim()
const snapshot = spec => ({ title: spec.title, role: 'dialog', modal: 'true', describedBy: null,
  headings: [spec.title], paragraphs: spec.paragraphs.map(normalized),
  buttons: spec.buttons.map(button => ({ ...button, disabled: false })),
  text: normalized([spec.title, ...spec.paragraphs, ...spec.buttons.map(button => button.text)].join(' ')),
  extraControls: 0, alerts: 0, busy: false })
const [preview, setup, previewZh, setupZh] = ONBOARDING_DIALOGS
for (const spec of ONBOARDING_DIALOGS) test(`exact ${spec.locale} ${spec.kind} has only its approved action`, () => {
  assert.equal(classifyOnboardingDialog(snapshot(spec)), spec)
  assert.ok(['Continue', '继续', 'Close', '关闭'].includes(spec.action))
  assert.ok(!['Sign in', '登录', 'Add API Key', '添加 API Key'].includes(spec.action))
})
const corruptions = {
  'unknown title': value => { value.title += ' changed' },
  'extra binding terms paragraph': value => { value.paragraphs.push('By continuing, you accept new Terms of Service.') },
  'changed copy under approved title': value => { value.paragraphs[0] = 'Permission required' },
  'extra full-text warning': value => { value.text += ' Security warning' },
  'different button order': value => { value.buttons.reverse(); value.buttons.push({ label: 'Confirm', text: 'Confirm', disabled: false }) },
  'disabled action or busy committing': value => { value.buttons[0].disabled = true },
  'extra credential input or link': value => { value.extraControls = 1 },
  'security alert': value => { value.alerts = 1 },
  'active sign-in attempt': value => { value.busy = true },
  'different accessible heading': value => { value.headings[0] = 'Other dialog' },
  'multiple headings': value => { value.headings.push(value.title) },
  'hidden referenced description': value => { value.describedBy = 'other-terms' },
  'alertdialog role': value => { value.role = 'alertdialog' },
  'missing busy guard': value => { delete value.busy },
  'nonmodal shape': value => { value.modal = 'false' },
  'missing guard fields': value => { delete value.extraControls },
}
for (const [label, mutate] of Object.entries(corruptions)) test(`rejects ${label} for every allowed dialog`, () => {
  for (const spec of ONBOARDING_DIALOGS) {
    const altered = snapshot(spec); mutate(altered)
    assert.equal(classifyOnboardingDialog(altered), null)
  }
})
for (const title of ['Waiting for sign in', 'Sign in timed out', 'Could not sign in', 'MFA required',
  'Access denied', 'Permission required', '等待登录', '登录已超时', '登录失败', '添加一个 API Key 开始使用']) {
  test(`never dismisses ${title}`, () => {
    assert.equal(classifyOnboardingDialog({ ...snapshot(setup), title }), null)
  })
}
function simulation({ notice = preview, optional = setup, mountAt = 500, readyAt = 0,
  initial, repeat, dismissFailure, count = 1 } = {}) {
  let now = 0, dismissed = 0, trialChecks = 0
  const clicks = [], seen = [], report = {}
  const driver = {
    now: () => now, pause: async () => { now += 100 },
    readDialogs: async () => {
      let current = initial ?? (dismissed === 0 ? notice : optional && dismissed === 1 && now >= mountAt ? optional : null)
      if (repeat && dismissed === 1) current = notice
      const value = current ? { count, snapshot: snapshot(current) } : { count: 0 }
      seen.push({ now, count: value.count }); return value
    },
    dismiss: async spec => { clicks.push(spec.action); if (dismissFailure) throw dismissFailure; dismissed++ },
    workspaceReady: async () => { trialChecks++; return now >= readyAt },
  }
  return { driver, report, clicks, seen, time: () => now, trials: () => trialChecks }
}
for (const [notice, optional] of [[preview, setup], [previewZh, setupZh]]) {
  test(`${notice.locale} delayed optional dialog receives only Close after Continue`, async () => {
    const s = simulation({ notice, optional })
    await runOnboardingSequence(s.driver, s.report)
    assert.deepEqual(s.clicks, [notice.action, optional.action])
    assert.equal(s.report.status, 'ready'); assert.equal(s.report.workspaceActionabilityChecked, true)
    assert.ok(s.seen.some(step => step.now > 0 && step.now < 500 && step.count === 0))
    assert.ok(s.time() >= 1600); assert.ok(s.trials() > 1)
  })
}
test('provider-ready path still requires a stable actual-actionability window', async () => {
  const s = simulation({ optional: null, readyAt: 700 })
  await runOnboardingSequence(s.driver, s.report)
  assert.deepEqual(s.clicks, ['Continue']); assert.ok(s.time() >= 1700)
})
test('an initially empty screen cannot silently skip the required fresh preview', async () => {
  const s = simulation({ notice: null, optional: null })
  await assert.rejects(runOnboardingSequence(s.driver, s.report), /readiness-timeout/)
  assert.deepEqual(s.clicks, []); assert.equal(s.trials(), 0)
})
test('a persistent overlay blocks readiness, even when no known dialog is mounted', async () => {
  const s = simulation({ optional: null, readyAt: Infinity })
  await assert.rejects(runOnboardingSequence(s.driver, s.report), /readiness-timeout/)
  assert.deepEqual(s.clicks, ['Continue'])
})
test('unknown dialog is refused without revealing arbitrary content', async () => {
  const s = simulation({ initial: { ...preview, title: 'Synthetic private auth token sentinel' } })
  await assert.rejects(runOnboardingSequence(s.driver, s.report), error => {
    assert.ok(!error.message.includes('sentinel')); return /unrecognized-dialog/.test(error.message)
  })
  assert.deepEqual(s.clicks, []); assert.ok(!JSON.stringify(s.report).includes('sentinel'))
  assert.equal(s.report.lastDialog.titleKind, 'unknown')
})
test('setup must follow the preview, not replace it', async () => {
  const s = simulation({ initial: setup })
  await assert.rejects(runOnboardingSequence(s.driver, s.report), /unexpected-dialog-order/)
  assert.deepEqual(s.clicks, [])
})
test('multiple visible dialogs fail instead of selecting the first', async () => {
  const s = simulation({ count: 2 })
  await assert.rejects(runOnboardingSequence(s.driver, s.report), /multiple-dialogs/)
  assert.deepEqual(s.clicks, [])
})
test('reappearing dialog is not repeatedly acknowledged', async () => {
  const s = simulation({ repeat: true })
  await assert.rejects(runOnboardingSequence(s.driver, s.report), /repeated-dialog/)
  assert.deepEqual(s.clicks, ['Continue'])
})
test('failed click or disappearance propagates once, without leaking its error or retry', async () => {
  const s = simulation({ dismissFailure: Error('synthetic URL token sentinel') })
  await assert.rejects(runOnboardingSequence(s.driver, s.report), /browser-interaction-failed/)
  assert.deepEqual(s.clicks, ['Continue']); assert.equal(s.report.status, 'failed')
  assert.equal(s.report.actions.length, 0); assert.ok(!JSON.stringify(s.report).includes('sentinel'))
})
test('DOM observation reads shape only, not input values, URLs or storage', async () => {
  const selectors = [], attributes = []
  const empty = { getAttribute: key => { attributes.push(key); return null }, innerText: '',
    querySelectorAll: selector => { selectors.push(selector); return [] }, querySelector: () => null }
  Object.defineProperty(empty, 'value', { get() { throw Error('Must not inspect input value') } })
  await readOnboardingDialog({ evaluate: fn => fn(empty) })
  assert.deepEqual(attributes, ['aria-label', 'role', 'aria-modal', 'aria-describedby', 'aria-busy'])
  assert.ok(selectors.some(selector => selector.includes('input')))
})
test('real browser adapter scopes normal click, awaits disappearance, and only trials workspace', async () => {
  let dismissed = false, trials = 0
  const calls = [], report = {}
  const dialog = { count: async () => dismissed ? 0 : 1,
    evaluate: async () => snapshot(preview),
    getByRole: (role, options) => { calls.push(['control', role, options]); return {
      count: async () => 1, click: async options => { calls.push(['click', options]); dismissed = true },
    } }, waitFor: async options => calls.push(['wait', options]) }
  const page = {
    locator: selector => selector === '#root' ? { count: async () => 1, evaluate: async () => false } : dialog,
    getByRole: (role, options) => { calls.push(['dialog', role, options]); return dialog },
  }
  const workspace = { click: async options => { assert.deepEqual(options, { trial: true, timeout: 250 }); trials++ } }
  await completeSyntheticOnboarding(page, workspace, report)
  assert.deepEqual(calls, [
    ['dialog', 'dialog', { name: 'Preview Notice', exact: true }],
    ['control', 'button', { name: 'Continue', exact: true }],
    ['click', { timeout: 10000 }], ['wait', { state: 'detached', timeout: 10000 }],
  ])
  assert.ok(trials > 1); assert.equal(report.status, 'ready')
})
test('runner awaits the guard before its first actual workspace click and browser callback', async () => {
  const code = await readFile(new URL('../scripts/run-sidechat-acceptance.mjs', import.meta.url), 'utf8')
  const guard = code.indexOf('await completeSyntheticOnboarding(page, workspaceRow, report.onboarding)')
  assert.ok(guard > 0 && guard < code.indexOf('await workspaceRow.click({ timeout: 15000 })'))
  assert.ok(guard < code.indexOf('const browserReport = await timeout'))
})

test('DOM extraction also refuses nonnative widgets and all editable content states', async () => {
  let controlsSelector
  const node = { getAttribute: name => name === 'role' ? 'dialog' : null, innerText: '',
    querySelectorAll: selector => { if (selector.startsWith('a,input,')) controlsSelector = selector; return [] },
    querySelector: () => null }
  await readOnboardingDialog({ evaluate: fn => fn(node) })
  for (const role of ['link', 'radio', 'radiogroup', 'slider', 'spinbutton', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'listbox', 'option', 'tree', 'treeitem', 'grid', 'gridcell', 'tab', 'tablist', 'form']) {
    assert.ok(controlsSelector.includes(`[role="${role}"]`), `Custom ${role} must be counted even with no innerText`)
    for (const spec of ONBOARDING_DIALOGS) assert.equal(classifyOnboardingDialog({ ...snapshot(spec), extraControls: 1 }), null)
  }
  assert.ok(controlsSelector.includes('[contenteditable]:not([contenteditable="false"])'),
    'Includes empty, true and plaintext-only editable attributes, not just true')
  for (const tag of ['iframe', 'object', 'embed', 'audio', 'video']) assert.ok(controlsSelector.split(',').includes(tag))
})
