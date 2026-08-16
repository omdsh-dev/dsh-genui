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
 * @module @omdsh-dev/dsh-genui/client/EChartNode
 */
import { useEffect, useRef, useState } from 'react'
import css from './GenuiBlock.module.css'
import { createChart as lazyCreateChart, type EChartsInstance } from './echarts-lazy.ts'
import { CHART_COLORS } from './blocks/charts.tsx'
import type { GenuiEChart } from './spec.ts'

/** Read a CSS custom property from the document root (host theme token). */
function readToken(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** Resolve the host accent and label colors for ECharts theming. */
function themeColors(): {
  accent: string
  labelPrimary: string
  labelSecondary: string
  labelTertiary: string
  border: string
  bgLayer1: string
} {
  return {
    accent: readToken('--dsw-alias-state-business-primary', '#4f8ef7'),
    labelPrimary: readToken('--dsw-alias-label-primary', '#e6e6e6'),
    labelSecondary: readToken('--dsw-alias-label-secondary', '#a0a0a0'),
    labelTertiary: readToken('--dsw-alias-label-tertiary', '#6b6b6b'),
    border: readToken('--dsw-alias-border-l1', 'rgba(255,255,255,0.12)'),
    bgLayer1: readToken('--dsw-alias-bg-layer-1', '#1a1a1e'),
  }
}

/** Build a full ECharts option from a preset + the simple data/series shape. */
function presetOption(node: GenuiEChart): Record<string, unknown> {
  const t = themeColors()
  const colors = CHART_COLORS.map(c => readToken(c.replace('var(', '').replace(')', ''), t.accent))
  const data = node.data ?? []
  const series = node.series

  const base = {
    color: colors,
    textStyle: { color: t.labelSecondary, fontFamily: 'inherit' },
    backgroundColor: 'transparent',
    grid: { left: 48, right: 16, top: 24, bottom: 32 },
    tooltip: { trigger: 'item', backgroundColor: t.bgLayer1, borderColor: t.border, textStyle: { color: t.labelPrimary } },
  }

  switch (node.preset) {
    case 'pie': {
      return {
        ...base,
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)', backgroundColor: t.bgLayer1, borderColor: t.border, textStyle: { color: t.labelPrimary } },
        legend: { bottom: 0, textStyle: { color: t.labelTertiary } },
        series: [{
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 6, borderColor: t.bgLayer1, borderWidth: 2 },
          label: { color: t.labelSecondary },
          data: data.map(d => ({ name: d.label, value: d.value })),
        }],
      }
    }
    case 'scatter': {
      return {
        ...base,
        tooltip: { trigger: 'item', backgroundColor: t.bgLayer1, borderColor: t.border, textStyle: { color: t.labelPrimary } },
        xAxis: { type: 'value', axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series: [{
          type: 'scatter',
          symbolSize: 10,
          data: data.map(d => [d.label, d.value]),
        }],
      }
    }
    case 'area': {
      return {
        ...base,
        tooltip: { trigger: 'axis', backgroundColor: t.bgLayer1, borderColor: t.border, textStyle: { color: t.labelPrimary } },
        xAxis: { type: 'category', data: data.map(d => d.label), axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series: (series ?? [{ label: '', data }]).map(s => ({
          name: s.label,
          type: 'line',
          smooth: true,
          areaStyle: { opacity: 0.15 },
          data: s.data.map(d => d.value),
        })),
        legend: series !== undefined ? { bottom: 0, textStyle: { color: t.labelTertiary } } : undefined,
      }
    }
    case 'line': {
      return {
        ...base,
        tooltip: { trigger: 'axis', backgroundColor: t.bgLayer1, borderColor: t.border, textStyle: { color: t.labelPrimary } },
        xAxis: { type: 'category', data: data.map(d => d.label), axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series: (series ?? [{ label: '', data }]).map(s => ({
          name: s.label,
          type: 'line',
          smooth: true,
          showSymbol: true,
          symbolSize: 6,
          data: s.data.map(d => d.value),
        })),
        legend: series !== undefined ? { bottom: 0, textStyle: { color: t.labelTertiary } } : undefined,
      }
    }
    default: {
      // 'bar' or unspecified
      return {
        ...base,
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: t.bgLayer1, borderColor: t.border, textStyle: { color: t.labelPrimary } },
        xAxis: { type: 'category', data: data.map(d => d.label), axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.labelTertiary }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series: (series ?? [{ label: '', data }]).map(s => ({
          name: s.label,
          type: 'bar',
          barMaxWidth: 40,
          itemStyle: { borderRadius: [4, 4, 2, 2] },
          data: s.data.map(d => d.value),
        })),
        legend: series !== undefined ? { bottom: 0, textStyle: { color: t.labelTertiary } } : undefined,
      }
    }
  }
}

export function EChartNode({ node }: { node: GenuiEChart }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const instanceRef = useRef<EChartsInstance | null>(null)

  useEffect(() => {
    let alive = true
    const el = ref.current
    if (el === null) return

    // Full `option` wins over preset shorthand.
    const option = node.option ?? presetOption(node)

    void lazyCreateChart(el, option, { height: node.height ?? 300 }).then((inst) => {
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

  // Update option when the node changes (model re-render).
  useEffect(() => {
    if (status !== 'ready' || instanceRef.current === null) return
    const option = node.option ?? presetOption(node)
    instanceRef.current.setOption(option, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node])

  if (status === 'error') {
    return (
      <div className={css.echartFallback} data-genui-echart>
        <div className={css.echartErr}>ECharts 渲染失败</div>
        {node.title !== undefined && <div className={css.echartHint}>{node.title}</div>}
      </div>
    )
  }

  return (
    <div className={css.echartWrap} data-genui-echart>
      {node.title !== undefined && <div className={css.echartTitle}>{node.title}</div>}
      <div ref={ref} className={css.echartCanvas} style={{ height: `${node.height ?? 300}px` }} />
      {status === 'loading' && <div className={css.echartHint}>加载图表…</div>}
    </div>
  )
}
