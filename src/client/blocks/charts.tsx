/**
 * Chart family: categorical palette, the sortable table, and the bars / line
 * / donut renderers. All local-first; no model round trips.
 *
 * Design system v3: the native charts draw in REAL CSS pixels — the plot width
 * is measured from the container and the SVG viewBox matches it 1:1 — instead
 * of a fixed 460×150 viewBox whose axis text scaled with the container (wide
 * screens got oversized labels, narrow ones got unreadable ones). Every chart
 * gets a y-axis with nice 1/2/5 ticks, and single-series bars render against a
 * true zero line so negative values are drawn, not clamped away.
 * @module @changfenhuang/dsh-genui/client/blocks/charts
 */
import { memo, useId, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
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

/**
 * Sortable numeric value of a cell. Human-written table cells are rarely
 * plain numbers, so the sort accepts the usual decorations:
 * `1,234` / `1，234`（千分位）、`1.2k`/`3M`/`5b`、`3.5万`/`2亿`、`0.3%`、
 * `¥99`/`$12`。A cell that cannot be read as a number returns NaN and the
 * row falls back to the text comparison — mixed columns sort deterministically
 * (numbers first, then text).
 */
export function parseSortableNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  if (typeof v !== 'string') return NaN
  let s = v.trim()
  if (s === '') return NaN
  s = s.replace(/^[¥$€£]/, '')
  const pct = s.endsWith('%')
  if (pct) s = s.slice(0, -1)
  // 中文单位在前：3.5万 → 35000、2亿 → 200000000；再是 k/m/b 后缀。
  let mult = 1
  if (s.endsWith('万')) { mult = 10_000; s = s.slice(0, -1) }
  else if (s.endsWith('亿')) { mult = 100_000_000; s = s.slice(0, -1) }
  else if (/[kmb]$/i.test(s)) {
    const unit = s.slice(-1).toLowerCase()
    mult = unit === 'k' ? 1e3 : unit === 'm' ? 1e6 : 1e9
    s = s.slice(0, -1)
  }
  s = s.replace(/[,，\s]/g, '')
  const n = Number(s)
  if (!Number.isFinite(n)) return NaN
  return n * mult
}

/** A column is numeric when every non-empty cell parses to a finite number —
 * those columns right-align with tabular numerals (the table's data voice). */
function numericColumns(rows: GenuiTable['rows'], nCols: number): boolean[] {
  return Array.from({ length: nCols }, (_, j) => {
    let any = false
    for (const row of rows) {
      const cell = row[j]
      if (cell === undefined || cell === null || cell === '') continue
      if (!Number.isFinite(parseSortableNumber(cell))) return false
      any = true
    }
    return any
  })
}

/** Signed cell text (`+12.4%`, `-3`, `−2.1k`) reads as a delta without any
 *  new spec field — the renderer classifies the string. */
function deltaTone(value: unknown): 'up' | 'down' | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!/^[+][\s]*[\d.]/.test(s) && !/^[-−][\s]*[\d.]/.test(s)) return null
  return s.startsWith('+') ? 'up' : 'down'
}

/** `types: ["bar"]` cell: an inline 0-100 track with the value printed on it. */
function CellBar({ cell }: { cell: string | number }) {
  const n = parseSortableNumber(cell)
  const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
  return (
    <span className={css.cellBar}>
      <span className={css.cellBarFill} style={{ width: `${pct}%` }} />
      <span className={css.cellBarText}>{String(cell)}</span>
    </span>
  )
}

