// @vitest-environment jsdom
// The streaming placeholder must look like the component that is arriving:
// same family shape, and the real title as soon as it has arrived.
import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installDomFenceRenderer } from '../src/client/dom-fence.tsx'

function makeCtx(sessionId: string, send: ReturnType<typeof vi.fn>): Context {
  return {
    sessions: {
      list: { getSnapshot: () => ({ ids: [sessionId] }) },
      retainInfo: (id: string) => ({ getSnapshot: () => ({ retainedBy: id === sessionId ? { mainView: 1 } : {} }) }),
    },
  } as unknown as Context
}

function stockCodeBlock(raw: string, lang: string): HTMLElement {
  const block = document.createElement('div')
  block.className = 'md-code-block'
  const banner = document.createElement('div')
  banner.setAttribute('data-code-block-banner', '')
  const label = document.createElement('span')
  label.textContent = lang
  banner.append(label)
  const content = document.createElement('div')
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = raw
  pre.appendChild(code)
  content.appendChild(pre)
  block.append(banner, content)
  return block
}

function row(key: string): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-chat-anchor-key', key)
  el.setAttribute('data-chat-flow-kind', 'assistant-step')
  el.setAttribute('data-chat-node-key', key)
  el.setAttribute('data-streaming', '')
  return el
}

const tick = (ms = 60): Promise<void> => new Promise(r => setTimeout(r, ms))
afterEach(cleanup)

describe('streaming skeleton', () => {
  it('takes the shape of the arriving component and shows its title', async () => {
    const r = row('k1')
    // A table whose header row has not even closed: nothing parses yet.
    const block = stockCodeBlock('{"items":[{"type":"table","title":"成本明细","columns":["a","b"', 'dsh-ui')
    r.appendChild(block)
    document.body.appendChild(r)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('s1', send), send)
    try {
      await tick()
      const skeleton = r.querySelector('[data-genui-skeleton]')
      expect(skeleton).not.toBeNull()
      expect(skeleton!.getAttribute('data-genui-skeleton')).toBe('table')
      // The real heading is visible while the body is still arriving.
      expect(skeleton!.textContent).toContain('成本明细')
      expect(skeleton!.getAttribute('aria-label')).toContain('成本明细')
    } finally {
      dispose()
    }
  })

  it('shows nothing — and keeps the stock block — while the type is unknown', async () => {
    // No `type` yet means no honest shape. A placeholder here is a guess that the
    // next frame replaces, and covering the body with a wrong guess is worse than
    // leaving it: the stock code block stays, nothing is mounted.
    const r = row('k2')
    const block = stockCodeBlock('{"items":[{"ty', 'dsh-ui')
    r.appendChild(block)
    document.body.appendChild(r)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('s2', send), send)
    try {
      await tick()
      expect(r.querySelector('[data-genui-skeleton]')).toBeNull()
      expect(block.style.display).not.toBe('none')
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
    } finally {
      dispose()
    }
  })
})
