import { describe, expect, it } from 'vitest'
import { COMPONENT_SCHEMAS } from '../src/client/genui-runtime/schema.ts'
import { inferSkeleton } from '../src/client/streaming-shape.ts'

/** The placeholder should look like the component that is arriving. */
describe('inferSkeleton', () => {
  it('maps the first component type to a matching shape', () => {
    expect(inferSkeleton('{"items":[{"type":"table","columns":["a"]').shape).toBe('table')
    expect(inferSkeleton('{"items":[{"type":"chart","kind":"bars"').shape).toBe('chart')
    expect(inferSkeleton('{"items":[{"type":"list","items":[').shape).toBe('list')
    expect(inferSkeleton('{"items":[{"type":"card","items":[').shape).toBe('card')
    expect(inferSkeleton('{"items":[{"type":"stat","value":').shape).toBe('stat')
    expect(inferSkeleton('{"items":[{"type":"diagram","' ).shape).toBe('diagram')
    expect(inferSkeleton('{"items":[{"type":"image","src":').shape).toBe('media')
  })

  it('falls back to the neutral shape when nothing is known yet', () => {
    expect(inferSkeleton('{"items":[').shape).toBe('generic')
    expect(inferSkeleton('{"items":[{"type":"mystery"').shape).toBe('generic')
  })

  it('shows a title that has fully arrived', () => {
    expect(inferSkeleton('{"items":[{"type":"card","title":"成本拆分","items":[').title).toBe('成本拆分')
  })

  it('shows a title that is still being typed', () => {
    // The closing quote has not arrived yet — the text is already the real title.
    expect(inferSkeleton('{"items":[{"type":"card","title":"成本拆').title).toBe('成本拆')
  })

  it('has no title when none was written', () => {
    expect(inferSkeleton('{"items":[{"type":"table","columns":').title).toBeUndefined()
  })
})

describe('coverage', () => {
  it('decides a shape for every whitelisted component type', () => {
    // A new component must not silently inherit the neutral placeholder: the
    // skeleton would then be back to "something is loading" for that type.
    const unmapped = Object.keys(COMPONENT_SCHEMAS)
      .filter(type => inferSkeleton(`{"items":[{"type":"${type}"`).shape === 'generic')
    expect(unmapped).toEqual([])
  })
})
