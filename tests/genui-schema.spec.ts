import { describe, expect, it } from 'vitest'
import {
  COMPONENT_SCHEMAS,
  diagnoseUnknownGenuiFields,
  normalizeGenuiSpec,
  processGenuiSpec,
  repairGenuiSpec,
  validateGenuiSpec,
} from '../src/client/guard.ts'
import { validateRenderableChartSemantics } from '../src/plugin/chart-contract.ts'

describe('GenUI runtime schema normalization', () => {
  it('uses registry field kinds and one-of rules during validation', () => {
    expect(validateGenuiSpec({ items: [{ type: 'card', title: 123, items: [] }] }).errors)
      .toContain('items[0].title must be a string')
    expect(validateGenuiSpec({ items: [{ type: 'chart', kind: 'bars', series: [{ label: 'A', data: [{ label: '一', value: 1 }] }] }] }).ok)
      .toBe(true)
    expect(validateGenuiSpec({ items: [{ type: 'chart' }] }).errors)
      .toContain("items[0]: type 'chart' requires data or series (array)")
    expect(validateGenuiSpec({ items: [{ type: 'grid', items: [] }] }).ok).toBe(true)
    expect(repairGenuiSpec({ items: [{ type: 'grid', items: [] }] })?.items[0]).toEqual({ type: 'grid', cols: 1, items: [] })
  })

  it('validates every root field kind from the root runtime schema', () => {
    for (const [field, value, message] of [
      ['panel', 'yes', 'spec.panel must be a boolean'],
      ['append', 1, 'spec.append must be a boolean'],
      ['gap', 'bad', 'spec.gap must be a finite number'],
      ['title', 123, 'spec.title must be a string'],
    ] as const) {
      const raw = { items: [], [field]: value }
      expect(validateGenuiSpec(raw)).toEqual({ ok: false, errors: [message] })
      expect(processGenuiSpec(raw).errors).toEqual([message])
    }

    const legalRoot = { title: '合法', gap: 8, panel: true, append: false, items: [] }
    expect(validateGenuiSpec(legalRoot)).toEqual({ ok: true, errors: [] })
    expect(processGenuiSpec(legalRoot).errors).toEqual([])
    expect(validateGenuiSpec({ type: 'text', content: 'bare component' })).toEqual({ ok: true, errors: [] })
  })

  it('exposes runtime required, optional, rule, and validator metadata', () => {
    expect(COMPONENT_SCHEMAS.card.fields.title).toBe('string')
    expect(COMPONENT_SCHEMAS.card.optional.title).toBe('string')
    expect(COMPONENT_SCHEMAS.chart.required).toEqual([])
    expect(COMPONENT_SCHEMAS.chart.oneOfRequired).toEqual([['data', 'series']])
    expect(COMPONENT_SCHEMAS.chart.conditionalRequired).toHaveLength(2)
    expect(COMPONENT_SCHEMAS.chart.validator).toMatchObject({ name: 'chart-renderability' })
    expect(COMPONENT_SCHEMAS.grid.required).toEqual(['items'])
    expect(COMPONENT_SCHEMAS.grid.optional.cols).toBe('number')
  })

  it('validates nested record fields before repair can discard malformed entries', () => {
    const result = processGenuiSpec({ items: [{
      type: 'steps',
      steps: [{ title: 123 }],
    }] })
    expect(result.errors).toContain('items[0].steps[0].title must be a string')
    expect(result.repaired?.items[0]).toEqual({ type: 'steps', steps: [] })
  })

  it('validates enum domains from the runtime registry', () => {
    expect(validateGenuiSpec({ items: [{ type: 'callout', content: 'x', tone: 'warn' }] }).errors)
      .toContain('items[0].tone must be one of info, success, warning, error')
    expect(validateGenuiSpec({ items: [{
      type: 'plot',
      series: [{ expr: 'x', kind: 'bars' }],
    }] }).errors).toContain('items[0].series[0].kind must be one of line, area, scatter')
  })

  it('normalizes every issue #102 alias with stable warning paths', () => {
    const result = normalizeGenuiSpec({ items: [
      { type: 'card', label: '标题', content: [{ type: 'text', text: '卡片' }] },
      { type: 'table', headers: ['名称'], data: [['苹果']] },
      { type: 'callout', kind: 'warning', content: '注意' },
      { type: 'steps', items: [{ title: '第一步' }] },
    ] })
    expect(result.value).toEqual({ items: [
      { type: 'card', title: '标题', items: [{ type: 'text', content: '卡片' }] },
      { type: 'table', columns: ['名称'], rows: [['苹果']] },
      { type: 'callout', tone: 'warning', content: '注意' },
      { type: 'steps', steps: [{ title: '第一步' }] },
    ] })
    expect(result.warnings.map(warning => [warning.path, warning.field, warning.canonical])).toEqual([
      ['items[0].label', 'label', 'title'],
      ['items[0].content', 'content', 'items'],
      ['items[0].items[0].text', 'text', 'content'],
      ['items[1].headers', 'headers', 'columns'],
      ['items[1].data', 'data', 'rows'],
      ['items[2].kind', 'kind', 'tone'],
      ['items[3].items', 'items', 'steps'],
    ])
  })

  it('keeps canonical fields when an alias is also present', () => {
    const result = normalizeGenuiSpec({ items: [
      { type: 'card', title: 'canonical', label: 'legacy', items: [], content: [{ type: 'text', content: 'ignored' }] },
      { type: 'table', columns: ['canonical'], headers: ['legacy'], rows: [], data: [['ignored']] },
    ] })
    expect(result.value).toEqual({ items: [
      { type: 'card', title: 'canonical', items: [] },
      { type: 'table', columns: ['canonical'], rows: [] },
    ] })
    expect(result.warnings).toHaveLength(4)
    expect(validateGenuiSpec(result.value).ok).toBe(true)
    expect(normalizeGenuiSpec(result.value)).toEqual({ value: result.value, warnings: [] })
  })

  it('retains existing compatibility aliases and table object semantics', () => {
    const result = processGenuiSpec({ items: [
      { type: 'text', text: '旧文本' },
      { type: 'badge', text: '文本徽章' },
      { type: 'badge', value: '值徽章' },
      { type: 'tabs', tabs: [{ label: '一', content: { type: 'text', content: '内容' } }] },
      { type: 'table', columns: [{ title: '名称', key: 'name' }], data: [{ name: '苹果' }] },
    ] })
    expect(result.errors).toEqual([])
    expect(result.repaired?.items).toEqual([
      { type: 'text', content: '旧文本' },
      { type: 'badge', label: '文本徽章' },
      { type: 'badge', label: '值徽章' },
      { type: 'tabs', tabs: [{ label: '一', items: [{ type: 'text', content: '内容' }] }] },
      { type: 'table', columns: ['名称'], rows: [['苹果']] },
    ])
  })

  it('warns for native unknown fields but keeps custom nodes opaque', () => {
    const native = diagnoseUnknownGenuiFields({ items: [
      { type: 'callout', content: 'x', typo: true },
      { type: 'custom-widget', typo: true, nested: { type: 'callout', kind: 'error' } },
    ] })
    expect(native).toHaveLength(1)
    expect(native[0]).toMatchObject({ path: 'items[0].typo', field: 'typo', type: 'callout' })
    const result = processGenuiSpec({ items: [
      { type: 'callout', content: 'x', typo: true },
      { type: 'custom-widget', typo: true },
    ] })
    expect(result.errors).toEqual([])
    expect(result.warnings.some(warning => warning.path === 'items[0].typo')).toBe(true)
    expect(result.warnings.some(warning => warning.path.includes('items[1]'))).toBe(false)
    expect(result.repaired?.items[1]).toEqual({ type: 'custom-widget', typo: true })
  })

  it('diagnoses root and nested native record typos without inspecting custom payloads', () => {
    const warnings = diagnoseUnknownGenuiFields({
      title: 'x',
      itmes: [],
      items: [{
        type: 'chart',
        data: [{ label: '一', value: 1, lable: 'typo' }],
      }, {
        type: 'tabs',
        tabs: [{ label: 'tab', items: [], lable: 'typo' }],
      }, {
        type: 'accordion',
        items: [{ title: 'section', items: [], titlle: 'typo' }],
      }, {
        type: 'diagram',
        kind: 'flowchart',
        nodes: [{ id: 'a', label: 'A', lable: 'typo' }],
        edges: [{ from: 'a', to: 'a', fro: 'typo' }],
        zones: [{ label: 'z', labell: 'typo' }],
        theme: { accent: '#fff', acccent: '#000' },
      }, {
        type: 'custom-widget',
        nested: { type: 'chart', data: [{ typo: true }] },
      }],
    })
    expect(warnings.map(warning => warning.path)).toEqual(expect.arrayContaining([
      'spec.itmes',
      'items[0].data[0].lable',
      'items[1].tabs[0].lable',
      'items[2].items[0].titlle',
      'items[3].nodes[0].lable',
      'items[3].edges[0].fro',
      'items[3].zones[0].labell',
      'items[3].theme.acccent',
    ]))
    expect(warnings.some(warning => warning.path.includes('custom-widget'))).toBe(false)
  })

  it('keeps native drop detection separate from custom nodes and file-tree data', () => {
    const custom = processGenuiSpec({ items: [
      { type: 'image', src: 'javascript:alert(1)' },
      { type: 'custom-widget', payload: { type: 'image', src: 'javascript:opaque' } },
    ] })
    expect(custom.declaredNativeCount).toBe(1)
    expect(custom.renderedNativeCount).toBe(0)
    expect(custom.renderedTotalCount).toBe(1)
    expect(custom.errors.some(error => error.includes('declared 1, rendered 0'))).toBe(true)

    const tree = processGenuiSpec({ items: [
      { type: 'image', src: 'javascript:alert(1)' },
      { type: 'file-tree', items: [{ name: 'src', type: 'dir', children: [{ name: 'a.ts', type: 'file' }] }] },
    ] })
    expect(tree.declaredNativeCount).toBe(2)
    expect(tree.renderedNativeCount).toBe(1)
    expect(tree.renderedTotalCount).toBe(1)
    expect(tree.errors.some(error => error.includes('declared 2, rendered 1'))).toBe(true)
  })

  it('keeps alias diagnostics stable for component-specific canonical fields', () => {
    const adopted = normalizeGenuiSpec({ items: [{ type: 'text', text: 'legacy' }] }).warnings[0]
    const ignored = normalizeGenuiSpec({ items: [{ type: 'text', text: 'legacy', content: 'canonical' }] }).warnings[0]
    expect(adopted?.message).toContain('normalized/adopted')
    expect(ignored?.message).toContain('ignored because canonical')
  })

  it('shares complete chart renderability errors between process and chart-contract', () => {
    const raw = { items: [{
      type: 'chart',
      kind: 'line',
      series: [{ label: 'A', data: [] }],
    }] }
    const processed = processGenuiSpec(raw)
    const shared = validateRenderableChartSemantics(processed.normalized)
    expect(shared).toEqual(expect.arrayContaining([
      'items[0].series is only supported for bars',
      'items[0].data is required for line',
      'items[0].series[0].data must not be empty',
    ]))
    expect(processed.errors).toEqual(expect.arrayContaining(shared))
  })

  it('diagnoses root and native nested record typos without entering custom payloads', () => {
    const warnings = diagnoseUnknownGenuiFields({
      titel: 'typo',
      items: [{
        type: 'chart',
        data: [{ label: 'A', value: 1, colour: '#fff' }],
        series: [{ label: 'S', data: [{ label: 'B', value: 2, valye: 3 }] }],
      }, {
        type: 'tabs',
        tabs: [{ label: 'Tab', items: [], labell: 'typo' }],
      }, {
        type: 'accordion',
        items: [{ title: 'Panel', items: [], titlle: 'typo' }],
      }, {
        type: 'diagram',
        kind: 'flowchart',
        nodes: [{ id: 'a', label: 'A', labell: 'typo' }],
        edges: [{ from: 'a', to: 'a', too: 'typo' }],
        zones: [{ label: 'Z', labell: 'typo' }],
        theme: { accent: '#fff', acccent: '#000' },
      }, {
        type: 'custom-widget',
        payload: { titel: 'opaque', nested: { colour: true } },
      }],
    })
    expect(warnings.map(warning => warning.path)).toEqual([
      'spec.titel',
      'items[0].data[0].colour',
      'items[0].series[0].data[0].valye',
      'items[1].tabs[0].labell',
      'items[2].items[0].titlle',
      'items[3].nodes[0].labell',
      'items[3].edges[0].too',
      'items[3].zones[0].labell',
      'items[3].theme.acccent',
    ])
  })

  it('keeps card alias diagnostics stable when canonical fields are present', () => {
    const adopted = normalizeGenuiSpec({ items: [{ type: 'card', label: 'legacy', items: [] }] }).warnings[0]
    const ignored = normalizeGenuiSpec({ items: [{ type: 'card', title: 'canonical', label: 'legacy', items: [] }] }).warnings[0]
    expect(adopted.message).toContain('normalized/adopted')
    expect(ignored.message).toContain('ignored because canonical field')
  })

  it('reports native nodes dropped by repair with declared/rendered counts', () => {
    const result = processGenuiSpec({ items: [
      { type: 'table', columns: {}, rows: 42 },
      { type: 'text', content: '保留' },
    ] })
    expect(result.declaredCount).toBe(2)
    expect(result.renderedCount).toBe(1)
    expect(result.errors.some(error => error.includes('declared 2, rendered 1'))).toBe(true)
    expect(result.repaired?.items).toEqual([{ type: 'text', content: '保留' }])
  })

  it('makes direct repair and validation consume canonical aliases', () => {
    const raw = { items: [
      { type: 'callout', kind: 'info', content: 'hello' },
      { type: 'steps', items: [{ title: 'one' }] },
    ] }
    expect(validateGenuiSpec(raw)).toEqual({ ok: true, errors: [] })
    expect(repairGenuiSpec(raw)).toEqual({ items: [
      { type: 'callout', content: 'hello', tone: 'info' },
      { type: 'steps', steps: [{ title: 'one' }] },
    ] })
  })
})
