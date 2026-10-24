import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GenuiPanel } from '../src/client/panel.tsx'
import { applyPanelOperation, clearSessionPanel, getPanelOperationError, getPanelSpec, getPanelStateKey, requestPanelExpand, setLocalPanel, setPanelLimits, type PanelOperation } from '../src/client/panel-store.ts'
import { evaluateComputed } from '../src/client/computed.ts'
import { resolveFence } from '../src/shared/fence-resolve.ts'
import { renderGenuiFence } from '../src/client/fence-render.tsx'
import { setLocale } from '../src/client/i18n/index.ts'
import { loadBlockState } from '../src/client/interaction-store.ts'
import { createGenuiArtifact } from '../src/client/artifact/create.ts'

const sessionId = 'panel-computed-state'
beforeEach(() => setLocale('en'))
afterEach(() => { cleanup(); clearSessionPanel(sessionId); localStorage.clear(); setPanelLimits({ maxNodes: 200, maxAppends: 200 }) })
const base: PanelOperation = { sourceId: 'base', order: [1, 0, 0], mode: 'replace', spec: {
  panel: true, computed: [{ id: 'base', expr: 'amount*2' }],
  items: [{ type: 'input', id: 'amount', inputType: 'number', label: 'Amount', value: '3' }],
} }
const delta = resolveFence(JSON.stringify({ panel: true, append: true,
  computed: [{ id: 'answer', expr: 'base+1' }], items: [
    { type: 'text', content: 'Answer {{answer}}' },
    { type: 'submit', label: 'Send', action: 'send', groups: ['amount'] },
  ],
}), { settled: true }).spec!
const append: PanelOperation = { sourceId: 'append', order: [2, 0, 0], mode: 'append', spec: delta }

it('recovers an unresolved append and its diagnostic after reopening, then resolves an earlier base', () => {
  expect(applyPanelOperation(sessionId, append)).toBe('invalid')
  expect(getPanelOperationError(sessionId, 'append')).toBeTruthy()
  clearSessionPanel(sessionId)
  expect(getPanelOperationError(sessionId, 'append')).toBeTruthy()
  expect(applyPanelOperation(sessionId, base)).toBe('accepted')
  expect(getPanelOperationError(sessionId, 'append')).toBeNull()
  expect(evaluateComputed(getPanelSpec(sessionId)!, {}).values.answer).toBe(7)
  expect(applyPanelOperation(sessionId, append)).toBe('idempotent')
  expect(createGenuiArtifact(getPanelSpec(sessionId)!).spec.items).toHaveLength(3)
})

it('keeps the valid baseline, later valid appends and pending error across reopening', () => {
  applyPanelOperation(sessionId, { sourceId: 'old', order: [0, 0, 0], mode: 'replace', spec: { items: [{ type: 'text', content: 'Old' }] } })
  applyPanelOperation(sessionId, append)
  const extra: PanelOperation = { sourceId: 'extra', order: [3, 0, 0], mode: 'append', spec: { items: [{ type: 'text', content: 'Extra' }] } }
  expect(applyPanelOperation(sessionId, extra)).toBe('accepted')
  clearSessionPanel(sessionId)
  expect(getPanelSpec(sessionId)?.items).toEqual([{ type: 'text', content: 'Old' }, { type: 'text', content: 'Extra' }])
  expect(getPanelOperationError(sessionId, 'append')).toBeTruthy()
  applyPanelOperation(sessionId, base)
  expect(evaluateComputed(getPanelSpec(sessionId)!, {}).values.answer).toBe(7)
  expect(getPanelSpec(sessionId)?.items.at(-1)).toEqual({ type: 'text', content: 'Extra' })
})

it('preserves the overflow barrier with pending work and keeps an explicit clear final', () => {
  setPanelLimits({ maxAppends: 1 })
  applyPanelOperation(sessionId, append)
  const extra: PanelOperation = { sourceId: 'extra', order: [3, 0, 0], mode: 'append', spec: { items: [{ type: 'text', content: 'Extra' }] } }
  expect(applyPanelOperation(sessionId, extra)).toBe('overflow')
  clearSessionPanel(sessionId)
  expect(applyPanelOperation(sessionId, { ...extra, sourceId: 'later', order: [4, 0, 0] })).toBe('blocked')
  applyPanelOperation(sessionId, base)
  expect(evaluateComputed(getPanelSpec(sessionId)!, {}).values.answer).toBe(7)
  setLocalPanel(sessionId, null)
  clearSessionPanel(sessionId)
  expect(applyPanelOperation(sessionId, append)).toBe('blocked')
  expect(getPanelSpec(sessionId)).toBeNull()
  expect(getPanelOperationError(sessionId, 'append')).toBeNull()
})

it('appends to the restored snapshot without losing its numeric source', () => {
  applyPanelOperation(sessionId, base)
  clearSessionPanel(sessionId)
  expect(applyPanelOperation(sessionId, append)).toBe('accepted')
  expect(evaluateComputed(getPanelSpec(sessionId)!, {}).values.answer).toBe(7)
})

