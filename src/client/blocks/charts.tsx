/**
 * Chart family: categorical palette, the sortable table, and the bars / line
 * / donut renderers. All local-first; no model round trips.
 * @module @omdsh-dev/dsh-genui/client/blocks/charts
 */
import { useState } from 'react'
import css from '../GenuiBlock.module.css'
import { GENUI_LIMITS } from '../guard.ts'
import type { GenuiChart, GenuiTable } from '../spec.ts'

export const CHART_COLORS = [
  'var(--dsw-static-deepseek-400)',
  'var(--dsw-static-green-400)',
  'var(--dsw-static-amber-400)',
  'var(--dsw-static-red-400)',
  'var(--dsw-static-blue-450)',
  'var(--dsw-static-deepseek-450)',
  'var(--dsw-static-neutral-bluish-400)',
  'var(--dsw-static-deepseek-300)',
]

/** Series color: explicit color wins; multi-series auto-assign from the palette. */
const seriesColor = (i: number, n: number, c?: string): string | undefined =>
  c ?? (n > 1 ? CHART_COLORS[i % CHART_COLORS.length] : undefined)
export function TableNode({ node }: { node: GenuiTable }) {
  const columns = node.columns.slice(0, GENUI_LIMITS.maxTableCols)
  const rows = node.rows.slice(0, GENUI_LIMITS.maxTableRows)
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const sorted = sort === null
    ? rows
    : [...rows].sort((a, b) => {
      const av = a[sort.col]
      const bv = b[sort.col]
      const an = typeof av === 'number' ? av : av === '' ? NaN : Number(av)
      const bn = typeof bv === 'number' ? bv : bv === '' ? NaN : Number(bv)
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return (an - bn) * sort.dir
      const as = String(av ?? '')
      const bs = String(bv ?? '')
      return (as < bs ? -1 : as > bs ? 1 : 0) * sort.dir
    })
  const clickHeader = (i: number): void => {
    setSort(prev => prev !== null && prev.col === i
      ? prev.dir === 1 ? { col: i, dir: -1 } : null
      : { col: i, dir: 1 })
  }
  return (
    <div className={css.tableWrap}>
      <table className={css.table}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                aria-sort={sort !== null && sort.col === i ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
              >
                <button type="button" className={css.thSort} onClick={() => clickHeader(i)}>
                  {c}
                  {sort !== null && sort.col === i && <span className={css.thSortMark} aria-hidden>{sort.dir === 1 ? ' ▲' : ' ▼'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i}>{row.slice(0, columns.length).map((cell, j) => <td key={j}>{String(cell)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Chart: bars (default), line (trend), or donut (share); multi-series bars via `series`. */
export function ChartNode({ chart }: { chart: GenuiChart }) {
  const kind = chart.kind ?? 'bars'
  if (kind === 'donut') return <DonutNode chart={chart} />
  if (kind === 'line') return <LineChartNode chart={chart} />
  return <BarsNode chart={chart} />
}

/** Bars: one column per datum (grouped bars when `series` is present). */
export function BarsNode({ chart }: { chart: GenuiChart }) {
  const grouped = chart.series !== undefined ? chart.series.slice(0, GENUI_LIMITS.maxPlotSeries) : undefined
  if (grouped !== undefined && grouped.length > 0) {
    const labels = grouped[0]!.data.map(d => d.label)
    const max = Math.max(...grouped.flatMap(s => s.data.map(d => Number(d.value) || 0)), 1)
    return (
      <div className={css.chart}>
        <div className={css.chartPlot}>
          {[0, 25, 50, 75].map(p => (
            <span key={p} className={p === 0 ? css.baseline : css.gridline} style={{ bottom: `${p}%` }} />
          ))}
          {labels.map((_, i) => (
            <div key={i} className={css.barCol}>
              <div className={css.groupedBars}>
                {grouped.map((s, si) => {
                  const d = s.data[i]
                  // Cap at 82% so the per-bar value annotation stays inside
                  // the plot; negatives clamp to a zero-height bar.
                  const v = d === undefined ? 0 : Number(d.value) || 0
                  const h = d === undefined ? 0 : Math.min(Math.round((Math.max(0, v) / max) * 100), 82)
                  return (
                    <div key={si} className={css.groupedBar} title={d === undefined ? s.label : `${s.label}: ${String(d.value)}`}>
                      <span className={css.groupValue}>{d === undefined ? '' : String(d.value)}</span>
                      <div
                        className={css.groupedFill}
                        style={{
                          height: `${h}%`,
                          background: seriesColor(si, grouped.length, s.color) ?? 'var(--dsw-alias-state-business-primary, #4f8ef7)',
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div className={css.chartLabels}>
          {labels.map(label => <span key={label} className={css.barLabel}>{label}</span>)}
        </div>
      </div>
    )
  }
  const data = chart.data.slice(0, GENUI_LIMITS.maxChartPoints)
  // Negative values clamp to a zero-height bar (the value annotation still
  // shows the real number) — a negative `height` percentage is invalid CSS
  // and used to collapse the bar entirely.
  const max = Math.max(...data.map(d => Number(d.value) || 0), 1)
  return (
    <div className={css.chart}>
      <div className={css.chartPlot}>
        {[0, 25, 50, 75].map(p => (
          <span key={p} className={p === 0 ? css.baseline : css.gridline} style={{ bottom: `${p}%` }} />
        ))}
        {data.map((d, i) => {
          // Cap at 85% so the value annotation always stays inside the plot.
          const v = Number(d.value) || 0
          const h = Math.min(Math.round((Math.max(0, v) / max) * 100), 85)
          return (
            <div key={i} className={css.barCol} title={`${d.label}: ${String(d.value)}`}>
              <span className={css.barValue}>{String(d.value)}</span>
              <div className={css.barFill} style={{ height: `${h}%`, ...(d.color !== undefined ? { background: d.color } : {}) }} />
            </div>
          )
        })}
      </div>
      <div className={css.chartLabels}>
        {data.map(d => <span key={d.label} className={css.barLabel}>{d.label}</span>)}
      </div>
    </div>
  )
}

/** Line: polyline over a fixed-height plot area with a readable Y axis —
 * four evenly spaced gridlines + tick labels (design system v2 skeleton). */
export function LineChartNode({ chart }: { chart: GenuiChart }) {
  const data = chart.data.slice(0, GENUI_LIMITS.maxChartPoints)
  const W = 460
  const H = 150
  const padL = 36
  const padR = 8
  const padT = 10
  const padB = 6
  const max = Math.max(...data.map(d => Number(d.value) || 0), 1)
  const min = Math.min(...data.map(d => Number(d.value) || 0), 0)
  const span = max - min || 1
  const n = Math.max(data.length - 1, 1)
  const pt = (i: number, v: number): [number, number] => [
    padL + (i / n) * (W - padL - padR),
    padT + (1 - (v - min) / span) * (H - padT - padB),
  ]
  const d = data.map((datum, i) => pt(i, Number(datum.value) || 0))
  const path = d.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const ticks = [0, 1, 2, 3].map(i => min + (span * i) / 3)
  const formatTick = (t: number): string => {
    const abs = Math.abs(t)
    if (abs >= 1000) return `${(t / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`
    if (Number.isInteger(t)) return String(t)
    return t.toFixed(1)
  }
  return (
    <div className={css.lineChart}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
        {ticks.map((t, i) => {
          const y = padT + (1 - (t - min) / span) * (H - padT - padB)
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} className={i === 0 ? css.lineGridAxis : css.lineGrid} />
              <text x={padL - 6} y={y + 3} textAnchor="end" className={css.lineTick}>{formatTick(t)}</text>
            </g>
          )
        })}
        {data.map((datum, i) => {
          const [x, y] = pt(i, Number(datum.value) || 0)
          return (
            <circle key={i} cx={x} cy={y} r={3} className={css.lineDot} fill={datum.color ?? undefined}>
              <title>{`${datum.label}: ${String(datum.value)}`}</title>
            </circle>
          )
        })}
        <path d={path} className={css.linePath} />
      </svg>
      <div className={css.lineLabels}>
        {data.map((d, i) => <span key={i} className={css.barLabel}>{d.label}</span>)}
      </div>
    </div>
  )
}

/** Donut: share of total with a center total. Negative values contribute
 * zero arc (a negative dasharray segment used to produce an invalid
 * stroke-dasharray and the browser drew the FULL circle instead). */
export function DonutNode({ chart }: { chart: GenuiChart }) {
  const data = chart.data.slice(0, GENUI_LIMITS.maxChartPoints)
  const clamped = data.map(d => ({ ...d, v: Math.max(0, Number(d.value) || 0) }))
  const total = clamped.reduce((s, d) => s + d.v, 0) || 1
  const R = 42
  const C = 2 * Math.PI * R
  let offset = 0
  return (
    <div className={css.donut}>
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="14" className={css.donutTrack} />
        {clamped.map((d, i) => {
          const frac = d.v / total
          const len = frac * C
          const el = (
            <circle
              key={i}
              cx="60" cy="60" r={R} fill="none" strokeWidth="14"
              style={{ stroke: seriesColor(i, data.length, d.color) ?? 'var(--dsw-alias-state-business-primary, #4f8ef7)' }}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            >
              <title>{`${d.label}: ${String(d.value)}`}</title>
            </circle>
          )
          offset += len
          return el
        })}
        <text x="60" y="58" textAnchor="middle" className={css.donutTotal}>{total >= 1000 ? `${Math.round(total / 100) / 10}k` : String(total)}</text>
        <text x="60" y="74" textAnchor="middle" className={css.donutTotalLabel}>合计</text>
      </svg>
      <div className={css.donutLegend}>
        {data.map((d, i) => (
          <span key={i} className={css.legendItem}>
            <span className={css.legendSwatch} style={{ background: seriesColor(i, data.length, d.color) ?? 'var(--dsw-alias-state-business-primary, #4f8ef7)' }} />
            {d.label} · {String(d.value)}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Tab strip with local active-tab state. Keyboard: ArrowLeft/Right to move,
 * Home/End to jump; ids wired via useId so `aria-controls` stays unique
 * across fences and sessions. */
