import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setLocale } from '../src/client/i18n/index.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'
import { collectGenuiMediaRefs } from '../src/client/artifact/media.ts'
import type { GenuiSpec } from '../src/client/spec.ts'
import { countXChars, linkedInFold, xCharStatus } from '../src/client/social-text.ts'
import { compileDshGo } from '../src/plugin/dsh-go-compiler.ts'
import { createValidateDshUiTool } from '../src/plugin/tool.ts'

beforeEach(() => { setLocale('en') })
afterEach(() => { cleanup(); setLocale('zh') })

export const X_EXAMPLE = {
  items: [{
    type: 'x-post',
    author: { name: 'Ada Lovelace', handle: 'ada', verified: true },
    timestamp: 'Draft',
    posts: [
      { text: 'Shipping social previews in DSH today.\n\nThread below 👇' },
      { text: 'Each post gets its own counter, weighted like X: links count as 23.\nhttps://example.com/a/very/long/path/that/is/shortened', images: ['https://example.com/shot.png'] },
      { text: 'Quote posts work too.', quote: { name: 'Someone', handle: 'someone', text: 'The original post.' } },
    ],
  }],
}

export const LINKEDIN_EXAMPLE = {
  items: [{
    type: 'linkedin-post',
    author: { name: 'Grace Hopper', headline: 'Rear admiral, computer scientist' },
    device: 'desktop',
    timestamp: '1h',
    text: 'Most posts lose the reader before the fold.\n\nHere is what I changed in how I review drafts, and why the first three lines now get more attention than the rest of the post combined.',
  }],
}

describe('X weighted character count', () => {
  it('counts Latin text one per character and line breaks as one', () => {
    expect(countXChars('hello')).toBe(5)
    expect(countXChars('a\n\nb')).toBe(4)
  })

  it('counts every URL as 23 characters whatever its length, without trailing punctuation', () => {
    expect(countXChars('https://example.com/a/very/long/path/that/goes/on/and/on')).toBe(23)
    expect(countXChars('see https://x.co.')).toBe(4 + 23 + 1)
    expect(countXChars('bare example.com/path works')).toBe(5 + 23 + 6)
  })

  it('counts CJK characters and emoji sequences as two', () => {
    expect(countXChars('你好')).toBe(4)
    expect(countXChars('👍')).toBe(2)
    expect(countXChars('👨‍👩‍👧')).toBe(2)
    expect(countXChars('🇹🇭')).toBe(2)
    expect(countXChars('ok 👍🏽')).toBe(5)
  })

  it('normalises to NFC before counting (a combining accent is one character)', () => {
    expect(countXChars('e\u0301')).toBe(1)
  })

  it('reports amber in the last 20 characters and red past the limit', () => {
    expect(xCharStatus('a'.repeat(259)).level).toBe('ok')
    expect(xCharStatus('a'.repeat(260)).level).toBe('near')
    expect(xCharStatus('a'.repeat(280)).level).toBe('near')
    expect(xCharStatus('a'.repeat(281))).toEqual({ count: 281, limit: 280, remaining: -1, level: 'over' })
    expect(xCharStatus('a'.repeat(281), 4000).level).toBe('ok')
  })
})

describe('LinkedIn see-more fold', () => {
  it('shows a short post whole', () => {
    expect(linkedInFold('Short post.')).toMatchObject({ truncated: false, visible: 'Short post.', cutBy: null })
  })

  it('cuts a long paragraph near 210 characters on desktop and 140 on mobile, at a word boundary', () => {
    const text = 'word '.repeat(100).trim()
    const desktop = linkedInFold(text, 'desktop')
    expect(desktop.truncated).toBe(true)
    expect(desktop.cutBy).toBe('chars')
    expect(desktop.visibleChars).toBeLessThanOrEqual(210)
    expect(desktop.visibleChars).toBeGreaterThan(200)
    expect(desktop.visible.endsWith('word')).toBe(true)
    const mobile = linkedInFold(text, 'mobile')
    expect(mobile.visibleChars).toBeLessThanOrEqual(140)
    expect(mobile.visibleChars).toBeGreaterThan(130)
  })

  it('spends a whole line on every line break and blank line (three-line limit)', () => {
    const fold = linkedInFold('Big news.\n\nWe shipped.\nMore below.\nAnd more.')
    expect(fold).toMatchObject({ truncated: true, cutBy: 'lines', visible: 'Big news.\n\nWe shipped.' })
  })

  it('drops a blank third line from the preview (two-line preview)', () => {
    const fold = linkedInFold('Line one.\nLine two.\n\nLine four.')
    expect(fold.visible).toBe('Line one.\nLine two.')
    expect(fold.truncated).toBe(true)
  })

  it('does not fold when only blank lines follow the visible text', () => {
    expect(linkedInFold('One.\nTwo.\nThree.\n\n').truncated).toBe(false)
  })

  it('counts code points, so emoji do not split', () => {
    const fold = linkedInFold('🚀'.repeat(300))
    expect(fold.visibleChars).toBeLessThanOrEqual(210)
    expect(Array.from(fold.visible).every(char => char === '🚀')).toBe(true)
  })
})

