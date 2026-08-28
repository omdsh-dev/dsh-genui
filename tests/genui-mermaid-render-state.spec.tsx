// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { renderMermaidMock } = vi.hoisted(() => ({ renderMermaidMock: vi.fn() }))
vi.mock('../src/client/mermaid-lazy.ts', () => ({ renderMermaid: renderMermaidMock }))

import { MermaidNode } from '../src/client/blocks/advanced.tsx'
import type { GenuiMermaid } from '../src/client/spec.ts'

afterEach(() => {
  cleanup()
  renderMermaidMock.mockReset()
})

const node = (code: string): GenuiMermaid => ({ type: 'mermaid', code })

describe('Mermaid render state', () => {
  it('recovers from an error when code changes to a valid diagram', async () => {
    renderMermaidMock
      .mockRejectedValueOnce(new Error('bad syntax'))
      .mockResolvedValueOnce('<svg><text>valid diagram</text></svg>')

    const view = render(<MermaidNode node={node('bad')} />)
    await screen.findByText('图语法有误，已降级显示源码')

    view.rerender(<MermaidNode node={node('graph TD\nA --> B')} />)
    expect(screen.getByText('渲染中…')).toBeTruthy()

    await waitFor(() => {
      const rendered = view.container.querySelector('[data-genui-mermaid]')
      expect(rendered).not.toBeNull()
      expect(rendered!.innerHTML).toContain('valid diagram')
    })
    expect(screen.queryByText('图语法有误，已降级显示源码')).toBeNull()
  })

  it('clears an old rendered SVG while new code is loading', async () => {
    let resolveNext!: (svg: string) => void
    const nextRender = new Promise<string>(resolve => { resolveNext = resolve })
    renderMermaidMock
      .mockResolvedValueOnce('<svg><text>first</text></svg>')
      .mockReturnValueOnce(nextRender)

    const view = render(<MermaidNode node={node('graph TD\nA --> B')} />)
    await waitFor(() => {
      const rendered = view.container.querySelector('[data-genui-mermaid]')
      expect(rendered).not.toBeNull()
      expect(rendered!.innerHTML).toContain('first')
    })

    view.rerender(<MermaidNode node={node('graph TD\nC --> D')} />)
    expect(screen.getByText('渲染中…')).toBeTruthy()
    expect(view.container.querySelector('[data-genui-mermaid]')).toBeNull()

    resolveNext('<svg><text>second</text></svg>')
    await waitFor(() => {
      const rendered = view.container.querySelector('[data-genui-mermaid]')
      expect(rendered).not.toBeNull()
      expect(rendered!.innerHTML).toContain('second')
    })
  })
})
