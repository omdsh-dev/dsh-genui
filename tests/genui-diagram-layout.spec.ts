import { describe, expect, it } from 'vitest'
import type { GenuiDiagram, GenuiDiagramEdge, GenuiDiagramKind } from '../src/client/spec.ts'
import { edgeLabelMetrics } from '../src/client/blocks/diagram/geometry.ts'
import { resolveLayout } from '../src/client/blocks/diagram/layout.ts'

const nodes: GenuiDiagram['nodes'] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C' },
]

function createDiagram(
  kind: GenuiDiagramKind,
  edges: GenuiDiagramEdge[] = [],
  zones?: GenuiDiagram['zones'],
): GenuiDiagram {
  return {
    type: 'diagram',
    kind,
    nodes,
    edges,
    ...(zones === undefined ? {} : { zones }),
  }
}

function nodeXs(diagram: GenuiDiagram): number[] {
  return resolveLayout(diagram).nodes.map(item => item.box.x)
}

describe('horizontal diagram edge-label spacing', () => {
  it('measures CJK, Latin, mixed text, and emoji graphemes with the renderer typography', () => {
    expect(edgeLabelMetrics('中文测试')).toEqual({ textWidth: 33.5, boxWidth: 41.5 })
    expect(edgeLabelMetrics('ABCDEFGHIJKLMN')).toEqual({ textWidth: 118.5, boxWidth: 126.5 })
    expect(edgeLabelMetrics('ABCDE')).toEqual({ textWidth: 26, boxWidth: 34 })
    expect(edgeLabelMetrics('A中B').textWidth).toBeCloseTo(18.6)
    expect(edgeLabelMetrics('A👩‍💻B').textWidth).toBeCloseTo(18.6)
  })

  it('keeps the 32px minimum gap when labels fit', () => {
    expect(nodeXs(createDiagram('timeline'))).toEqual([40, 200, 360])
    expect(nodeXs(createDiagram('timeline', [{ from: 'a', to: 'b', label: 'OK' }]))).toEqual([40, 200, 360])
  })

  it('expands only the gap required by a long adjacent label', () => {
    const diagram = createDiagram('timeline', [{ from: 'a', to: 'b', label: 'ABCDEFGHIJKLMN' }])
    const layout = resolveLayout(diagram)
    expect(nodeXs(diagram)).toEqual([40, 308, 468])
    expect(layout.width).toBe(636)
    expect(layout.edges[0]?.labelCx).toBe(238)
    expect(layout.nodes[2]?.box.x).toBe(468)
  })

  it('uses the same width calculation for four-character and fourteen-character CJK labels', () => {
    const short = resolveLayout(createDiagram('timeline', [{ from: 'a', to: 'b', label: '中文测试' }]))
    const long = resolveLayout(createDiagram('timeline', [{ from: 'a', to: 'b', label: '实时同步到下游并写入归档库里' }]))
    expect(short.nodes[1]?.box.x).toBe(224)
    expect(long.nodes[1]?.box.x).toBe(308)
  })

  it('widens only the gaps containing long labels and keeps the canvas at the calculated bounds', () => {
    const label = 'ABCDEFGHIJKLMN'
    const diagram: GenuiDiagram = {
      type: 'diagram',
      kind: 'timeline',
      nodes,
      edges: [
        { from: 'a', to: 'b', label },
        { from: 'b', to: 'c', label },
      ],
    }
    const layout = resolveLayout(diagram)
    expect(nodeXs(diagram)).toEqual([40, 308, 576])
    expect(layout.width).toBe(744)
  })

  it('keeps the nine-node limit while sizing all eight labelled gaps', () => {
    const manyNodes = Array.from({ length: 9 }, (_unused, index) => ({ id: `node-${index}`, label: `Node ${index}` }))
    const manyEdges = Array.from({ length: 8 }, (_unused, index) => ({ from: `node-${index}`, to: `node-${index + 1}`, label: 'ABCDEFGHIJKLMN' }))
    const diagram: GenuiDiagram = { type: 'diagram', kind: 'timeline', nodes: manyNodes, edges: manyEdges }
    expect(resolveLayout(diagram).width).toBe(2352)
  })

  it('allocates separate slots for multiple labels connecting the same adjacent nodes', () => {
    const label = 'ABCDEFGHIJKLMN'
    const layout = resolveLayout(createDiagram('timeline', [
      { from: 'a', to: 'b', label },
      { from: 'b', to: 'a', label },
    ]))
    const metrics = edgeLabelMetrics(label)
    const firstCenter = layout.edges[0]?.labelCx ?? 0
    const secondCenter = layout.edges[1]?.labelCx ?? 0
    const firstRight = firstCenter + metrics.boxWidth / 2
    const secondLeft = secondCenter - metrics.boxWidth / 2
    expect(layout.nodes[1]?.box.x).toBe(444)
    expect(secondLeft - firstRight).toBeCloseTo(8)
    expect(firstCenter).toBeLessThan(secondCenter)
  })

  it('uses label-aware gaps for all four horizontal diagram kinds', () => {
    const edges: GenuiDiagramEdge[] = [{ from: 'a', to: 'b', label: '实时同步到下游并写入归档库里' }]
    for (const kind of ['timeline', 'line', 'scatter', 'bar'] satisfies GenuiDiagramKind[]) {
      expect(nodeXs(createDiagram(kind, edges))).toEqual([40, 308, 468])
    }
  })

  it('does not change the spacing for non-adjacent edges', () => {
    expect(nodeXs(createDiagram('timeline', [
      { from: 'a', to: 'c', label: 'ABCDEFGHIJKLMN' },
    ]))).toEqual([40, 200, 360])
  })

  it('keeps zone membership unchanged when widening a gap would move a node out', () => {
    const diagram = createDiagram('timeline', [
      { from: 'a', to: 'b', label: 'ABCDEFGHIJKLMN' },
    ], [{ label: 'DATA', x: 230, y: 0, w: 100, h: 150 }])
    const layout = resolveLayout(diagram)
    expect(nodeXs(diagram)).toEqual([40, 200, 360])
    expect(layout.edges[0]?.labelCx).toBeUndefined()
  })

  it('rejects a candidate whose label mask would overlap a zone title plate', () => {
    const diagram = createDiagram('timeline', [
      { from: 'a', to: 'b', label: 'ABCDEFGHIJKLMN' },
    ], [{ label: 'DATA', x: 134, y: 48, w: 100, h: 100 }])
    const layout = resolveLayout(diagram)
    expect(nodeXs(diagram)).toEqual([40, 200, 360])
    expect(layout.edges[0]?.labelCx).toBeUndefined()
  })
})
