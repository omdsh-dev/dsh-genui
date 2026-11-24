// The visible half of the action-failure fix: a failed [genui-action] relay
// must surface something the reader can see, not just a console line. The
// notice lives at body level (independent of the panel), stacks, and clears
// itself so a burst of failures cannot pile up forever.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { showActionFailure } from '../src/client/action-notice.ts'

const HOST = '[data-genui-action-notice-host]'
const ITEM = '[data-genui-action-notice]'

afterEach(() => {
  document.querySelectorAll(HOST).forEach(node => node.remove())
  vi.useRealTimers()
})

describe('showActionFailure()', () => {
  it('renders a visible notice naming the action', () => {
    showActionFailure('submit-answer', 'agent busy')
    const notices = document.querySelectorAll(ITEM)
    expect(notices).toHaveLength(1)
    expect(notices[0]!.textContent).toContain('submit-answer')
  })

  it('stacks multiple failures instead of replacing the previous one', () => {
    showActionFailure('first', 'e1')
    showActionFailure('second', 'e2')
    const notices = document.querySelectorAll(ITEM)
    expect(notices).toHaveLength(2)
    expect(notices[1]!.textContent).toContain('second')
  })

  it('auto-dismisses after the timeout and drops the empty host', () => {
    vi.useFakeTimers()
    showActionFailure('slow', 'e')
    expect(document.querySelectorAll(ITEM)).toHaveLength(1)
    vi.advanceTimersByTime(5000)
    expect(document.querySelectorAll(ITEM)).toHaveLength(0)
    expect(document.querySelectorAll(HOST)).toHaveLength(0)
  })

  it('never leaks the failure detail into the DOM', () => {
    // The detail may quote field content or a transport message; only the
    // action name is safe to show.
    showActionFailure('demo', 'secret-token-abc123')
    expect(document.querySelector(ITEM)!.textContent).not.toContain('secret-token-abc123')
  })

  it('does nothing outside a DOM environment', () => {
    expect(() => showActionFailure('x', 'y')).not.toThrow()
  })
})