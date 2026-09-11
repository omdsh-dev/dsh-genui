// SKILL.md examples are copy-paste material: a model will reuse them verbatim,
// so an example that cannot render teaches a broken shape (the fence silently
// degrades to a code block on the user's machine).
//
// The fence info string declares the intent, because documentation must also be
// allowed to show FRAGMENTS and ANTI-EXAMPLES:
//   ```json dsh-ui       -> must render (contract + repair + render gate)
//   ```json dsh-ui-bad   -> must be REJECTED (proves the documented "don't do
//                           this" really is rejected by the very guard)
//   ```json              -> free-form fragment, not asserted
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { processGenuiSpec, isRenderableProcess } from '../src/client/guard.ts'
import { validateRenderableChartSemantics } from '../src/plugin/chart-contract.ts'

const skill = readFileSync(join(process.cwd(), 'SKILL.md'), 'utf8')
const blocksOf = (tag: string): string[] =>
  [...skill.matchAll(new RegExp('```json ' + tag + '\\n([\\s\\S]*?)\\n```', 'g'))].map(m => m[1]!)
const renders = (raw: string): boolean => {
  const spec = JSON.parse(raw)
  return validateRenderableChartSemantics(spec).length === 0 && isRenderableProcess(processGenuiSpec(spec))
}

describe('SKILL.md examples', () => {
  const good = blocksOf('dsh-ui')
  const bad = blocksOf('dsh-ui-bad')

  it('ships copy-pasteable examples and at least one anti-example', () => {
    expect(good.length).toBeGreaterThanOrEqual(5)
    expect(bad.length).toBeGreaterThanOrEqual(1)
    // Without a no-component example a model learns "always emit something".
    expect(skill).toContain('正确地不套组件')
  })

  for (const [i, raw] of good.entries()) {
    it(`example ${i + 1} renders`, () => {
      expect(renders(raw)).toBe(true)
    })
  }

  for (const [i, raw] of bad.entries()) {
    it(`anti-example ${i + 1} is really rejected`, () => {
      // The doc claims this shape fails; if the guard ever accepts it, the
      // documentation is lying and this test says so.
      expect(renders(raw)).toBe(false)
    })
  }
})
