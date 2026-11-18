// Guards the one fence example every request carries.
//
// Issue #344 was caused by this example: it contained "[...]" and
// "<user-language text>", so the model's only authoritative sample taught it to
// emit JSON that cannot parse. The sample now also has to carry its weight as
// teaching material — a single placeholder text node demonstrated nothing about
// the components the section warns about (one component per items entry, and
// table's column/row field names).
import { describe, expect, it } from 'vitest'
import { GENUI_SECTION_TEXT } from '../src/plugin/index.ts'

const FENCE_OPEN = /^\u0060{3}dsh-ui$/
const FENCE_CLOSE = /^\u0060{3}$/

/** The example body between its opening and closing fence lines. */
function exampleBody(text: string): string {
  const lines = text.split('\n')
  const open = lines.findIndex(line => FENCE_OPEN.test(line))
  if (open < 0) throw new Error('system-prompt section has no dsh-ui example')
  const close = lines.findIndex((line, index) => index > open && FENCE_CLOSE.test(line))
  if (close < 0) throw new Error('system-prompt example fence is not closed')
  return lines.slice(open + 1, close).join('\n')
}

describe('system-prompt fence example', () => {
  it('is valid JSON with no placeholder tokens', () => {
    const body = exampleBody(GENUI_SECTION_TEXT)
    expect(() => JSON.parse(body)).not.toThrow()
    expect(body).not.toMatch(/<[^>]+>|\.\.\./)
  })

  it('shows more than one component and the field names the section warns about', () => {
    const spec = JSON.parse(exampleBody(GENUI_SECTION_TEXT)) as { items: Array<{ type: string }> }
    expect(spec.items.length).toBeGreaterThan(1)
    expect(spec.items.map(node => node.type)).toContain('table')
  })

  it('stays inside the per-request character budget', () => {
    expect(GENUI_SECTION_TEXT.length).toBeLessThanOrEqual(3400)
  })
})
