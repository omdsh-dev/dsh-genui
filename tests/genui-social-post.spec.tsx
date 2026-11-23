import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setLocale } from '../src/client/i18n/index.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'
import { collectGenuiMediaRefs } from '../src/client/artifact/media.ts'
import type { GenuiSpec } from '../src/client/spec.ts'
import { X_POST_LIMIT, X_URL_WEIGHT, countXChars, findXUrls, linkedInFold, xCharStatus, xDisplayUrl } from '../src/client/social-text.ts'
import { compileDshGo } from '../src/plugin/dsh-go-compiler.ts'
import { createValidateDshUiTool } from '../src/plugin/tool.ts'

beforeEach(() => { setLocale('en') })
afterEach(() => { cleanup(); setLocale('zh') })

export const X_EXAMPLE = {
  items: [{
    type: 'x-post',
    author: { name: 'Alex Example', handle: 'alex', verified: true },
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
    author: { name: 'Sam Sample', headline: 'Product designer' },
    device: 'desktop',
    timestamp: '1h',
    text: 'Most posts lose the reader before the fold.\n\nHere is what I changed in how I review drafts, and why the first three lines now get more attention than the rest of the post combined.',
  }],
}

/** 278 ASCII characters: the reviewer's draft before the keycap. */
const DRAFT_278 = 'a'.repeat(278)
const WIKI_URL = 'https://en.wikipedia.org/wiki/Foo_(bar)'

