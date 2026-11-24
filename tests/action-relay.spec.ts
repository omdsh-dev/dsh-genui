// The [genui-action] relay: a click becomes a conversation.send() prompt. When
// that send rejects (session gone, agent busy) the click used to vanish with
// only a console.warn. The relay must retry a bounded number of times and then
// surface a visible failure, while never retrying a success or looping.
import { describe, expect, it, vi } from 'vitest'
import { relayAction } from '../src/client/action-relay.ts'

const noDelay = { retryDelayMs: 0 }

describe('relayAction()', () => {
  it('sends once and reports success without retrying', async () => {
    const send = vi.fn(async () => {})
    const onFailure = vi.fn()
    const ok = await relayAction(send, 'demo', { ...noDelay, onFailure })
    expect(ok).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('retries after a failure and succeeds', async () => {
    let calls = 0
    const send = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw new Error('agent busy')
    })
    const onFailure = vi.fn()
    const ok = await relayAction(send, 'demo', { ...noDelay, onFailure })
    expect(ok).toBe(true)
    expect(send).toHaveBeenCalledTimes(3)
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('gives up after the retry budget and surfaces a visible failure', async () => {
    const send = vi.fn(async () => {
      throw new Error('session gone')
    })
    const onFailure = vi.fn()
    const ok = await relayAction(send, 'demo', { ...noDelay, maxRetries: 2, onFailure })
    expect(ok).toBe(false)
    expect(send).toHaveBeenCalledTimes(3)
    expect(onFailure).toHaveBeenCalledTimes(1)
    const [action, error, attempts] = onFailure.mock.calls[0]!
    expect(action).toBe('demo')
    expect(error).toBeInstanceOf(Error)
    expect(attempts).toBe(3)
  })

  it('stops retrying when shouldAbort reports the session is gone', async () => {
    const send = vi.fn(async () => {
      throw new Error('session closed')
    })
    const onFailure = vi.fn()
    const ok = await relayAction(send, 'demo', {
      ...noDelay,
      maxRetries: 5,
      shouldAbort: () => true,
      onFailure,
    })
    expect(ok).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  it('never throws even when send throws synchronously', async () => {
    const send = vi.fn(() => {
      throw new Error('sync boom')
    }) as unknown as () => Promise<void>
    const onFailure = vi.fn()
    await expect(relayAction(send, 'demo', { ...noDelay, maxRetries: 1, onFailure })).resolves.toBe(false)
    expect(onFailure).toHaveBeenCalledTimes(1)
  })
})