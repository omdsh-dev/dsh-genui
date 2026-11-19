// @vitest-environment jsdom
// GenUI hardening: render-level caps, depth guards, and a11y wiring. The
// fence path repairs specs first (see genui-guard.spec.ts); these tests pin
// the renderer's own belt-and-suspenders behavior and the accessibility
// contract of interactive components.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownText } from './genui-markdown.tsx'
import { GENUI_LIMITS } from '../src/client/genui-runtime/index.ts'
import { processGenuiSpec } from '../src/client/guard.ts'

afterEach(cleanup)

function fenced(spec: unknown): string {
  return `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
}

describe('render caps', () => {
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

  // #298 方向 A:政策性截断不再计入「声明 vs 渲染」缺陷账——超限 tabs
  // 截断到 maxTabs 后照常渲染,并向模型发出 policy_truncated 教学警告。
  it('caps tabs at render time', () => {
    const spec = { items: [
      { type: 'tabs', tabs: Array.from({ length: 30 }, (_, i) => ({ label: `tab ${i}`, items: [{ type: 'text', content: `body ${i}` }] })) },
    ] }
    const { container } = render(<MarkdownText text={fenced(spec)} />)
    expect(container.querySelector('[data-genui]')).not.toBeNull()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBe(GENUI_LIMITS.maxTabs)
    const processed = processGenuiSpec(spec)
    expect(processed.errors).toEqual([])
    expect(processed.warnings.some(w => w.kind === 'truncated')).toBe(true)
  })

  it('caps accordion items at render time with the same teaching warning', () => {
    const spec = { items: [
      { type: 'accordion', items: Array.from({ length: 30 }, (_, i) => ({ title: `头 ${i}`, items: [{ type: 'text', content: `体 ${i}` }] })) },
    ] }
    const processed = processGenuiSpec(spec)
    expect(processed.errors).toEqual([])
    expect(processed.renderedNativeCount).toBeGreaterThan(0)
    expect(processed.warnings.some(w => w.kind === 'truncated')).toBe(true)
  })

  it('reports actual table, list, and file-tree truncation counts', () => {
    const spec = { items: [
      { type: 'table', columns: ['value'], rows: Array.from({ length: 51 }, (_, index) => [`row ${index}`]) },
      { type: 'list', items: Array.from({ length: 51 }, (_, index) => `item ${index}`) },
      { type: 'file-tree', items: [
        ...Array.from({ length: 51 }, (_, index) => ({ name: `root ${index}`, type: 'file' })),
      ] },
      { type: 'file-tree', items: [{ name: 'dir', type: 'dir', children: [
        ...Array.from({ length: 52 }, (_, index) => ({ name: `child ${index}`, type: 'file' })),
      ] }] },
      { type: 'card', title: 'Nested', items: [
        { type: 'table', columns: ['value'], rows: Array.from({ length: 51 }, (_, index) => [`nested row ${index}`]) },
        { type: 'list', items: Array.from({ length: 51 }, (_, index) => `nested item ${index}`) },
      ] },
    ] }
    const processed = processGenuiSpec(spec)
    const warning = processed.warnings.find(item => item.kind === 'truncated')

    expect(processed.errors).toEqual([])
    expect(warning?.message).toContain('2 行超出 table.rows')
    expect(warning?.message).toContain('2 项超出 list.items')
    expect(warning?.message).toContain('3 个节点超出 file-tree 每层')
  })

  it('does not report data arrays at their exact caps or invalid trailing entries', () => {
    const rows = Array.from({ length: GENUI_LIMITS.maxTableRows }, (_, index) => [`row ${index}`])
    const listItems = Array.from({ length: GENUI_LIMITS.maxListItems }, (_, index) => `item ${index}`)
    const treeItems = Array.from({ length: GENUI_LIMITS.maxListItems }, (_, index) => ({ name: `node ${index}`, type: 'file' }))
    const processed = processGenuiSpec({ items: [
      { type: 'table', columns: ['value'], rows: [null, ...rows, null] },
      { type: 'list', items: [null, ...listItems, null] },
      { type: 'file-tree', items: [null, ...treeItems, null] },
    ] })

    expect(processed.warnings.some(item => item.kind === 'truncated')).toBe(false)
  })

  it('skips invalid object rows while counting actual table overflow', () => {
    const rows = Array.from({ length: GENUI_LIMITS.maxTableRows }, (_, index) => ({ value: `row ${index}` }))
    const exactLimit = processGenuiSpec({ items: [
      { type: 'table', columns: ['value'], rows: [...rows, null, 'invalid'] },
    ] })
    const overflow = processGenuiSpec({ items: [
      { type: 'table', columns: ['value'], rows: [...rows, null, { value: 'extra' }] },
    ] })

    expect(exactLimit.warnings.some(item => item.kind === 'truncated')).toBe(false)
    expect(overflow.warnings.find(item => item.kind === 'truncated')?.message).toContain('1 行超出 table.rows')
  })

  it('counts implicit table-header overflow once', () => {
    const processed = processGenuiSpec({ items: [{
      type: 'table', rows: [['value'], ...Array.from({ length: GENUI_LIMITS.maxTableRows }, (_, index) => [`row ${index}`])],
    }] })

    expect(processed.warnings.find(item => item.kind === 'truncated')?.message).toContain('1 行超出 table.rows')
  })

  it('counts valid overflow after invalid entries beyond each cap', () => {
    const rows = Array.from({ length: GENUI_LIMITS.maxTableRows }, (_, index) => ({ value: `row ${index}` }))
    const listItems = Array.from({ length: GENUI_LIMITS.maxListItems }, (_, index) => `item ${index}`)
    const treeItems = Array.from({ length: GENUI_LIMITS.maxListItems }, (_, index) => ({ name: `node ${index}`, type: 'file' }))
    const processed = processGenuiSpec({ items: [
      { type: 'table', columns: ['value'], rows: [...rows, null, { value: 'extra' }] },
      { type: 'list', items: [...listItems, null, 'extra'] },
      { type: 'file-tree', items: [...treeItems, null, { name: 'extra', type: 'file' }] },
    ] })
    const warning = processed.warnings.find(item => item.kind === 'truncated')

    expect(warning?.message).toContain('1 行超出 table.rows')
    expect(warning?.message).toContain('1 项超出 list.items')
    expect(warning?.message).toContain('1 个节点超出 file-tree 每层')
  })

  it('caps file-tree depth at render time', () => {
    let node: Record<string, unknown> = { name: 'leaf', type: 'file' }
    for (let i = 0; i < 20; i++) node = { name: `dir ${i}`, type: 'dir', children: [node] }
    expect(() => render(<MarkdownText text={fenced({ items: [{ type: 'file-tree', items: [node] }] })} />)).not.toThrow()
  })
})

describe('a11y wiring', () => {
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
