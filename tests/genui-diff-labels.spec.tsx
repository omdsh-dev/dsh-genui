// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodeNode, DiffNode, JsonNode } from '../src/client/blocks/advanced.tsx'
import type { GenuiCode, GenuiDiff, GenuiJson } from '../src/client/spec.ts'

const originalClipboard = navigator.clipboard

afterEach(() => {
  cleanup()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard })
})

describe('GenUI diff labels', () => {
  it('renders the rc.1 diff contract with localized copy labels', () => {
    const node: GenuiDiff = {
      type: 'diff',
      diffs: [{ path: 'a.txt', oldText: 'x', newText: 'y' }],
    }

    render(<DiffNode node={node} />)

    const diff = document.querySelector('[data-diff]')
    expect(diff).not.toBeNull()
    expect(diff?.textContent).toContain('复制')
    expect(diff?.textContent).toContain('1 个文件')
    expect(diff?.textContent).not.toContain('undefined')
  })

  it('passes required copy labels to CodeBlock', () => {
    const node: GenuiCode = { type: 'code', lang: 'text', code: 'hello' }

    render(<CodeNode node={node} />)

    expect(document.querySelector('.md-code-block')?.textContent).toContain('复制')
    expect(document.querySelector('.md-code-block')?.textContent).not.toContain('undefined')
  })

  it('uses the localized CodeBlock copied label after copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const node: GenuiCode = { type: 'code', lang: 'text', code: 'hello' }

    render(<CodeNode node={node} />)

    fireEvent.click(document.querySelector('.md-code-block button')!)
    await waitFor(() => expect(document.querySelector('.md-code-block button')?.textContent).toBe('复制成功'))
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('passes required copy labels to JsonTree', () => {
    const node: GenuiJson = { type: 'json', value: { answer: 42 } }

    render(<JsonNode node={node} />)

    const row = document.querySelector('[role="treeitem"]')
    expect(row).not.toBeNull()
    fireEvent.mouseOver(row!)
    const button = document.querySelector('[data-json-copy-button]')
    expect(button?.getAttribute('aria-label')).toContain('复制')
    expect(button?.getAttribute('aria-label')).not.toContain('undefined')
  })

  it('uses the localized JsonTree copied label after copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const node: GenuiJson = { type: 'json', value: { answer: 42 } }

    render(<JsonNode node={node} />)

    const row = document.querySelector('[data-json-root-row]')!
    fireEvent.mouseOver(row)
    const button = document.querySelector<HTMLButtonElement>('[data-json-copy-button]')!
    fireEvent.click(button)
    await waitFor(() => expect(button.getAttribute('aria-label')).toBe('已复制'))
    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ answer: 42 }, null, 2))
  })
})
