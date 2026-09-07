// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GENUI_ACTION_DEBOUNCE_MS } from '../src/client/GenuiBlock.tsx'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})

beforeEach(() => {
  vi.useFakeTimers()
})

describe('input color runtime schema', () => {
  it('accepts and preserves inputType=color', () => {
    const spec = { items: [{ type: 'input', inputType: 'color' }] }

    expect(validateGenuiSpec(spec)).toEqual({ ok: true, errors: [] })
    expect(repairGenuiSpec(spec)?.items[0]).toMatchObject({
      type: 'input',
      inputType: 'color',
    })
  })

  it('continues to reject unsupported input types', () => {
    const spec = { items: [{ type: 'input', inputType: 'date' }] }

    expect(validateGenuiSpec(spec).ok).toBe(false)
    expect(repairGenuiSpec(spec)?.items[0]).toEqual({ type: 'input' })
  })
})

describe('input color rendering and submit collection', () => {
  it('renders the native color input and collects its value into fields', () => {
    const onAction = vi.fn()
    const spec = {
      items: [
        { type: 'input', inputType: 'color', label: '主色', id: 'c_primary', value: '#1a3a5c' },
        { type: 'submit', label: '提交', action: 'send' },
      ],
    }

    render(
      <GenuiActionContext.Provider value={onAction}>
        <GenuiBlock spec={spec as never} />
      </GenuiActionContext.Provider>,
    )

    const input = screen.getByLabelText('主色') as HTMLInputElement
    expect(input.type).toBe('color')
    expect(input.value).toBe('#1a3a5c')

    fireEvent.change(input, { target: { value: '#ff0000' } })
    expect(input.value).toBe('#ff0000')

    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)

    expect(onAction).toHaveBeenCalledWith('send', expect.objectContaining({
      fields: { c_primary: '#ff0000' },
    }))
  })
  it.each([undefined, '', 'red', '#ABCDEF'])('submits the displayed initial color %s', initial => {
    const onAction = vi.fn()
    const expected = initial === '#ABCDEF' ? '#abcdef' : '#000000'
    const spec = { items: [
      { type: 'input', inputType: 'color', label: '主色', id: 'c_primary', value: initial },
      { type: 'submit', label: '提交', action: 'send' },
    ] }
    render(<GenuiActionContext.Provider value={onAction}><GenuiBlock spec={spec as never} /></GenuiActionContext.Provider>)
    expect((screen.getByLabelText('主色') as HTMLInputElement).value).toBe(expected)
    expect((screen.getByRole('button', { name: '提交' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).toHaveBeenCalledWith('send', expect.objectContaining({ fields: { c_primary: expected } }))
  })

  it('restores the user color ahead of the model default', () => {
    const onAction = vi.fn()
    const spec = { items: [
      { type: 'input', inputType: 'color', label: '主色', id: 'c_primary', value: '#112233' },
      { type: 'submit', label: '提交', action: 'send' },
    ] }
    const panel = <GenuiActionContext.Provider value={onAction}><GenuiBlock spec={spec as never} stateKey="color-restore" /></GenuiActionContext.Provider>
    const first = render(panel)
    fireEvent.change(screen.getByLabelText('主色'), { target: { value: '#ff0000' } })
    vi.advanceTimersByTime(300)
    first.unmount()
    render(panel)
    expect((screen.getByLabelText('主色') as HTMLInputElement).value).toBe('#ff0000')
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).toHaveBeenCalledWith('send', expect.objectContaining({ fields: { c_primary: '#ff0000' } }))
  })

})