it('keeps live and persisted edits when a real dock receives an append; replacement resets the form', async () => {
  applyPanelOperation(sessionId, base)
  const send = vi.fn()
  const renderPanel = () => render(<GenuiPanel sessionId={sessionId} sendGenuiAction={send} insertTemplate={() => {}} />)
  const view = renderPanel()
  act(() => requestPanelExpand(sessionId))
  fireEvent.change(view.getByLabelText('Amount'), { target: { value: '5' } })
  act(() => { applyPanelOperation(sessionId, append) })
  expect(view.getByLabelText('Amount')).toHaveProperty('value', '5')
  expect(view.getByText('Answer 11')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Send', exact: true }))
  expect(send.mock.calls.at(-1)?.[1].fields).toEqual({ amount: '5' })
  await waitFor(() => expect(loadBlockState(getPanelStateKey(sessionId)!)?.fields?.amount).toBe('5'))
  view.unmount()
  clearSessionPanel(sessionId)
  const restored = renderPanel()
  act(() => requestPanelExpand(sessionId))
  expect(restored.getByLabelText('Amount')).toHaveProperty('value', '5')
  act(() => { applyPanelOperation(sessionId, { ...base, sourceId: 'replacement', order: [5, 0, 0], spec: { items: [{ type: 'input', id: 'amount', inputType: 'number', label: 'Amount', value: '8' }] } }) })
  expect(restored.getByLabelText('Amount')).toHaveProperty('value', '8')
})

it('keeps standalone and artifact validation strict for an unbound append delta', () => {
  expect(delta).not.toBeNull()
  expect(() => createGenuiArtifact(delta)).toThrow()
  expect(resolveFence(JSON.stringify({ ...delta, panel: false }), { settled: true }).spec).toBeNull()
})

it('flushes a draft when immediately collapsing before an append', () => {
  applyPanelOperation(sessionId, base)
  const view = render(<GenuiPanel sessionId={sessionId} sendGenuiAction={() => {}} insertTemplate={() => {}} />)
  act(() => requestPanelExpand(sessionId))
  fireEvent.change(view.getByLabelText('Amount'), { target: { value: '5' } })
  fireEvent.click(view.container.querySelector('[data-genui-panel] button[aria-expanded="true"]')!)
  act(() => { applyPanelOperation(sessionId, append) })
  act(() => requestPanelExpand(sessionId))
  expect(view.getByLabelText('Amount')).toHaveProperty('value', '5')
  expect(view.getByText('Answer 11')).toBeTruthy()
})

it('excludes removed fields and choices when replacing an extended form with its base', () => {
  const initial: PanelOperation = { ...base, spec: { ...base.spec, items: [...base.spec.items, { type: 'submit', label: 'Send', action: 'send' }] } }
  applyPanelOperation(sessionId, initial)
  const send = vi.fn()
  const view = render(<GenuiPanel sessionId={sessionId} sendGenuiAction={send} insertTemplate={() => {}} />)
  act(() => requestPanelExpand(sessionId))
  fireEvent.change(view.getByLabelText('Amount'), { target: { value: '5' } })
  act(() => { applyPanelOperation(sessionId, { ...append, spec: { items: [
    { type: 'input', id: 'note', label: 'Note' },
    { type: 'checkbox', group: 'extra', label: 'Extra' },
    { type: 'radio', group: 'mode', options: ['A', 'B'] },
  ] } }) })
  fireEvent.change(view.getByLabelText('Note'), { target: { value: 'removed note' } })
  fireEvent.click(view.getByRole('checkbox', { name: 'Extra' }))
  fireEvent.click(view.getByRole('radio', { name: 'A' }))
  act(() => { applyPanelOperation(sessionId, { ...initial, sourceId: 'back-to-base', order: [3, 0, 0] }) })
  fireEvent.click(view.getByRole('button', { name: 'Send', exact: true }))
  expect(send.mock.calls.at(-1)?.[1].fields).toEqual({ amount: '5' })
  expect(send.mock.calls.at(-1)?.[1].answers).toEqual({})
  view.unmount()
  const state = loadBlockState(getPanelStateKey(sessionId)!)
  expect(state?.fields).toEqual({ amount: '5' })
  expect(state?.answers).toEqual({})
  expect(state?.multiAnswers).toBeUndefined()
})

it.each(['secret+1', 'missing+1', 'amount.constructor', 'evil(amount)', '(()=>1)()'])('rejects unsafe or unresolved append expression %s without changing the valid panel', expr => {
  const initial: PanelOperation = { ...base, spec: { ...base.spec, items: [...base.spec.items, { type: 'input', id: 'secret', inputType: 'password' }] } }
  applyPanelOperation(sessionId, initial)
  const candidate = resolveFence(JSON.stringify({ panel: true, append: true, computed: [{ id: 'bad', expr }], items: [{ type: 'text', content: '{{bad}}' }] }), { settled: true })
  if (candidate.spec !== null) {
    expect(applyPanelOperation(sessionId, { ...append, spec: candidate.spec })).toBe('invalid')
    expect(getPanelOperationError(sessionId, 'append')).toBeTruthy()
  } else expect(candidate.processed?.errors.length).toBeGreaterThan(0)
  expect(getPanelSpec(sessionId)).toBe(initial.spec)
})

it('shows a pending fence diagnostic and removes it when the earlier base arrives', () => {
  const view = render(renderGenuiFence(JSON.stringify(delta), 'delta', { sessionId, source: { id: 'pending', order: [2, 0, 0] } }))
  expect(view.getByRole('alert')).toBeTruthy()
  act(() => { applyPanelOperation(sessionId, base) })
  expect(view.queryByRole('alert')).toBeNull()
  expect(evaluateComputed(getPanelSpec(sessionId)!, {}).values.answer).toBe(7)
})
