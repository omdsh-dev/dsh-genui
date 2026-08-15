// GenUI spec guard: resource limits, deterministic repair, and validation.
// Pure node tests — no DOM. The fence path runs every body through
// `repairGenuiSpec` before rendering, so these invariants protect the UI.
import { describe, expect, it } from 'vitest'
import { GENUI_LIMITS, repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'
import { isGenuiSpec, parseGenuiSpec } from '../src/client/spec.ts'

const text = (content: string) => ({ type: 'text', content })

describe('repairGenuiSpec: root shape', () => {
  it('returns null for non-object roots', () => {
    expect(repairGenuiSpec(null)).toBeNull()
    expect(repairGenuiSpec('x')).toBeNull()
    expect(repairGenuiSpec([])).toBeNull()
    expect(repairGenuiSpec(42)).toBeNull()
  })

  it('returns null when items is not an array', () => {
    expect(repairGenuiSpec({ title: 'x' })).toBeNull()
    expect(repairGenuiSpec({ items: 'nope' })).toBeNull()
    expect(repairGenuiSpec({ items: {} })).toBeNull()
  })

  it('keeps title and clamps gap', () => {
    const spec = repairGenuiSpec({ title: 'T', gap: 200, items: [text('a')] })
    expect(spec?.title).toBe('T')
    expect(spec?.gap).toBe(96)
    const spec2 = repairGenuiSpec({ gap: -10, items: [] })
    expect(spec2?.gap).toBe(0)
  })

  it('produces a valid GenuiSpec for a valid input (idempotent)', () => {
    const input = {
      title: 't', gap: 12, items: [
        text('hi'), { type: 'stat', label: 'L', value: '1', delta: '+2%' },
      ],
    }
    const once = repairGenuiSpec(input)
    const twice = repairGenuiSpec(once)
    expect(once).not.toBeNull()
    expect(twice).toEqual(once)
    expect(isGenuiSpec(once)).toBe(true)
  })
})

describe('repairGenuiSpec: single-component roots', () => {
  it('wraps a bare component root into a col (documented fence vocabulary)', () => {
    const spec = repairGenuiSpec({ type: 'callout', tone: 'info', title: '核心观察', content: '你好' })
    expect(spec).not.toBeNull()
    // The repaired GenuiSpec carries no `type` (root spec field set) — the
    // observable wrap effect is the items array holding the bare component.
    expect(spec?.items).toHaveLength(1)
    expect((spec?.items[0] as { type: string }).type).toBe('callout')
    expect(isGenuiSpec(spec)).toBe(true)
  })

  it('hoists panel/append from the bare component onto the wrapper', () => {
    const spec = repairGenuiSpec({ type: 'text', content: 'x', panel: true, append: true })
    expect(spec?.panel).toBe(true)
    expect(spec?.append).toBe(true)
    const inner = spec?.items[0] as { panel?: unknown; append?: unknown }
    expect(inner.panel).toBeUndefined()
    expect(inner.append).toBeUndefined()
  })

  it('still rejects non-component objects without an items array', () => {
    expect(repairGenuiSpec({ title: 'x' })).toBeNull()
    expect(repairGenuiSpec({ foo: 1 })).toBeNull()
  })

  it('idempotent: a wrapped single root repairs to itself', () => {
    const once = repairGenuiSpec({ type: 'stat', label: 'L', value: '1' })
    const twice = repairGenuiSpec(once)
    expect(twice).toEqual(once)
  })
})

describe('validateGenuiSpec / parseGenuiSpec: single-component roots', () => {
  it('accepts a bare component as valid', () => {
    const result = validateGenuiSpec({ type: 'callout', tone: 'info', title: 'T', content: 'c' })
    expect(result.ok).toBe(true)
  })

  it('parseGenuiSpec wraps a single-component fence body', () => {
    const spec = parseGenuiSpec(JSON.stringify({ type: 'keyvalue', pairs: [{ key: 'a', value: 'b' }] }))
    expect(spec?.type).toBe('col')
    expect((spec?.items[0] as { type: string }).type).toBe('keyvalue')
  })

  it('parseGenuiSpec still rejects non-component junk', () => {
    expect(parseGenuiSpec('{"foo":1}')).toBeNull()
    expect(parseGenuiSpec('not json')).toBeNull()
  })
})

describe('repairGenuiSpec: node-level healing', () => {
  it('drops nodes with missing required fields', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'text' }, // no content
      { type: 'button' }, // no label
      { type: 'table', columns: ['a'] }, // no rows
      { type: 'quiz', question: 'q' }, // no options
      text('kept'),
    ] })
    expect(spec?.items).toHaveLength(1)
    expect((spec?.items[0] as { content: string }).content).toBe('kept')
  })

  it('clamps out-of-range numbers', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'progress', value: 150 },
      { type: 'progress', value: -5 },
      { type: 'grid', cols: 40, items: [] },
    ] })
    const [p1, p2, g] = spec!.items as Array<{ value?: number; cols?: number }>
    expect(p1.value).toBe(100)
    expect(p2.value).toBe(0)
    expect(g.cols).toBe(GENUI_LIMITS.maxGridCols)
  })

  it('clamps non-integer grid cols', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'grid', cols: 3.7, items: [] }] })
    expect((spec!.items[0] as { cols: number }).cols).toBe(3)
  })

  it('truncates oversized strings', () => {
    const long = 'x'.repeat(5000)
    const spec = repairGenuiSpec({ items: [text(long)] })
    expect((spec!.items[0] as { content: string }).content).toHaveLength(GENUI_LIMITS.maxString)
  })

  it('truncates oversized code and mermaid bodies', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'code', code: 'x'.repeat(GENUI_LIMITS.maxCode + 100) },
      { type: 'mermaid', code: 'y'.repeat(GENUI_LIMITS.maxMermaid + 100) },
    ] })
    expect((spec!.items[0] as { code: string }).code).toHaveLength(GENUI_LIMITS.maxCode)
    expect((spec!.items[1] as { code: string }).code).toHaveLength(GENUI_LIMITS.maxMermaid)
  })

  it('caps array-backed nodes (tabs, meshes, options, rows)', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `t${i}`, items: [] }))
    const spec = repairGenuiSpec({ items: [
      { type: 'tabs', tabs: many(30) },
      { type: 'scene3d', meshes: Array.from({ length: 20 }, () => ({ shape: 'box' as const })) },
      { type: 'select', options: Array.from({ length: 80 }, (_, i) => `o${i}`) },
      { type: 'table', columns: ['a'], rows: Array.from({ length: 80 }, () => ['x']) },
    ] })
    const [tabs, scene, select, table] = spec!.items as Array<{ tabs?: unknown[]; meshes?: unknown[]; options?: string[]; rows?: unknown[] }>
    expect(tabs.tabs).toHaveLength(GENUI_LIMITS.maxTabs)
    expect(scene.meshes).toHaveLength(GENUI_LIMITS.maxMeshes)
    expect(select.options).toHaveLength(GENUI_LIMITS.maxOptions)
    expect(table.rows).toHaveLength(GENUI_LIMITS.maxTableRows)
  })

  it('caps total node count', () => {
    const spec = repairGenuiSpec({ items: Array.from({ length: 500 }, (_, i) => text(`n${i}`)) })
    expect(spec!.items).toHaveLength(GENUI_LIMITS.maxNodes)
  })

  it('caps nesting depth', () => {
    let node: unknown = text('leaf')
    for (let i = 0; i < 30; i++) node = { type: 'col', items: [node] }
    const spec = repairGenuiSpec({ items: [node] })
    let cur: unknown = spec!.items[0]
    let depth = 0
    while (cur !== undefined && typeof cur === 'object') {
      const items = (cur as { items?: unknown[] }).items
      cur = items?.[0]
      depth += 1
    }
    // Root col at depth 0 … deepest kept node at depth maxDepth, one more dropped.
    expect(depth).toBe(GENUI_LIMITS.maxDepth + 1)
  })

  it('drops invalid chart without data or series but keeps series-only charts', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'chart' },
      { type: 'chart', series: [{ label: 's', data: [{ label: 'a', value: 1 }] }] },
    ] })
    expect(spec!.items).toHaveLength(1)
    expect((spec!.items[0] as { type: string }).type).toBe('chart')
  })

  it('passes unknown node types through untouched (custom components)', () => {
    const custom = { type: 'my-widget', flavor: 'pink', data: { a: [1, 2] } }
    const spec = repairGenuiSpec({ items: [custom] })
    expect(spec!.items).toHaveLength(1)
    expect(spec!.items[0]).toEqual(custom)
  })

  it('sanitizes raw scalars inside collections', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'list', items: ['ok', 42, { title: 't' }, null] },
      { type: 'keyvalue', pairs: [{ key: 'k', value: 'v' }, { key: 1, value: 'x' }] },
    ] })
    const [list] = spec!.items as Array<{ items?: Array<string | { title: string }>; pairs?: Array<{ key: string; value: string }> }>
    expect(list.items).toEqual(['ok', { title: 't' }])
    const [kv] = spec!.items.slice(1) as Array<{ pairs: Array<{ key: string; value: string }> }>
    expect(kv.pairs).toEqual([{ key: 'k', value: 'v' }])
  })
})