describe('X weighted character count (official twitter-text parser)', () => {
  it('uses the twitter-text v3 defaults: 280 limit, URLs weigh 23', () => {
    expect(X_POST_LIMIT).toBe(280)
    expect(X_URL_WEIGHT).toBe(23)
  })

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

  // Regression (PR review): the hand-rolled counter weighed `1️⃣` as 1 + 2 + 2
  // (digit, VS16, combining keycap) and reported 283 for this draft.
  it('fits 278 ASCII characters plus a keycap emoji at exactly 280, valid', () => {
    const status = xCharStatus(`${DRAFT_278}1️⃣`)
    expect(status).toEqual({ weightedLength: 280, limit: 280, remaining: 0, valid: true, empty: false, permillage: 1000, level: 'near' })
    expect(xCharStatus(`${DRAFT_278}1️⃣!`)).toMatchObject({ weightedLength: 281, remaining: -1, valid: false, level: 'over' })
  })

  it('counts every emoji sequence as two: keycaps, ZWJ families, skin tones, flags', () => {
    for (const emoji of ['1️⃣', '#️⃣', '*️⃣', '👨‍👩‍👧‍👦', '👩🏾‍💻', '👍🏽', '🇹🇭', '🏴‍☠️']) expect(countXChars(emoji), emoji).toBe(2)
    expect(countXChars('#️⃣*️⃣1️⃣')).toBe(6)
  })

  // Known limitation, pinned on purpose: twitter-text 3.1.0 ships twemoji-parser 11
  // (Unicode 12 era), so a newer ZWJ sequence splits into its parts. This is what
  // parseTweet reports; update it together with the parser.
  it('follows twitter-text 3.1.0 emoji data, so some newer emoji count more than two', () => {
    expect(countXChars('❤️‍🔥')).toBe(5)
    expect(countXChars('🧑‍🧑‍🧒')).toBe(8)
  })

  it('detects a URL with balanced parentheses as one URL weighing 23', () => {
    expect(findXUrls(`read ${WIKI_URL} now`)).toEqual([{ start: 5, end: 5 + WIKI_URL.length, url: WIKI_URL }])
    expect(countXChars(`read ${WIKI_URL} now`)).toBe(5 + 23 + 4)
  })

  it('does not swallow a closing parenthesis that sits outside the URL', () => {
    const text = '(see https://example.com/docs)'
    expect(findXUrls(text)).toEqual([{ start: 5, end: 29, url: 'https://example.com/docs' }])
    expect(countXChars(text)).toBe(5 + 23 + 1)
    expect(findXUrls(`(${WIKI_URL})`).map(url => url.url)).toEqual([WIKI_URL])
  })

  it('detects scheme-less domains like X does', () => {
    expect(findXUrls('docs at example.com/start.').map(url => url.url)).toEqual(['example.com/start'])
    expect(countXChars('docs at example.com/start.')).toBe(8 + 23 + 1)
  })

  it('reports valid and permillage the way parseTweet does', () => {
    // An empty draft is not valid for X, but it is not an error either: it stays neutral.
    expect(xCharStatus('')).toMatchObject({ weightedLength: 0, valid: false, empty: true, permillage: 0, level: 'ok' })
    expect(xCharStatus('a'.repeat(140))).toMatchObject({ valid: true, empty: false, permillage: 500 })
    // Within the limit but containing a character X rejects: surfaced as `invalid`.
    expect(xCharStatus('bad \uFFFE char')).toMatchObject({ weightedLength: 11, valid: false, empty: false, level: 'invalid' })
    expect(xCharStatus('\uFEFF')).toMatchObject({ valid: false, level: 'invalid' })
    expect(xCharStatus('a'.repeat(400), 4000)).toMatchObject({ weightedLength: 400, limit: 4000, valid: true, permillage: 100, level: 'ok' })
  })

  it('shortens links for display the way t.co does', () => {
    expect(xDisplayUrl('https://www.example.com/a')).toBe('example.com/a')
    expect(xDisplayUrl(WIKI_URL)).toBe('en.wikipedia.org/wiki/Foo_(ba…')
  })

  it('normalises to NFC before counting (a combining accent is one character)', () => {
    expect(countXChars('e\u0301')).toBe(1)
  })

  it('reports amber in the last 20 characters and red past the limit', () => {
    expect(xCharStatus('a'.repeat(259)).level).toBe('ok')
    expect(xCharStatus('a'.repeat(260)).level).toBe('near')
    expect(xCharStatus('a'.repeat(280)).level).toBe('near')
    expect(xCharStatus('a'.repeat(281))).toEqual({ weightedLength: 281, limit: 280, remaining: -1, valid: false, empty: false, permillage: 1003, level: 'over' })
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

  it('projects the same twitter-text count and the estimate wording natively', () => {
    const x = compileDshGo(repairGenuiSpec({ items: [{ type: 'x-post', author: { name: 'n' }, posts: [{ text: `${DRAFT_278}1️⃣` }] }] })!, 'fence', undefined, 'en')
    expect(JSON.stringify(x.view)).toContain('280/280')
    expect(JSON.stringify(x.view)).not.toContain('would reject')
    const bad = compileDshGo(repairGenuiSpec({ items: [{ type: 'x-post', author: { name: 'n' }, posts: [{ text: 'a'.repeat(281) }] }] })!, 'fence', undefined, 'en')
    expect(JSON.stringify(bad.view)).toContain('281/280 · X would reject this post')
    const li = compileDshGo(repairGenuiSpec(LINKEDIN_EXAMPLE)!, 'fence', undefined, 'en')
    expect(JSON.stringify(li.view)).toContain('(estimate; LinkedIn doesn\'t publish the cut-off)')
  })
})

describe('x-post / linkedin-post rendering', () => {
  it('renders a thread with a connecting line, verbatim text, and a red counter over 280', () => {
    const spec = { items: [{ type: 'x-post', author: { name: 'Alex Example', handle: 'alex' }, posts: [{ text: 'first\n\nsecond paragraph' }, { text: 'x'.repeat(290) }] }] } as GenuiSpec
    const { container } = render(<GenuiBlock spec={spec} />)
    expect(screen.getByRole('article', { name: 'X thread preview, 2 posts' })).toBeTruthy()
    expect(container.querySelectorAll('[data-thread="continues"]')).toHaveLength(1)
    expect(screen.getAllByText('@alex')).toHaveLength(2)
    const texts = container.querySelectorAll('[data-genui-x-post] [dir="auto"]')
    expect(texts[0]?.textContent).toBe('first\n\nsecond paragraph')
    expect(screen.getByRole('status', { name: '10 characters over the 280 limit' }).getAttribute('data-level')).toBe('over')
    expect(screen.getByRole('status', { name: '23 / 280 characters' }).getAttribute('data-level')).toBe('ok')
  })

  it('shows 280/280 (amber, not red) for the 278 + keycap draft', () => {
    render(<GenuiBlock spec={{ items: [{ type: 'x-post', author: { name: 'n' }, posts: [{ text: `${DRAFT_278}1️⃣` }] }] } as GenuiSpec} />)
    const counter = screen.getByRole('status', { name: '280 / 280 characters' })
    expect(counter.textContent).toBe('280/280')
    expect(counter.getAttribute('data-level')).toBe('near')
    expect(counter.getAttribute('data-valid')).toBe('true')
  })

  it('highlights a parenthesised URL in full and leaves an outer parenthesis as text', () => {
    const { container } = render(<GenuiBlock spec={{ items: [{ type: 'x-post', author: { name: 'n' }, posts: [{ text: `Read ${WIKI_URL} (or https://example.com/docs).` }] }] } as GenuiSpec} />)
    const links = Array.from(container.querySelectorAll('[data-genui-x-post] [data-url]'))
    expect(links.map(link => link.getAttribute('data-url'))).toEqual([WIKI_URL, 'https://example.com/docs'])
    expect(links.map(link => link.getAttribute('title'))).toEqual([WIKI_URL, 'https://example.com/docs'])
    expect(links.map(link => link.textContent)).toEqual(['en.wikipedia.org/wiki/Foo_(ba…', 'example.com/docs'])
    expect(container.querySelector('[data-genui-x-post] [dir="auto"]')?.textContent).toBe('Read en.wikipedia.org/wiki/Foo_(ba… (or example.com/docs).')
    expect(screen.getByRole('status', { name: `${5 + 23 + 5 + 23 + 2} / 280 characters` })).toBeTruthy()
  })

  it('marks a post X would reject in red with a spoken reason, counts it in the thread footer, and keeps an empty draft neutral', () => {
    render(<GenuiBlock spec={{ items: [{ type: 'x-post', author: { name: 'n' }, posts: [{ text: 'bad \uFFFE char' }, { text: '' }, { text: 'fine' }] }] } as GenuiSpec} />)
    const invalid = screen.getByRole('status', { name: '11 / 280 characters: X would reject this post (it contains characters X does not allow)' })
    expect(invalid.getAttribute('data-level')).toBe('invalid')
    expect(invalid.getAttribute('title')).toContain('X would reject this post')
    expect(invalid.textContent).toBe('11/280')
    const empty = screen.getByRole('status', { name: 'Empty post: 0 / 280 characters' })
    expect(empty.getAttribute('data-level')).toBe('ok')
    expect(empty.textContent).toBe('0/280')
    expect(screen.getByText('3 posts · X would reject 1')).toBeTruthy()
  })

  it('uses the singular for one character over', () => {
    render(<GenuiBlock spec={{ items: [{ type: 'x-post', author: { name: 'n' }, posts: [{ text: 'x'.repeat(281) }, { text: 'x'.repeat(282) }] }] } as GenuiSpec} />)
    expect(screen.getByRole('status', { name: '1 character over the 280 limit' }).textContent).toBe('-1')
    expect(screen.getByRole('status', { name: '2 characters over the 280 limit' }).textContent).toBe('-2')
    expect(screen.getByText('2 posts · X would reject 2')).toBeTruthy()
  })

  it('falls back to an initials avatar when none is given', () => {
    const { container } = render(<GenuiBlock spec={{ items: [{ type: 'x-post', author: { name: 'Sam Sample' }, posts: [{ text: 'hi' }] }] } as GenuiSpec} />)
    expect(container.querySelector('[data-genui-x-post] span[aria-hidden="true"]')?.textContent).toBe('SS')
  })

  it('folds a LinkedIn post at see more, expands locally, and switches device', () => {
    render(<GenuiBlock spec={LINKEDIN_EXAMPLE as GenuiSpec} />)
    const post = screen.getByRole('article', { name: 'LinkedIn post preview' })
    expect(post.textContent).not.toContain('combined.')
    const note = screen.getByText(/visible before “see more” on desktop/)
    expect(note.textContent).toMatch(/^≈ First \d+ of 180 characters visible before “see more” on desktop \(estimate; LinkedIn doesn’t publish the cut-off\. Modeled on about 210 characters or 3 lines: cut by /)
    expect(note.textContent?.match(/estimate/g)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '…see more' }))
    expect(post.textContent).toContain('combined.')
    fireEvent.click(screen.getByRole('button', { name: 'show less' }))
    expect(post.textContent).not.toContain('combined.')
    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }))
    expect(screen.getByText(/visible before “see more” on mobile/).textContent).toContain('(estimate; LinkedIn doesn’t publish the cut-off.')
  })

  it('labels a post that fits as an estimate too, in both locales', () => {
    render(<GenuiBlock spec={{ items: [{ type: 'linkedin-post', author: { name: 'n' }, text: 'Short post.' }] } as GenuiSpec} />)
    expect(screen.getByText(/^≈ Whole post visible on desktop/).textContent).toContain('estimate, LinkedIn doesn’t publish the cut-off')
    cleanup()
    setLocale('zh')
    render(<GenuiBlock spec={LINKEDIN_EXAMPLE as GenuiSpec} />)
    expect(screen.getByText(/^≈ 在桌面信息流中/).textContent).toContain('估算；LinkedIn 未公布折叠位置')
  })
})
