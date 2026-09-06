/**
 * Editorial diagram renderer: `diagram` node → inline SVG. The browser-side
 * port of the diagram-design editorial design system — semantic tokens,
 * dotted-paper ground, orthogonal connectors, 4px grid, complexity budget,
 * zone grouping, legend strip — as a white-listed dsh-genui component.
 *
 * Layout is resolved by `resolveLayout`, routing by `routeEdge`, and every
 * value is sanitized by the guard before this component ever sees it.
 * @module @changfenhuang/dsh-genui/client/blocks/diagram
 */
import { useMemo } from 'react'
import type { GenuiDiagram } from '../../spec.ts'
import { GENUI_LIMITS } from '../../genui-runtime/index.ts'
import { resolveLayout } from './layout.ts'
import { routeEdge, labelGeometry, type Box } from './geometry.ts'
import { resolvePalette, nodeTreatment, edgeStroke, inkAt } from './theme.ts'

const FONT_SANS = "'Geist', -apple-system, 'Segoe UI', sans-serif"
const FONT_MONO = "'Geist Mono', ui-monospace, 'SF Mono', monospace"

/** Editorial constants (diagram-design §5–7). */
const NODE_H = 64 // node box height (48→64 for the editorial ramp)
const LEGEND_H = 56

/**
 * Compute a deterministic parent map for tree-like kinds: the first edge
 * into each node is its parent (a stable convention the model can rely on).
 */
function buildParentMap(edges: Array<{ from: string; to: string }>): (id: string) => string | undefined {
  const parents = new Map<string, string>()
  for (const e of edges) {
    if (!parents.has(e.to)) parents.set(e.to, e.from)
  }
  return id => parents.get(id)
}

/** Render one node box + its text content (tag / name / sublabel / index). */
function renderNodeBox(
  box: Box,
  label: string,
  sub: string | undefined,
  type: string | undefined,
  tag: string | undefined,
  index: number,
  palette: ReturnType<typeof resolvePalette>,
): React.ReactNode {
  const treatment = nodeTreatment(type, palette)
  const cx = box.x + box.w / 2
  // Editorial 64px ramp: name centered, sublabel below, tag top-left, index bottom-right.
  const nameY = box.y + (box.h - NODE_H) / 2 + 28
  const subY = box.y + (box.h - NODE_H) / 2 + 44
  const tagW = Math.min(44, Math.max(24, (tag ?? '').length * 7 + 8))
  return (
    <g>
      {/* opaque paper mask: arrows must not bleed through transparent fills */}
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={6} fill={palette.paper} />
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={6}
        fill={treatment.fill}
        stroke={treatment.stroke}
        strokeWidth={1}
        strokeDasharray={treatment.dashed === true ? '5,4' : undefined}
      />
      {tag !== undefined && (
        <>
          <rect x={box.x + 8} y={box.y + 6} width={tagW} height={12} rx={2} fill="transparent" stroke={inkAt(treatment.stroke, 0.4)} strokeWidth={0.8} />
          <text x={box.x + 8 + tagW / 2} y={box.y + 15} fill={inkAt(treatment.stroke, 0.8)} fontSize={7} fontFamily={FONT_MONO} textAnchor="middle" letterSpacing={0.8}>{tag}</text>
        </>
      )}
      {/* Index number: bottom-right, half-transparent, editorial big numeral */}
      <text x={box.x + box.w - 6} y={box.y + box.h - 6} fill={inkAt(treatment.stroke, 0.12)} fontSize={24} fontWeight={600} fontFamily={FONT_MONO} textAnchor="end">{String(index).padStart(2, '0')}</text>
      <text x={cx} y={nameY} fill={palette.ink} fontSize={12} fontWeight={600} fontFamily={FONT_SANS} textAnchor="middle">{label}</text>
      {sub !== undefined && (
        <text x={cx} y={subY} fill={palette.soft} fontSize={9} fontFamily={FONT_MONO} textAnchor="middle">{sub}</text>
      )}
    </g>
  )
}