export const TableNode = memo(function TableNode({ node }: { node: GenuiTable }) {
  const columns = node.columns.slice(0, GENUI_LIMITS.maxTableCols)
  const rows = node.rows.slice(0, GENUI_LIMITS.maxTableRows)
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const sorted = sort === null
    ? rows
    : [...rows].sort((a, b) => {
      const an = parseSortableNumber(a[sort.col])
      const bn = parseSortableNumber(b[sort.col])
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return (an - bn) * sort.dir
      if (Number.isFinite(an) !== Number.isFinite(bn)) return Number.isFinite(an) ? -sort.dir : sort.dir
      const as = String(a[sort.col] ?? '')
      const bs = String(b[sort.col] ?? '')
      return (as < bs ? -1 : as > bs ? 1 : 0) * sort.dir
    })
  const clickHeader = (i: number): void => {
    setSort(prev => prev !== null && prev.col === i
      ? prev.dir === 1 ? { col: i, dir: -1 } : null
      : { col: i, dir: 1 })
  }
  const numeric = numericColumns(rows, columns.length)
  const types = node.types ?? []
  return (
    <div className={css.tableWrap}>
      <table className={css.table}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                className={numeric[i] ? css.thNum : undefined}
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
            <tr key={i}>{row.slice(0, columns.length).map((cell, j) => {
              const type = types[j]
              const tone = type === 'delta'
                ? (String(cell).trim().startsWith('-') ? 'down' : 'up')
                : deltaTone(cell)
              return (
                <td key={j} className={numeric[j] || type === 'num' ? css.tdNum : undefined}>
                  {type === 'badge'
                    ? <span className={css.cellBadge}>{String(cell)}</span>
                    : type === 'bar'
                      ? <CellBar cell={cell} />
                      : tone === null
                        ? String(cell)
                        : <span className={`${css.tdDelta} ${tone === 'up' ? css.tdDeltaUp : css.tdDeltaDown}`}>{String(cell)}</span>}
                </td>
              )
            })}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})

/** Measured plot width. Charts draw in CSS pixels: 1 SVG unit = 1px, so axis
 *  text keeps its designed size at every container width. */
function useMeasuredWidth(): [RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const measure = (): void => {
      const next = el.clientWidth
      if (next > 0) setWidth(next)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/** Axis ticks on 1/2/5×10^n steps covering [min, max] inclusively. */
function niceTicks(min: number, max: number, target = 4): number[] {
  const lo = Math.min(min, 0)
  const hi = Math.max(max, 0)
  if (lo === hi) return [0, 1]
  const raw = (hi - lo) / Math.max(target, 1)
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(raw, Number.MIN_VALUE))))
  const normalized = raw / magnitude
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
  const start = Math.floor(lo / step) * step
  const end = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let t = start; t <= end + step / 2; t += step) ticks.push(Math.abs(t) < step / 1e6 ? 0 : t)
  return ticks
}

/** Compact tick text: 1200 → 1.2k, 0.5 → 0.5, integers bare. */
function formatTick(t: number): string {
  const abs = Math.abs(t)
  if (abs >= 1e9) return `${(t / 1e9).toFixed(abs % 1e9 === 0 ? 0 : 1)}b`
  if (abs >= 1e6) return `${(t / 1e6).toFixed(abs % 1e6 === 0 ? 0 : 1)}m`
  if (abs >= 1000) return `${(t / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`
  if (Number.isInteger(t)) return String(t)
  return String(Math.round(t * 100) / 100)
}

/** Shared y-axis gutter: ticks positioned against the same percentage scale
 *  the plot uses, so labels line up with the gridlines. */
function YAxis({ ticks, lo, span }: { ticks: number[]; lo: number; span: number }) {
  return (
    <div className={css.chartYAxis} style={{ height: 160 }}>
      {ticks.map(t => (
        <span key={t} className={css.chartYTick} style={{ bottom: `${((t - lo) / span) * 100}%` }}>
          {formatTick(t)}
        </span>
      ))}
    </div>
  )
}

/** Chart: bars (default), line (trend), or donut (share); multi-series bars via `series`. */
export const ChartNode = memo(function ChartNode({ chart }: { chart: GenuiChart }) {
  const kind = chart.kind ?? 'bars'
  if (kind === 'donut') return <DonutNode chart={chart} />
  if (kind === 'line') return <LineChartNode chart={chart} />
  return <BarsNode chart={chart} />
})

/** Bars: one column per datum (grouped bars when `series` is present).
 *  Single-series bars render against a true zero line, so negative values
 *  draw downward instead of clamping to zero height. */
