/** Future real-host Playwright acceptance. NOT executed by the pure contracts.
 * Caller owns authenticated loopback page, exact candidates, public synthetic
 * seed/flush/restart and backend oracles. No installs, private context access,
 * DOM construction, request interception, browser launch or API action sending.
 */
import assert from 'node:assert/strict'
import { observeUiAwayCreate, verifyUiAwaySelection } from './sidechat-away-navigation.mjs'
import { nativeThreadTab } from './sidechat-browser-locators.mjs'
import { isSidechatActionRequest, verifyActionResponse } from './sidechat-browser-transport.mjs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TITLE, FIELD_LABEL, BUTTON_LABEL, SUBMIT_LABEL, POSITIONS, fixtureValues,
  actionPlan, validateInputs, initialExpected, validateSnapshot, bounded,
  executeOwnedAction } from './sidechat-browser-contracts.mjs'

const THREAD_MENU = /^(Switch thread \/ new|切换线程 \/ 新建)$/u
const SURFACE = '[data-genui-surface="dsh-better-sidebar/sidechat"]'
const MAIN_FORMS = '[data-chat-flow-kind="assistant-step"] [data-genui]:visible'
const TOTAL_MS = 240000
const STEP_MS = 15000

export async function checkSidechatBrowser(options) {
  const ids = validateInputs(options) // All required callbacks validated before touching UI.
  const { page, artifactsDir, parentId, childIds, awaySessionId, workspaceId, bindUiAwaySession, seed,
    readBackendSnapshot, waitForBackendAction, report = {} } = options
  assert.ok(page && typeof page.locator === 'function', 'An actual Playwright page is required')
  assert.equal(typeof artifactsDir, 'string')
  const location = new URL(page.url())
  assert.equal(location.protocol, 'http:')
  assert.equal(location.hostname, '127.0.0.1', 'Only the isolated loopback synthetic host is allowed')
  assert.equal(location.search, '', 'Exchange launch token before invoking the helper; never capture it')
  const viewport = page.viewportSize()
  assert.ok(viewport && viewport.width >= 1100 && viewport.height >= 700,
    'Use an explicit desktop viewport with main conversation and sidebar both visible')
  const deadline = Date.now() + TOTAL_MS
  const remaining = () => {
    assert.ok(Date.now() < deadline, 'Sidechat acceptance exceeded four minutes')
    return Math.max(1, Math.min(STEP_MS, deadline - Date.now()))
  }
  const run = (operation, label) => bounded(operation, remaining(), label)
  const poll = async (read, accepts, label) => {
    const expires = Date.now() + remaining()
    do {
      const value = await run(read, label)
      if (accepts(value)) return value
      await new Promise(resolve => setTimeout(resolve, 50))
    } while (Date.now() < expires)
    assert.fail(label)
  }
  const count = (locator, expected, label) => poll(() => locator.count(), n => n === expected, label)
  const attr = (locator, name) => locator.getAttribute(name, { timeout: remaining() })
  const click = async locator => {
    await count(locator, 1, 'Trusted control must resolve uniquely')
    await locator.click({ timeout: remaining() })
  }
  const onScreen = async locator => {
    const box = await run(() => locator.boundingBox(), 'on-screen geometry')
    return box !== null && box.width > 0 && box.height > 0 && box.x + box.width > 0
      && box.y + box.height > 0 && box.x < viewport.width && box.y < viewport.height
  }
  const uniqueOnScreen = async locator => {
    const result = []
    for (const entry of await run(() => locator.all(), 'visible controls')) if (await onScreen(entry)) result.push(entry)
    assert.equal(result.length, 1, 'Exactly one real on-screen control required')
    return result[0]
  }
  const parentOwner = page.locator(`[data-sidebar-right-session="${parentId}"][data-sidebar-right-panel]`)
  const mainForms = () => page.locator(MAIN_FORMS).filter({ hasText: TITLE })
  const body = () => parentOwner.locator('[data-dsh-native-tab-host]:visible')
    .filter({ has: page.getByRole('button', { name: THREAD_MENU }) })
  const rows = () => body().locator(`${SURFACE} ${SURFACE}`).filter({ hasText: 'Fixture text block' })
  const sideForms = () => rows().locator('[data-genui-explicit-fence] [data-genui]')
  const input = form => form.getByRole('textbox', { name: FIELD_LABEL, exact: true })
  const selectSession = async id => {
    const row = page.locator(`[data-row-key="session:${id}"]`)
    await click(row)
    await poll(() => attr(row, 'aria-selected'), value => value === 'true', 'Actual workspace session selection')
  }
  const openGuide = async kind => {
    const expand = page.locator('[data-sidebar-right-expand]')
    const onscreen = []
    for (const entry of await run(() => expand.all(), 'sidebar expand controls')) if (await onScreen(entry)) onscreen.push(entry)
    assert.ok(onscreen.length <= 1, 'Ambiguous sidebar expand control')
    if (onscreen.length) await click(onscreen[0])
    await count(parentOwner, 1, 'Parent sidebar owner must be unique')
    const guide = parentOwner.locator(`[data-sidebar-right-guide-entry="${kind}"]`)
    if (!(await guide.count()) || !(await onScreen(guide))) {
      await click(await uniqueOnScreen(parentOwner.locator('[data-dockkit-add-tab]')))
    }
    await click(guide)
  }
  const assertMain = async values => {
    await count(mainForms(), 4, 'Four actual main-conversation fixture forms required')
    for (let index = 0; index < 4; index++) {
      const form = mainForms().nth(index)
      const ownership = await run(() => form.evaluate(element => ({
        kind: element.closest('[data-chat-flow-kind]')?.getAttribute('data-chat-flow-kind'),
        anchor: element.closest('[data-chat-anchor-key]')?.getAttribute('data-chat-anchor-key'),
        inSidechat: element.closest('[data-genui-surface], [data-sidebar-right-session]') !== null,
      })), 'read production main ownership')
      assert.equal(ownership.kind, 'assistant-step')
      assert.ok(ownership.anchor, 'Real main host anchor required; never fabricate one')
      assert.equal(ownership.inSidechat, false, 'Sidechat must not be counted as main rendering')
      assert.equal(await input(form).inputValue({ timeout: remaining() }), values[index])
    }
  }
  const assertSide = async values => {
    await count(body(), 1, 'One visible real sidechat body required')
    await count(rows(), 2, 'Original text blocks 0 and 2 must each render their own assistant row')
    for (let rowIndex = 0; rowIndex < 2; rowIndex++) {
      const row = rows().nth(rowIndex)
      const block = rowIndex === 0 ? 0 : 2
      const rowText = await row.textContent({ timeout: remaining() })
      for (const fence of [0, 1]) assert.ok(rowText.includes(`Fixture text block ${block}, fence ${fence}`))
      await count(row.locator('[data-genui-explicit-fence] [data-genui]'), 2,
        'Each original text block must contain two production explicit fences')
      const ownership = await run(() => row.evaluate(element => ({
        mainAnchor: element.closest('[data-chat-anchor-key]') !== null,
        mainKind: element.closest('[data-chat-flow-kind]') !== null,
        mainTakeover: element.querySelector('.genui-dom-fence') !== null,
      })), 'read production sidechat ownership')
      assert.deepEqual(ownership, { mainAnchor: false, mainKind: false, mainTakeover: false },
        'Sidechat must render through its explicit production hook, not impersonate a main row')
    }
    await count(sideForms(), 4, 'Four sidechat fixture forms required; never skip an identity')
    for (let index = 0; index < 4; index++) {
      assert.equal(await input(sideForms().nth(index)).inputValue({ timeout: remaining() }), values[index],
        `Independent original block/fence state ${POSITIONS[index]}`)
    }
  }
  const chooseThread = async index => {
    await click(body().getByRole('button', { name: THREAD_MENU }))
    // Menu portals live outside the sidebar, but exact fixture names are unique.
    await click(page.getByRole('menuitem', { name: `DSH354 thread-${index === 0 ? 'A' : 'B'}`, exact: true }))
    const activeTab = nativeThreadTab(parentOwner, page, index)
    await count(activeTab, 1, 'One native tab with the exact production title required')
    await poll(() => attr(activeTab, 'aria-selected'), value => value === 'true', 'Real sidechat thread tab selected')
  }
  const fill = async (forms, values, verify) => {
    const observed = ['', '', '', '']
    for (let index = 0; index < 4; index++) {
      await input(forms().nth(index)).fill(values[index], { timeout: remaining() })
      observed[index] = values[index]
      await verify(observed) // Catch same-thread identical-fence state collisions immediately.
    }
  }
  const screenshot = async (locator, file) => {
    await locator.screenshot({ path: join(artifactsDir, file), timeout: remaining() })
    report.screenshots.push(file)
  }
  let expected = initialExpected(ids)
  let lastSnapshot
  const verifyBackend = async stage => {
    const actual = validateSnapshot(await run(() => readBackendSnapshot({ stage,
      expected: structuredClone(expected) }), 'complete backend snapshot'), expected, seed.assistantEventSeq)
    if (lastSnapshot) assert.deepEqual(actual, lastSnapshot, 'State-only UI operation must not produce or change any action')
    lastSnapshot = actual
  }
  const pageErrors = []
  const onPageError = () => pageErrors.push(true)
  // Observe requests only. Never intercept, replay, fabricate or route them.
  const requests = []
  const requestHandles = []
  let observedActionRequests = 0
  let actionRequestFailed = false
  const onRequest = request => {
    if (!isSidechatActionRequest(request, location.origin)) return
    observedActionRequests++
    if (observedActionRequests > 4) return // Count excess traffic without retaining unbounded handles/bodies.
    requestHandles.push(request)
    try { requests.push(request.postDataJSON()) } catch { requests.push(null) }
  }
  const onRequestFailed = request => {
    if (isSidechatActionRequest(request, location.origin)) actionRequestFailed = true
  }
  report.status = 'running-real-host-checks'
  report.scope = 'Synthetic main + A/B forms; actual workspace rows, sidebar guide, thread menu and native tabs; real click/submit and durable per-owner replay settlement'
  report.screenshots = []
  report.scenarios = []
  report.actionTransport = []
  report.identity = { parentId, childIds: [...childIds], awaySessionId, seed: structuredClone(seed) }
  const uiAwayCreate = observeUiAwayCreate(page, location.origin, workspaceId, [...ids, awaySessionId])
  page.on('pageerror', onPageError)
  page.on('request', onRequest)
  page.on('requestfailed', onRequestFailed)
  try {
    await verifyBackend('baseline-before-any-ui-action')
    await selectSession(parentId)
    await assertMain(['', '', '', ''])
    await fill(mainForms, fixtureValues('main'), assertMain)
    await verifyBackend('main-form-edits-no-action')
    await openGuide('sidechat')
    await chooseThread(0)
    await assertSide(['', '', '', ''])
    await fill(sideForms, fixtureValues('A'), assertSide)
    await assertMain(fixtureValues('main'))
    await screenshot(sideForms().nth(3), 'dsh354-thread-A-block2-fence1.png')
    await chooseThread(1)
    await assertSide(['', '', '', ''])
    await fill(sideForms, fixtureValues('B'), assertSide)
    await assertMain(fixtureValues('main'))
    await chooseThread(0)
    await assertSide(fixtureValues('A'))
    await chooseThread(1)
    await assertSide(fixtureValues('B'))
    await screenshot(sideForms().nth(1), 'dsh354-thread-B-block0-fence1.png')
    report.scenarios.push('12 independent values across main/A/B, original text blocks 0/2 and fence indexes 0/1')

    // A different real native tab hides/disposes the explicit row surface.
    await openGuide('files')
    await count(body(), 0, 'Files tab must actually hide the sidechat view')
    const bTab = nativeThreadTab(parentOwner, page, 1)
    await click(bTab)
    await poll(() => attr(bTab, 'aria-selected'), value => value === 'true', 'Native sidechat tab reselected')
    await assertSide(fixtureValues('B'))
    report.scenarios.push('Real Files ↔ Sidechat native tab round trip retains all four B values')

    // Official rc.2 hides non-current blank rows. The workspace header creates
    // a fresh blank, not the pre-seeded away. Observe and bind that exact ID.
    const workspaceRow = page.locator(`[data-row-key="workspace:${workspaceId}"]`)
    await count(workspaceRow, 1, 'Exact owned workspace must be unique')
    await workspaceRow.hover({ timeout: remaining() }) // Native row actions are visible on hover.
    const newSession = workspaceRow.getByRole('button', { name: /^(New session in workspace|在“workspace”中新建会话)$/u })
    const newSessionControl = await uniqueOnScreen(newSession)
    uiAwayCreate.arm()
    await click(newSessionControl)
    const uiAway = await uiAwayCreate.finish(remaining())
    const uiAwayRow = page.locator(`[data-row-key="session:${uiAway.sessionId}"]`)
    await count(uiAwayRow, 1, 'Returned UI-created session must resolve uniquely')
    await poll(() => attr(uiAwayRow, 'aria-selected'), value => value === 'true', 'Returned UI-created session must actually be selected')
    verifyUiAwaySelection(uiAway, { rowKey: await attr(uiAwayRow, 'data-row-key'),
      selected: await attr(uiAwayRow, 'aria-selected'), onScreen: await onScreen(uiAwayRow) })
    report.uiAway = await run(() => bindUiAwaySession(uiAway.sessionId), 'Bind exact UI away to durable zero-event oracle')
    assert.deepEqual(report.uiAway, { ...uiAway, durableRelevantEvents: 0, actions: 0, completedTurns: [] })
    await poll(async () => !(await onScreen(parentOwner)), Boolean, 'Actual away conversation hides parent owner')
    await selectSession(parentId)
    await assertMain(fixtureValues('main'))
    await assertSide(fixtureValues('B'))
    await chooseThread(0)
    await assertSide(fixtureValues('A'))
    await verifyBackend('all-state-switches-before-action')
    assert.equal(observedActionRequests, 0, 'Editing and switching must not send a sidechat prompt')
    report.scenarios.push('Real top-level conversation away/return retains main, B and A values')

    // First contact can rename the current A tab. Do all A named selection
    // before its actions, then select still-unchanged B exactly once.
    for (const [index, step] of actionPlan(childIds).entries()) {
      if (index === 2) {
        await chooseThread(1)
        await assertSide(fixtureValues('B'))
      }
      const result = await executeOwnedAction({ step, stage: `action-${index + 1}`,
        expected, previousSnapshot: lastSnapshot, assistantEventSeq: seed.assistantEventSeq,
        readBackendSnapshot, waitForBackendAction, timeoutMs: Math.min(30000, deadline - Date.now()),
        click: () => sideForms().nth(step.fence).getByRole('button', { name: step.label, exact: true })
          .click({ timeout: remaining() }) })
      expected = result.expected
      lastSnapshot = result.snapshot
      await poll(() => {
        assert.ok(observedActionRequests <= index + 1, 'Unexpected extra owning action request')
        return observedActionRequests
      }, n => n === index + 1, 'One actual sidechat.prompt request per trusted action')
      assert.deepEqual(requests[index], { childId: step.ownerId,
        text: expected[step.ownerId].actions.at(-1).text }, 'Actual UI request must name only its owning child and exact payload')
      assert.equal(actionRequestFailed, false, 'An owning action request failed')
      const transport = await verifyActionResponse(requestHandles[index], { timeoutMs: remaining() })
      assert.equal(actionRequestFailed, false, 'An owning action request failed during response completion')
      report.actionTransport.push({ actionIndex: index + 1, ownerId: step.ownerId, ...transport })
      await assertMain(fixtureValues('main'))
      await assertSide(fixtureValues(index < 2 ? 'A' : 'B'))
      report.scenarios.push(`Action ${index + 1}: owning child only; exact durable message/payload and settled turn/end verified`)
    }
    await screenshot(mainForms().nth(0), 'dsh354-main-unchanged.png')
    await screenshot(sideForms().nth(1), 'dsh354-thread-B-after-actions.png')
    await verifyBackend('final-after-all-actions-and-screenshots')
    assert.equal(observedActionRequests, 4, 'No duplicate, missing or late sidechat prompt')
    assert.equal(actionRequestFailed, false, 'No owning sidechat action may fail transport')
    assert.equal(report.actionTransport.length, 4, 'Every action response must have awaited positive evidence')
    uiAwayCreate.assertOnce()
    assert.equal(pageErrors.length, 0, 'Real page emitted uncaught errors')
    report.backend = lastSnapshot
    report.status = 'passed-real-host-checks'
    return report
  } catch (error) {
    report.status = 'failed-real-host-checks'
    // No raw browser error/URL/body dump: prevent accidental credential logging.
    report.failure = 'A required UI, state-isolation or backend ownership assertion failed; inspect the thrown assertion locally.'
    throw error
  } finally {
    uiAwayCreate.dispose()
    page.off('pageerror', onPageError)
    page.off('request', onRequest)
    page.off('requestfailed', onRequestFailed)
    await writeFile(join(artifactsDir, 'dsh354-browser-report.json'), JSON.stringify(report, null, 2) + '\n')
  }
}