/** Render one routed edge: path, optional label mask + text. */
function renderEdge(edge: { from: Box; to: Box; label?: string | undefined; kind?: string | undefined }, key: number, palette: ReturnType<typeof resolvePalette>, markerId: string): React.ReactNode {
  const routed = routeEdge(edge.from, edge.to)
  const stroke = edgeStroke(edge.kind, palette)
  const dashed = edge.kind === 'dashed'
  // Accent arrows are the focal signal: slightly heavier stroke (1.4).
  const width = edge.kind === 'accent' ? 1.4 : 1.2
  const lg = labelGeometry(routed.a, routed.b)
  return (
    <g key={key}>
      <path
        d={routed.d}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={dashed ? '5,4' : undefined}
        markerEnd={`url(#${markerId})`}
      />
      {edge.label !== undefined && (
        <g>
          <rect
            x={lg.cx - (edge.label.length * 5 + 8) / 2}
            y={lg.maskY}
            width={edge.label.length * 5 + 8}
            height={12}
            rx={2}
            fill={palette.paper}
          />
          <text x={lg.cx} y={lg.maskY + 9} fill={palette.soft} fontSize={8} fontFamily={FONT_MONO} textAnchor="middle" letterSpacing={0.5}>{edge.label}</text>
        </g>
      )}
    </g>
  )
}

/** Arrow marker defs (default / accent / link), per-diagram unique ids. */
function renderMarkers(uid: string, palette: ReturnType<typeof resolvePalette>): React.ReactNode {
  return (
    <defs>
      <marker id={`${uid}-arrow`} markerWidth={8} markerHeight={6} refX={7} refY={3} orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill={palette.muted} />
      </marker>
      <marker id={`${uid}-arrow-accent`} markerWidth={8} markerHeight={6} refX={7} refY={3} orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill={palette.accent} />
      </marker>
      <marker id={`${uid}-arrow-link`} markerWidth={8} markerHeight={6} refX={7} refY={3} orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill={palette.link} />
      </marker>
    </defs>
  )
}

/** Dotted-paper ground: the editorial backdrop behind every diagram. */
function renderGround(uid: string, palette: ReturnType<typeof resolvePalette>): React.ReactNode {
  return (
    <>
      <defs>
        <pattern id={`${uid}-dots`} width={22} height={22} patternUnits="userSpaceOnUse">
          <circle cx={1} cy={1} r={0.9} fill={inkAt(palette.ink, 0.10)} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={palette.paper} />
      <rect width="100%" height="100%" fill={`url(#${uid}-dots)`} opacity={0.55} />
    </>
  )
}

/** Zone container: hairline dashed rect + mono uppercase eyebrow label. */
function renderZone(z: { label: string; x: number; y: number; w: number; h: number }, palette: ReturnType<typeof resolvePalette>): React.ReactNode {
  const labelW = z.label.length * 7 + 12
  const cx = z.x + z.w / 2
  return (
    <g>
      <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={8} fill={inkAt(palette.ink, 0.02)} stroke={inkAt(palette.ink, 0.10)} strokeWidth={0.8} />
      <rect x={cx - labelW / 2} y={z.y + 4} width={labelW} height={12} rx={2} fill={palette.paper} />
      <text x={cx} y={z.y + 13} fill={inkAt(palette.ink, 0.40)} fontSize={7} fontFamily={FONT_MONO} textAnchor="middle" letterSpacing={1.2}>{z.label}</text>
    </g>
  )
}

/** Legend strip at the bottom: hairline separator + treatment swatches. */
function renderLegend(palette: ReturnType<typeof resolvePalette>): React.ReactNode {
  const items: Array<{ label: string; type: string | undefined }> = [
    { label: 'Focal', type: 'focal' },
    { label: 'Backend', type: 'backend' },
    { label: 'Store', type: 'store' },
    { label: 'External', type: 'external' },
    { label: 'Optional', type: 'optional' },
    { label: 'Security', type: 'security' },
  ]
  return (
    <g>
      <line x1={40} y1={0} x2={1000} y2={0} stroke={inkAt(palette.ink, 0.10)} strokeWidth={0.8} />
      <text x={40} y={16} fill={palette.soft} fontSize={8} fontFamily={FONT_MONO} letterSpacing={1.6}>LEGEND</text>
      {items.map((item, i) => {
        const t = nodeTreatment(item.type, palette)
        const x = 40 + i * 170
        return (
          <g key={item.label}>
            <rect x={x} y={32} width={14} height={10} rx={2} fill={t.fill} stroke={t.stroke} strokeWidth={1} strokeDasharray={t.dashed === true ? '3,2' : undefined} />
            <text x={x + 20} y={41} fill={palette.soft} fontSize={8.5} fontFamily={FONT_SANS}>{item.label}</text>
          </g>
        )
      })}
    </g>
  )
}

