// GenUI spec guard: resource limits, deterministic repair, and validation.
// Pure node tests — no DOM. The fence path runs every body through
// `repairGenuiSpec` before rendering, so these invariants protect the UI.
import { describe, expect, it } from 'vitest'
import { countDeclaredGenuiNodes, countGenuiNodes, repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'
import { GENUI_LIMITS } from '../src/client/genui-runtime/index.ts'
import { type GenuiNode, type GenuiList, isGenuiSpec, parseGenuiSpec } from '../src/client/spec.ts'

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
      { type: 'audio' }, // no src
      { type: 'video' }, // no src
      text('kept'),
    ] })
    expect(spec?.items).toHaveLength(1)
    expect((spec?.items[0] as { content: string }).content).toBe('kept')
  })

  it('normalizes object-array options into strings (select/radio)', () => {
    // Models sometimes reuse ask_user_question's {label,description} shape for
    // select/radio options; the guard must extract readable text instead of
    // silently dropping every option (empty list = "options not rendered").
    const spec = repairGenuiSpec({ items: [
      { type: 'radio', label: 'Q', group: 'q', options: [
        { label: '甲方案', description: '说明' },
        { value: '乙方案' },
        { title: '丙方案' },
        { x: 1 },
      ] },
      { type: 'select', options: [{ label: '选项A' }, { label: '选项B' }] },
    ] })
    const [radio, select] = spec!.items as Array<{ options?: string[] }>
    expect(radio.options).toEqual(['甲方案', '乙方案', '丙方案', '{"x":1}'])
    expect(select.options).toEqual(['选项A', '选项B'])
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

  it('keeps safe media URLs and rejects active or local schemes', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'audio', src: '/mmx-files/a.mp3', alt: 'A', loop: true },
      { type: 'video', src: 'https://cdn.example.com/b.mp4', poster: '/b.jpg', aspectRatio: '4:3', muted: true },
      { type: 'audio', src: 'javascript:alert(1)' },
      { type: 'video', src: 'file:///tmp/private.mp4' },
      { type: 'video', src: '//example.com/protocol-relative.mp4' },
    ] })
    expect(spec?.items).toEqual([
      { type: 'audio', src: '/mmx-files/a.mp3', alt: 'A', loop: true },
      { type: 'video', src: 'https://cdn.example.com/b.mp4', poster: '/b.jpg', muted: true, aspectRatio: '4:3' },
    ])
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

describe('repairGenuiSpec: table / tabs tolerance (issue #42)', () => {
  it('flattens object columns and object-array rows (data alias) into a real table', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'table',
        columns: [{ title: '名称', key: 'name' }, { title: '数量', dataIndex: 'count' }],
        data: [
          { name: '苹果', count: 3, extra: 'x' },
          { name: '梨', count: null },
        ] },
    ] })
    const table = spec?.items[0] as { columns: string[], rows: Array<Array<string | number>> }
    expect(table.columns).toEqual(['名称', '数量'])
    expect(table.rows).toEqual([['苹果', 3], ['梨', '']])
  })

  it('keys object rows by the first row when columns are plain strings', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'table', columns: ['a', 'b'], rows: [{ a: 1, b: 'two' }] },
    ] })
    const table = spec?.items[0] as { rows: Array<Array<string | number>> }
    expect(table.rows).toEqual([[1, 'two']])
  })

  it('accepts tabs[].content as an items alias (array or single component)', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'tabs', tabs: [
        { label: '一', content: [{ type: 'text', content: 'a' }, { type: 'badge', label: 'b' }] },
        { label: '二', content: { type: 'text', content: 'c' } },
      ] },
    ] })
    const tabs = spec?.items[0] as { tabs: Array<{ label: string, items: unknown[] }> }
    expect(tabs.tabs[0]?.items).toHaveLength(2)
    expect(tabs.tabs[1]?.items).toHaveLength(1)
  })
})

describe('node counting: container descent + declared nodes (issue #42)', () => {
  it('countGenuiNodes descends into row / col / grid / card containers', () => {
    const tree = { items: [
      { type: 'row', items: [{ type: 'col', items: [text('a'), text('b')] }] },
      { type: 'grid', cols: 2, items: [text('c')] },
      { type: 'card', title: 'k', items: [text('d')] },
    ] }
    expect(countGenuiNodes(tree)).toBe(8)
  })

  it('countDeclaredGenuiNodes walks the same containers and skips non-node "type" strings', () => {
    const tree = { items: [
      { type: 'row', items: [text('a')] },
      { type: 'file-tree', items: [
        { name: 'src', type: 'dir', children: [{ name: 'i.ts', type: 'file' }] },
      ] },
    ] }
    // row + text + the file-tree node itself; the dir/file children are not
    // GenUI nodes and must not count.
    expect(countDeclaredGenuiNodes(tree)).toBe(3)
  })

  it('countDeclaredGenuiNodes counts a single-component root', () => {
    expect(countDeclaredGenuiNodes({ type: 'callout', content: 'x' })).toBe(1)
  })
})

