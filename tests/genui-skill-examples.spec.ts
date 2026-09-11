// Every JSON example in SKILL.md must survive the REAL fence pipeline
// (parse -> chart contract -> repair -> render gate). An example that cannot
// render teaches the wrong shape: the model copies it and the fence silently
// degrades to a code block.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { processGenuiSpec, isRenderableProcess } from '../src/client/guard.ts'
import { validateRenderableChartSemantics } from '../src/plugin/chart-contract.ts'

const skill = readFileSync(join(process.cwd(), 'SKILL.md'), 'utf8')
const blocks = [...skill.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m => m[1]!)

describe('SKILL.md examples', () => {
  it('ships five renderable examples plus a no-component counter-example', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(5)
    // The prose example matters as much: without it a model learns "always
    // emit something", which is how short answers get wrapped in boxes.
    expect(skill).toContain('正确地不套组件')
  })

  for (const [i, raw] of blocks.entries()) {
    it(`example ${i + 1} renders`, () => {
      const spec = JSON.parse(raw)
      expect(validateRenderableChartSemantics(spec)).toEqual([])
      expect(isRenderableProcess(processGenuiSpec(spec))).toBe(true)
    })
  }
})
