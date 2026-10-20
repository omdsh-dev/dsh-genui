import { describe, expect, it } from 'vitest'
import { partialRepairGenuiSpec, processGenuiSpec, repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'
import { COMPONENT_SCHEMAS } from '../src/client/genui-runtime/schema.ts'
import { normalizeGenuiSpec } from '../src/client/genui-runtime/normalize.ts'
import { diagnoseUnknownGenuiFields } from '../src/client/genui-runtime/diagnostics.ts'
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

  it('infers the six uniquely identified component types without changing the input', () => {
    const spec = {
      gap: 12,
      items: [
        { columns: ['Name'], rows: [['AGENTS.md']] },
        { pairs: [{ key: 'status', value: 'active' }] },
        { steps: [{ title: 'Review' }] },
        { diffs: [{ path: 'a.ts', newText: 'updated' }] },
        { meshes: [{ shape: 'box' }] },
        { tabs: [{ label: 'Details', items: [{ columns: ['Name'], rows: [['README.md']] }] }] },
      ],
    }
    const original = structuredClone(spec)
    const normalized = normalizeGenuiSpec(spec)

    expect(normalized.value).toEqual({
      gap: 12,
      items: [
        { type: 'table', columns: ['Name'], rows: [['AGENTS.md']] },
        { type: 'keyvalue', pairs: [{ key: 'status', value: 'active' }] },
        { type: 'steps', steps: [{ title: 'Review' }] },
        { type: 'diff', diffs: [{ path: 'a.ts', newText: 'updated' }] },
        { type: 'scene3d', meshes: [{ shape: 'box' }] },
        { type: 'tabs', tabs: [{ label: 'Details', items: [{ type: 'table', columns: ['Name'], rows: [['README.md']] }] }] },
      ],
    })
    expect(processGenuiSpec(spec).errors).toEqual([])
    expect(spec).toEqual(original)
  })

  it('processes the issue #325 table example with its original row data', () => {
    const spec = {
      gap: 12,
      items: [{
        columns: ['文件', '要点', '状态'],
        rows: [
          ['AGENTS.md', '全局基线', '在用'],
          ['SOUL.md', '人格设定', '备份'],
        ],
      }],
    }
    const original = structuredClone(spec)
    const normalized = normalizeGenuiSpec(spec)

    expect(normalized.value).toEqual({
      gap: 12,
      items: [{ type: 'table', columns: spec.items[0]!.columns, rows: spec.items[0]!.rows }],
    })
    expect(processGenuiSpec(spec).errors).toEqual([])
    expect(spec).toEqual(original)
  })

  it('infers uniquely shaped components nested in containers and list entries', () => {
    const spec = {
      items: [
        ...['row', 'col', 'grid', 'card'].map(type => ({ type, items: [{ columns: ['Name'], rows: [['one']] }] })),
        { type: 'list', items: [{ pairs: [{ key: 'status', value: 'ready' }] }] },
      ],
    }
    const result = processGenuiSpec(spec)

    expect(result.errors).toEqual([])
    expect(result.normalized.items.slice(0, 4).map(container => container.items[0]?.type))
      .toEqual(['table', 'table', 'table', 'table'])
    expect(result.normalized.items[4]?.items[0]?.type).toBe('keyvalue')
  })

  it('does not infer ambiguous shapes or objects with an explicit invalid type', () => {
    const nodes = [
      { columns: ['Name'], rows: [['one']], tabs: [] },
      { type: null, columns: ['Name'], rows: [['one']] },
      { type: 123, columns: ['Name'], rows: [['one']] },
    ]

    for (const node of nodes) {
      const raw = { items: [node] }
      expect(normalizeGenuiSpec(raw).value).toEqual(raw)
      expect(processGenuiSpec(raw).errors).toContain("items[0]: missing string 'type'")
    }
  })

  it('exposes runtime required, optional, rule, and validator metadata', () => {
    expect(COMPONENT_SCHEMAS.card.fields.title).toBe('string')
    expect(COMPONENT_SCHEMAS.card.optional.title).toBe('string')
    expect(COMPONENT_SCHEMAS.chart.required).toEqual([])
    expect(COMPONENT_SCHEMAS.chart.oneOfRequired).toEqual([['data', 'series']])
    // v3: `line` may carry its points in `series`, so only the donut keeps a
    // conditional `data` requirement.
    expect(COMPONENT_SCHEMAS.chart.conditionalRequired).toHaveLength(1)
    expect(COMPONENT_SCHEMAS.chart.conditionalRequired[0]!.when).toEqual({ field: 'kind', equals: 'donut' })
    expect(COMPONENT_SCHEMAS.chart.fields.horizontal).toBe('boolean')
    expect(COMPONENT_SCHEMAS.chart.fields.stacked).toBe('boolean')
    expect(COMPONENT_SCHEMAS.stat.fields.spark).toBe('array')
    expect(COMPONENT_SCHEMAS.table.fields.types).toBe('array')
    expect(COMPONENT_SCHEMAS.progress.enums.variant).toEqual(['bar', 'ring'])
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

  it('returns each nested record error once across validation and processing', () => {
    const cases = [
      { name: 'chart data', spec: { items: [{ type: 'chart', kind: 'line', data: [3, 4] }] }, paths: ['items[0].data[0]', 'items[0].data[1]'] },
      { name: 'chart series data', spec: { items: [{ type: 'chart', kind: 'line', data: [{ label: 'a', value: 1 }], series: [{ label: 'S1', data: [3, 4] }] }] }, paths: ['items[0].series[0].data[0]', 'items[0].series[0].data[1]'] },
      { name: 'tabs', spec: { items: [{ type: 'tabs', tabs: [3, 4] }] }, paths: ['items[0].tabs[0]', 'items[0].tabs[1]'] },
      { name: 'accordion', spec: { items: [{ type: 'accordion', items: [3, 4] }] }, paths: ['items[0].items[0]', 'items[0].items[1]'] },
      { name: 'two chart series with five points each', spec: { items: [{ type: 'chart', kind: 'line', data: [{ label: 'a', value: 1 }], series: [{ label: 'S1', data: [1, 2, 3, 4, 5] }, { label: 'S2', data: [1, 2, 3, 4, 5] }] }] }, paths: [
        'items[0].series[0].data[0]', 'items[0].series[0].data[1]', 'items[0].series[0].data[2]', 'items[0].series[0].data[3]', 'items[0].series[0].data[4]',
        'items[0].series[1].data[0]', 'items[0].series[1].data[1]', 'items[0].series[1].data[2]', 'items[0].series[1].data[3]', 'items[0].series[1].data[4]',
      ] },
    ]
    for (const { name, spec, paths } of cases) {
      const expected = paths.map(path => `${path} must be an object`)
      for (const errors of [validateGenuiSpec(spec).errors, processGenuiSpec(spec).errors]) {
        expect(errors, name).toEqual([...new Set(errors)])
        expect(errors.filter(error => error.endsWith('must be an object')), name).toEqual(expected)
      }
    }
  })

  it('validates enum domains from the runtime registry', () => {
    // 'purple' stays outside every tone vocabulary; 'warn'/'danger' on a
    // callout are now value-aliases (warn→warning, danger→error, issue #186),
    // so they normalize instead of failing the enum.
    expect(validateGenuiSpec({ items: [{ type: 'callout', content: 'x', tone: 'purple' }] }).errors)
      .toContain('items[0].tone must be one of info, success, warning, error')
    expect(validateGenuiSpec({ items: [{ type: 'callout', content: 'x', tone: 'warn' }] }).errors).toEqual([])
    expect(validateGenuiSpec({ items: [{ type: 'callout', content: 'x', tone: 'danger' }] }).errors).toEqual([])
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

  it('carries the divider label through validation, aliases, and repair', () => {
    expect(validateGenuiSpec({ items: [{ type: 'divider', label: '数据' }] }).ok).toBe(true)
    expect(repairGenuiSpec({ items: [{ type: 'divider', label: '数据' }] })?.items[0])
      .toEqual({ type: 'divider', label: '数据' })
    // `title`/`text` normalize onto `label` with the stable alias warning.
    const normalized = normalizeGenuiSpec({ items: [{ type: 'divider', title: '数据' }] })
    expect(normalized.value).toEqual({ items: [{ type: 'divider', label: '数据' }] })
    expect(normalized.warnings.map(warning => [warning.path, warning.field, warning.canonical]))
      .toEqual([['items[0].title', 'title', 'label']])
    // Overlong labels truncate in repair instead of dropping the node.
    expect((repairGenuiSpec({ items: [{ type: 'divider', label: '标'.repeat(80) }] })?.items[0] as { label?: string }).label)
      .toHaveLength(64)
    // Undeclared fields on divider still surface as unknown-field diagnostics.
    expect(diagnoseUnknownGenuiFields({ items: [{ type: 'divider', typo: 1 }] }))
      .toMatchObject([{ path: 'items[0].typo', field: 'typo', type: 'divider' }])
  })

  it('carries the B1/B3/B4 anthology fields through validation and repair', () => {
    // B1: display tier + align (legacy `center` stays valid alongside).
    expect(validateGenuiSpec({ items: [
      { type: 'text', size: 'display', content: '开篇', align: 'center' },
      { type: 'text', content: '正文', center: true },
    ] }).ok).toBe(true)
    expect(validateGenuiSpec({ items: [{ type: 'text', content: 'x', align: 'middle' }] }).errors)
      .toContain('items[0].align must be one of left, center, right')
    expect(validateGenuiSpec({ items: [{ type: 'text', content: 'x', size: 'huge' }] }).errors)
      .toContain('items[0].size must be one of display, h1, h2, h3, body, muted, caption')
    const text = repairGenuiSpec({ items: [{ type: 'text', content: '开篇', size: 'display', align: 'right' }] })?.items[0]
    expect(text).toEqual({ type: 'text', content: '开篇', size: 'display', align: 'right' })
    // B3: card eyebrow survives repair and truncates like short labels.
    expect(repairGenuiSpec({ items: [{ type: 'card', eyebrow: '第'.repeat(80), title: 'T', items: [] }] })?.items[0])
      .toMatchObject({ eyebrow: '第'.repeat(64), title: 'T' })
    // B4: image caption rides the same pipeline as alt.
    expect(repairGenuiSpec({ items: [{ type: 'image', src: 'https://example.com/a.png', alt: 'A', caption: '来源：X' }] })?.items[0])
      .toEqual({ type: 'image', src: 'https://example.com/a.png', alt: 'A', caption: '来源：X' })
    // Undeclared fields on these components still surface as unknown-field warnings.
    expect(diagnoseUnknownGenuiFields({ items: [
      { type: 'card', items: [], caption: 'x' },
      { type: 'image', src: 'https://example.com/a.png', eyebrow: 'x' },
    ] }).map(d => d.path)).toEqual(['items[0].caption', 'items[1].eyebrow'])
  })

  it('normalizes aliases inside renderer-reachable table details before submission validation', () => {
    const raw = { items: [
      { type: 'table', columns: ['项目'], rows: [['A']], details: [[{ type: 'select', id: 'choice', items: ['A', 'B'] }]] },
      { type: 'submit', label: '提交', action: 'send', groups: ['choice'] },
    ] }
    const normalized = normalizeGenuiSpec(raw)
    expect(normalized.value).toEqual({ items: [
      { type: 'table', columns: ['项目'], rows: [['A']], details: [[{ type: 'select', id: 'choice', options: ['A', 'B'] }]] },
      { type: 'submit', label: '提交', action: 'send', groups: ['choice'] },
    ] })
    expect(normalized.warnings).toContainEqual(expect.objectContaining({ path: 'items[0].details[0][0].items', canonical: 'options' }))
    const processed = processGenuiSpec(raw)
    expect(processed.errors).toEqual([])
    expect((processed.repaired?.items[0] as { details: unknown[][] }).details[0]).toEqual([{ type: 'select', id: 'choice', options: ['A', 'B'] }])
  })

  it('preserves detail alias normalization and row alignment after pruning a bad entry', () => {
    const raw = { items: [
      { type: 'table', columns: ['Item'], rows: [['A'], ['B']], details: [{ type: 'text', content: 'bad entry' }, [{ type: 'select', id: 'choice', items: ['A', 'B'] }]] },
      { type: 'submit', label: 'Send', action: 'send', groups: ['choice'] },
    ] }
    const processed = processGenuiSpec(raw)
    expect(processed.errors).toEqual(['items[0].details[0] must be an array or null'])
    expect(processed.warnings).toContainEqual(expect.objectContaining({ path: 'items[0].details[1][0].items', canonical: 'options' }))
    const candidate = partialRepairGenuiSpec(processed)
    expect(candidate?.items).toEqual([
      { type: 'table', columns: ['Item'], rows: [['A'], ['B']], details: [null, [{ type: 'select', id: 'choice', options: ['A', 'B'] }]] },
      raw.items[1],
    ])
    expect(validateGenuiSpec(candidate).ok).toBe(true)
  })

  it('leaves group-header details outside normalization and diagnostics', () => {
    const raw = { items: [{
      type: 'table', columns: ['区域', '数值'], types: ['group', 'num'], rows: [['华东', ''], ['上海', '120']],
      details: [[{ type: 'select', id: 'hidden', items: ['A', 'B'], lable: '隐藏' }], null],
    }] }
    const normalized = normalizeGenuiSpec(raw)
    expect((normalized.value as typeof raw).items[0]!.details![0]![0]).toMatchObject({ items: ['A', 'B'], lable: '隐藏' })
    expect(normalized.warnings.some(warning => warning.path === 'items[0].details[0][0].items')).toBe(false)
    expect(diagnoseUnknownGenuiFields(normalized.value).some(warning => warning.path === 'items[0].details[0][0].lable')).toBe(false)
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

  it('derives table columns from a headerless 2D rows/data body', () => {
    // Real-session sample: the model ships `{type:'table', data:[[…],[…]]}`
    // with no `columns`. Before this, repair dropped the node and the whole
    // fence degraded to a code block; now the leading row becomes the header.
    const headed = processGenuiSpec({ items: [
      { type: 'table', data: [['#', '任务'], ['t1', '后端'], ['t2', '前端']] },
    ] })
    expect(headed.errors).toEqual([])
    expect(headed.repaired?.items).toEqual([
      { type: 'table', columns: ['#', '任务'], rows: [['t1', '后端'], ['t2', '前端']] },
    ])

    // Ragged body: the leading row is data, so the columns are neutral names
    // rather than a fabricated header taken from that row's text.
    const ragged = processGenuiSpec({ items: [
      { type: 'table', rows: [['a', 'b', 'c'], ['1']] },
    ] })
    expect(ragged.errors).toEqual([])
    expect(ragged.repaired?.items).toEqual([
      { type: 'table', columns: ['列1', '列2', '列3'], rows: [['a', 'b', 'c'], ['1']] },
    ])

    // Header-only capture stays a (header) table with an empty body.
    expect(processGenuiSpec({ items: [{ type: 'table', rows: [['名称', '结果']] }] }).repaired?.items)
      .toEqual([{ type: 'table', columns: ['名称', '结果'], rows: [] }])

    // A non-2D body is still a contract error, not something to invent from.
    expect(processGenuiSpec({ items: [{ type: 'table', rows: 42 }] }).errors)
      .toContain("items[0]: type 'table' requires rows (array)")
    expect(processGenuiSpec({ items: [{ type: 'table', rows: [] }] }).errors)
      .toContain("items[0]: type 'table' requires columns (array)")
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

  it('warns about unknown fields inside renderer-reachable table details', () => {
    const warnings = diagnoseUnknownGenuiFields({ items: [
      { type: 'table', columns: ['项目'], rows: [['A']], details: [[{ type: 'input', lable: '姓名' }]] },
    ] })
    expect(warnings).toContainEqual(expect.objectContaining({
      kind: 'unknown-field',
      path: 'items[0].details[0][0].lable',
      type: 'input',
    }))
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
    // A line chart may carry its points in `series` (v3), so the remaining
    // renderability error is the empty series itself.
    const raw = { items: [{
      type: 'chart',
      kind: 'line',
      series: [{ label: 'A', data: [] }],
    }] }
    const processed = processGenuiSpec(raw)
    const shared = validateRenderableChartSemantics(processed.normalized)
    expect(shared).toEqual(expect.arrayContaining([
      'items[0].series[0].data must not be empty',
    ]))
    expect(processed.errors).toEqual(expect.arrayContaining(shared))

    // The donut stays single-series and still needs `data`.
    const donut = { items: [{ type: 'chart', kind: 'donut', series: [{ label: 'A', data: [{ label: 'X', value: 1 }] }] }] }
    const donutShared = validateRenderableChartSemantics(processGenuiSpec(donut).normalized)
    expect(donutShared).toEqual(expect.arrayContaining([
      'items[0].series is only supported for bars and line',
      'items[0].data is required for donut',
    ]))
  })

  it('accepts grouped bars that keep their points in series (data: [])', () => {
    const processed = processGenuiSpec({ items: [{
      type: 'chart',
      data: [],
      series: [
        { label: '本月', data: [{ label: 'Q1', value: 3 }] },
        { label: '上月', data: [{ label: 'Q1', value: 2 }] },
      ],
    }] })
    expect(processed.errors).toEqual([])
    expect(validateRenderableChartSemantics(processed.normalized)).toEqual([])
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
