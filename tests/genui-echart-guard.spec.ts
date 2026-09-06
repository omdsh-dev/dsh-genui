// GenUI echart guard: preset whitelist, height clamping, option sanitization
// (XSS filter, tooltip renderMode, array/node budget), and node rejection.
// Pure node tests — no DOM.
import { describe, expect, it } from 'vitest'
import { repairGenuiSpec } from '../src/client/guard.ts'
import { GENUI_LIMITS } from '../src/client/genui-runtime/index.ts'

const echart = (props: Record<string, unknown> = {}) => ({ type: 'echart', ...props })

describe('repairGenuiSpec: echart preset whitelist', () => {
  it('accepts all five valid presets', () => {
    for (const preset of ['bar', 'line', 'area', 'pie', 'scatter'] as const) {
      const spec = repairGenuiSpec({ items: [echart({ preset, data: [{ label: 'a', value: 1 }] })] })
      expect(spec?.items).toHaveLength(1)
      expect((spec?.items[0] as { preset: string }).preset).toBe(preset)
    }
  })

  it('drops invalid preset values (kept undefined, node survives via data)', () => {
    const spec = repairGenuiSpec({ items: [echart({ preset: 'bubble', data: [{ label: 'a', value: 1 }] })] })
    expect(spec?.items).toHaveLength(1)
    expect((spec?.items[0] as { preset?: string }).preset).toBeUndefined()
  })
})

describe('repairGenuiSpec: echart height clamping', () => {
  it('clamps height into 100–800', () => {
    const spec = repairGenuiSpec({ items: [
      echart({ preset: 'bar', height: 50, data: [{ label: 'a', value: 1 }] }),
      echart({ preset: 'bar', height: 9999, data: [{ label: 'a', value: 1 }] }),
      echart({ preset: 'bar', height: 300, data: [{ label: 'a', value: 1 }] }),
    ] })
    expect((spec?.items[0] as { height: number }).height).toBe(100)
    expect((spec?.items[1] as { height: number }).height).toBe(800)
    expect((spec?.items[2] as { height: number }).height).toBe(300)
  })

  it('defaults height when absent', () => {
    const spec = repairGenuiSpec({ items: [echart({ preset: 'bar', data: [{ label: 'a', value: 1 }] })] })
    expect((spec?.items[0] as { height?: number }).height).toBeUndefined()
  })
})

describe('repairGenuiSpec: echart node rejection', () => {
  it('drops an echart with no option, data, or series', () => {
    const spec = repairGenuiSpec({ items: [
      echart(),
      echart({ preset: 'bar' }), // preset alone without data/series
    ] })
    expect(spec?.items).toHaveLength(0)
  })

  it('keeps a series-only echart', () => {
    const spec = repairGenuiSpec({ items: [
      echart({ preset: 'bar', series: [{ label: 's', data: [{ label: 'a', value: 1 }] }] }),
    ] })
    expect(spec?.items).toHaveLength(1)
  })

  it('keeps an option-only echart', () => {
    const spec = repairGenuiSpec({ items: [
      echart({ option: { title: { text: 'ok' } } }),
    ] })
    expect(spec?.items).toHaveLength(1)
  })
})

