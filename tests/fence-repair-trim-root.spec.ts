// `trimToBalancedRoot` is the "legal JSON + trailing junk" cutter used by content
// recognition (an unlabelled CodeBlock whose body the host does not label as
// dsh-ui). Real sample: the model leaked its tool-call template after the JSON
// and never closed the fence, so the whole thing arrived as one code block.
import { describe, expect, it } from 'vitest'
import { trimToBalancedRoot } from '../src/shared/fence-repair.ts'

const SPEC = '{"items":[{"type":"table","columns":["a"],"rows":[["1"]]}]}'

describe('trimToBalancedRoot', () => {
  it('cuts trailing junk after a complete root value', () => {
    expect(trimToBalancedRoot(`${SPEC}\n</x> and a sentence`)).toBe(SPEC)
    expect(trimToBalancedRoot(`${SPEC}   `)).toBe(SPEC)
  })

  it('ignores braces and brackets inside strings', () => {
    const body = '{"items":[{"type":"text","content":"a } b ] c \\" d"}]}'
    expect(trimToBalancedRoot(`${body} tail`)).toBe(body)
  })

  it('returns null when there is nothing to cut', () => {
    expect(trimToBalancedRoot(SPEC)).toBeNull()
  })

  it('returns null for an unterminated or mismatched root', () => {
    expect(trimToBalancedRoot('{"items":[{"type":"text"}')).toBeNull()
    expect(trimToBalancedRoot('{"items":[}]} tail')).toBeNull()
    expect(trimToBalancedRoot('普通文字')).toBeNull()
  })
})
