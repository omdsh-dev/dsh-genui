// @vitest-environment jsdom
// Inline markup: emphasis INSIDE a sentence. Every token must become a React
// element — never HTML — and an unsafe link must degrade to its label.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderInline } from '../src/client/inline.ts'

afterEach(cleanup)

const html = (text: string): string => {
  const { container } = render(<div>{renderInline(text)}</div>)
  return container.innerHTML
}

describe('inline markup', () => {
  it('renders code, bold, mark and an https link as elements', () => {
    const out = html('跑 `npm run build`，**一定要**看 ==退出码==，见 [文档](https://example.com/a)')
    expect(out).toContain('<code')
    expect(out).toContain('<strong')
    expect(out).toContain('<mark')
    expect(out).toContain('href="https://example.com/a"')
    expect(out).toContain('rel="noreferrer noopener"')
    // The literal markers must be gone from the visible text.
    expect(out).not.toContain('`')
    expect(out).not.toContain('**')
    expect(out).not.toContain('==')
  })

  it('leaves an unterminated marker literal instead of throwing', () => {
    expect(html('这里有 **没闭合的加粗')).toContain('**没闭合的加粗')
    expect(html('只有一个反引号 ` 在里面')).toContain('`')
  })

  it('refuses a non-http(s) link and keeps only its label', () => {
    const out = html('[点我](javascript:alert(1))')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('<a')
    expect(out).toContain('点我')
  })

  it('never emits HTML from the source text', () => {
    const out = html('<img src=x onerror=alert(1)> 与 **加粗**')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  it('returns the plain string untouched when there is no markup', () => {
    // Identity: the fast path must not wrap plain prose in extra elements.
    const plain = '完全没有标记的一句话'
    expect(renderInline(plain)).toBe(plain)
    expect(html(plain)).toBe('<div>完全没有标记的一句话</div>')
  })
})
