// Synthetic issue #329 workflow: normalize and guard authored JSON before rendering.
import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { processGenuiSpec, repairGenuiSpec } from '../src/client/guard.ts'
import { setLocale } from '../src/client/i18n/index.ts'
import { createValidateDshUiTool } from '../src/plugin/tool.ts'

const body = '1. Use synthetic fixtures.\n2. Preserve the original text.\n3. Review before sending.'
const copy = (fields: Record<string, unknown> = {}) => ({ type: 'copy', label: 'Copy constraints', text: body, ...fields })
const specOf = (items: unknown[]) => processGenuiSpec({ items }).spec!
const previewOf = (container: HTMLElement) => container.querySelector('pre')!

afterEach(() => {
  cleanup()
  setLocale('zh')
  vi.restoreAllMocks()
})

describe('copy preview schema and guards', () => {
  it('keeps optional preview fields through the actual canonical pipeline', async () => {
    const authored = { items: [copy({ expandable: true, previewLines: 2 })] }
    const result = processGenuiSpec(authored)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.spec!.items[0]).toEqual(authored.items[0])
    const verdict = String(await createValidateDshUiTool().execute({ spec: JSON.stringify(authored) }))
    expect(verdict).toContain('status=valid')
    expect(verdict).toContain('next=emit_fence')
    expect(verdict).not.toContain('warning=unknown_field')
  })

  it('preserves the existing copy aliases with preview options', () => {
    const result = processGenuiSpec({ items: [{ type: 'copy', content: body, expandable: true, previewLines: 1 }] })
    expect(result.errors).toEqual([])
    expect(result.spec!.items[0]).toEqual({ type: 'copy', text: body, expandable: true, previewLines: 1 })
    expect(result.warnings.some(w => w.kind === 'unknown-field')).toBe(false)
  })

  it.each([[0, 0], [-4, 0], [2.8, 2], [10000, 30]])('bounds previewLines=%s to %s', (input, expected) => {
    const result = processGenuiSpec({ items: [copy({ expandable: true, previewLines: input })] })
    expect(result.errors).toEqual([])
    expect(result.spec!.items[0]).toHaveProperty('previewLines', expected)
  })

  it.each([{ expandable: 'true' }, { previewLines: '2' }, { previewLines: Number.NaN }, { previewLines: Number.POSITIVE_INFINITY }])('diagnoses malformed options: %j', fields => {
    const result = processGenuiSpec({ items: [copy(fields)] })
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('copy preview renderer', () => {
  it.each([{}, { expandable: false, previewLines: 2 }, { previewLines: 2 }])('leaves legacy copy markup and hidden body unchanged: %j', fields => {
    const legacy = render(<GenuiBlock spec={specOf([copy()])} animateEntrance={false} />)
    const oldHtml = legacy.container.innerHTML
    legacy.unmount()
    const out = render(<GenuiBlock spec={specOf([copy(fields)])} animateEntrance={false} />)
    expect(out.container.innerHTML).toBe(oldHtml)
    expect(out.queryByText(body)).toBeNull()
    expect(out.getAllByRole('button')).toHaveLength(1)
    expect(out.container.querySelector('pre')).toBeNull()
  })

  it('opens and closes a separate keyboard-native toggle without copying', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { configurable: true, value: { writeText } } }))
    try {
      const out = render(<GenuiBlock spec={specOf([copy({ expandable: true })])} />)
      const toggle = out.getByRole('button', { name: '查看文本' })
      const preview = previewOf(out.container)
      expect(toggle.tagName).toBe('BUTTON')
      expect(toggle.getAttribute('type')).toBe('button')
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(toggle.getAttribute('aria-controls')).toBe(preview.id)
      expect(preview.hidden).toBe(true)
      fireEvent.click(toggle)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(preview.hidden).toBe(false)
      expect(preview.textContent).toBe(body)
      expect(preview.tabIndex).toBe(0)
      fireEvent.click(toggle)
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(preview.hidden).toBe(true)
      expect(writeText).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('shows the first N lines while collapsed and preserves blank lines and CRLF on expansion', () => {
    const text = 'first\r\n\r\nthird\nfourth'
    const out = render(<GenuiBlock spec={specOf([copy({ text, expandable: true, previewLines: 2 })])} />)
    const preview = previewOf(out.container)
    const toggle = out.getByRole('button', { name: '查看文本' })
    expect(preview.hidden).toBe(false)
    expect(preview.textContent).toBe('first\r\n')
    fireEvent.click(toggle)
    expect(preview.textContent).toBe(text)
    fireEvent.click(toggle)
    expect(preview.textContent).toBe('first\r\n')
  })

  it('renders markup and markdown literally, not as active elements', () => {
    const text = '<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n**literal** [link](https://example.com)'
    const out = render(<GenuiBlock spec={specOf([copy({ text, expandable: true })])} />)
    fireEvent.click(out.getByRole('button', { name: '查看文本' }))
    expect(previewOf(out.container).textContent).toBe(text)
    expect(previewOf(out.container).querySelector('img,script,a,strong')).toBeNull()
  })

  it('bounds long previews and warns without shortening the copied text', async () => {
    const text = 'x'.repeat(2500) + '\nlast line'
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { configurable: true, value: { writeText } } }))
    try {
      const out = render(<GenuiBlock spec={specOf([copy({ text, expandable: true })])} />)
      fireEvent.click(out.getByRole('button', { name: '查看文本' }))
      expect(previewOf(out.container).textContent).toBe(text.slice(0, 2000))
      expect(out.getByText('预览已截断，复制仍包含组件的完整文本。')).toBeTruthy()
      fireEvent.click(out.getByRole('button', { name: 'Copy constraints' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(text))
      await waitFor(() => expect(out.getByRole('status').textContent).toBe('已复制到剪贴板'))
      expect(out.getByRole('status').closest('button')).toBeNull()
      expect(out.getByRole('button', { name: '收起文本' }).getAttribute('aria-expanded')).toBe('true')
    } finally { vi.unstubAllGlobals() }
  })

  it('does not split Unicode code points at the preview cap', () => {
    const text = 'x'.repeat(1999) + '😀' + 'after'
    const out = render(<GenuiBlock spec={specOf([copy({ text, expandable: true })])} />)
    fireEvent.click(out.getByRole('button', { name: '查看文本' }))
    expect(previewOf(out.container).textContent).toBe('x'.repeat(1999) + '😀')
  })

  it.each(['', 'short', 'first\n'])('shows short/empty preview without an unnecessary truncation hint: %j', text => {
    const out = render(<GenuiBlock spec={specOf([copy({ text, expandable: true, previewLines: 30 })])} />)
    expect(previewOf(out.container).textContent).toBe(text)
    expect(out.queryByText('预览已截断，复制仍包含组件的完整文本。')).toBeNull()
  })

  it('keeps expansion while a reply updates, but resets when the block identity changes', () => {
    const out = render(<GenuiBlock spec={specOf([copy({ expandable: true })])} />)
    fireEvent.click(out.getByRole('button', { name: '查看文本' }))
    out.rerender(<GenuiBlock spec={specOf([copy({ expandable: true, text: body + '\n4. Added later.' })])} />)
    expect(out.getByRole('button', { name: '收起文本' }).getAttribute('aria-expanded')).toBe('true')
    expect(previewOf(out.container).textContent).toContain('4. Added later.')
    out.rerender(<GenuiBlock stateKey="copy-preview-reply-one" spec={specOf([copy({ expandable: true })])} />)
    expect(out.getByRole('button', { name: '收起文本' })).toBeTruthy()
    out.rerender(<GenuiBlock stateKey="copy-preview-reply-two" spec={specOf([copy({ expandable: true })])} />)
    expect(out.getByRole('button', { name: '查看文本' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('isolates sibling previews and follows locale changes without losing expansion', () => {
    const out = render(<GenuiBlock spec={specOf([copy({ expandable: true }), copy({ expandable: true, text: 'second' })])} />)
    const toggles = out.getAllByRole('button', { name: '查看文本' })
    expect(toggles[0]!.getAttribute('aria-controls')).not.toBe(toggles[1]!.getAttribute('aria-controls'))
    fireEvent.click(toggles[0]!)
    expect(toggles[1]!.getAttribute('aria-expanded')).toBe('false')
    act(() => setLocale('en'))
    expect(out.getByRole('button', { name: 'Hide text' }).getAttribute('aria-expanded')).toBe('true')
    expect(out.getByRole('button', { name: 'View text' }).getAttribute('aria-expanded')).toBe('false')
  })

  it.each(['tabs', 'accordion'])('isolates and restores copy expansion across %s children', kind => {
    const items = kind === 'tabs'
      ? [{ type: 'tabs', tabs: [{ label: 'A', items: [copy({ expandable: true })] }, { label: 'B', items: [copy({ expandable: true, text: 'second' })] }] }]
      : [{ type: 'accordion', items: [{ title: 'A', items: [copy({ expandable: true })] }, { title: 'B', items: [copy({ expandable: true, text: 'second' })] }] }]
    const out = render(<GenuiBlock spec={specOf(items)} />)
    fireEvent.click(out.getByRole('button', { name: '查看文本' }))
    const role = kind === 'tabs' ? 'tab' : 'button'
    fireEvent.click(out.getByRole(role, { name: 'B' }))
    expect(out.getByRole('button', { name: '查看文本' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(out.getByRole(role, { name: 'A' }))
    expect(out.getByRole('button', { name: '收起文本' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('restores an expanded preview after closing its accordion completely', () => {
    const spec = specOf([{ type: 'accordion', items: [{ title: 'A', items: [copy({ expandable: true })] }] }])
    const out = render(<GenuiBlock spec={spec} />)
    fireEvent.click(out.getByRole('button', { name: '查看文本' }))
    fireEvent.click(out.getByRole('button', { name: 'A' }))
    expect(out.container.querySelector('pre')).toBeNull()
    fireEvent.click(out.getByRole('button', { name: 'A' }))
    expect(out.getByRole('button', { name: '收起文本' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('isolates identical nested positions in different containers', () => {
    const spec = specOf([{ type: 'tabs', tabs: [
      { label: 'Outer A', items: [{ type: 'accordion', items: [{ title: 'Inner', items: [copy({ expandable: true })] }] }] },
      { label: 'Outer B', items: [{ type: 'accordion', items: [{ title: 'Inner', items: [copy({ expandable: true })] }] }] },
    ] }])
    const out = render(<GenuiBlock spec={spec} />)
    fireEvent.click(out.getByRole('button', { name: '查看文本' }))
    fireEvent.click(out.getByRole('tab', { name: 'Outer B' }))
    expect(out.getByRole('button', { name: '查看文本' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(out.getByRole('tab', { name: 'Outer A' }))
    expect(out.getByRole('button', { name: '收起文本' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('forgets preview state after a node is removed or disabled', () => {
    const out = render(<GenuiBlock spec={specOf([copy({ expandable: true })])} />)
    fireEvent.click(out.getByRole('button', { name: '查看文本' }))
    out.rerender(<GenuiBlock spec={specOf([{ type: 'text', content: 'replacement' }])} />)
    out.rerender(<GenuiBlock spec={specOf([copy({ expandable: true })])} />)
    expect(out.getByRole('button', { name: '查看文本' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(out.getByRole('button', { name: '查看文本' }))
    out.rerender(<GenuiBlock spec={specOf([copy({ expandable: false })])} />)
    out.rerender(<GenuiBlock spec={specOf([copy({ expandable: true })])} />)
    expect(out.getByRole('button', { name: '查看文本' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps the preview CSS bounded, scrollable, whitespace-preserving and monospace', () => {
    // A static contract, not a claim about browser-painted geometry.
    const css = readFileSync('src/client/GenuiBlock.module.css', 'utf8')
    const rule = /\.copyPreview \{([^}]+)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('max-height: 240px')
    expect(rule).toContain('overflow: auto')
    expect(rule).toContain('white-space: pre-wrap')
    expect(rule).toContain('font-family: var(--dsl-g-font-mono)')
    expect(rule).toContain('overflow-wrap: anywhere')
  })

  it('does not loosen the existing guard limit on copied text', () => {
    const spec = repairGenuiSpec({ items: [copy({ expandable: true, text: 'x'.repeat(13000) })] })!
    expect(spec.items[0]).toHaveProperty('text', 'x'.repeat(12000))
  })
})
