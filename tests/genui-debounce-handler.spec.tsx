// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GENUI_ACTION_DEBOUNCE_MS, GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'

const spec = repairGenuiSpec({
  items: [{ type: 'button', label: '刷新', action: 'refresh' }],
})!

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('action debounce handler lifecycle', () => {
  it('delivers a pending action to the latest provider handler', () => {
    const handlerA = vi.fn()
    const handlerB = vi.fn()
    const view = render(
      <GenuiActionContext.Provider value={handlerA}>
        <GenuiBlock spec={spec} />
      </GenuiActionContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    view.rerender(
      <GenuiActionContext.Provider value={handlerB}>
        <GenuiBlock spec={spec} />
      </GenuiActionContext.Provider>,
    )
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)

    expect(handlerA).not.toHaveBeenCalled()
    expect(handlerB).toHaveBeenCalledTimes(1)
    expect(handlerB).toHaveBeenCalledWith('refresh', { type: 'button', label: '刷新' })
  })

  it('cancels an old pending timer after the provider changes and the block unmounts', () => {
    const handlerA = vi.fn()
    const handlerB = vi.fn()
    const view = render(
      <GenuiActionContext.Provider value={handlerA}>
        <GenuiBlock spec={spec} />
      </GenuiActionContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    view.rerender(
      <GenuiActionContext.Provider value={handlerB}>
        <GenuiBlock spec={spec} />
      </GenuiActionContext.Provider>,
    )
    view.unmount()
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)

    expect(handlerA).not.toHaveBeenCalled()
    expect(handlerB).not.toHaveBeenCalled()
  })
})
