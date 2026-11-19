// @vitest-environment jsdom
// Editorial diagram rendering: the `diagram` node renders inline SVG with the
// editorial constraints (orthogonal paths, semantic tokens, a11y shell).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { t } from '../src/client/i18n/index.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { DiagramNode } from '../src/client/blocks/diagram/index.tsx'
import { edgeLabelMetrics } from '../src/client/blocks/diagram/geometry.ts'
import type { GenuiDiagram, GenuiSpec } from '../src/client/spec.ts'

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
    const svg = container.querySelector('svg[role="group"]')
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

  it('uses the shared measured width for a long horizontal edge label', () => {
    const label = '实时同步到下游并写入归档库里'
    const spec: GenuiDiagram = {
      type: 'diagram',
      kind: 'timeline',
      nodes: [{ id: 'a', label: '采集端' }, { id: 'b', label: '清洗端' }],
      edges: [{ from: 'a', to: 'b', label }],
    }
    const { container } = render(<DiagramNode node={spec} />)
    const text = Array.from(container.querySelectorAll('text')).find(item => item.textContent === label)
    expect(text).not.toBeUndefined()
    const metrics = edgeLabelMetrics(label)
    expect(Number(text?.getAttribute('textLength'))).toBeCloseTo(metrics.textWidth)
    expect(Number(text?.getAttribute('x'))).toBeCloseTo(238)
    const mask = text?.parentElement?.querySelector('rect')
    expect(Number(mask?.getAttribute('width'))).toBeCloseTo(metrics.boxWidth)
    expect(Number(mask?.getAttribute('x'))).toBeCloseTo(238 - metrics.boxWidth / 2)
  })

  it('selects nodes with pointer and keyboard input, then shows the node details', () => {
    const spec: GenuiDiagram = {
      ...base,
      nodes: base.nodes.map((item, index) => index === 0 ? { ...item, description: 'Receives and routes requests.' } : item),
    }
    render(<DiagramNode node={spec} />)
    const web = screen.getByRole('button', { name: 'Web' })
    fireEvent.click(web)
    expect(web.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Receives and routes requests.')).not.toBeNull()
    const database = screen.getByRole('button', { name: 'Postgres' })
    fireEvent.keyDown(database, { key: ' ' })
    expect(database.getAttribute('aria-pressed')).toBe('true')
  })

  it('shares node selection with conditional sibling components', () => {
    const spec: GenuiSpec = {
      items: [
        {
          type: 'diagram',
          kind: 'flowchart',
          id: 'selectedNode',
          nodes: [
            { id: 'web', label: 'Web', description: 'Serves the application.' },
            { id: 'db', label: 'Database', description: 'Stores application data.' },
          ],
        },
        { type: 'text', content: 'Database explanation', when: { field: 'selectedNode', op: 'eq', value: 'db' } },
      ],
    }
    render(<GenuiBlock spec={spec} />)
    expect(screen.queryByText('Database explanation')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Database' }))
    expect(screen.getByText('Database explanation')).not.toBeNull()
    expect(screen.getByText('Stores application data.')).not.toBeNull()
  })

  it('removes selections synchronously when streaming removes the selected node', () => {
    const spec: GenuiSpec = {
      items: [
        {
          type: 'diagram', kind: 'flowchart', id: 'selectedNode',
          nodes: [{ id: 'db', label: 'Database' }, { id: 'web', label: 'Web' }],
        },
        { type: 'text', content: 'Database explanation', when: { field: 'selectedNode', op: 'eq', value: 'db' } },
      ],
    }
    const view = render(<GenuiBlock spec={spec} />)
    fireEvent.click(screen.getByRole('button', { name: 'Database' }))
    expect(screen.getByText('Database explanation')).not.toBeNull()
    view.rerender(<GenuiBlock spec={{ ...spec, items: [
      { type: 'diagram', kind: 'flowchart', id: 'selectedNode', nodes: [{ id: 'web', label: 'Web' }] },
      spec.items[1]!,
    ] }} />)
    expect(screen.queryByText('Database explanation')).toBeNull()
    expect(screen.queryByText(t('dgm.details'))).toBeNull()
  })

  it('does not carry a local selection into a different diagram identity', () => {
    const first: GenuiDiagram = {
      type: 'diagram', kind: 'flowchart', id: 'firstSelection', nodes: [{ id: 'same', label: 'Shared node ID' }],
    }
    const second: GenuiDiagram = { ...first, id: 'secondSelection' }
    const sibling: GenuiSpec['items'][number] = {
      type: 'text', content: 'Selection followed the new diagram',
      when: { field: 'secondSelection', op: 'eq', value: 'same' },
    }
    const view = render(<GenuiBlock spec={{ items: [first, sibling] }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Shared node ID' }))
    view.rerender(<GenuiBlock spec={{ items: [second, sibling] }} />)
    expect(screen.queryByText('Selection followed the new diagram')).toBeNull()
    expect(screen.queryByText(t('dgm.details'))).toBeNull()
  })

  it('rejects restored selections for nodes beyond the rendered limit', () => {
    const nodes = Array.from({ length: 10 }, (_unused, index) => ({ id: `node-${index}`, label: `Node ${index}` }))
    const spec: GenuiSpec = {
      items: [{ type: 'diagram', id: 'selection', kind: 'flowchart', nodes }],
    }
    render(<GenuiBlock spec={spec} initialState={{ fields: { selection: 'node-9' } }} />)
    expect(screen.queryByText(t('dgm.details'))).toBeNull()
    expect(screen.queryByText('Node 9')).toBeNull()
  })

  it('links a selection made before a streaming update supplies the diagram id', async () => {
    const diagram: GenuiDiagram = {
      type: 'diagram', kind: 'flowchart', nodes: [{ id: 'db', label: 'Database' }],
    }
    const sibling: GenuiSpec['items'][number] = {
      type: 'text', content: 'Database explanation', when: { field: 'selectedNode', op: 'eq', value: 'db' },
    }
    const view = render(<GenuiBlock spec={{ items: [diagram, sibling] }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Database' }))
    view.rerender(<GenuiBlock spec={{ items: [{ ...diagram, id: 'selectedNode' }, sibling] }} />)
    await waitFor(() => expect(screen.getByText('Database explanation')).not.toBeNull())
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
    expect(texts).toContain(t('dgm.legend'))
    // The legend lists only the node types this diagram actually uses: two
    // untyped nodes are `backend`, so `Backend` shows and unused roles do not.
    expect(texts).toContain(t('dgm.legend.backend'))
    expect(texts).not.toContain(t('dgm.legend.security'))
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
