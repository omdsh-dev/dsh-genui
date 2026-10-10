// @vitest-environment jsdom
// Regression: a table cell carrying a pasted code block lost its line breaks
// AND its leading indentation. `.table td` sets `white-space: nowrap` (the
// table's data voice), which collapses runs of spaces; worse, the inline
// renderer used to turn every `\n` into a `<br>`, and a `<br>` contributes
// NOTHING to `textContent` or `Selection.toString()` — so selecting a cell and
// copying it produced ONE run-on line. A `python - <<'PY' … PY` heredoc lost
// its structure and could not be pasted back into a shell (the user had to
// reassemble it by hand).
//
// The contract pinned here:
//   1. newlines stay real newline characters in the DOM (so they survive
//      selection/copy);
//   2. a code-shaped cell gets `pre-wrap` (indentation preserved), a prose
//      cell gets `pre-line` (breaks painted, spaces collapsed), a single-line
//      cell keeps `nowrap`;
//   3. the stylesheet still declares both, so a future edit cannot silently
//      re-collapse the indentation.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'

afterEach(cleanup)

/** A cell exactly as the model writes one: a heredoc script with indentation. */
const CODE_CELL = "python - <<'PY'\nimport json\nd = json.load(open('g1.json'))\n    print(d.get('eligible'))\nPY"
/** A prose cell that happens to carry a hard line break. */
const PROSE_CELL = '第一行\n第二行'

/** What a user gets when they select the cell and hit copy. */
function selectionTextOf(node: Element): string {
  const range = document.createRange()
  range.selectNodeContents(node)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return selection.toString()
}

function renderCell(cell: string) {
  const { container } = render(<GenuiBlock spec={{
    items: [{ type: 'table', columns: ['步骤', '命令'], rows: [['跑脚本', cell]] }],
  }} />)
  return container
}

describe('multi-line table cells keep their line structure and indentation', () => {
  it('copies a heredoc cell back as the multi-line snippet the model wrote', () => {
    const container = renderCell(CODE_CELL)
    const td = container.querySelector('td:nth-child(2)')!
    // The selection (and textContent) carries real newlines, not `<br>` holes.
    expect(selectionTextOf(td)).toBe(CODE_CELL)
    expect(td.textContent).toBe(CODE_CELL)
    expect(container.querySelectorAll('td br')).toHaveLength(0)
    // Indentation survives the copy path too.
    expect(selectionTextOf(td)).toContain('\n    print(')
  })

  it('marks a code-shaped cell pre-wrap and a prose cell pre-line', () => {
    const code = renderCell(CODE_CELL).querySelector('td:nth-child(2)')!
    expect(code.className).toContain('tdCode')

    const prose = renderCell(PROSE_CELL).querySelector('td:nth-child(2)')!
    expect(prose.className).toContain('tdMultiline')
    expect(prose.className).not.toContain('tdCode')
    expect(selectionTextOf(prose)).toBe(PROSE_CELL)
  })

  it('normalizes CRLF in prose and indented code without losing copy structure', () => {
    for (const cell of [PROSE_CELL, CODE_CELL]) {
      const td = renderCell(cell.replaceAll('\n', '\r\n')).querySelector('td:nth-child(2)')!
      expect(td.textContent).toBe(cell)
      expect(selectionTextOf(td)).toBe(cell)
      expect(td.querySelector('br')).toBeNull()
      expect(td.className).toContain(cell === CODE_CELL ? 'tdCode' : 'tdMultiline')
    }
  })

  it('leaves a single-line cell on the nowrap data voice', () => {
    const td = renderCell('ls -la').querySelector('td:nth-child(2)')!
    expect(td.className).not.toContain('tdCode')
    expect(td.className).not.toContain('tdMultiline')
  })

  it('preserves repeated spaces in inline code inside a single-line table cell', () => {
    const td = renderCell('`hello    world`').querySelector('td:nth-child(2)')!
    expect(td.querySelector('code')?.textContent).toBe('hello    world')
    expect(td.className).not.toContain('tdCode')
    expect(td.className).not.toContain('tdMultiline')
  })

  it('keeps inline code in multi-line cells under the existing cell whitespace rule', () => {
    const td = renderCell('before `hello    world`\n    after').querySelector('td:nth-child(2)')!
    expect(td.className).toContain('tdCode')
    expect(td.querySelector('code')?.textContent).toBe('hello    world')
  })

  it('marks a multi-line header too', () => {
    const { container } = render(<GenuiBlock spec={{
      items: [{ type: 'table', columns: ['A\n    B', 'C'], rows: [['1', '2']] }],
    }} />)
    expect(container.querySelectorAll('th[class*="tdCode"]')).toHaveLength(1)
  })

  it('pins the stylesheet contract for both markers and the prose surfaces', () => {
    // jsdom does not compute CSS-module styles, so the contract is asserted on
    // the stylesheet source.
    const css = readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')
    expect(css).toMatch(/\.table th\.tdCode,\s*\.table td\.tdCode\s*\{[^}]*white-space:\s*pre-wrap/)
    expect(css).toMatch(/\.table th\.tdMultiline,\s*\.table td\.tdMultiline\s*\{[^}]*white-space:\s*pre-line/)
    expect(css).toMatch(/\.table td\s*\{[^}]*white-space:\s*nowrap/)
    expect(css).toMatch(/\.table > thead > tr > th:not\(\.tdCode\):not\(\.tdMultiline\) \.inlineCode,[\s\S]*?\.table > tbody > tr:not\(\.detailRow\) > td:not\(\.tdCode\):not\(\.tdMultiline\) \.inlineCode,[\s\S]*?\.table > tfoot > tr > td:not\(\.tdCode\):not\(\.tdMultiline\) \.inlineCode\s*\{[^}]*white-space:\s*pre/)
    // Prose containers that may now carry a real newline must paint it.
    expect(css).toMatch(/\.calloutBody,[\s\S]*?\.kvValue[\s\S]*?\{[^}]*white-space:\s*pre-line/)
  })
})