describe('repairGenuiSpec: list nodes', () => {
  it('keeps row/text/badge children inside a list', () => {
    const spec = repairGenuiSpec({
      items: [
        {
          type: 'list',
          items: [
            'src',
            {
              type: 'row',
              items: [
                { type: 'text', text: 'app.ts' },
                { type: 'badge', text: 'TS' },
                { type: 'badge', value: '42 lines' },
              ],
            },
          ],
        },
      ],
    })
    const [list] = spec!.items as Array<{ items: GenuiList['items'] }>
    expect(list.items).toHaveLength(2)
    expect(list.items[0]).toBe('src')
    const row = list.items[1] as GenuiNode & { items: GenuiNode[] }
    expect(row.type).toBe('row')
    expect(row.items.map(item => item.type)).toEqual(['text', 'badge', 'badge'])
    expect(row.items[0]).toMatchObject({ type: 'text', content: 'app.ts' })
    expect(row.items[1]).toMatchObject({ type: 'badge', label: 'TS' })
    expect(row.items[2]).toMatchObject({ type: 'badge', label: '42 lines' })
  })

  it('keeps valid entries while dropping invalid typed list nodes', () => {
    const spec = repairGenuiSpec({
      items: [
        {
          type: 'list',
          items: [
            'plain',
            { type: 'row', items: [{ type: 'text', content: 'keep' }] },
            { type: 'text' },
            { type: 'button' },
            { type: 'badge', label: 'ok' },
          ],
        },
      ],
    })
    const [list] = spec!.items as Array<{ items: GenuiList['items'] }>
    expect(list.items).toEqual([
      'plain',
      { type: 'row', items: [{ type: 'text', content: 'keep' }] },
      { type: 'badge', label: 'ok' },
    ])
  })

  it('charges typed list children against the shared node budget', () => {
    const badges = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'badge' as const, label: `b${i}` }))
    const spec = repairGenuiSpec({
      items: [
        { type: 'list', items: badges(50) },
        { type: 'list', items: badges(50) },
        { type: 'list', items: badges(50) },
        { type: 'list', items: badges(50) },
      ],
    })
    const lists = spec!.items as Array<{ items: Array<{ type: string; label: string }> }>
    // 3 full lists (3×50 badges) + 3 list nodes = 153 nodes; the 4th list
    // node costs 1 and fits 46 more badges before the 200-node budget cuts
    // (196 badges + 4 lists = 200 exactly). Without the deduction all 204
    // nodes would slip through.
    expect(lists[0]!.items).toHaveLength(50)
    expect(lists[1]!.items).toHaveLength(50)
    expect(lists[2]!.items).toHaveLength(50)
    expect(lists[3]!.items).toHaveLength(46)
    expect(countGenuiNodes(spec)).toBe(GENUI_LIMITS.maxNodes)
  })

  it('keeps title-objects, strings, and typed nodes interleaved in order', () => {
    const spec = repairGenuiSpec({
      items: [
        {
          type: 'list',
          items: [
            { type: 'badge', label: 'node-first' },
            { title: 'titled', desc: 'd' },
            'plain',
            { type: 'text', text: 'typed-last' },
          ],
        },
      ],
    })
    const [list] = spec!.items as Array<{ items: GenuiList['items'] }>
    expect(list.items).toEqual([
      { type: 'badge', label: 'node-first' },
      { title: 'titled', desc: 'd' },
      'plain',
      { type: 'text', content: 'typed-last' },
    ])
  })

  it('prefers the title form when an object carries both title and type', () => {
    const spec = repairGenuiSpec({
      items: [
        { type: 'list', items: [{ title: 'T', desc: 'D', type: 'badge', label: 'B' }] },
      ],
    })
    const [list] = spec!.items as Array<{ items: GenuiList['items'] }>
    expect(list.items).toEqual([{ title: 'T', desc: 'D' }])
  })

  it('countGenuiNodes includes typed list children', () => {
    const count = countGenuiNodes({
      items: [
        {
          type: 'list',
          items: [
            { type: 'badge', label: 'a' },
            { type: 'list', items: [{ type: 'text', content: 'x' }] },
            'plain',
            { title: 't' },
          ],
        },
      ],
    })
    // list + badge + nested-list + nested-text = 4; the 'plain' string and
    // {title,desc} shape are list-item entries, not nodes.
    expect(count).toBe(4)
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

  it('accepts text/badge aliases the same way repair does', () => {
    const result = validateGenuiSpec({
      items: [
        {
          type: 'list',
          items: [
            { type: 'text', text: 'app.ts' },
            { type: 'badge', text: 'TS' },
            { type: 'badge', value: '42 lines' },
            { type: 'badge', label: 'plain' },
          ],
        },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('still rejects text/badge without any accepted label field', () => {
    const result = validateGenuiSpec({ items: [{ type: 'text' }, { type: 'badge' }] })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain("requires content or text")
    expect(result.errors.join('\n')).toContain("requires label, text, or value")
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
