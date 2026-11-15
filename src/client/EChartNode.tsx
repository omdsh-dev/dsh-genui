/**
 * ECharts node: renders a full ECharts chart from a declarative option
 * object. The echarts engine is lazy-loaded (lib/assets/echarts.js) only when
 * an `echart` node appears — the main client bundle never carries the engine.
 *
 * The `option` field accepts a standard ECharts `EChartsCoreOption`. For
 * simple use cases the `preset` + `data` shorthand builds the option
 * automatically: `preset: 'bar' | 'line' | 'pie' | 'scatter' | 'area'` maps
 * to a themed option template that reads the same `data`/`series` shape as
 * the `chart` node, so a model can upgrade a `chart` to ECharts by changing
 * `type` to `echart` and adding `preset`.
 * @module @changfenhuang/dsh-genui/client/EChartNode
 */
import { renderInline } from './inline.ts'
import { useEffect, useRef, useState } from 'react'
import css from './GenuiBlock.module.css'
import { createChart as lazyCreateChart, type EChartsInstance } from './echarts-lazy.ts'
import { echartEngineFor } from './echarts-engine.ts'
import { CHART_COLORS } from './blocks/charts.tsx'
import type { GenuiEChart } from './spec.ts'
import { useT } from './i18n/index.ts'

/**
 * Categorical fallback palette. The host defines its `--dsw-static-*` tokens on
 * `body`, not on `:root`, and ECharts renders to CANVAS (so a `var(--x)` string
 * is meaningless to it — every colour must be resolved to a literal first).
 * Reading only `document.documentElement` therefore returned '' for every
 * series colour and collapsed multi-series charts to one accent hue; these
 * fixed hues keep series distinguishable on any host.
 */
export const SERIES_FALLBACK = [
  '#679efe', '#4ed17e', '#f5b83d', '#f2707a', '#8b7ff0', '#3fc7d4', '#b7c8fe', '#9aa3b2',
] as const

/**
 * Read a host theme token, resolved from the ELEMENT first (custom properties
 * inherit, so any node inside `body` sees the host sheet) and falling back to
 * body/root for detached renders.
 */
function readToken(name: string, fallback: string, el?: HTMLElement | null): string {
  const hosts: Array<Element | null> = [el ?? null, typeof document === 'undefined' ? null : document.body, typeof document === 'undefined' ? null : document.documentElement]
  for (const host of hosts) {
    if (host === null) continue
    const value = getComputedStyle(host).getPropertyValue(name).trim()
    if (value !== '') return value
  }
  return fallback
}

