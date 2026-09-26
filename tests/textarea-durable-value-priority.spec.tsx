// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('textarea durable value priority', () => {
  it('restored durable value wins over the spec default after remount', () => {
    const stateKey = 'textarea-durable-value-priority'
    const spec = {
      items: [
        { type: 'textarea', label: '简介', id: 'bio', value: '默认简介' },
        { type: 'submit', label: '发送', action: 'send' },
      ],
    }
    const onAction = vi.fn()

    renderBlock(spec, stateKey, onAction)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('默认简介')

    fireEvent.change(textarea, { target: { value: '用户简介' } })
    vi.advanceTimersByTime(400)

    cleanup()
    renderBlock(spec, stateKey, onAction)

    const restored = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(restored.value).toBe('用户简介')

    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).toHaveBeenCalledWith('send', expect.objectContaining({
      fields: { bio: '用户简介' },
    }))
  })

  it('a cleared durable value stays cleared instead of snapping back to the spec default', () => {
    const stateKey = 'textarea-durable-value-cleared'
    const spec = {
      items: [
        { type: 'textarea', label: '简介', id: 'bio', value: '默认简介' },
        { type: 'input', label: '昵称', id: 'name' },
        { type: 'submit', label: '发送', action: 'send' },
      ],
    }
    const onAction = vi.fn()

    renderBlock(spec, stateKey, onAction)
    const textarea = screen.getByLabelText('简介') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '' } })
    // A non-blank sibling keeps the submit clickable while `bio` is blank, so
    // the cleared-field assertion below runs against a real submit payload.
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '阿米' } })
    vi.advanceTimersByTime(400)

    cleanup()
    renderBlock(spec, stateKey, onAction)

    const restored = screen.getByLabelText('简介') as HTMLTextAreaElement
    expect(restored.value).toBe('')

    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    // Blank values are stored durably but excluded from submit collection.
    const sendCall = onAction.mock.calls.find(([action]) => action === 'send')
    expect(sendCall).toBeDefined()
    const payload = sendCall![1] as { fields?: Record<string, string> }
    expect(payload.fields).toEqual({ name: '阿米' })
    expect(payload.fields?.bio).toBeUndefined()
  })
})
