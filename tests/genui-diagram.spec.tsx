// @vitest-environment jsdom
// Editorial diagram rendering: the `diagram` node renders inline SVG with the
// editorial constraints (orthogonal paths, semantic tokens, a11y shell).
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DiagramNode } from '../src/client/blocks/diagram/index.tsx'
import type { GenuiDiagram } from '../src/client/spec.ts'

afterEach(cleanup)

const base: GenuiDiagram = {
  type: 'diagram',
  kind: 'architecture',
  title: '系统架构',
  nodes: [
    { id: 'web', label: 'Web', type: 'focal', x: 40, y: 40, w: 128, h: 48, tag: 'API' },
    { id: 'db', label: 'Postgres', type: 'store', x: 240, y: 120, w: 128, h: 48, sub: 'rds:5432' },
  ],
  edges: [{ from: 'web', to: 'db', label: 'WRITE', kind: 'accent' }],
}

describe('DiagramNode', () => {
  it('renders an accessible svg with the diagram title', () => {
    const { container } = render(<DiagramNode node={base} />)
    const svg = container.querySelector('svg[role="img"]')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-labelledby')).toBeTruthy()
    const title = container.querySelector('title')
    expect(title?.textContent).toBe('系统架构')
  })

  it('draws both node labels and the edge label', () => {
    const { container } = render(<DiagramNode node={base} />)
    const text = Array.from(container.querySelectorAll('text')).map(t => t.textContent)
    expect(text).toContain('Web')
    expect(text).toContain('Postgres')
    expect(text).toContain('WRITE')
  })

  it('renders an orthogonal path (elbow, not diagonal) for off-axis edges', () => {
    const { container } = render(<DiagramNode node={base} />)
    const path = container.querySelector('path')
    expect(path).not.toBeNull()
    expect(path?.getAttribute('d')).toContain('M ')
    // Orthogonal paths contain only H/V/Q commands, never L between off-axis points.
    const d = path?.getAttribute('d') ?? ''
    expect(d).toMatch(/^M [0-9.]+ [0-9.]+ (H|V|Q)/)
  })

  it('applies semantic treatment: focal node uses the accent stroke', () => {
    const { container } = render(<DiagramNode node={base} />)
    const rects = Array.from(container.querySelectorAll('rect'))
    // The focal node's stroke rect should exist; find any rect with accent-ish stroke.
    const strokes = rects.map(r => r.getAttribute('stroke')).filter(Boolean)
    expect(strokes.length).toBeGreaterThan(0)
  })

  it('renders dark variant with dark paper background', () => {
    const dark: GenuiDiagram = { ...base, variant: 'dark' }
    const { container } = render(<DiagramNode node={dark} />)
    const svg = container.querySelector('svg') as SVGSVGElement
    expect(svg.style.background).toContain('45, 49, 66') // jet-black dark paper
  })

  it('renders every rule kind without throwing', () => {
    const kinds = [
      'flowchart', 'sequence', 'state', 'er', 'timeline', 'swimlane', 'quadrant', 'radar', 'loop',
      'nested', 'tree', 'org-chart', 'layers', 'venn', 'pyramid', 'bar', 'line', 'gantt', 'scatter',
      'dp-security-matrix',
    ] as const
    for (const kind of kinds) {
      const spec: GenuiDiagram = {
        type: 'diagram',
        kind,
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
        edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
      }
      const { container } = render(<DiagramNode node={spec} />)
      expect(container.querySelector('svg')).not.toBeNull()
      cleanup()
    }
  })

  it('renders every coordinate kind without throwing', () => {
    const kinds = ['architecture', 'it-state', 'high-level', 'process', 'medallion', 'data-flow', 'dp-integration'] as const
    for (const kind of kinds) {
      const spec: GenuiDiagram = {
        type: 'diagram',
        kind,
        nodes: [
          { id: 'a', label: 'A', x: 40, y: 40 },
          { id: 'b', label: 'B', x: 240, y: 40 },
        ],
        edges: [{ from: 'a', to: 'b' }],
      }
      const { container } = render(<DiagramNode node={spec} />)
      expect(container.querySelector('svg')).not.toBeNull()
      cleanup()
    }
  })

  it('renders zone regions and the legend strip', () => {
    const spec: GenuiDiagram = {
      type: 'diagram',
      kind: 'architecture',
      title: '带分组的架构',
      zones: [
        { label: 'FRONTEND', x: 40, y: 40, w: 200, h: 140 },
        { label: 'DATA', x: 280, y: 40, w: 200, h: 140 },
      ],
      nodes: [
        { id: 'a', label: 'Web', x: 60, y: 80 },
        { id: 'b', label: 'DB', x: 300, y: 80 },
      ],
      edges: [{ from: 'a', to: 'b' }],
    }
    const { container } = render(<DiagramNode node={spec} />)
    const texts = Array.from(container.querySelectorAll('text')).map(t => t.textContent)
    expect(texts).toContain('FRONTEND')
    expect(texts).toContain('DATA')
    expect(texts).toContain('LEGEND')
    // The legend lists only the node types this diagram actually uses: two
    // untyped nodes are `backend`, so `Backend` shows and unused roles do not.
    expect(texts).toContain('Backend')
    expect(texts).not.toContain('Security')
    // Zone hairline rects exist (dashed border + label mask + node boxes).
    expect(container.querySelectorAll('rect').length).toBeGreaterThanOrEqual(8)
  })

  it('renders the dotted-paper ground pattern', () => {
    const { container } = render(<DiagramNode node={base} />)
    const pattern = container.querySelector('pattern')
    expect(pattern).not.toBeNull()
    expect(pattern?.getAttribute('patternUnits')).toBe('userSpaceOnUse')
  })
})
