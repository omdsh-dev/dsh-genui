import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { resolveFence } from '../src/shared/fence-resolve.ts'
import { createGenuiArtifact } from '../src/client/artifact/create.ts'
import type { BlockInteractionState } from '../src/client/interaction-store.ts'

afterEach(cleanup)
it('preserves checkbox identity through computed labels, artifact restore and explicit clearing', () => {
  const spec = resolveFence(JSON.stringify({ computed: [{ id: 'total', expr: 'amount*2' }], items: [
    { type: 'input', id: 'amount', inputType: 'number', label: 'Amount', value: '2' },
    { type: 'checkbox', group: 'choices', label: 'Choose {{total}}' },
    { type: 'submit', label: 'Send', action: 'send', groups: ['choices'] },
  ] }), { settled: true }).spec!
  const sent: Array<Record<string, unknown>> = []
  const send = (_action: string, payload: Record<string, unknown>) => { sent.push(payload) }
  let state: BlockInteractionState | undefined
  const view = render(<GenuiActionContext.Provider value={send}><GenuiBlock spec={spec} onStateSnapshot={next => { state = next }} /></GenuiActionContext.Provider>)
  fireEvent.click(view.getByRole('checkbox', { name: 'Choose 4' }))
  fireEvent.change(view.getByLabelText('Amount'), { target: { value: '3' } })
  expect(view.getByRole('checkbox', { name: 'Choose 6' })).toHaveProperty('checked', true)
  fireEvent.click(view.getByRole('button', { name: 'Send' }))
  expect(sent.at(-1)).toMatchObject({ answers: { choices: ['Choose 6'] } })
  const artifact = createGenuiArtifact(spec, state)
  view.unmount()
  const restored = render(<GenuiActionContext.Provider value={send}><GenuiBlock spec={artifact.spec} initialState={artifact.state} /></GenuiActionContext.Provider>)
  expect(restored.getByRole('checkbox', { name: 'Choose 6' })).toHaveProperty('checked', true)
  fireEvent.change(restored.getByLabelText('Amount'), { target: { value: '4' } })
  expect(restored.getByRole('checkbox', { name: 'Choose 8' })).toHaveProperty('checked', true)
  fireEvent.click(restored.getByRole('checkbox', { name: 'Choose 8' }))
  expect(restored.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true)
  expect(restored.getByRole('checkbox')).toHaveProperty('checked', false)
})
