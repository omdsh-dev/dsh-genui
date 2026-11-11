/**
 * Editorial diagram layout: resolves a `diagram` spec into positioned boxes
 * and routed edges. Two layout modes mirror diagram-design's grammar:
 *
 *  - Coordinate kinds (architecture, it-state, high-level, process,
 *    medallion, data-flow, dp-integration): the spec carries x/y/w/h per
 *    node; this module passes them through (4px-grid already enforced by the
 *    guard) and routes edges.
 *  - Rule kinds (flowchart, sequence, state, er, timeline, swimlane,
 *    quadrant, radar, loop, nested, tree, org-chart, layers, venn, pyramid,
 *    bar, line, gantt, scatter, dp-security-matrix): the spec carries data
 *    only; this module lays the nodes out on the editorial grid.
 *
 * The output is a plain layout object consumed by the SVG renderer — no
 * React, no DOM, fully unit-testable.
 * @module @changfenhuang/dsh-genui/client/blocks/diagram/layout
 */
import type { GenuiDiagram, GenuiDiagramEdge, GenuiDiagramKind, GenuiDiagramNode, GenuiDiagramZone } from '../../spec.ts'
import { edgeLabelMetrics, labelGeometry, routeEdge, type Box } from './geometry.ts'

export interface LayoutNode {
  node: GenuiDiagramNode
  box: Box
}

export interface LayoutEdge {
  edge: GenuiDiagramEdge
  /** Resolved box references for routing. */
  fromId: string
  toId: string
  /** Horizontal center of a label slot when row layout allocates a widened gap. */
  labelCx?: number | undefined
}

export interface DiagramLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  /** Canvas size (width/height). */
  width: number
  height: number
}

/** Coordinate-mode kinds: nodes carry explicit positions. */
const COORDINATE_KINDS: readonly GenuiDiagramKind[] = [
  'architecture', 'it-state', 'high-level', 'process', 'medallion', 'data-flow', 'dp-integration',
]

const GAP = 32 // editorial gap between nodes
const NODE_W = 128
const NODE_H = 64
const MARGIN = 40

function isCoord(kind: GenuiDiagramKind): boolean {
  return COORDINATE_KINDS.includes(kind)
}

/** Default box for a node without coordinates. */
function defaultBox(i: number, cols: number): Box {
  const col = i % cols
  const row = Math.floor(i / cols)
  return {
    x: MARGIN + col * (NODE_W + GAP),
    y: MARGIN + row * (NODE_H + GAP),
    w: NODE_W,
    h: NODE_H,
  }
}

/** Simple top-down flow layout: nodes in a column, one per row. */
function columnLayout(nodes: GenuiDiagramNode[]): LayoutNode[] {
  return nodes.map((node, i) => ({
    node,
    box: { x: MARGIN, y: MARGIN + i * (NODE_H + GAP), w: NODE_W, h: NODE_H },
  }))
}

const EDGE_LABEL_CLEARANCE = 12
const EDGE_LABEL_SLOT_GAP = 8
const LAYOUT_GRID = 4

interface RowLayoutResult {
  placed: LayoutNode[]
  labelCenters: Map<number, number>
}

interface EdgeLabelSlot {
  edgeIndex: number
  boxWidth: number
}

function roundUpToGrid(value: number): number {
  return Math.ceil(value / LAYOUT_GRID) * LAYOUT_GRID
}

function placeRowNodes(nodes: GenuiDiagramNode[], gaps: number[]): LayoutNode[] {
  let x = MARGIN
  return nodes.map((node, i) => {
    const placed = { node, box: { x, y: MARGIN, w: NODE_W, h: NODE_H } }
    x += NODE_W + (gaps[i] ?? 0)
    return placed
  })
}

function zoneMembership(placed: LayoutNode[], zones: readonly GenuiDiagramZone[]): number[][] {
  return placed.map(({ box }) => {
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    return zones.flatMap((zone, index) => {
      const x = zone.x ?? 0
      const y = zone.y ?? 0
      const w = zone.w ?? 100
      const h = zone.h ?? 100
      return cx >= x && cx <= x + w && cy >= y && cy <= y + h ? [index] : []
    })
  })
}

