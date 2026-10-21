import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { resolveGenuiSpec } from '../src/client/fence-render.tsx'
import { loadBlockState, saveBlockState } from '../src/client/interaction-store.ts'

afterEach(() => { cleanup(); localStorage.clear() })

describe('slider visible value matches the submitted field', () => {
  it.each([
    { initial: 0.004, changed: 0.006, min: 0, max: 0.01, step: 0.001 },
    { initial: -0.004, changed: -0.006, min: -0.01, max: 0, step: 0.001 },
    { initial: 0.000000004, changed: 0.000000006, min: 0, max: 0.00000001, step: 0.000000001 },
    { initial: 0.25, changed: 0.75, min: 0, max: 1, step: 0.01 },
    { initial: 2, changed: 3, min: 0, max: 10, step: 1 },
    { initial: 0, changed: 0.001, min: 0, max: 0.01, step: 0.001 },
    { initial: 0.001, changed: 0.011, min: 0.001, max: 0.101, step: 0.01 },
  ])('preserves $initial initially and $changed after interaction', ({ initial, changed, min, max, step }) => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec = resolveGenuiSpec(JSON.stringify({ items: [
      { type: 'slider', id: 'parameter', label: 'Synthetic parameter', min, max, step, value: initial },
      { type: 'submit', label: 'Use parameter', action: 'apply_parameter', groups: ['parameter'] },
    ] }))
    expect(spec).not.toBeNull()
    const { container, getByRole } = render(
      <GenuiActionContext.Provider value={(action, payload) => actions.push([action, payload])}>
        <GenuiBlock spec={spec!} />
      </GenuiActionContext.Provider>
    )
    const slider = getByRole('slider') as HTMLInputElement
    const visible = () => container.querySelector('[class*="sliderValue"]')?.textContent
    const submit = () => fireEvent.click(getByRole('button', { name: 'Use parameter' }))
    expect(Number(slider.value)).toBe(initial)
    submit()
    expect(actions[0]?.[1].fields).toEqual({ parameter: String(initial) })
    expect(visible()).toBe(String(initial))
    fireEvent.change(slider, { target: { value: String(changed) } })
    submit()
    expect(Number(slider.value)).toBe(changed)
    expect(actions[1]?.[1].fields).toEqual({ parameter: String(changed) })
    expect(visible()).toBe(String(changed))
  })

  it('shows the restored fine-grained field rather than the model default', async () => {
    const stateKey = 'synthetic-slider-precision'
    saveBlockState(stateKey, { fields: { parameter: '0.006' } })
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec = resolveGenuiSpec(JSON.stringify({ items: [
      { type: 'slider', id: 'parameter', label: 'Synthetic parameter', min: 0, max: 0.01, step: 0.001, value: 0.004 },
      { type: 'submit', label: 'Use parameter', action: 'apply_parameter', groups: ['parameter'] },
    ] }))
    expect(spec).not.toBeNull()
    const mount = () => render(
      <GenuiActionContext.Provider value={(action, payload) => actions.push([action, payload])}>
        <GenuiBlock spec={spec!} stateKey={stateKey} />
      </GenuiActionContext.Provider>
    )
    const first = mount()
    expect((first.getByRole('slider') as HTMLInputElement).value).toBe('0.006')
    expect(first.container.querySelector('[class*="sliderValue"]')?.textContent).toBe('0.006')
    fireEvent.change(first.getByRole('slider'), { target: { value: '0.007' } })
    await waitFor(() => expect(loadBlockState(stateKey)?.fields).toEqual({ parameter: '0.007' }))
    first.unmount()

    const restored = mount()
    expect((restored.getByRole('slider') as HTMLInputElement).value).toBe('0.007')
    expect(restored.container.querySelector('[class*="sliderValue"]')?.textContent).toBe('0.007')
    fireEvent.click(restored.getByRole('button', { name: 'Use parameter' }))
    expect(actions).toEqual([['apply_parameter', {
      type: 'submit', answers: {}, fields: { parameter: '0.007' }, total: 1, answered: 1,
    }]])
  })
})
