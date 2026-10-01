// @vitest-environment jsdom
// Inline markup: emphasis INSIDE a sentence. Every token must become a React
// element — never HTML — and an unsafe link must degrade to its label.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderInline } from '../src/client/inline.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'

afterEach(cleanup)

const html = (text: string): string => {
  const { container } = render(<div>{renderInline(text)}</div>)
  return container.innerHTML
}

describe('inline markup', () => {
  it.each([
    String.raw`\(\frac{a}{b}\)`,
    String.raw`\[\begin{pmatrix}a & b \\ c & d\end{pmatrix}\]`,
    String.raw`$$\begin{cases}x^2 & x>0 \\ -x & x\le 0\end{cases}$$`,
    String.raw`\[\begin{aligned}a&=b+c\\&=d\end{aligned}\]`,
    String.raw`**$a*b$**`,
    String.raw`==\(x^2\)==`,
  ])('renders a complete formula: %s', source => {
    const out = html(source)
    expect(out).toContain('class="katex"')
    expect(out).not.toContain('katex-error')
    expect(out).toContain('<math')
    expect(out).not.toContain('<div class=')
  })

  it('keeps a multiline display formula inside emphasis', () => {
    const { container } = render(<span>{renderInline('**$$x +\ny$$**')}</span>)
    expect(container.querySelector('strong .katex-display')).not.toBeNull()
    expect(container.textContent).not.toContain('**')
  })

  it('keeps a real newline as a newline character (not a <br>)', () => {
    // `<br>` paints a break but contributes NOTHING to `textContent`, so a
    // user selecting and copying a multi-line cell used to get one run-on
    // line — a `python - <<'PY' … PY` heredoc lost its structure and could not
    // be pasted back into a shell. The newline must survive in the DOM; the
    // owning container turns it into a visible break via pre-line/pre-wrap.
    const out = html('第一行\n第二行')
    expect(out).not.toContain('<br')
    expect(out).toContain('第一行\n第二行')
    const { container } = render(<div>{renderInline('第一行\n第二行')}</div>)
    expect(container.textContent).toBe('第一行\n第二行')
  })

  it('normalizes CRLF to one newline and mixes with emphasis', () => {
    const out = html('**重点**\r\n说明')
    expect(out).toContain('<strong')
    expect(out).not.toContain('<br')
    const { container } = render(<div>{renderInline('**重点**\r\n说明')}</div>)
    expect(container.textContent).toBe('重点\n说明')
  })

  it('keeps the newline inside emphasis content too', () => {
    const out = html('**第一行\n第二行**')
    expect(out).toContain('<strong')
    expect(out).not.toContain('<br')
    expect(out).toContain('第一行\n第二行')
  })

  it('keeps a newline out of code spans (code stays single-line)', () => {
    const out = html('`a\nb`')
    // The newline ENDS the code-span attempt (no closing backtick before it);
    // it stays a newline and the backticks remain literal.
    expect(out).not.toContain('<code')
    expect(out).not.toContain('<br')
    expect(out).toContain('`a\nb`')
  })

  it('keeps fenced backticks literal instead of parsing an inner code span', () => {
    const out = html('因为：```score = 1```于是')
    expect(out).not.toContain('<code')
    expect(out).toContain('```score = 1```')
  })

  it('keeps complete fenced content opaque while parsing surrounding inline text', () => {
    const out = html('**前文** ```js\nconst name = `foo`\n**原文**\n``` **后文**')
    expect(out).not.toContain('<code')
    expect(out).toContain('const name = `foo`')
    expect(out).toContain('**原文**')
    expect(out.match(/<strong/g)).toHaveLength(2)
    expect(out).not.toContain('<br')

    const tilde = html('~~~js\nconst name = `foo`\n~~~')
    expect(tilde).not.toContain('<code')
    expect(tilde).toContain('`foo`')
  })

  it('keeps content after an unclosed fence marker literal', () => {
    const out = html('**前文** ```js\nconst name = `foo`\n**原文**')
    expect(out).not.toContain('<code')
    expect(out).toContain('const name = `foo`')
    expect(out).toContain('**原文**')
    expect(out.match(/<strong/g)).toHaveLength(1)
    expect(out).not.toContain('<br')
  })

  it.each(['``foo``', '```foo```', '````foo````'])('keeps consecutive backticks literal: %s', source => {
    const out = html(source)
    expect(out).not.toContain('<code')
    expect(out).toContain(source)
  })

  it('still renders a single-backtick code span', () => {
    const out = html('运行 `pnpm test`')
    expect(out).toContain('<code')
    expect(out).toContain('pnpm test')
  })

  it('keeps the reported callout content as literal inline text', () => {
    const { container } = render(<GenuiBlock spec={{ items: [
      { type: 'callout', tone: 'error', title: '围栏', content: '因为：```score = 1 - 0.05 × level ```于是照建不误' },
      { type: 'callout', tone: 'info', title: '表格', content: '| 配置 | 级数 |\n|---|---|\n| 破例版 | 887 |' },
    ] }} />)
    expect(container.querySelector('code')).toBeNull()
    expect(container.textContent).toContain('```score = 1 - 0.05 × level ```')
    expect(container.textContent).toContain('|---|---|')
    expect(container.querySelector('table')).toBeNull()
    // Both fields carry one real newline each — still newlines, not <br>.
    expect(container.querySelectorAll('br')).toHaveLength(0)
    expect(container.textContent).toContain('| 配置 | 级数 |\n|---|---|\n| 破例版 | 887 |')
  })

  it('expresses a line break inside a callout through the block path (#177)', () => {
    // #177 gave a string field a way to express a break; the mechanism is now
    // a real newline painted by `pre-line`, so the break also survives
    // selection/copy (a `<br>` did not).
    const { container } = render(<GenuiBlock spec={{
      title: '换行',
      items: [
        { type: 'callout', tone: 'info', title: '两段', content: '第一行\n第二行' },
        { type: 'text', content: '甲\n乙' },
      ],
    }} />)
    expect(container.querySelectorAll('br')).toHaveLength(0)
    expect(container.textContent).toContain('第一行\n第二行')
    expect(container.textContent).toContain('甲\n乙')
    const css = readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')
    expect(css).toMatch(/\.calloutBody,[\s\S]*?white-space:\s*pre-line/)
  })

  it('paints real newlines in text and control labels (#249)', () => {
    const { container } = render(<GenuiBlock spec={{ items: [
      { type: 'text', content: '甲\n乙' },
      { type: 'badge', label: '待办\n事项' },
      { type: 'button', label: '继续\n操作' },
      { type: 'checkbox', label: '选择\n项目' },
      { type: 'radio', label: '选项\n列表', options: ['第一\n项'] },
      { type: 'tabs', tabs: [{ label: '概要\n信息', items: [] }] },
      { type: 'submit', label: '提交\n答案' },
    ] }} />)
    expect(container.querySelectorAll('br')).toHaveLength(0)
    for (const value of ['甲\n乙', '待办\n事项', '继续\n操作', '选择\n项目', '选项\n列表', '第一\n项', '概要\n信息', '提交\n答案']) {
      expect(container.textContent).toContain(value)
    }
    const css = readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')
    expect(css).toMatch(/\.text\s*\{[^}]*white-space:\s*pre-line/)
    expect(css).toMatch(/\.button,\s*\.badge,\s*\.checkbox,\s*\.radio,\s*\.tab,[^}]*white-space:\s*pre-line/)
  })

  it('updates a formula without leaving stale math or damaging surrounding text', () => {
    const { container, rerender } = render(<span>{renderInline(String.raw`**\(x\)** tail`)}</span>)
    expect(container.querySelector('strong .katex')).not.toBeNull()
    rerender(<span>{renderInline(String.raw`**\(y+1\)** updated`)}</span>)
    expect(container.querySelector('annotation')?.textContent).toBe('y+1')
    expect(container.textContent).toContain('updated')
  })

  it('renders formula labels without nesting interactive links', () => {
    const { container } = render(<button>{renderInline('[$x$](https://example.com)', false)}</button>)
    expect(container.querySelector('button .katex')).not.toBeNull()
    expect(container.querySelector('a')).toBeNull()
  })

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

  it('renders inline and display math while preserving code and unsafe-source boundaries', () => {
    const { container } = render(<div>{renderInline('Energy $E=mc^2$; $$\\frac{a}{b}$$; `$x$`; <img src=x onerror=alert(1)>')}</div>)
    expect(container.querySelectorAll('.katex')).toHaveLength(2)
    expect(container.querySelector('.katex-display')).not.toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('$x$')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.katex-error')).toBeNull()
  })

  it('keeps escaped delimiters literal and refuses unsafe math links', () => {
    expect(html(String.raw`Escaped \$x\$`)).not.toContain('katex')
    const out = html(String.raw`$\href{javascript:alert(1)}{x}$`)
    expect(out).not.toContain('href="javascript:')
    expect(out).not.toContain('<script')
  })

  it('unescapes $ and backslash tokens to their literal characters', () => {
    const out = html(String.raw`总价 \$100，路径 C:\\dir，另一个 \$x\$`)
    expect(out).toContain('$100')
    expect(out).toContain('C:\\dir')
    expect(out).toContain('$x$')
    expect(out).not.toContain('\\$')
    expect(out).not.toContain('\\\\')
    expect(out).not.toContain('katex')
  })

  it('leaves currency and incomplete math literal', () => {
    expect(html('Price $5 and $10')).not.toContain('katex')
    expect(html('Unfinished $x + 1')).toContain('$x + 1')
  })

  it('returns the plain string untouched when there is no markup', () => {
    // Identity: the fast path must not wrap plain prose in extra elements.
    const plain = '完全没有标记的一句话'
    expect(renderInline(plain)).toBe(plain)
    expect(html(plain)).toBe('<div>完全没有标记的一句话</div>')
  })
})
