// Regression for "key written as a one-element array" fence bodies (tier-3).
//
// Real session sample (2026-10-27, 拒绝统计): the model wrote a table member as
// an ARRAY ELEMENT and wrapped a key in brackets.
//
// Both spellings are bracket-BALANCED and quote-clean, so tier-1 (quotes /
// trailing commas) and tier-2 (missing closers) cannot see anything wrong:
// the whole fence stayed a raw code block with a red diagnostic. This test
// pins the key-unwrap rewrite that recovers the first spelling, and pins that
// the second one — a real structural defect, not a key typo — is still NOT
// guessed at.
import { describe, expect, it } from 'vitest'
import { completeFenceJson, repairFenceJson } from '../src/shared/fence-repair.ts'
import { processGenuiSpec, partialRepairGenuiSpec } from '../src/client/guard.ts'
import { parsePartialGenuiSpec } from '../src/client/parse-partial.ts'

/** A key written as a wrapped string, with its colon intact. */
const WRAPPED_KEY = '{"items":[{"type":"table",["columns"]:["a","b"],"rows":[["1","2"],["3","4"]]}]}'

/** The exact body captured from the session. It carries THREE independent
 *  defects, not one: a valueless `["rows"]` member (no colon), an early `]`
 *  that closes the item object right after it, and a mis-nested last row
 *  (`[["**17:35"…`). Refusal is the contract for a body this broken. */
const SESSION_BODY =
  '{"gap":10,"items":[{"columns":["阶段","拒绝数","说明"],["rows"]],[["17:22","19","—"],[["**17:35","41","+22"]],"type":"table"}],"title":"拒绝"}'

describe('wrapped member key (tier-3)', () => {
  it('is bracket-balanced and quote-clean — the reason the other tiers fail', () => {
    const count = (ch: string): number => WRAPPED_KEY.split(ch).length - 1
    expect(count('{')).toBe(count('}'))
    expect(count('[')).toBe(count(']'))
    expect(() => JSON.parse(WRAPPED_KEY)).toThrow()
    expect(repairFenceJson(WRAPPED_KEY)).toBeNull()
  })

  it('unwraps the key and yields the intended member', () => {
    const completed = completeFenceJson(WRAPPED_KEY)
    expect(completed).not.toBeNull()
    expect(JSON.parse(completed!.text)).toEqual({
      items: [{ type: 'table', columns: ['a', 'b'], rows: [['1', '2'], ['3', '4']] }],
    })
    expect(completed!.repairs).toBe(1)
  })

  it('renders through the shared pipeline instead of degrading to a code block', () => {
    const completed = completeFenceJson(WRAPPED_KEY)!
    const spec = partialRepairGenuiSpec(processGenuiSpec(parsePartialGenuiSpec(completed.text)!))
    expect(spec).not.toBeNull()
  })

  it('unwraps several wrapped keys in one body', () => {
    const raw = '{"items":[{"type":"table",["columns"]:["a"],["rows"]:[["1"]]}]}'
    const completed = completeFenceJson(raw)
    expect(completed).not.toBeNull()
    expect(JSON.parse(completed!.text)).toEqual({
      items: [{ type: 'table', columns: ['a'], rows: [['1']] }],
    })
    expect(completed!.repairs).toBe(2)
  })

  it('does not unwrap an array value while tier-2 completes the body', () => {
    // TRUNCATED on purpose: a LEGAL body exits before any repair tier runs, so
    // the first version of this test never reached the rewrite at all.
    const raw = '{"items":[["a"],["b"]],"t":"x"'
    const completed = completeFenceJson(raw)
    expect(completed).not.toBeNull()
    expect(JSON.parse(completed!.text)).toEqual({ items: [['a'], ['b']], t: 'x' })
  })

  it('does not touch a wrapped string that is an ARRAY element', () => {
    // A balance defect forces the shape pass to run; `["b"]:2` sits inside an
    // array, so it is an element, not a key, and must be left alone.
    expect(completeFenceJson('{"a":[1,["b"]:2}')).toBeNull()
  })

  it('does not guess when the wrapped key has no colon (a second defect)', () => {
    const completed = completeFenceJson(SESSION_BODY)
    expect(completed).toBeNull()
  })

  it('unwraps the key BEFORE the Tetris rewrite (the order is load-bearing)', () => {
    // THE conflict shape: a wrapped `["rows"]:` key whose VALUE is the matrix,
    // right after `columns` — both rewrites can claim it. Unwrapping first
    // yields `"rows":[["1"]]` (parses); Tetris first splices the pair into
    // `"rows": ["rows"]:[["1"]]]`, which cannot parse and loses the repair.
    // Verified by differential: FORWARD heals, SWAPPED returns null.
    const raw = '{"columns":["a"],["rows"]:[["1"]]}'
    const completed = completeFenceJson(raw)
    expect(completed).not.toBeNull()
    expect(JSON.parse(completed!.text)).toEqual({ columns: ['a'], rows: [['1']] })
    expect(completed!.repairs).toBe(1)
  })

  it('does not guess when the ONLY defect is the missing colon', () => {
    // The colon guard is observable on THIS body: without it, `["b"]` is
    // unwrapped into garbage the whole-body parse would then ADOPT (verified by
    // deleting the guard — this test goes red). The plain `{"a":1,["b"]}`
    // case is refused by a later tier regardless, so it is kept only as a
    // contract assertion, not as the guard's witness.
    expect(completeFenceJson('{"a":1,["b"]{"c":2}')).toBeNull()
    expect(completeFenceJson('{"a":1,["b"]}')).toBeNull()
  })

  it('unwraps inside a root array and three levels deep', () => {
    expect(JSON.parse(completeFenceJson('[{"a":1,["b"]:2}]')!.text)).toEqual([{ a: 1, b: 2 }])
    expect(JSON.parse(completeFenceJson('{"a":{"b":{"c":1,["d"]:2}}}')!.text)).toEqual({ a: { b: { c: 1, d: 2 } } })
  })

  it('counts every edit when shapes mix', () => {
    // one unwrap + one trailing comma
    expect(completeFenceJson('{["a"]:1,}')!.repairs).toBe(2)
  })

  it('heals a wrapped key AND a missing closer in one pass', () => {
    const raw = '{"items":[{"type":"table",["columns"]:["a"],"rows":[["1"]}'
    const completed = completeFenceJson(raw)
    expect(completed).not.toBeNull()
    expect(JSON.parse(completed!.text)).toEqual({
      items: [{ type: 'table', columns: ['a'], rows: [['1']] }],
    })
  })
})
