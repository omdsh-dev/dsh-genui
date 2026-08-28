// @vitest-environment jsdom
import type { Context } from '@deepseek-ai/cordis'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installDomFenceRenderer, setDomRootFactory } from '../src/client/dom-fence.tsx'

describe('DOM fence RAF teardown', () => {
  let callbacks: Map<number, FrameRequestCallback>
  let nextId: number

  beforeEach(() => {
    callbacks = new Map()
    nextId = 1
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextId++
      callbacks.set(id, cb)
      return id
    })
  })

  afterEach(() => {
    setDomRootFactory(createRoot)
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('cancels and ignores a queued sweep after dispose', async () => {
    const cancel = vi.fn<(id: number) => void>()
    vi.stubGlobal('cancelAnimationFrame', cancel)

    const rootFactory = vi.fn(() => ({
      render: vi.fn(),
      unmount: vi.fn(),
    }) as unknown as Root)
    setDomRootFactory(rootFactory)

    const ctx = {
      sessions: { list: { getSnapshot: () => ({ current: 'session-a' }) } },
    } as unknown as Context

    const dispose = installDomFenceRenderer(ctx, vi.fn())

    const block = document.createElement('div')
    block.className = 'md-code-block'
    block.innerHTML = '<div>dsh-ui</div><pre>{"items":[{"type":"text","content":"hello"}]}</pre>'
    document.body.append(block)

    // Let MutationObserver enqueue the coalesced RAF without running it.
    await Promise.resolve()
    await Promise.resolve()

    expect(callbacks.size).toBe(1)
    const [[rafId, callback]] = [...callbacks.entries()]
    expect(rootFactory).not.toHaveBeenCalled()

    dispose()

    expect(cancel).toHaveBeenCalledWith(rafId)

    // Even if an environment invokes the stale callback after cancellation,
    // the disposed guard must make it a no-op.
    callback(16)

    expect(rootFactory).not.toHaveBeenCalled()
    expect(document.querySelector('.genui-dom-fence')).toBeNull()
  })
})