/** 通过实际计算后的 font-size 获取字号，供 ECharts 的数字字号字段使用。 */
function readFontSize(name: string, fallback: number, el?: HTMLElement | null): number {
  if (el === undefined || el === null) return fallback
  const probe = document.createElement('span')
  probe.style.fontSize = `var(${name})`
  el.appendChild(probe)
  const parsed = Number.parseFloat(getComputedStyle(probe).fontSize)
  probe.remove()
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Resolve the host accent and label colors for ECharts theming. */
function themeColors(el?: HTMLElement | null): {
  accent: string
  labelPrimary: string
  labelSecondary: string
  labelTertiary: string
  border: string
  bgLayer1: string
  fontData: number
  fontMeta: number
  fontDisplay: number
} {
  return {
    accent: readToken('--dsw-alias-state-business-primary', '#4f8ef7', el),
    labelPrimary: readToken('--dsw-alias-label-primary', '#e6e6e6', el),
    labelSecondary: readToken('--dsw-alias-label-secondary', '#a0a0a0', el),
    labelTertiary: readToken('--dsw-alias-label-tertiary', '#6b6b6b', el),
    border: readToken('--dsw-alias-border-l1', 'rgba(255,255,255,0.12)', el),
    bgLayer1: readToken('--dsw-alias-bg-layer-1', '#1a1a1e', el),
    // The --dsl-g-* scale is declared on the .block/.panel roots; the chart
    // container inherits it. Detached renders fall back to these literals.
    fontData: readFontSize('--dsl-g-font-data', 12, el),
    fontMeta: readFontSize('--dsl-g-font-meta', 12.5, el),
    fontDisplay: readFontSize('--dsl-g-font-display', 28, el),
  }
}

/** 根据预设和数据生成完整的 ECharts option，并从图表容器读取宿主主题颜色。 */
export function presetOption(node: GenuiEChart, el?: HTMLElement | null): Record<string, unknown> {
  const t = themeColors(el)
  // Each palette slot carries its own fallback hue: if the host lacks the
  // static tokens, series must still be distinguishable (the old code fell
  // back to the accent for every slot, so every chart came out one colour).
  const colors = node.palette !== undefined && node.palette.length > 0
    ? [...node.palette]
    : CHART_COLORS.map((c, i) =>
      readToken(c.replace('var(', '').replace(')', ''), SERIES_FALLBACK[i % SERIES_FALLBACK.length]!, el))
  // 坐标轴预设保留空位置；独立图形省略缺失值，同时保留真实零值。
  const independentMarks = ['wordCloud', 'pie', 'gauge', 'funnel', 'treemap'].includes(node.preset ?? '')
  const data = (node.data ?? []).filter(d => !independentMarks || typeof d.value === 'number' && Number.isFinite(d.value))
  const series = node.series

  // Shared tooltip base: renderMode 'richText' prevents ECharts from writing
  // tooltip content via innerHTML — labels/formatters are model output and
  // must never reach the HTML parser.
  const tt = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    renderMode: 'richText',
    backgroundColor: t.bgLayer1,
    borderColor: t.border,
    textStyle: { color: t.labelPrimary, fontSize: t.fontData * 14 / 12 },
    ...extra,
  })

  const base = {
    color: colors,
    textStyle: { color: t.labelSecondary, fontFamily: 'inherit', fontSize: t.fontData },
    backgroundColor: 'transparent',
    grid: { left: 48, right: 16, top: 24, bottom: 32 },
    tooltip: tt({ trigger: 'item' }),
  }

  switch (node.preset) {
    case 'wordCloud': {
      return {
        ...base,
        series: [{
          type: 'wordCloud',
          sizeRange: [t.fontData * 16 / 12, t.fontData * 64 / 12],
          rotationRange: [0, 0],
          gridSize: 8,
          textStyle: { fontFamily: 'sans-serif' },
          data: data.map((d, i) => ({ name: d.label, value: d.value, textStyle: { color: colors[i % colors.length] } })),
        }],
      }
    }
    case 'pie': {
      return {
        ...base,
        tooltip: tt({ trigger: 'item', formatter: '{b}: {c} ({d}%)' }),
        legend: { bottom: 0, textStyle: { color: t.labelTertiary, fontSize: t.fontData } },
        series: [{
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 6, borderColor: t.bgLayer1, borderWidth: 2 },
          label: { color: t.labelSecondary, fontSize: t.fontData },
          data: data.map(d => ({ name: d.label, value: d.value })),
        }],
      }
    }
    case 'scatter': {
      // xAxis is 'category' so string labels (e.g. 「一月」) render correctly;
      // the previous `type: 'value'` xAxis could not plot non-numeric labels.
      return {
        ...base,
        tooltip: tt({ trigger: 'item' }),
        xAxis: { type: 'category', data: data.map(d => d.label), axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary, fontSize: t.fontData }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary, fontSize: t.fontData }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series: [{
          type: 'scatter',
          symbolSize: 10,
          data: data.map(d => d.value),
        }],
      }
    }
    case 'area': {
      return {
        ...base,
        tooltip: tt({ trigger: 'axis' }),
        xAxis: { type: 'category', data: data.map(d => d.label), axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary, fontSize: t.fontData } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary, fontSize: t.fontData }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series: (series ?? [{ label: '', data }]).map((s, i) => ({
          name: s.label,
          type: 'line',
          smooth: true,
          areaStyle: { opacity: 0.15 },
          data: s.data.map(d => d.value),
          ...optItemStyleColor(s.color, i, series),
        })),
        legend: series !== undefined ? { bottom: 0, textStyle: { color: t.labelTertiary, fontSize: t.fontData } } : undefined,
      }
    }
    case 'line': {
      return {
        ...base,
        tooltip: tt({ trigger: 'axis' }),
        xAxis: { type: 'category', data: data.map(d => d.label), axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary, fontSize: t.fontData } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary, fontSize: t.fontData }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series: (series ?? [{ label: '', data }]).map((s, i) => ({
          name: s.label,
          type: 'line',
          smooth: true,
          showSymbol: true,
          symbolSize: 6,
          data: s.data.map(d => d.value),
          ...optItemStyleColor(s.color, i, series),
        })),
        legend: series !== undefined ? { bottom: 0, textStyle: { color: t.labelTertiary, fontSize: t.fontData } } : undefined,
      }
    }
    case 'radar': {
      // Indicators come from the first series' labels; each series is one
      // polygon. `data` alone is treated as a single unnamed series.
      const entries = series ?? [{ label: '', data }]
      const indicators = (entries[0]?.data ?? []).map(d => ({ name: d.label, max: undefined as number | undefined }))
      const completeEntries = entries.flatMap((entry, index) => {
        const values = entry.data.map(d => typeof d.value === 'number' && Number.isFinite(d.value) ? d.value : null)
        // 雷达图需要完整坐标；缺失数据不能在原点显示为真实零值。
        return values.some(value => value === null) ? [] : [{ entry, index, values: values as number[] }]
      })
      const max = Math.max(...completeEntries.flatMap(({ values }) => values), 1)
      return {
        ...base,
        tooltip: tt({ trigger: 'item' }),
        legend: { bottom: 0, textStyle: { color: t.labelTertiary, fontSize: t.fontData } },
        radar: {
          indicator: indicators.map(i => ({ name: i.name, max: Math.ceil(max * 1.1) })),
          splitLine: { lineStyle: { color: t.border } },
          splitArea: { show: false },
          axisLine: { lineStyle: { color: t.border } },
          axisName: { color: t.labelTertiary, fontSize: t.fontData },
        },
        series: [{
          type: 'radar',
          symbolSize: 5,
          areaStyle: { opacity: 0.12 },
          data: completeEntries.map(({ entry, index, values }) => ({
            name: entry.label,
            value: values,
            ...optItemStyleColor(entry.color, index, series),
          })),
        }],
      }
    }
    case 'gauge': {
      // One gauge per datum (usually a single KPI).
      return {
        ...base,
        tooltip: tt({ trigger: 'item' }),
        series: data.slice(0, 4).map((d, i) => ({
          type: 'gauge',
          startAngle: 210,
          endAngle: -30,
          min: 0,
          max: Math.max(Number(d.value) || 0, 100),
          center: data.length > 1 ? [`${(i + 0.5) * (100 / Math.min(data.length, 4))}%`, '58%'] : ['50%', '58%'],
          radius: data.length > 1 ? '62%' : '82%',
          progress: { show: true, width: 12 },
          axisLine: { lineStyle: { width: 12, color: [[1, t.border]] } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          pointer: { show: false },
          title: { offsetCenter: [0, '32%'], color: t.labelTertiary, fontSize: t.fontData },
          detail: { valueAnimation: true, fontSize: t.fontDisplay, offsetCenter: [0, '2%'], formatter: '{value}', color: t.labelPrimary },
          data: [{ value: Number(d.value) || 0, name: d.label }],
        })),
      }
    }
    case 'funnel': {
      return {
        ...base,
        tooltip: tt({ trigger: 'item', formatter: '{b}: {c}' }),
        legend: { bottom: 0, textStyle: { color: t.labelTertiary, fontSize: t.fontData } },
        series: [{
          type: 'funnel',
          left: '8%',
          width: '84%',
          top: 16,
          bottom: 40,
          gap: 2,
          label: { position: 'inside', color: '#fff', fontSize: t.fontData, formatter: '{b} {c}' },
          itemStyle: { borderWidth: 0 },
          data: data.map(d => ({ name: d.label, value: Number(d.value) || 0 })),
        }],
      }
    }
    case 'treemap': {
      return {
        ...base,
        tooltip: tt({ trigger: 'item', formatter: '{b}: {c}' }),
        series: [{
          type: 'treemap',
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          upperLabel: { show: false },
          label: { color: t.labelPrimary, fontSize: t.fontData },
          itemStyle: { borderColor: t.bgLayer1, borderWidth: 2, gapWidth: 2 },
          data: data.map(d => ({ name: d.label, value: Number(d.value) || 0 })),
        }],
      }
    }
    case 'sankey': {
      const links = node.links ?? []
      const names = data.length > 0
        ? data.map(d => d.label)
        : [...new Set(links.flatMap(l => [l.from, l.to]))]
      return {
        ...base,
        tooltip: tt({ trigger: 'item' }),
        series: [{
          type: 'sankey',
          left: 8,
          right: 8,
          top: 12,
          bottom: 12,
          nodeGap: 12,
          lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.32 },
          label: { color: t.labelSecondary, fontSize: t.fontData },
          emphasis: { focus: 'adjacency' },
          data: names.map(name => ({ name })),
          links: links.map(l => ({ source: l.from, target: l.to, value: l.value ?? 1 })),
        }],
      }
    }
    case 'graph': {
      const links = node.links ?? []
      const names = data.length > 0
        ? data.map(d => d.label)
        : [...new Set(links.flatMap(l => [l.from, l.to]))]
      // Node size follows its degree, so hubs read as hubs without extra data.
      const degree = new Map<string, number>()
      for (const l of links) {
        degree.set(l.from, (degree.get(l.from) ?? 0) + 1)
        degree.set(l.to, (degree.get(l.to) ?? 0) + 1)
      }
      return {
        ...base,
        tooltip: tt({ trigger: 'item' }),
        series: [{
          type: 'graph',
          layout: 'force',
          roam: true,
          label: { show: true, color: t.labelSecondary, fontSize: t.fontMeta },
          force: { repulsion: 200, edgeLength: 80 },
          lineStyle: { color: t.border, curveness: 0.1 },
          emphasis: { focus: 'adjacency' },
          data: names.map(name => ({ name, symbolSize: 16 + (degree.get(name) ?? 0) * 5 })),
          links: links.map(l => ({ source: l.from, target: l.to })),
        }],
      }
    }
    case 'heatmap': {
      // Rows come from `series` (one row per entry), columns from the first
      // row's labels — the same shape the other presets use.
      const rows = series ?? [{ label: '', data }]
      const cols = (rows[0]?.data ?? []).map(d => d.label)
      const values = rows.flatMap((row, y) => row.data.flatMap((d, x) =>
        typeof d.value === 'number' && Number.isFinite(d.value) ? [[x, y, d.value]] : []))
      const max = Math.max(...values.map(v => v[2] as number), 1)
      return {
        ...base,
        tooltip: tt({ trigger: 'item', position: 'top' }),
        grid: { left: 64, right: 16, top: 16, bottom: 48 },
        xAxis: { type: 'category', data: cols, splitArea: { show: false }, axisLabel: { color: t.labelTertiary, fontSize: t.fontData }, axisLine: { lineStyle: { color: t.border } } },
        yAxis: { type: 'category', data: rows.map(r => r.label), splitArea: { show: false }, axisLabel: { color: t.labelTertiary, fontSize: t.fontData }, axisLine: { lineStyle: { color: t.border } } },
        visualMap: { min: 0, max, calculable: true, orient: 'horizontal', left: 'center', bottom: 0, textStyle: { color: t.labelTertiary, fontSize: t.fontData } },
        series: [{ type: 'heatmap', data: values, label: { show: values.length <= 60, color: t.labelPrimary, fontSize: t.fontData }, itemStyle: { borderColor: t.bgLayer1, borderWidth: 2 } }],
      }
    }
    case 'bigline': {
      // Long series: symbols off, area wash, inside + slider zoom.
      return {
        ...base,
        tooltip: tt({ trigger: 'axis' }),
        grid: { left: 48, right: 20, top: 24, bottom: 56 },
        dataZoom: [
          { type: 'inside', start: 0, end: 45 },
          { type: 'slider', height: 16, bottom: 8, borderColor: t.border, textStyle: { color: t.labelTertiary, fontSize: t.fontData } },
        ],
        xAxis: { type: 'category', boundaryGap: false, data: data.map(d => d.label), axisLabel: { color: t.labelTertiary, fontSize: t.fontData }, axisLine: { lineStyle: { color: t.border } } },
        yAxis: { type: 'value', axisLabel: { color: t.labelTertiary, fontSize: t.fontData }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series: (series ?? [{ label: '', data }]).map((s2, i) => ({
          name: s2.label,
          type: 'line',
          smooth: true,
          showSymbol: false,
          areaStyle: { opacity: 0.12 },
          data: s2.data.map(d => d.value),
          ...optItemStyleColor(s2.color, i, series),
        })),
        legend: series !== undefined ? { bottom: 26, textStyle: { color: t.labelTertiary, fontSize: t.fontData } } : undefined,
      }
    }
    default: {
      // 'bar' or unspecified
      return {
        ...base,
        tooltip: tt({ trigger: 'axis', axisPointer: { type: 'shadow' } }),
        xAxis: { type: 'category', data: data.map(d => d.label), axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary, fontSize: t.fontData } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary, fontSize: t.fontData }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series: (series ?? [{ label: '', data }]).map(s => ({
          name: s.label,
          type: 'bar',
          barMaxWidth: 40,
          itemStyle: { borderRadius: [4, 4, 2, 2], ...(s.color !== undefined ? { color: s.color } : {}) },
          data: s.data.map(d => d.value),
        })),
        legend: series !== undefined ? { bottom: 0, textStyle: { color: t.labelTertiary, fontSize: t.fontData } } : undefined,
      }
    }
  }
}

