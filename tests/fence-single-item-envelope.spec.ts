// Regression: the envelope's `items` takes a LIST, but a body that names one
// component at the root is already accepted — `{"type":"callout",…}` wraps into a
// one-item spec. The same intent written one level down, as
// `{"items":{"type":"callout",…}}`, was rejected outright, so two spellings of the
// same thing disagreed: the bare form rendered, the envelope form degraded to a
// code block with the red "JSON 解析失败" banner.
//
// Observed in a live session (2026-10-20): the model wrote the envelope form three
// times in one reply, so the reader saw three banners for bodies that were one
// array away from correct.
import { describe, expect, it } from 'vitest'
import { parsePartialGenuiSpec } from '../src/client/parse-partial.ts'
import { resolveFence } from '../src/shared/fence-resolve.ts'
import { adoptSingleItemEnvelope } from '../src/client/spec.ts'

describe('envelope with one component where the list belongs', () => {
  it('adopts the single component instead of rejecting the body', () => {
    const spec = parsePartialGenuiSpec('{"title":"t","items":{"type":"callout","content":"hi"}}')
    expect(spec).not.toBeNull()
    expect(spec!.items).toHaveLength(1)
    expect(spec!.title).toBe('t')
    expect((spec!.items[0] as { type?: string }).type).toBe('callout')
  })

  it('keeps the component fields untouched, including nested lists', () => {
    const raw = '{"items":{"type":"table","columns":["a","b"],"rows":[["1","2"]]}}'
    const spec = adoptSingleItemEnvelope(JSON.parse(raw))
    expect(spec).not.toBeNull()
    const node = spec!.items[0] as { type?: string; columns?: unknown[]; rows?: unknown[] }
    expect(node.type).toBe('table')
    expect(node.columns).toEqual(['a', 'b'])
    expect(node.rows).toEqual([['1', '2']])
  })

  it('renders through the fence resolver, so no banner is shown', () => {
    const raw = '{"title":"t","gap":12,"items":{"type":"keyvalue","pairs":[{"key":"k","value":"v"}]}}'
    // settled=false is the streaming path; adoption must not depend on the tier-2
    // completion pass, because this body is already complete.
    expect(resolveFence(raw, { settled: false }).spec).not.toBeNull()
    expect(resolveFence(raw, { settled: true }).spec).not.toBeNull()
  })

  it('leaves the standard list form alone', () => {
    const spec = parsePartialGenuiSpec('{"items":[{"type":"callout","content":"hi"}]}')
    expect(spec!.items).toHaveLength(1)
    // Idempotent: an already-correct envelope is never re-wrapped.
    expect(adoptSingleItemEnvelope({ items: [{ type: 'callout' }] })).toBeNull()
  })

  it('leaves a bare component root to its own wrapper', () => {
    // A component root carries its own `items` vocabulary (steps/list/timeline
    // records), so the envelope repair must not intercept it.
    expect(adoptSingleItemEnvelope({ type: 'steps', items: [{ title: 'a', desc: 'b' }] })).toBeNull()
    expect(parsePartialGenuiSpec('{"type":"steps","items":[{"title":"a","desc":"b"}]}')).not.toBeNull()
  })

  it('rejects an items object that is not component-shaped', () => {
    // No `type`, or a non-string one, names no component: there is nothing to
    // adopt, and guessing a node would invent content the model never wrote.
    expect(adoptSingleItemEnvelope({ items: { foo: 1 } })).toBeNull()
    expect(adoptSingleItemEnvelope({ items: { type: 123 } })).toBeNull()
    expect(adoptSingleItemEnvelope({ items: { type: '' } })).toBeNull()
    expect(parsePartialGenuiSpec('{"items":{"foo":1}}')).toBeNull()
  })

  it('rejects a non-object items value', () => {
    expect(adoptSingleItemEnvelope({ items: 'hello' })).toBeNull()
    expect(adoptSingleItemEnvelope({ items: 42 })).toBeNull()
    expect(adoptSingleItemEnvelope({ items: null })).toBeNull()
  })
})
