// Narrow-card grading layout (#62): .gradeItem used grid-template-columns
// auto auto 1fr, so a long question in an auto column crushed the 1fr answer
// column down to ~one CJK glyph per line ("vertical text"). jsdom cannot lay
// out, so — same as the table-scroll/reveal contracts — pin the exact rule at
// the source CSS level.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readRule = (name: string): string => {
  const css = readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')
  const match = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css)
  expect(match, `${name} rule must exist`).not.toBeNull()
  return match![1]!
}

describe('grading result layout contract', () => {
  it('gradeItem keeps the answer column shrinkable', () => {
    const rule = readRule('gradeItem')
    // The regression: an unshrinkable auto question column next to a bare 1fr.
    expect(rule).not.toContain('auto auto 1fr')
    expect(rule).toContain('minmax(0, 1fr)')
    expect(rule).toContain('display: grid')
  })

  it('question spans its own full row above tag|answer', () => {
    const rule = readRule('gradeQ')
    expect(rule).toContain('grid-column: 1 / -1')
    expect(rule).toContain('overflow-wrap: anywhere')
  })

  it('long text fields wrap instead of overflowing', () => {
    for (const name of ['gradeAns', 'gradeExp']) {
      expect(readRule(name)).toContain('overflow-wrap: anywhere')
    }
    // Explanation stays full-width below the tag|answer row.
    expect(readRule('gradeExp')).toContain('grid-column: 1 / -1')
  })
})