/** Per-series itemStyle.color override when the preset series declares one
 * (aligns with the `chart` node which respects `series[].color`). */
function optItemStyleColor(color: string | undefined, _i: number, _series: unknown): Record<string, unknown> {
  return color !== undefined ? { itemStyle: { color } } : {}
}

/** Refresh typography without replaying preset data or interactive defaults. */
function fontSizeOption(option: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(option)) {
    if (key === 'fontSize' || key === 'sizeRange') {
      result[key] = value
    } else if (Array.isArray(value)) {
      const children = value.map(item => item !== null && typeof item === 'object'
        ? fontSizeOption(item as Record<string, unknown>) : {})
      // ECharts merges component arrays by index. Keep empty entries so a
      // slider's text style cannot be applied to the preceding inside zoom.
      if (children.some(child => Object.keys(child).length > 0)) result[key] = children
    } else if (value !== null && typeof value === 'object') {
      const child = fontSizeOption(value as Record<string, unknown>)
      if (Object.keys(child).length > 0) result[key] = child
    }
  }
  return result
}

export function EChartNode({ node }: { node: GenuiEChart }) {
  const t = useT()
  const ref = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const instanceRef = useRef<EChartsInstance | null>(null)

  useEffect(() => {
    let alive = true
    const el = ref.current
    if (el === null) return

    // Full `option` wins over preset shorthand.
    const option = node.option ?? presetOption(node, el)

    const engine = echartEngineFor(node) === 'echarts-full' ? 'full' : 'core'
    void lazyCreateChart(el, option, { height: node.height ?? 300 }, engine).then((inst) => {
      if (!alive) {
        inst.dispose()
        return
      }
      instanceRef.current = inst
      setStatus('ready')
    }).catch(() => {
      if (alive) setStatus('error')
    })

    return () => {
      alive = false
      instanceRef.current?.dispose()
      instanceRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Resize observer: keep the chart responsive.
  useEffect(() => {
    if (status !== 'ready') return
    const el = ref.current
    if (el === null) return
    const ro = new ResizeObserver(() => {
      instanceRef.current?.resize()
    })
    ro.observe(el)
    return () => { ro.disconnect() }
  }, [status])

  // Update option when the node changes (model re-render). `status` is in
  // deps so that when the engine finishes loading (status: 'loading' →
  // 'ready'), this effect re-runs and applies the LATEST option — without
  // it, a spec update that arrived during engine load would be lost forever
  // (the mount effect captured the old option, and this effect would have
  // returned early when status was 'loading' and never re-run).
  useEffect(() => {
    if (status !== 'ready' || instanceRef.current === null) return
    const option = node.option ?? presetOption(node, ref.current)
    instanceRef.current.setOption(option, true)
    if (node.option !== undefined) return
    let contentFontSize = getComputedStyle(document.body).getPropertyValue('--dsh-content-font-size').trim()
    const observer = new MutationObserver(() => {
      const nextContentFontSize = getComputedStyle(document.body).getPropertyValue('--dsh-content-font-size').trim()
      if (nextContentFontSize === contentFontSize) return
      contentFontSize = nextContentFontSize
      if (instanceRef.current !== null) instanceRef.current.setOption(fontSizeOption(presetOption(node, ref.current)))
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'] })
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, status])

  if (status === 'error') {
    return (
      <div className={css.echartFallback} data-genui-echart>
        <div className={css.echartErr}>{t('echart.failed')}</div>
        {node.title !== undefined && <div className={css.echartHint}>{renderInline(node.title)}</div>}
      </div>
    )
  }

  return (
    <div className={css.echartWrap} data-genui-echart>
      {node.title !== undefined && <div className={css.echartTitle}>{renderInline(node.title)}</div>}
      <div
        ref={ref}
        className={css.echartCanvas}
        style={{ height: `${node.height ?? 300}px` }}
        role="img"
        aria-label={node.title ?? 'ECharts chart'}
      />
      {status === 'loading' && <div className={css.echartHint}>{t('echart.loading')}</div>}
    </div>
  )
}
