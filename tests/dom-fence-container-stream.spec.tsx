// @vitest-environment jsdom
// End-to-end streaming proof for containers: the DOM channel must render a
// finished CHILD while the container is still open. The parser unit tests cover
// `parsePartialGenuiSpec`; this drives the real observer pipeline, so a
// regression in the takeover path (skeleton never leaves, or the container waits
// for its own close) fails here and not only in a unit test.
import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installDomFenceRenderer } from '../src/client/dom-fence.tsx'

function makeCtx(sessionId: string | undefined, send: ReturnType<typeof vi.fn>): Context {
  return {
    sessions: {
      list: { getSnapshot: () => ({ ids: sessionId === undefined ? [] : [sessionId] }) },
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

function assistantRow(key: string, streaming = false): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('data-chat-anchor-key', key)
  row.setAttribute('data-chat-flow-kind', 'assistant-step')
  row.setAttribute('data-chat-node-key', key)
  if (streaming) row.setAttribute('data-streaming', '')
  return row
}

const tick = (ms = 60): Promise<void> => new Promise(r => setTimeout(r, ms))
afterEach(cleanup)

describe('container grows while streaming', () => {
  it('shows the first finished child before the card closes, then the second', async () => {
    const row = assistantRow('c1', true)
    const one = '{"items":[{"type":"card","title":"成本拆分","items":[{"type":"keyvalue","pairs":[{"key":"向量库","value":"¥1,200"}]}'
    const block = stockCodeBlock(one, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('s1', send), send)
    try {
      await tick()
      const first = row.querySelector('.genui-dom-fence')
      expect(first).not.toBeNull()
      expect(first!.textContent).toContain('¥1,200')
      fireEvent.animationEnd(first!.querySelector('[class*="reveal"]')!)

      const two = one + ',{"type":"keyvalue","pairs":[{"key":"推理","value":"¥800"}]}'
      block.querySelector('code')!.textContent = two
      for (let i = 0; i < 40 && !row.querySelector('.genui-dom-fence')?.textContent?.includes('¥800'); i++) await tick(50)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('¥800')
    } finally {
      dispose()
    }
  })
})
