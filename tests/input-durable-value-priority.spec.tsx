// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasFenceRegistry } from './helpers/fence-host'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GENUI_ACTION_DEBOUNCE_MS } from '../src/client/GenuiBlock.tsx'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})

beforeEach(() => {
  vi.useFakeTimers()
})

function renderBlock(
  spec: unknown,
  stateKey: string,
  onAction: (action: string, payload: Record<string, unknown>) => void,
) {
  return render(
    <GenuiActionContext.Provider value={onAction}>
      <GenuiBlock spec={spec as never} stateKey={stateKey} />
    </GenuiActionContext.Provider>,
  )
}

describe.skipIf(!hasFenceRegistry)('input durable value priority', () => {
  it('restored durable value wins over the spec default after remount', () => {
    const stateKey = 'input-durable-value-priority'
    const spec = {
      items: [
        { type: 'input', label: '名称', id: 'name', value: '默认值' },
        { type: 'submit', label: '发送', action: 'send' },
      ],
    }
    const onAction = vi.fn()

    renderBlock(spec, stateKey, onAction)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('默认值')

    fireEvent.change(input, { target: { value: '用户值' } })
    vi.advanceTimersByTime(400)

    cleanup()
    renderBlock(spec, stateKey, onAction)

    const restored = screen.getByRole('textbox') as HTMLInputElement
    expect(restored.value).toBe('用户值')

    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).toHaveBeenCalledWith('send', expect.objectContaining({
      fields: { name: '用户值' },
    }))
  })
})