describe('sanitizeEChartOption: XSS prevention (via repairGenuiSpec)', () => {
  it('forces tooltip.renderMode to richText', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { tooltip: { trigger: 'axis', formatter: '{b}: {c}' } },
    })] })
    const node = spec?.items[0] as { option?: { tooltip?: { renderMode?: string } } }
    expect(node?.option?.tooltip?.renderMode).toBe('richText')
  })

  it('forces renderMode richText even when tooltip has no formatter', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { tooltip: { trigger: 'item' } },
    })] })
    const node = spec?.items[0] as { option?: { tooltip?: { renderMode?: string } } }
    expect(node?.option?.tooltip?.renderMode).toBe('richText')
  })

  it('filters <script> tags from string values', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { title: { text: '<script>alert(1)</script>' } },
    })] })
    const node = spec?.items[0] as { option?: { title?: { text?: string } } }
    expect(node?.option?.title?.text).toBeUndefined()
  })

  it('filters <img onerror=...> from string values', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { tooltip: { formatter: '<img src=x onerror=alert(1)>' } },
    })] })
    const node = spec?.items[0] as { option?: { tooltip?: { formatter?: string } } }
    expect(node?.option?.tooltip?.formatter).toBeUndefined()
  })

  it('filters on[a-z]+= event handlers from string values', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { label: 'text onload=alert(1)' },
    })] })
    const node = spec?.items[0] as { option?: { label?: string } }
    expect(node?.option?.label).toBeUndefined()
  })

  it('filters javascript: URIs from string values', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { link: 'javascript:alert(1)' },
    })] })
    const node = spec?.items[0] as { option?: { link?: string } }
    expect(node?.option?.link).toBeUndefined()
  })

  it('filters url() CSS exfiltration from string values', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { backgroundColor: 'url(https://evil.example/track?u=1)' },
    })] })
    const node = spec?.items[0] as { option?: { backgroundColor?: string } }
    expect(node?.option?.backgroundColor).toBeUndefined()
  })

  it('preserves legitimate string values (CJK, templates, hex)', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: {
        title: { text: '销售趋势' },
        xAxis: { type: 'category', data: ['一月', '二月'] },
        backgroundColor: '#1a1a1e',
      },
    })] })
    const node = spec?.items[0] as { option?: { title?: { text?: string }; xAxis?: { data?: string[] }; backgroundColor?: string } }
    expect(node?.option?.title?.text).toBe('销售趋势')
    expect(node?.option?.xAxis?.data).toEqual(['一月', '二月'])
    expect(node?.option?.backgroundColor).toBe('#1a1a1e')
  })

  it('filters function values from option', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { title: { text: 'ok' }, formatter: () => 'x' },
    })] })
    const node = spec?.items[0] as { option?: Record<string, unknown> }
    expect(node?.option?.title).toBeDefined()
    expect(node?.option?.formatter).toBeUndefined()
  })
})

describe('sanitizeEChartOption: resource budget (via repairGenuiSpec)', () => {
  it('caps array length to maxEChartArrayLen', () => {
    const hugeData = Array.from({ length: 10000 }, (_, i) => i)
    const spec = repairGenuiSpec({ items: [echart({
      option: { series: [{ data: hugeData }] },
    })] })
    const node = spec?.items[0] as { option?: { series?: Array<{ data?: unknown[] }> } }
    expect(node?.option?.series?.[0]?.data).toHaveLength(GENUI_LIMITS.maxEChartArrayLen)
  })

  it('caps total node count to maxEChartOptionNodes', () => {
    const huge: Record<string, unknown> = {}
    for (let i = 0; i < 3000; i++) huge[`k${i}`] = i
    const spec = repairGenuiSpec({ items: [echart({ option: huge })] })
    const node = spec?.items[0] as { option?: Record<string, unknown> }
    expect(node?.option).toBeDefined()
    expect(Object.keys(node!.option!)).toHaveLength(GENUI_LIMITS.maxEChartOptionNodes - 1)
  })

  it('caps nesting depth to maxEChartOptionDepth', () => {
    // Deep nesting beyond the limit causes the walk to return undefined at
    // the cutoff depth, which cascades up (each parent loses its only child
    // → empty object → undefined). The option gets stripped entirely.
    let inner: Record<string, unknown> = { v: 'leaf' }
    for (let i = 0; i < 20; i++) inner = { a: inner }
    const spec = repairGenuiSpec({ items: [echart({ option: inner })] })
    const node = spec?.items[0] as { option?: Record<string, unknown> }
    // The entire option is stripped because the deep nesting exceeds the
    // depth budget — every level above the cutoff becomes an empty object.
    expect(node?.option).toBeUndefined()

    // A nesting depth WITHIN the limit survives.
    let ok: Record<string, unknown> = { v: 'leaf' }
    for (let i = 0; i < 5; i++) ok = { a: ok }
    const spec2 = repairGenuiSpec({ items: [echart({ option: ok })] })
    const node2 = spec2?.items[0] as { option?: Record<string, unknown> }
    expect(node2?.option).toBeDefined()
  })
})
