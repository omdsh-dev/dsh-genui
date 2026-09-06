// Editorial diagram guard: repair + validation of the `diagram` node.
// Pure node tests — no DOM. Mirrors genui-guard.spec.ts style.
import { describe, expect, it } from 'vitest'
import { repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'
import { GENUI_LIMITS } from '../src/client/genui-runtime/index.ts'

const diagram = (over: Record<string, unknown>) => ({ type: 'diagram', kind: 'architecture', nodes: [{ id: 'n1', label: 'A' }], ...over })

describe('repairGenuiSpec: diagram', () => {
  it('keeps a valid coordinate diagram and clamps to the 4px grid', () => {
    const spec = repairGenuiSpec({ items: [diagram({
      kind: 'architecture',
      nodes: [
        { id: 'n1', label: 'Web', x: 41, y: 40, w: 130, h: 48, type: 'focal', tag: 'API', sub: 'v1' },
        { id: 'n2', label: 'DB', x: 200, y: 140 },
      ],
      edges: [{ from: 'n1', to: 'n2', label: 'WRITE', kind: 'accent' }],
    })] })
    const d = spec?.items[0] as { type: 'diagram'; nodes: Array<{ x: number; y: number; w: number; h: number }> }
    expect(d.type).toBe('diagram')
    // 41 → 40, 130 → 132 (round to 4)
    expect(d.nodes[0].x).toBe(40)
    expect(d.nodes[0].w).toBe(132)
    expect(d.nodes[0].tag).toBe('API')
  })

  it('drops unknown kinds and nodes missing id/label', () => {
    const spec = repairGenuiSpec({ items: [
      diagram({ kind: 'not-a-kind' as string }),
      { type: 'diagram', kind: 'tree', nodes: [{ id: 'a' }, { label: 'no-id' }] },
    ] })
    // Unknown kind → dropped; valid kind with incomplete nodes → dropped nodes.
    expect(spec?.items).toHaveLength(1)
    const d = spec?.items[0] as { nodes: unknown[] }
    expect(d.nodes).toHaveLength(0)
  })

  it('budgets nodes and edges', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, label: `N${i}` }))
    const edges = Array.from({ length: 20 }, (_, i) => ({ from: `n${i}`, to: `n${(i + 1) % 20}` }))
    const spec = repairGenuiSpec({ items: [diagram({ nodes: many, edges })] })
    const d = spec?.items[0] as { nodes: unknown[]; edges: unknown[] }
    expect(d.nodes.length).toBe(GENUI_LIMITS.maxDiagramNodes)
    expect(d.edges.length).toBe(GENUI_LIMITS.maxDiagramEdges)
  })

  it('drops duplicate node ids and keeps the first', () => {
    const spec = repairGenuiSpec({ items: [diagram({ nodes: [
      { id: 'a', label: 'first' }, { id: 'a', label: 'dup' },
    ] })] })
    const d = spec?.items[0] as { nodes: Array<{ label: string }> }
    expect(d.nodes).toHaveLength(1)
    expect(d.nodes[0].label).toBe('first')
  })

  it('clamps label length to the editorial budget', () => {
    const spec = repairGenuiSpec({ items: [diagram({ edges: [{ from: 'n1', to: 'n1', label: 'X'.repeat(40) }] })] })
    const d = spec?.items[0] as { edges: Array<{ label: string }> }
    expect(d.edges[0].label.length).toBe(GENUI_LIMITS.maxDiagramLabel)
  })

  it('drops non-hex / non-token theme colors', () => {
    const spec = repairGenuiSpec({ items: [diagram({ theme: { accent: 'url(https://evil/x)', paper: '#123456' } })] })
    const d = spec?.items[0] as { theme?: { accent?: string; paper?: string } }
    expect(d.theme?.accent).toBeUndefined()
    expect(d.theme?.paper).toBe('#123456')
  })
})

describe('validateGenuiSpec: diagram', () => {
  it('reports missing kind / nodes', () => {
    const v = validateGenuiSpec({ items: [{ type: 'diagram' }] })
    expect(v.ok).toBe(false)
    expect(v.errors.join('\n')).toContain('requires kind')
    expect(v.errors.join('\n')).toContain('requires nodes')
  })

  it('accepts a well-formed diagram', () => {
    const v = validateGenuiSpec({ items: [diagram({})] })
    expect(v.ok).toBe(true)
  })
})
