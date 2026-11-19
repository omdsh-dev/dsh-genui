/** Pure synthetic assertions only: no browser, DOM, host, filesystem mutation,
 * network or runtime accessibility-engine claims. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeThreadTab, threadTitlePattern } from '../scripts/sidechat-browser-locators.mjs'
import { initialExpected, actionPlan, appendExpected, executeOwnedAction, validateSnapshot } from '../scripts/sidechat-browser-contracts.mjs'

const ids = ['session-parent', 'session-a', 'session-b']
const initial = initialExpected(ids)
const step = actionPlan(ids.slice(1))[0]
const next = appendExpected(initial, step)
const evidence = expected => ({ sessions: Object.fromEntries(Object.entries(expected).map(([id, value]) => [id, {
  actions: value.actions.map((action, index) => ({ ...structuredClone(action), messageId: `${id}-message-${index}`,
    eventSeq: 20 + index * 10, endSeq: 25 + index * 10 })), completedTurns: [...value.completedTurns],
}])) })

for (const [index, owner] of ['A', 'B'].entries()) {
  test(`title-only predicate ignores close/unread labels for ${owner}`, () => {
    const title = `DSH354 thread-${owner}`
    for (const suffix of ['Close tab', '关闭标签页', '閉じる', 'Unread Close tab']) {
      const syntheticAccessibleName = `${title} ${suffix}`
      assert.equal(threadTitlePattern(index).test(syntheticAccessibleName), false,
        'The old full-name exact predicate rejects this compound name')
      assert.equal(threadTitlePattern(index).test(title), true,
        'The new title-node predicate does not inspect close/unread labels')
    }
  })
  test(`title-only predicate rejects prefixes, other owners and close-label spoofing for ${owner}`, () => {
    for (const candidate of [`DSH354 thread-${owner}-copy`, `prefix DSH354 thread-${owner}`,
      `DSH354 thread-${owner === 'A' ? 'B' : 'A'}`, 'Files']) {
      assert.equal(threadTitlePattern(index).test(candidate), false)
    }
    const candidate = { title: 'Files', closeLabel: `DSH354 thread-${owner}` }
    assert.equal(threadTitlePattern(index).test(candidate.title), false)
  })
}
test('locator construction scopes the production title node under the owned actual native tab', () => {
  // A locator-call recorder, not a DOM: it only preserves selector arguments.
  const recorder = steps => ({
    steps,
    locator(selector) { return recorder([...steps, ['locator', selector]]) },
    filter(options) { return recorder([...steps, ['filter', options]]) },
  })
  const result = nativeThreadTab(recorder(['parentOwner']), recorder(['page']), 0)
  assert.deepEqual(result.steps.slice(0, 2), ['parentOwner', ['locator', '[role="tab"][data-dockkit-tab]']])
  const inner = result.steps[2][1].has
  assert.deepEqual(inner.steps.slice(0, 2), ['page', ['locator', '[data-dockkit-tab-title]']])
  assert.equal(inner.steps[2][1].hasText.source, '^DSH354 thread-A$')
})
test('unknown thread index fails closed', () => {
  for (const value of [-1, 2, undefined, '0']) assert.throws(() => threadTitlePattern(value))
})
test('duplicate title candidates remain detectable rather than silently selecting first', () => {
  const titles = ['DSH354 thread-A', 'DSH354 thread-A']
  assert.equal(titles.filter(title => threadTitlePattern(0).test(title)).length, 2)
})

for (const failurePoint of ['before', 'wait', 'after']) {
  test(`rejection of ${failurePoint} oracle propagates without action retry`, async () => {
    const sentinel = Error(`synthetic-${failurePoint}-oracle-failure`)
    let clicks = 0, reads = 0, waits = 0
    await assert.rejects(executeOwnedAction({ step, stage: 'independent', expected: initial,
      previousSnapshot: evidence(initial), assistantEventSeq: 11,
      readBackendSnapshot: async () => {
        reads++
        if (failurePoint === (reads === 1 ? 'before' : 'after')) throw sentinel
        return reads === 1 ? evidence(initial) : evidence(next)
      },
      click: async () => { clicks++ },
      waitForBackendAction: async () => { waits++; if (failurePoint === 'wait') throw sentinel; return evidence(next) },
    }), error => error === sentinel)
    assert.equal(clicks, failurePoint === 'before' ? 0 : 1)
    assert.equal(waits, failurePoint === 'before' ? 0 : 1)
    assert.equal(reads, failurePoint === 'after' ? 2 : 1)
  })
}
test('settlement timeout rejects without click retry or fresh read', async () => {
  let clicks = 0, reads = 0
  await assert.rejects(executeOwnedAction({ step, stage: 'timeout', expected: initial,
    assistantEventSeq: 11, timeoutMs: 10,
    readBackendSnapshot: async () => { reads++; return evidence(initial) },
    click: async () => { clicks++ }, waitForBackendAction: () => new Promise(() => {}),
  }), /owning replay settlement timed out/)
  assert.equal(clicks, 1); assert.equal(reads, 1)
})
test('a prior receipt cannot be rewritten when appending a new action', async () => {
  const nextStep = actionPlan(ids.slice(1))[1]
  const final = appendExpected(next, nextStep)
  const altered = evidence(final)
  altered.sessions[ids[1]].actions[0].messageId = 'rewritten-prior-message'
  await assert.rejects(executeOwnedAction({ step: nextStep, stage: 'rewrite', expected: next,
    assistantEventSeq: 11, previousSnapshot: evidence(next),
    readBackendSnapshot: async () => evidence(next), click: async () => {},
    waitForBackendAction: async () => altered,
  }), /Prior action evidence changed/)
})
test('helper evidence cannot prove away: a four-session snapshot is rejected', () => {
  const snapshot = evidence(initial)
  snapshot.sessions['session-away'] = { actions: [], completedTurns: [] }
  assert.throws(() => validateSnapshot(snapshot, initial, 11), /exactly parent/)
})
test('helper evidence cannot authenticate arbitrary IDs: durable provenance is host-adapter responsibility', () => {
  const snapshot = evidence(next)
  snapshot.sessions[ids[1]].actions[0].messageId = 'arbitrary-opaque-value'
  assert.equal(validateSnapshot(snapshot, next, 11).sessions[ids[1]].actions[0].messageId, 'arbitrary-opaque-value')
})
test('helper evidence cannot detect error metadata: host-adapter error checks are mandatory', () => {
  const snapshot = evidence(next)
  snapshot.routeGuardErrors = ['synthetic-denial']
  assert.deepEqual(validateSnapshot(snapshot, next, 11), evidence(next))
})
test('visible values alone do not distinguish original content indexes from filtered indexes', () => {
  const projectVisible = rows => rows.map(row => ({ text: row.text, values: row.values }))
  const original = [{ block: 0, text: 'Fixture text block 0', values: ['f0', 'f1'] },
    { block: 2, text: 'Fixture text block 2', values: ['f0-other', 'f1-other'] }]
  const filtered = original.map((row, index) => ({ ...row, block: index }))
  assert.deepEqual(projectVisible(original), projectVisible(filtered))
  assert.notDeepEqual(original.map(row => row.block), filtered.map(row => row.block))
})
