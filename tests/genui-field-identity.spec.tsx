import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { resolveGenuiSpec } from '../src/client/fence-render.tsx'
import { setLocale } from '../src/client/i18n/index.ts'
import { loadBlockState, type BlockInteractionState } from '../src/client/interaction-store.ts'
import type { GenuiSpec } from '../src/client/spec.ts'
import { createGenuiArtifact } from '../src/client/artifact/create.ts'

beforeEach(() => setLocale('en'))
afterEach(() => { cleanup(); localStorage.clear() })

function mount(raw: unknown) {
  const spec = resolveGenuiSpec(JSON.stringify(raw))
  expect(spec).not.toBeNull()
  const states: BlockInteractionState[] = []
  const actions: Array<[string, Record<string, unknown>]> = []
  const view = render(<GenuiActionContext.Provider value={(action, payload) => actions.push([action, payload])}>
    <GenuiBlock spec={spec!} stateKey="field-identity" onStateSnapshot={state => states.push(state)} />
  </GenuiActionContext.Provider>)
  return { ...view, states, actions, spec: spec! }
}

describe('field ownership across containers', () => {
  it('keeps each tab field and submitted value attached to its own ID', () => {
    const view = mount({ items: [
      { type: 'tabs', tabs: [
        { label: 'Monthly', items: [{ type: 'input', id: 'monthly', label: 'Monthly value', value: '10' }] },
        { label: 'Rate', items: [{ type: 'input', id: 'rate', label: 'Rate value', value: '0.1' }] },
      ] },
      { type: 'submit', label: 'Send', action: 'send', groups: ['monthly', 'rate'] },
    ] })
    fireEvent.change(view.getByLabelText('Monthly value'), { target: { value: '20' } })
    fireEvent.click(view.getByRole('tab', { name: 'Rate' }))
    expect(view.getByLabelText('Rate value')).toHaveProperty('value', '0.1')
    fireEvent.change(view.getByLabelText('Rate value'), { target: { value: '0.2' } })
    fireEvent.click(view.getByRole('tab', { name: 'Monthly' }))
    expect(view.getByLabelText('Monthly value')).toHaveProperty('value', '20')
    fireEvent.click(view.getByRole('button', { name: 'Send' }))
    expect(view.actions).toEqual([['send', expect.objectContaining({ fields: { monthly: '20', rate: '0.2' } })]])
  })

  it('keeps passwords out of public drafts, storage, artifacts and submit after switching tabs', async () => {
    const secret = 'SYNTHETIC_SECRET_TEST_ONLY'
    const view = mount({ items: [
      { type: 'tabs', tabs: [
        { label: 'Private', items: [{ type: 'input', id: 'secret', inputType: 'password', label: 'Private field' }] },
        { label: 'Public', items: [{ type: 'input', id: 'note', label: 'Public field' }] },
      ] },
      { type: 'submit', label: 'Send', action: 'send', groups: ['note'] },
    ] })
    fireEvent.change(view.getByLabelText('Private field'), { target: { value: secret } })
    fireEvent.click(view.getByRole('tab', { name: 'Public' }))
    expect(view.getByLabelText('Public field')).toHaveProperty('value', '')
    expect(view.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true)
    fireEvent.change(view.getByLabelText('Public field'), { target: { value: 'safe note' } })
    fireEvent.click(view.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(loadBlockState('field-identity')?.fields).toEqual({ note: 'safe note' }))
    const artifact = createGenuiArtifact(view.spec, view.states.at(-1))
    expect(JSON.stringify([view.states, view.actions, loadBlockState('field-identity'), artifact])).not.toContain(secret)
    expect(view.actions).toEqual([['send', expect.objectContaining({ fields: { note: 'safe note' } })]])
    fireEvent.click(view.getByRole('tab', { name: 'Private' }))
    expect(view.getByLabelText('Private field')).toHaveProperty('value', '')
  })

  it('resets local values when a streaming field changes ID or password type', () => {
    const states: BlockInteractionState[] = []
    const capture = (state: BlockInteractionState) => states.push(state)
    const view = render(<GenuiBlock spec={{ items: [{ type: 'input', id: 'first', label: 'Field' }] }} onStateSnapshot={capture} />)
    fireEvent.change(view.getByLabelText('Field'), { target: { value: 'old draft' } })
    view.rerender(<GenuiBlock spec={{ items: [{ type: 'input', id: 'secret', inputType: 'password', label: 'Field' }] }} onStateSnapshot={capture} />)
    expect(view.getByLabelText('Field')).toHaveProperty('value', '')
    fireEvent.change(view.getByLabelText('Field'), { target: { value: 'SYNTHETIC_SECRET_TEST_ONLY' } })
    view.rerender(<GenuiBlock spec={{ items: [{ type: 'input', id: 'secret', inputType: 'text', label: 'Field' }] }} onStateSnapshot={capture} />)
    expect(view.getByLabelText('Field')).toHaveProperty('value', '')
    expect(JSON.stringify(states)).not.toContain('SYNTHETIC_SECRET_TEST_ONLY')
  })

  it('retains invalid numeric drafts and blocks submit across collapse and durable restore', async () => {
    const raw = {
      computed: [{ id: 'double', expr: 'amount*2' }], items: [
        { type: 'accordion', items: [{ title: 'Amount section', items: [{ type: 'input', id: 'amount', inputType: 'number', label: 'Amount', value: '2' }] }] },
        { type: 'text', content: 'Result {{double}}' },
        { type: 'submit', label: 'Send', action: 'send', groups: ['amount'] },
      ],
    }
    const view = mount(raw)
    fireEvent.change(view.getByLabelText('Amount'), { target: { value: '-' } })
    expect(view.getByText('Result 4')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Amount section' }))
    expect(view.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true)
    fireEvent.click(view.getByRole('button', { name: 'Send' }))
    expect(view.actions).toEqual([])
    fireEvent.click(view.getByRole('button', { name: 'Amount section' }))
    expect(view.getByRole('textbox', { name: /^Amount/ })).toHaveProperty('value', '-')
    await waitFor(() => expect(loadBlockState('field-identity')?.fields?.amount).toBe('-'))
    view.unmount()
    const restored = mount(raw)
    expect(restored.getByRole('textbox', { name: /^Amount/ })).toHaveProperty('value', '-')
    expect(restored.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true)
    fireEvent.change(restored.getByRole('textbox', { name: /^Amount/ }), { target: { value: '3' } })
    fireEvent.click(restored.getByRole('button', { name: 'Send' }))
    expect(restored.actions).toEqual([['send', expect.objectContaining({ fields: { amount: '3' } })]])
  })

  it('keeps an invalid number in a temporarily closed table detail', () => {
    const view = mount({ items: [
      { type: 'table', columns: ['Item'], rows: [['A']], details: [[{ type: 'input', id: 'amount', inputType: 'number', label: 'Amount', value: '2' }]] },
      { type: 'submit', label: 'Send', action: 'send', groups: ['amount'] },
    ] })
    const toggle = view.container.querySelector<HTMLButtonElement>('tbody button[aria-expanded]')!
    fireEvent.click(toggle)
    fireEvent.change(view.getByLabelText('Amount'), { target: { value: '1e' } })
    fireEvent.click(toggle)
    expect(view.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true)
    fireEvent.click(toggle)
    expect(view.getByRole('textbox', { name: /^Amount/ })).toHaveProperty('value', '1e')
  })

  it('filters hidden password IDs before emitting the first restored snapshot', () => {
    const states: BlockInteractionState[] = []
    render(<GenuiBlock spec={{ items: [{ type: 'tabs', tabs: [
      { label: 'Public', items: [{ type: 'input', id: 'note' }] },
      { label: 'Private', items: [{ type: 'input', id: 'secret', inputType: 'password' }] },
    ] }] }} initialState={{ fields: { secret: 'SYNTHETIC_SECRET_TEST_ONLY', note: 'safe' } }} onStateSnapshot={state => states.push(state)} />)
    expect(states.length).toBeGreaterThan(0)
    expect(JSON.stringify(states)).not.toContain('SYNTHETIC_SECRET_TEST_ONLY')
  })
})

it('reconciles the current draft when the same field changes number → text → number', () => {
  const numeric: GenuiSpec = { computed: [{ id: 'double', expr: 'amount*2' }], items: [
    { type: 'input', id: 'amount', inputType: 'number', label: 'Amount', value: '2' },
    { type: 'text', content: 'Result {{double}}' },
  ] }
  const text: GenuiSpec = { items: [{ type: 'input', id: 'amount', label: 'Amount' }] }
  const view = render(<GenuiBlock spec={numeric} />)
  view.rerender(<GenuiBlock spec={text} />)
  fireEvent.change(view.getByLabelText('Amount'), { target: { value: '3' } })
  view.rerender(<GenuiBlock spec={numeric} />)
  expect(view.getByLabelText('Amount')).toHaveProperty('value', '3')
  expect(view.getByText('Result 6')).toBeTruthy()
  fireEvent.change(view.getByLabelText('Amount'), { target: { value: '-' } })
  expect(view.getByText('Result 6')).toBeTruthy()
})

it('keeps grouped radio choices attached to their tab and group', () => {
  const view = mount({ items: [{ type: 'tabs', tabs: [
    { label: 'First', items: [{ type: 'radio', group: 'first', options: ['A1', 'A2'] }] },
    { label: 'Second', items: [{ type: 'radio', group: 'second', options: ['B1', 'B2'] }] },
  ] }] })
  fireEvent.click(view.getByRole('radio', { name: 'A2' }))
  fireEvent.click(view.getByRole('tab', { name: 'Second' }))
  expect(view.getByRole('radio', { name: 'B2' })).toHaveProperty('checked', false)
  fireEvent.click(view.getByRole('radio', { name: 'B1' }))
  fireEvent.click(view.getByRole('tab', { name: 'First' }))
  expect(view.getByRole('radio', { name: 'A2' })).toHaveProperty('checked', true)
})
