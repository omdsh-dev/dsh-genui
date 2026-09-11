// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { renderGenuiFence, renderResolvedFenceNode } from '../src/client/fence-render.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'
import { fenceStateKey, loadBlockState, saveBlockState } from '../src/client/interaction-store.ts'

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

  it.each([renderGenuiFence, renderResolvedFenceNode])('keeps input and pending actions when a streaming fence settles (%#)', renderFence => {
    const spec = repairGenuiSpec({ items: [
      ...fieldSpec.items, { type: 'button', label: '确认', action: 'confirm' },
    ] })!
    const raw = JSON.stringify(spec)
    const onAction = vi.fn()
    const source = { id: 'assistant:17:fence:0', order: [17, 0, 0] as const }
    const view = render(<GenuiActionContext.Provider value={onAction}>
      {renderFence(raw, 0, { sessionId: 'stream-session' })}
    </GenuiActionContext.Provider>)
    const input = screen.getByRole('textbox', { name: '姓名' })
    fireEvent.change(input, { target: { value: 'typing' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    view.rerender(<GenuiActionContext.Provider value={onAction}>
      {renderFence(raw, 0, { sessionId: 'stream-session', source })}
    </GenuiActionContext.Provider>)
    expect(screen.getByRole('textbox', { name: '姓名' })).toBe(input)
    expect(fieldValue()).toBe('typing')
    act(() => { vi.advanceTimersByTime(300) })
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(loadBlockState(fenceStateKey('stream-session', source.id, raw))?.fields?.name).toBe('typing')
  })
})
