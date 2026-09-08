// @vitest-environment jsdom
// GenUI action debounce: rapid repeated interactions on one control collapse
// into a single [genui-action] with the last payload; different action names
// stay independent; unmount cancels pending timers.
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownText } from './markdown-labels.tsx'
import { hasFenceRegistry } from './setup'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GENUI_ACTION_DEBOUNCE_MS } from '../src/client/GenuiBlock.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
beforeEach(() => {
  vi.useFakeTimers()
})

function fenced(spec: unknown): string {
  return `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
}

describe.skipIf(!hasFenceRegistry)('action debounce', () => {
  it('collapses rapid repeats into one action with the last payload', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced({ items: [
          { type: 'button', label: '刷新', action: 'refresh' },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    const button = document.querySelector('button')!
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    expect(actions).toHaveLength(0) // nothing fired inside the window
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['refresh', { type: 'button', label: '刷新' }]])
  })

  it('keeps different action names independent', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced({ items: [
          { type: 'button', label: '刷新', action: 'refresh' },
          { type: 'switch', label: '通知', action: 'toggle-notify' },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    fireEvent.click(document.querySelector('button')!)
    fireEvent.click(document.querySelector('[role="switch"]')!)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toHaveLength(2)
    expect(actions.map(([a]) => a).sort()).toEqual(['refresh', 'toggle-notify'])
  })

  it('fires again after the window elapses', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced({ items: [
          { type: 'button', label: '刷新', action: 'refresh' },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    const button = document.querySelector('button')!
    fireEvent.click(button)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    fireEvent.click(button)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toHaveLength(2)
  })

  it('does not fire without a provider (v1 behavior)', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    render(<MarkdownText text={fenced({ items: [{ type: 'button', label: 'x', action: 'a' }] })} />)
    fireEvent.click(document.querySelector('button')!)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toHaveLength(0)
  })

  it('cancels pending actions on unmount', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const view = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced({ items: [{ type: 'button', label: 'x', action: 'a' }] })} />
      </GenuiActionContext.Provider>,
    )
    fireEvent.click(document.querySelector('button')!)
    view.unmount()
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toHaveLength(0)
  })

  it('exposes a sane debounce window', () => {
    expect(GENUI_ACTION_DEBOUNCE_MS).toBeGreaterThan(0)
    expect(GENUI_ACTION_DEBOUNCE_MS).toBeLessThanOrEqual(1000)
  })
})