describe('validateGenuiSpec: diagnostics', () => {
  it('passes a well-formed spec', () => {
    const result = validateGenuiSpec({ items: [text('a'), { type: 'progress', value: 50 }] })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('reports missing required fields with paths', () => {
    const result = validateGenuiSpec({ items: [text('a'), { type: 'button' }] })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('items[1]')
    expect(result.errors.join('\n')).toContain('label')
  })

  it('reports out-of-range progress and deep nesting', () => {
    let node: unknown = text('x')
    for (let i = 0; i < 20; i++) node = { type: 'card', items: [node] }
    const result = validateGenuiSpec({ items: [{ type: 'progress', value: 120 }, node] })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('0..100')
    expect(result.errors.join('\n')).toContain('max depth')
  })

  it('reports the node budget', () => {
    const result = validateGenuiSpec({ items: Array.from({ length: 500 }, (_, i) => text(`n${i}`)) })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain(`${GENUI_LIMITS.maxNodes} nodes`)
  })

  it('flags unknown types as custom-renderer warnings', () => {
    const result = validateGenuiSpec({ items: [{ type: 'my-widget' }] })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain("unknown type 'my-widget'")
  })
})

describe('repairGenuiSpec: color field whitelist (CSS injection channel)', () => {
  it('keeps hex / rgb / hsl / host-token colors', () => {
    const spec = repairGenuiSpec({
      items: [
        { type: 'avatar', name: 'A', color: '#4f8ef7' },
        { type: 'chart', data: [{ label: 'x', value: 1, color: 'rgb(10, 20, 30)' }] },
        { type: 'chart', data: [{ label: 'y', value: 2, color: 'var(--dsw-static-green-400)' }] },
        { type: 'scene3d', meshes: [{ shape: 'box', color: 'hsl(210 50% 40%)' }], background: '#101418' },
      ],
    })
    expect(spec?.items[0]).toMatchObject({ color: '#4f8ef7' })
    const chart1 = spec!.items[1] as { data: Array<{ color?: string }> }
    expect(chart1.data[0]!.color).toBe('rgb(10, 20, 30)')
    const chart2 = spec!.items[2] as { data: Array<{ color?: string }> }
    expect(chart2.data[0]!.color).toBe('var(--dsw-static-green-400)')
    expect(spec?.items[3]).toMatchObject({ background: '#101418' })
  })

  it('drops url()/javascript:/garbage values (degrade to default palette)', () => {
    const spec = repairGenuiSpec({
      items: [
        { type: 'avatar', name: 'A', color: 'url(https://evil.example/track?u=1)' },
        { type: 'chart', data: [{ label: 'x', value: 1, color: 'javascript:alert(1)' }] },
        { type: 'plot', series: [{ expr: 'x', color: 'expression(alert(1))' }] },
        { type: 'scene3d', meshes: [{ shape: 'box', color: 'not-a-color' }] },
      ],
    })
    expect(spec?.items[0]).toEqual({ type: 'avatar', name: 'A' })
    const chart = spec!.items[1] as { data: Array<{ color?: string }> }
    expect(chart.data[0]!.color).toBeUndefined()
    const plot = spec!.items[2] as { series: Array<{ color?: string }> }
    expect(plot.series[0]!.color).toBeUndefined()
    const scene = spec!.items[3] as { meshes: Array<{ color?: string }> }
    expect(scene.meshes[0]!.color).toBeUndefined()
  })
})