describe('x-post / linkedin-post guard', () => {
  it('validates the documented examples with no errors', () => {
    expect(validateGenuiSpec(X_EXAMPLE)).toEqual({ ok: true, errors: [] })
    expect(validateGenuiSpec(LINKEDIN_EXAMPLE)).toEqual({ ok: true, errors: [] })
  })

  it('passes validate_dsh_ui without warnings', async () => {
    const tool = createValidateDshUiTool()
    for (const spec of [X_EXAMPLE, LINKEDIN_EXAMPLE]) {
      const verdict = String(await tool.execute({ spec: JSON.stringify(spec) }, {} as never))
      expect(verdict).toContain('status=valid')
      expect(verdict).not.toContain('warning=')
    }
  })

  it('reports unknown fields and missing requirements', async () => {
    const tool = createValidateDshUiTool()
    const verdict = String(await tool.execute({ spec: JSON.stringify({ items: [{ type: 'x-post', author: { name: 'a' }, posts: [{ text: 'hi', likes: 3 }] }] }) }, {} as never))
    expect(verdict).toContain('warning=unknown_field')
    expect(verdict).toContain('likes')
    expect(validateGenuiSpec({ items: [{ type: 'x-post', author: { name: 'a' } }] }).ok).toBe(false)
    expect(validateGenuiSpec({ items: [{ type: 'linkedin-post', author: { handle: 'x' }, text: 'hi' }] }).ok).toBe(false)
    expect(validateGenuiSpec({ items: [{ type: 'linkedin-post', author: { name: 'a' }, text: 'hi', device: 'tablet' }] }).ok).toBe(false)
    expect(validateGenuiSpec({ items: [{ type: 'linkedin-post', author: { name: 'a' }, text: 'hi', images: ['javascript:alert(1)'] }] }).ok).toBe(false)
  })

  it('repairs model-shaped input: aliases, string posts, unsafe images dropped, text kept verbatim', () => {
    const repaired = repairGenuiSpec({ items: [
      { type: 'x-post', user: { name: 'n', username: '@h', image: 'file:///etc/passwd' }, tweets: ['a\n\n b ', { content: 'c', images: ['javascript:x', '/api/file?path=%2Fa.png', 'https://e.com/1.png', 'https://e.com/2.png', 'https://e.com/3.png', 'https://e.com/4.png'] }] },
      { type: 'linkedin-post', author: { name: 'n' }, body: 'x\n\ny', device: 'phone' },
    ] })
    expect(repaired?.items[0]).toEqual({
      type: 'x-post', author: { name: 'n', handle: '@h' },
      posts: [{ text: 'a\n\n b ' }, { text: 'c', images: ['/api/file?path=%2Fa.png', 'https://e.com/1.png', 'https://e.com/2.png', 'https://e.com/3.png'] }],
    })
    expect(repaired?.items[1]).toEqual({ type: 'linkedin-post', author: { name: 'n' }, text: 'x\n\ny' })
  })

  it('exposes avatars and attached images to the HTML exporter', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'x-post', author: { name: 'n', avatar: '/a.png' }, posts: [{ text: 't', images: ['/b.png'] }] },
      { type: 'linkedin-post', author: { name: 'n' }, text: 't', images: ['/c.png'] },
    ] })!
    expect(collectGenuiMediaRefs(spec).map(ref => ref.src)).toEqual(['/a.png', '/b.png', '/c.png'])
  })

  it('projects to a readable native view', () => {
    const spec = repairGenuiSpec(X_EXAMPLE)!
    const result = compileDshGo(spec, 'fence', undefined, 'en')
    expect(result.issues).toEqual([])
    expect(JSON.stringify(result.view)).toContain('1/3 · ')
  })
})

describe('x-post / linkedin-post rendering', () => {
  it('renders a thread with a connecting line, verbatim text, and a red counter over 280', () => {
    const spec = { items: [{ type: 'x-post', author: { name: 'Ada Lovelace', handle: 'ada' }, posts: [{ text: 'first\n\nsecond paragraph' }, { text: 'x'.repeat(290) }] }] } as GenuiSpec
    const { container } = render(<GenuiBlock spec={spec} />)
    expect(screen.getByRole('article', { name: 'X thread preview, 2 posts' })).toBeTruthy()
    expect(container.querySelectorAll('[data-thread="continues"]')).toHaveLength(1)
    expect(screen.getAllByText('@ada')).toHaveLength(2)
    const texts = container.querySelectorAll('[data-genui-x-post] [dir="auto"]')
    expect(texts[0]?.textContent).toBe('first\n\nsecond paragraph')
    expect(screen.getByRole('status', { name: '10 characters over the 280 limit' }).getAttribute('data-level')).toBe('over')
    expect(screen.getByRole('status', { name: '23 / 280 characters' }).getAttribute('data-level')).toBe('ok')
  })

  it('falls back to an initials avatar when none is given', () => {
    const { container } = render(<GenuiBlock spec={{ items: [{ type: 'x-post', author: { name: 'Grace Hopper' }, posts: [{ text: 'hi' }] }] } as GenuiSpec} />)
    expect(container.querySelector('[data-genui-x-post] span[aria-hidden="true"]')?.textContent).toBe('GH')
  })

  it('folds a LinkedIn post at see more, expands locally, and switches device', () => {
    render(<GenuiBlock spec={LINKEDIN_EXAMPLE as GenuiSpec} />)
    const post = screen.getByRole('article', { name: 'LinkedIn post preview' })
    expect(post.textContent).not.toContain('combined.')
    expect(screen.getByText(/visible before “see more” on desktop/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '…see more' }))
    expect(post.textContent).toContain('combined.')
    fireEvent.click(screen.getByRole('button', { name: 'show less' }))
    expect(post.textContent).not.toContain('combined.')
    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }))
    expect(screen.getByText(/visible before “see more” on mobile/)).toBeTruthy()
  })
})
