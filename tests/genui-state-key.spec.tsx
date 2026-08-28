// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'
import { loadBlockState, saveBlockState } from '../src/client/interaction-store.ts'

const fieldSpec = repairGenuiSpec({
  items: [{ type: 'input', id: 'name', label: '姓名' }],
})!

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})

function fieldValue(): string {
  return (screen.getByRole('textbox', { name: '姓名' }) as HTMLInputElement).value
}

describe('GenUI durable state identity', () => {
  it('starts a fresh in-memory lifetime when stateKey changes', () => {
    saveBlockState('state-a', { fields: { name: 'Alice' } })

    const view = render(<GenuiBlock spec={fieldSpec} stateKey="state-a" />)
    expect(fieldValue()).toBe('Alice')

    view.rerender(<GenuiBlock spec={fieldSpec} stateKey="state-b" />)
    expect(fieldValue()).toBe('')

    // The old in-memory value must never be written under the new durable key.
    act(() => { vi.advanceTimersByTime(300) })
    expect(loadBlockState('state-b')?.fields?.name).toBeUndefined()

    // Returning to the original durable identity restores its own state.
    view.rerender(<GenuiBlock spec={fieldSpec} stateKey="state-a" />)
    expect(fieldValue()).toBe('Alice')
  })

  it('keeps one volatile instance while an identity-less streaming spec grows', () => {
    const first = repairGenuiSpec({
      title: '第一段',
      items: [{ type: 'input', id: 'name', label: '姓名' }],
    })!
    const second = repairGenuiSpec({
      title: '第二段',
      items: [
        { type: 'input', id: 'name', label: '姓名' },
        { type: 'text', content: '后续流式内容' },
      ],
    })!

    const view = render(<GenuiBlock spec={first} />)
    fireEvent.change(screen.getByRole('textbox', { name: '姓名' }), { target: { value: 'typing' } })
    expect(fieldValue()).toBe('typing')

    view.rerender(<GenuiBlock spec={second} />)
    expect(fieldValue()).toBe('typing')
  })
})
