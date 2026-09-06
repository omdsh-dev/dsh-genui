// @vitest-environment jsdom
// GenUI hardening: render-level caps, depth guards, and a11y wiring. The
// fence path repairs specs first (see genui-guard.spec.ts); these tests pin
// the renderer's own belt-and-suspenders behavior and the accessibility
// contract of interactive components.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { hasFenceRegistry } from './setup'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { GENUI_LIMITS } from '../src/client/genui-runtime/index.ts'

afterEach(cleanup)

function fenced(spec: unknown): string {
  return `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
}

describe.skipIf(!hasFenceRegistry)('render caps', () => {
  it('bounds a spec beyond the node budget', () => {
    render(<MarkdownText text={fenced({ items: Array.from({ length: 500 }, (_, i) => ({ type: 'text', content: `item ${i}` })) })} />)
    expect(document.body.textContent).toContain('item 0')
    expect(document.body.textContent).not.toContain('item 299')
    expect(document.body.textContent).not.toContain('item 499')
  })

  it('renders pathological nesting without crashing', () => {
    let node: unknown = { type: 'text', content: 'deep' }
    for (let i = 0; i < 40; i++) node = { type: 'col', items: [node] }
    // The leaf sits beyond the depth cap and is elided by the guard; the
    // important invariant is that rendering never blows the stack.
    expect(() => render(<MarkdownText text={fenced({ items: [node] })} />)).not.toThrow()
    expect(document.querySelector('[data-genui]')).not.toBeNull()
  })

  it('caps tabs at render time', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'tabs', tabs: Array.from({ length: 30 }, (_, i) => ({ label: `tab ${i}`, items: [{ type: 'text', content: `body ${i}` }] })) },
    ] })} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBeLessThanOrEqual(GENUI_LIMITS.maxTabs)
  })

  it('caps file-tree depth at render time', () => {
    let node: Record<string, unknown> = { name: 'leaf', type: 'file' }
    for (let i = 0; i < 20; i++) node = { name: `dir ${i}`, type: 'dir', children: [node] }
    expect(() => render(<MarkdownText text={fenced({ items: [{ type: 'file-tree', items: [node] }] })} />)).not.toThrow()
  })
})

describe.skipIf(!hasFenceRegistry)('a11y wiring', () => {
  it('exposes progress as a progressbar with aria values', () => {
    render(<MarkdownText text={fenced({ items: [{ type: 'progress', label: '下载', value: 66, valueLabel: '66%' }] })} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('66')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
    expect(bar.getAttribute('aria-label')).toBe('下载')
  })

  it('navigates tabs with arrow keys and wires aria-controls', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'tabs', tabs: [
        { label: '一', items: [{ type: 'text', content: 'panel 一' }] },
        { label: '二', items: [{ type: 'text', content: 'panel 二' }] },
        { label: '三', items: [{ type: 'text', content: 'panel 三' }] },
      ] },
    ] })} />)
    const tabs = screen.getAllByRole('tab')
    const first = tabs[0]!
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(first.getAttribute('aria-controls')).not.toBeNull()
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
    expect(document.body.textContent).toContain('panel 二')
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' })
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0]!.id)
  })

  it('announces quiz results via aria-live', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'quiz', question: 'q', options: [{ label: '对', correct: true }, { label: '错' }] },
    ] })} />)
    expect(document.querySelector('[aria-live="polite"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '对' }))
    const live = document.querySelector('[aria-live="polite"]')
    expect(live).not.toBeNull()
    expect(live!.textContent).toContain('回答正确')
  })

  it('wires accordion headings to their bodies', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'accordion', items: [{ title: '头部', items: [{ type: 'text', content: '内容' }] }] },
    ] })} />)
    const head = screen.getByRole('button', { name: /头部/ })
    const controls = head.getAttribute('aria-controls')
    expect(controls).not.toBeNull()
    const body = document.getElementById(controls!)
    expect(body).not.toBeNull()
    expect(body!.textContent).toContain('内容')
  })

  it('gives sibling radio groups distinct names', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'radio', label: 'A', options: ['1', '2'] },
      { type: 'radio', label: 'B', options: ['x', 'y'] },
    ] })} />)
    const groups = screen.getAllByRole('radiogroup')
    const nameA = groups[0]!.querySelector('input')!.name
    const nameB = groups[1]!.querySelector('input')!.name
    expect(nameA).not.toBe('')
    expect(nameA).not.toBe(nameB)
  })
})