function sameZoneMembership(before: number[][], after: number[][]): boolean {
  return before.length === after.length && before.every((membership, index) => {
    const candidate = after[index] ?? []
    return membership.length === candidate.length && membership.every((zone, i) => zone === candidate[i])
  })
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** Match the opaque title plate painted by renderZone in index.tsx. */
function zoneTitleBox(zone: GenuiDiagramZone): Box {
  const width = zone.label.length * 7 + 12
  const x = zone.x ?? 0
  const y = zone.y ?? 0
  const w = zone.w ?? 100
  return { x: x + w / 2 - width / 2, y: y + 4, w: width, h: 12 }
}

function isValidRowLayout(
  candidate: LayoutNode[],
  baseline: LayoutNode[],
  edges: GenuiDiagramEdge[],
  labelCenters: Map<number, number>,
  zones: readonly GenuiDiagramZone[],
): boolean {
  if (!sameZoneMembership(zoneMembership(baseline, zones), zoneMembership(candidate, zones))) return false

  const byId = new Map(candidate.map(item => [item.node.id, item.box]))
  const labels: Array<{ box: Box; managed: boolean }> = []

  for (const [edgeIndex, edge] of edges.entries()) {
    if (edge.label === undefined) continue
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (from === undefined || to === undefined) continue

    const routed = routeEdge(from, to)
    const geometry = labelGeometry(routed.a, routed.b)
    const metrics = edgeLabelMetrics(edge.label)
    const managed = labelCenters.has(edgeIndex)
    const cx = labelCenters.get(edgeIndex) ?? geometry.cx
    const box = { x: cx - metrics.boxWidth / 2, y: geometry.maskY, w: metrics.boxWidth, h: 12 }

    if (managed) {
      if (candidate.some(item => boxesOverlap(box, item.box))) return false
      if (zones.some(zone => boxesOverlap(box, zoneTitleBox(zone)))) return false
    }
    labels.push({ box, managed })
  }

  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]!
      const b = labels[j]!
      if ((a.managed || b.managed) && boxesOverlap(a.box, b.box)) return false
    }
  }
  return true
}

/**
 * Horizontal rule layouts widen only the node gaps that need room for their
 * adjacent edge labels. Every label in one gap gets its own centered slot.
 */
function rowLayout(
  nodes: GenuiDiagramNode[],
  edges: GenuiDiagramEdge[],
  zones: readonly GenuiDiagramZone[],
): RowLayoutResult {
  const baseGaps = Array.from({ length: Math.max(0, nodes.length - 1) }, () => GAP)
  const baseline = placeRowNodes(nodes, baseGaps)
  const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]))
  const groups = new Map<number, EdgeLabelSlot[]>()

  for (const [edgeIndex, edge] of edges.entries()) {
    if (edge.label === undefined) continue
    const from = nodeIndex.get(edge.from)
    const to = nodeIndex.get(edge.to)
    if (from === undefined || to === undefined || Math.abs(from - to) !== 1) continue
    const boundary = Math.min(from, to)
    const group = groups.get(boundary) ?? []
    group.push({ edgeIndex, boxWidth: edgeLabelMetrics(edge.label).boxWidth })
    groups.set(boundary, group)
  }

  if (groups.size === 0) return { placed: baseline, labelCenters: new Map() }

  const gaps = [...baseGaps]
  for (const [boundary, group] of groups) {
    const labelsWidth = group.reduce((sum, label) => sum + label.boxWidth, 0)
      + Math.max(0, group.length - 1) * EDGE_LABEL_SLOT_GAP
    gaps[boundary] = Math.max(GAP, roundUpToGrid(labelsWidth + EDGE_LABEL_CLEARANCE))
  }

  const candidate = placeRowNodes(nodes, gaps)
  const labelCenters = new Map<number, number>()
  for (const [boundary, group] of groups) {
    const left = candidate[boundary]!.box.x + candidate[boundary]!.box.w
    const gap = gaps[boundary] ?? GAP
    const labelsWidth = group.reduce((sum, label) => sum + label.boxWidth, 0)
      + Math.max(0, group.length - 1) * EDGE_LABEL_SLOT_GAP
    let cursor = left + (gap - labelsWidth) / 2
    for (const label of group) {
      labelCenters.set(label.edgeIndex, cursor + label.boxWidth / 2)
      cursor += label.boxWidth + EDGE_LABEL_SLOT_GAP
    }
  }

  if (!isValidRowLayout(candidate, baseline, edges, labelCenters, zones)) {
    return { placed: baseline, labelCenters: new Map() }
  }
  return { placed: candidate, labelCenters }
}

/** Layered horizontal layout (layers, pyramid, gantt phases): stacked rows. */
function layerLayout(nodes: GenuiDiagramNode[], perRow = 3): LayoutNode[] {
  return nodes.map((node, i) => {
    const row = Math.floor(i / perRow)
    const col = i % perRow
    return {
      node,
      box: {
        x: MARGIN + col * (NODE_W + GAP),
        y: MARGIN + row * (NODE_H + GAP),
        w: NODE_W,
        h: NODE_H,
      },
    }
  })
}