function markerFor(kind: string | undefined, uid: string): string {
  if (kind === 'accent') return `${uid}-arrow-accent`
  if (kind === 'link') return `${uid}-arrow-link`
  return `${uid}-arrow`
}

/** Stable per-render uid (avoid id collisions across diagrams on one page). */
let uidCounter = 0
function nextUid(): string {
  uidCounter += 1
  return `genui-diagram-${uidCounter}`
}

/** The `diagram` node renderer. */
export function DiagramNode({ node }: { node: GenuiDiagram }) {
  const uid = useMemo(nextUid, [])
  const palette = useMemo(() => resolvePalette(node.variant, node.theme), [node.variant, node.theme])
  const layout = useMemo(() => resolveLayout(node, buildParentMap(node.edges ?? [])), [node])

  const byId = useMemo(() => new Map(layout.nodes.map(l => [l.node.id, l.box])), [layout])
  // figcaption gets its own id so aria-labelledby can point at the SVG <title>
  // alone — sharing one id between the two renders duplicates ids in the DOM.
  const titleId = `${uid}-title`
  const captionId = `${uid}-caption`
  const descId = `${uid}-desc`

  // Complexity budget is enforced by the guard; belt-and-suspenders here.
  const nodes = layout.nodes.slice(0, GENUI_LIMITS.maxDiagramNodes)
  const edges = layout.edges.slice(0, GENUI_LIMITS.maxDiagramEdges)
  const zones = (node.zones ?? []).slice(0, GENUI_LIMITS.maxDiagramZones)

  // Focal budget: accent on 1–2 nodes max; extra focal nodes downgrade to backend.
  let focalSeen = 0
  const focalBudget = GENUI_LIMITS.maxDiagramFocal

  // Canvas: content bounds + editorial chrome (bottom legend strip).
  const contentH = layout.height
  const canvasH = contentH + LEGEND_H + 24

  return (
    <figure className="genui-diagram" data-genui-diagram>
      {node.title !== undefined && (
        <figcaption id={captionId} style={{ fontFamily: "Instrument Serif, 'Times New Roman', serif", fontSize: 20, marginBottom: 8, color: palette.ink }}>
          {node.title}
        </figcaption>
      )}
      <svg
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descId}
        viewBox={`0 0 ${layout.width} ${canvasH}`}
        style={{ maxWidth: '100%', height: 'auto', background: palette.paper }}
      >
        <title id={titleId}>{node.title ?? node.kind}</title>
        <desc id={descId}>{`${node.kind} diagram with ${nodes.length} nodes and ${edges.length} connectors`}</desc>
        {renderMarkers(uid, palette)}
        {renderGround(uid, palette)}
        {/* zones drawn before arrows and nodes */}
        <g>
          {zones.map((z, i) => (
            <g key={`zone-${i}`}>
              {renderZone({ label: z.label, x: z.x ?? 0, y: z.y ?? 0, w: z.w ?? 100, h: z.h ?? 100 }, palette)}
            </g>
          ))}
        </g>
        <g>
          {edges.map((e, i) => {
            const from = byId.get(e.fromId)
            const to = byId.get(e.toId)
            if (from === undefined || to === undefined) return null
            return renderEdge({ from, to, label: e.edge.label, kind: e.edge.kind }, i, palette, markerFor(e.edge.kind, uid))
          })}
        </g>
        {/* nodes after edges */}
        <g>
          {nodes.map((l, idx) => {
            const effectiveType = l.node.type === 'focal' && focalSeen >= focalBudget ? undefined : l.node.type
            if (l.node.type === 'focal') focalSeen += 1
            return (
              <g key={l.node.id}>
                {renderNodeBox(l.box, l.node.label, l.node.sub, effectiveType, l.node.tag, idx + 1, palette)}
              </g>
            )
          })}
        </g>
        {/* legend strip */}
        <g transform={`translate(0, ${contentH + 8})`}>
          {renderLegend(palette)}
        </g>
      </svg>
    </figure>
  )
}