export const BarsNode = memo(function BarsNode({ chart }: { chart: GenuiChart }) {
  const grouped = chart.series !== undefined ? chart.series.slice(0, GENUI_LIMITS.maxPlotSeries) : undefined
  const isGrouped = grouped !== undefined && grouped.length > 0
  const data = chart.data.slice(0, GENUI_LIMITS.maxChartPoints)
  const labels = isGrouped ? grouped[0]!.data.map(d => d.label) : data.map(d => d.label)
  const seriesValues = isGrouped
    ? grouped.map(s => s.data.map(d => Number(d.value) || 0))
    : [data.map(d => Number(d.value) || 0)]
  const colors = seriesValues.map((_values, si) =>
    seriesColor(si, seriesValues.length, isGrouped ? grouped[si]?.color : undefined) ?? 'var(--dsw-alias-state-business-primary, #4f8ef7)')
  const flat = seriesValues.flat()
  const showValues = labels.length <= 12

  // Horizontal: label column + one track per series. The axis is always
  // 0..max (a horizontal track has no zero line to cross).
  if (chart.horizontal === true) {
    const scale = Math.max(Math.max(...flat, 0), 1)
    const legend = isGrouped
      ? (
        <div className={css.chartLegend}>
          {grouped.map((entry, si) => (
            <span key={si} className={css.legendItem}>
              <span className={css.legendSwatch} style={{ background: colors[si] }} />
              {entry.label}
            </span>
          ))}
        </div>
      )
      : null
    return (
      <div className={css.chart} data-genui-chart="bars" role="img" aria-label={`横向柱状图，${labels.length} 组`}>
        <div className={css.hbars}>
          {labels.map((label, i) => (
            <div key={i} className={css.hbarRow}>
              <span className={css.hbarLabel} title={label}>{label}</span>
              <div className={css.hbarTracks}>
                {seriesValues.map((values, si) => {
                  const v = values[i] ?? 0
                  const width = Math.max(0, Math.min(100, (Math.max(0, v) / scale) * 100))
                  const title = `${isGrouped ? `${grouped[si]!.label} · ` : ''}${label}: ${v}`
                  return (
                    <div key={si} className={css.hbarTrack} title={title}>
                      <div className={css.hbarFill} style={{ width: `${width}%`, background: colors[si] }} />
                    </div>
                  )
                })}
              </div>
              {showValues && (
                <span className={css.hbarValue}>
                  {isGrouped
                    ? seriesValues.reduce((sum, values) => sum + (values[i] ?? 0), 0)
                    : String(data[i]?.value ?? '')}
                </span>
              )}
            </div>
          ))}
        </div>
        {legend}
      </div>
    )
  }

  // Vertical: grouped bars clamp negatives (the flex layout stacks upward), so
  // the axis starts at zero for that shape; single-series bars render against
  // a true zero line and draw negatives downward.
  const ticks = niceTicks(isGrouped ? 0 : Math.min(...flat, 0), Math.max(...flat, 0), 4)
  const lo = ticks[0]!
  const hi = ticks[ticks.length - 1]!
  const span = hi - lo || 1
  const pct = (v: number): number => ((v - lo) / span) * 100
  const zero = pct(0)
  const summary = `柱状图，${labels.length} 组，最大 ${formatTick(Math.max(...flat, 0))}`
  return (
    <div className={css.chart} data-genui-chart="bars" role="img" aria-label={summary}>
      <div className={css.chartBody}>
        <YAxis ticks={ticks} lo={lo} span={span} />
        <div className={css.chartPlot}>
          {ticks.map(t => (
            <span key={t} className={t === 0 ? css.baseline : css.gridline} style={{ bottom: `${pct(t)}%` }} />
          ))}
          {labels.map((label, i) => (
            <div key={i} className={css.barCol}>
              {isGrouped
                ? (
                  <div className={css.groupedBars}>
                    {grouped.map((entry, si) => {
                      const datum = entry.data[i]
                      const v = datum === undefined ? 0 : Number(datum.value) || 0
                      return (
                        <div key={si} className={css.groupedBar} title={datum === undefined ? entry.label : `${entry.label} · ${label}: ${String(datum.value)}`}>
                          {showValues && <span className={css.groupValue}>{datum === undefined ? '' : String(datum.value)}</span>}
                          <div
                            className={css.groupedFill}
                            style={{
                              height: `${Math.max(0, pct(Math.max(0, v)))}%`,
                              background: colors[si],
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                )
                : (() => {
                  const v = seriesValues[0]![i] ?? 0
                  const top = Math.max(pct(v), zero)
                  const bottom = Math.min(pct(v), zero)
                  return (
                    <>
                      {showValues && (
                        <span className={css.barValue} style={{ bottom: `calc(${top}% + 4px)` }}>{String(data[i]?.value ?? '')}</span>
                      )}
                      <div
                        className={css.barFill}
                        style={{
                          bottom: `${bottom}%`,
                          height: `${Math.max(top - bottom, 0.6)}%`,
                          ...(v < 0 ? { borderRadius: '0 0 5px 5px' } : {}),
                          ...(data[i]?.color !== undefined ? { background: data[i]!.color } : {}),
                        }}
                        title={`${label}: ${String(data[i]?.value ?? '')}`}
                      />
                    </>
                  )
                })()}
            </div>
          ))}
        </div>
      </div>
      <div className={css.chartLabels}>
        {labels.map((label, i) => <span key={`${label}-${i}`} className={css.barLabel}>{label}</span>)}
      </div>
      {isGrouped && (
        <div className={css.chartLegend}>
          {grouped.map((entry, si) => (
            <span key={si} className={css.legendItem}>
              <span className={css.legendSwatch} style={{ background: colors[si] }} />
              {entry.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
})

/** Line: responsive polyline with an area wash, nice y ticks and sampled x
 *  labels drawn in SVG at their real size. */
export const LineChartNode = memo(function LineChartNode({ chart }: { chart: GenuiChart }) {
  const [ref, measured] = useMeasuredWidth()
  const gradientId = `genui-line-${useId().replace(/:/g, '')}`
  const grouped = chart.series !== undefined && chart.series.length > 0
    ? chart.series.slice(0, GENUI_LIMITS.maxPlotSeries)
    : undefined
  const data = chart.data.slice(0, GENUI_LIMITS.maxChartPoints)
  const labels = grouped !== undefined ? grouped[0]!.data.map(d => d.label) : data.map(d => d.label)
  const seriesValues = grouped !== undefined
    ? grouped.map(entry => entry.data.map(d => Number(d.value) || 0))
    : [data.map(d => Number(d.value) || 0)]
  const colors = seriesValues.map((_values, si) =>
    seriesColor(si, seriesValues.length, grouped !== undefined ? grouped[si]?.color : undefined) ?? 'var(--dsl-g-accent)')
  const multi = seriesValues.length > 1
  const flat = seriesValues.flat()
  const pointCount = Math.max(...seriesValues.map(values => values.length), 0)
  const W = Math.max(measured, 260)
  const H = 176
  const padL = 44
  const padR = 12
  const padT = 14
  const padB = 26
  const ticks = niceTicks(Math.min(...flat, 0), Math.max(...flat, 0), 4)
  const lo = ticks[0]!
  const hi = ticks[ticks.length - 1]!
  const span = hi - lo || 1
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const x = (i: number): number => padL + (pointCount <= 1 ? innerW / 2 : (i / (pointCount - 1)) * innerW)
  const y = (v: number): number => padT + (1 - (v - lo) / span) * innerH
  const paths = seriesValues.map(values =>
    values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' '))
  const area = !multi && pointCount > 1
    ? `${paths[0]} L ${x(pointCount - 1).toFixed(1)} ${y(lo).toFixed(1)} L ${x(0).toFixed(1)} ${y(lo).toFixed(1)} Z`
    : null
  // Keep x labels readable: at most one per ~64px of plot width.
  const labelStep = Math.max(1, Math.ceil(pointCount / Math.max(1, Math.floor(innerW / 64))))
  const summary = `折线图，${multi ? `${seriesValues.length} 条序列` : `${pointCount} 个点`}，范围 ${formatTick(Math.min(...flat, 0))} 到 ${formatTick(Math.max(...flat, 0))}`
  return (
    <div className={css.lineChart} data-genui-chart="line" ref={ref} role="img" aria-label={summary}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--dsl-g-accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--dsl-g-accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => {
          const ty = y(t)
          return (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={ty} y2={ty} className={i === 0 ? css.lineGridAxis : css.lineGrid} />
              <text x={padL - 8} y={ty + 4} textAnchor="end" className={css.lineTick}>{formatTick(t)}</text>
            </g>
          )
        })}
        {area !== null && <path d={area} fill={`url(#${gradientId})`} />}
        {paths.map((d, si) => <path key={si} d={d} className={css.linePath} style={{ stroke: colors[si] }} />)}
        {seriesValues.map((values, si) => values.map((v, i) => (
          <circle key={`${si}-${i}`} cx={x(i)} cy={y(v)} r={3.5} className={css.lineDot} style={{ fill: colors[si] }}>
            <title>{`${multi ? `${grouped![si]!.label} · ` : ''}${labels[i] ?? ''}: ${String(v)}`}</title>
          </circle>
        )))}
        {labels.map((label, i) => (
          i % labelStep === 0
            ? <text key={`l-${i}`} x={x(i)} y={H - 8} textAnchor="middle" className={css.lineLabel}>{label}</text>
            : null
        ))}
      </svg>
      {multi && (
        <div className={css.chartLegend}>
          {grouped!.map((entry, si) => (
            <span key={si} className={css.legendItem}>
              <span className={css.legendSwatch} style={{ background: colors[si] }} />
              {entry.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
})

/** Donut: share of total with a center total and a legend that shows each
 *  slice's value AND percentage (the old legend was unstyled text). */
export const DonutNode = memo(function DonutNode({ chart }: { chart: GenuiChart }) {
  const data = chart.data.slice(0, GENUI_LIMITS.maxChartPoints)
  const clamped = data.map(d => ({ ...d, v: Math.max(0, Number(d.value) || 0) }))
  const total = clamped.reduce((s, d) => s + d.v, 0) || 1
  // Center total: 1 decimal for fractional sums — a share-of-total figure
  // like 3.3/9.9 used to print the raw float as 6.6000000000000005.
  const totalText = total >= 1000
    ? `${Math.round(total / 100) / 10}k`
    : Number.isInteger(total) ? String(total) : total.toFixed(1)
  const R = 62
  const STROKE = 18
  const SIZE = 160
  const C = 2 * Math.PI * R
  let offset = 0
  const summary = `环形图，${clamped.length} 项，合计 ${totalText}`
  return (
    <div className={css.donut} data-genui-chart="donut" role="img" aria-label={summary}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth={STROKE} className={css.donutTrack} />
        {clamped.map((d, i) => {
          const frac = d.v / total
          const len = frac * C
          const el = (
            <circle
              key={i}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              strokeWidth={STROKE}
              className={css.donutSeg}
              style={{ stroke: seriesColor(i, data.length, d.color) ?? 'var(--dsw-alias-state-business-primary, #4f8ef7)' }}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            >
              <title>{`${d.label}: ${String(d.value)}（${(frac * 100).toFixed(1)}%）`}</title>
            </circle>
          )
          offset += len
          return el
        })}
        <text x={SIZE / 2} y={SIZE / 2 - 2} textAnchor="middle" className={css.donutTotal}>{totalText}</text>
        <text x={SIZE / 2} y={SIZE / 2 + 16} textAnchor="middle" className={css.donutTotalLabel}>合计</text>
      </svg>
      <div className={css.donutLegend}>
        {clamped.map((d, i) => (
          <span key={i} className={css.legendItem}>
            <span className={css.legendSwatch} style={{ background: seriesColor(i, data.length, d.color) ?? 'var(--dsw-alias-state-business-primary, #4f8ef7)' }} />
            <span>{d.label}</span>
            <span className={css.donutPct}>{String(d.value)} · {(d.v / total * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
})