/** Tree layout: level = depth, children fan out horizontally under the parent. */
function treeLayout(nodes: GenuiDiagramNode[], parentOf: (id: string) => string | undefined): LayoutNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const childrenOf = new Map<string, string[]>()
  const roots: string[] = []
  for (const n of nodes) {
    const p = parentOf(n.id)
    if (p === undefined || !byId.has(p)) {
      roots.push(n.id)
    } else {
      const list = childrenOf.get(p) ?? []
      list.push(n.id)
      childrenOf.set(p, list)
    }
  }
  const placed = new Map<string, Box>()
  const depthOf = new Map<string, number>()

  // measure: leaf width = 1; parent width = sum of children widths.
  const measure = (id: string, depth: number): number => {
    depthOf.set(id, depth)
    const kids = childrenOf.get(id) ?? []
    if (kids.length === 0) return 1
    return kids.reduce((sum, k) => sum + measure(k, depth + 1), 0)
  }

  // assign: place children left→right, then center the parent above them.
  const assign = (id: string, left: number): number => {
    const depth = depthOf.get(id) ?? 0
    const kids = childrenOf.get(id) ?? []
    const w = NODE_W
    let cursor = left
    if (kids.length === 0) {
      placed.set(id, { x: left, y: MARGIN + depth * (NODE_H + GAP * 1.5), w, h: NODE_H })
      return left + w
    }
    for (const k of kids) cursor = assign(k, cursor)
    const first = placed.get(kids[0]!)!
    const last = placed.get(kids[kids.length - 1]!)!
    const cx = (first.x + last.x + last.w) / 2 - w / 2
    placed.set(id, { x: Math.max(left, cx), y: MARGIN + depth * (NODE_H + GAP * 1.5), w, h: NODE_H })
    return cursor
  }

  let left = MARGIN
  for (const r of roots) {
    left = assign(r, left) + GAP
  }
  return nodes.map(n => ({ node: n, box: placed.get(n.id) ?? { x: MARGIN, y: MARGIN, w: NODE_W, h: NODE_H } }))
}

/**
 * Resolve a diagram spec into a positioned layout. `parentOf` lets tree-like
 * kinds pass their hierarchy; other rule kinds use a generic grid.
 */
export function resolveLayout(
  diagram: GenuiDiagram,
  parentOf?: (id: string) => string | undefined,
): DiagramLayout {
  const nodes = diagram.nodes
  const edges = diagram.edges ?? []

  let placed: LayoutNode[]
  let edgeLabelCenters = new Map<number, number>()
  if (isCoord(diagram.kind)) {
    placed = nodes.map((node, i) => ({
      node,
      box: {
        x: node.x ?? MARGIN + (i % 3) * (NODE_W + GAP),
        y: node.y ?? MARGIN + Math.floor(i / 3) * (NODE_H + GAP),
        w: node.w ?? NODE_W,
        h: node.h ?? NODE_H,
      },
    }))
  } else if (diagram.kind === 'tree' || diagram.kind === 'org-chart' || diagram.kind === 'nested') {
    placed = treeLayout(nodes, parentOf ?? (() => undefined))
  } else if (diagram.kind === 'layers' || diagram.kind === 'pyramid' || diagram.kind === 'gantt') {
    placed = layerLayout(nodes)
  } else if (diagram.kind === 'flowchart' || diagram.kind === 'process' || diagram.kind === 'sequence') {
    // Directed flows read top-down.
    placed = columnLayout(nodes)
  } else if (diagram.kind === 'timeline' || diagram.kind === 'line' || diagram.kind === 'scatter' || diagram.kind === 'bar') {
    const row = rowLayout(nodes, edges, diagram.zones ?? [])
    placed = row.placed
    edgeLabelCenters = row.labelCenters
  } else {
    placed = nodes.map((node, i) => ({ node, box: defaultBox(i, 3) }))
  }

  // Canvas bounds.
  let width = 0
  let height = 0
  for (const l of placed) {
    width = Math.max(width, l.box.x + l.box.w)
    height = Math.max(height, l.box.y + l.box.h)
  }
  width = Math.max(320, Math.ceil((width + MARGIN) / 4) * 4)
  // Hug the content: the old 200px floor plus the legend strip made a 4-node
  // single row render inside a canvas twice its needed height, and the SVG
  // scales to the container width, so the empty band was amplified on screen.
  height = Math.max(96, Math.ceil((height + MARGIN) / 4) * 4)

  const edgesOut: LayoutEdge[] = edges.map((edge, index) => {
    const labelCx = edgeLabelCenters.get(index)
    return labelCx === undefined
      ? { edge, fromId: edge.from, toId: edge.to }
      : { edge, fromId: edge.from, toId: edge.to, labelCx }
  })

  return { nodes: placed, edges: edgesOut, width, height }
}
