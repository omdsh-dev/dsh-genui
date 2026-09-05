/** Runtime metadata shared by GenUI normalization and diagnostics. */

export type ComponentFieldKind =
  | 'string'
  | 'string-or-null'
  | 'number'
  | 'boolean'
  | 'nodes'
  | 'array'
  | 'object'
  | 'unknown'

/** A conditional rule for fields whose presence depends on another field. */
export interface ComponentConditionalRule {
  readonly kind: 'required-if'
  readonly when: { readonly field: string; readonly equals: unknown }
  readonly required: readonly string[]
  readonly message?: string
}

/** A field rule that requires at least one member of a field group. */
export interface ComponentOneOfRule {
  readonly kind: 'one-of-required'
  readonly fields: readonly string[]
  readonly message?: string
}

/** Runtime metadata naming a component-specific semantic validator. */
export interface ComponentValidatorMetadata {
  readonly name: string
  readonly [key: string]: unknown
}

/** Runtime schema for an object nested inside a native component field. */
export interface ComponentRecordSchema {
  readonly required: readonly string[]
  readonly fields: Readonly<Record<string, ComponentFieldKind>>
  readonly enums: Readonly<Record<string, readonly string[]>>
  readonly nested: Readonly<Record<string, ComponentRecordSchema>>
}

export interface ComponentSchema {
  readonly required: readonly string[]
  readonly fields: Readonly<Record<string, ComponentFieldKind>>
  readonly enums: Readonly<Record<string, readonly string[]>>
  /** Explicit optional field kinds; `fields` remains the complete field map. */
  readonly optional: Readonly<Record<string, ComponentFieldKind>>
  readonly aliases: Readonly<Record<string, string>>
  readonly oneOfRequired: readonly (readonly string[])[]
  readonly conditionalRequired: readonly ComponentConditionalRule[]
  readonly rules: readonly (ComponentOneOfRule | ComponentConditionalRule)[]
  readonly nested: Readonly<Record<string, ComponentRecordSchema>>
  readonly validator?: ComponentValidatorMetadata
}

export interface GenuiDiagnostic {
  readonly kind: 'alias' | 'unknown-field'
  readonly path: string
  readonly message: string
  readonly type?: string
  readonly field?: string
  readonly canonical?: string
}

/** Canonical enum domains shared by schema validation and repair. */
export const TEXT_SIZES = ['h1', 'h2', 'h3', 'body', 'muted', 'caption'] as const
export const BUTTON_TONES = ['primary', 'danger', 'success', 'ghost'] as const
export const BADGE_TONES = ['success', 'warn', 'danger', 'accent'] as const
export const INPUT_TYPES = ['text', 'email', 'password'] as const
export const CALLOUT_TONES = ['info', 'success', 'warning', 'error'] as const
export const CHART_KINDS = ['bars', 'line', 'donut'] as const
export const PLOT_KINDS = ['line', 'area', 'scatter'] as const
export const MEDIA_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '9:16'] as const
export const MESH_SHAPES = ['box', 'sphere', 'cone', 'cylinder', 'torus'] as const
export const FILE_TYPES = ['file', 'dir'] as const
export const DIAGRAM_KINDS = [
  'architecture', 'it-state', 'flowchart', 'sequence', 'state', 'er', 'timeline',
  'swimlane', 'quadrant', 'radar', 'loop', 'nested', 'tree', 'org-chart', 'layers',
  'venn', 'pyramid', 'bar', 'line', 'gantt', 'scatter', 'high-level', 'process',
  'medallion', 'data-flow', 'dp-integration', 'dp-security-matrix',
] as const
export const DIAGRAM_NODE_TYPES = ['focal', 'backend', 'store', 'external', 'input', 'optional', 'security'] as const
export const DIAGRAM_VARIANTS = ['light', 'dark', 'editorial'] as const
export const DIAGRAM_EDGE_KINDS = ['solid', 'dashed', 'accent', 'link'] as const
export const DIAGRAM_ROUTES = ['auto', 'orthogonal', 'straight'] as const
export const ECHART_PRESETS = ['bar', 'line', 'area', 'pie', 'scatter'] as const

const schema = (
  required: readonly string[],
  fields: Readonly<Record<string, ComponentFieldKind>>,
  aliases: Readonly<Record<string, string>> = {},
  options: {
    oneOfRequired?: readonly (readonly string[])[]
    conditionalRequired?: readonly ComponentConditionalRule[]
    nested?: Readonly<Record<string, ComponentRecordSchema>>
    enums?: Readonly<Record<string, readonly string[]>>
    validator?: ComponentValidatorMetadata
  } = {},
): ComponentSchema => {
  const optional = Object.fromEntries(
    Object.entries(fields).filter(([field]) => field !== 'type' && !required.includes(field)),
  ) as Record<string, ComponentFieldKind>
  const oneOfRequired = options.oneOfRequired ?? []
  const conditionalRequired = options.conditionalRequired ?? []
  const rules: Array<ComponentOneOfRule | ComponentConditionalRule> = [
    ...oneOfRequired.map(fieldsInRule => ({ kind: 'one-of-required' as const, fields: fieldsInRule })),
    ...conditionalRequired,
  ]
  return {
    required,
    fields,
    optional,
    aliases,
    oneOfRequired,
    conditionalRequired,
    rules,
    enums: options.enums ?? {},
    nested: options.nested ?? {},
    ...(options.validator === undefined ? {} : { validator: options.validator }),
  }
}

const recordSchema = (
  required: readonly string[],
  fields: Readonly<Record<string, ComponentFieldKind>>,
  nested: Readonly<Record<string, ComponentRecordSchema>> = {},
  enums: Readonly<Record<string, readonly string[]>> = {},
): ComponentRecordSchema => ({ required, fields, enums, nested })

const nodeFields = { type: 'string' } as const

const chartDatumSchema = recordSchema(['label', 'value'], {
  label: 'string',
  value: 'number',
  color: 'string',
})

const chartSeriesSchema = recordSchema(['label', 'data'], {
  label: 'string',
  color: 'string',
  data: 'array',
}, { data: chartDatumSchema })

const stepsRecordSchema = recordSchema(['title'], { title: 'string', desc: 'string' })
const keyValueRecordSchema = recordSchema(['key', 'value'], { key: 'string', value: 'string' })
const timelineRecordSchema = recordSchema(['title'], { title: 'string', desc: 'string', time: 'string' })
const diffRecordSchema = recordSchema(['path', 'newText'], { path: 'string', oldText: 'string-or-null', newText: 'string' })
const plotParamSchema = recordSchema(['name', 'value'], {
  name: 'string', value: 'number', min: 'number', max: 'number', step: 'number', animateTo: 'number', durationMs: 'number', loop: 'boolean',
})
const plotSeriesSchema = recordSchema(['expr'], {
  expr: 'string', label: 'string', color: 'string', kind: 'string', params: 'array',
}, { params: plotParamSchema }, { kind: PLOT_KINDS })
const sceneMeshSchema = recordSchema(['shape'], {
  shape: 'string', color: 'string', position: 'array', rotation: 'array', scale: 'unknown', size: 'unknown',
}, {}, { shape: MESH_SHAPES })

function fileTreeRecordSchema(depth: number): ComponentRecordSchema {
  return recordSchema(['name'], {
    name: 'string', type: 'string', children: 'array',
  }, depth > 0 ? { children: fileTreeRecordSchema(depth - 1) } : {}, { type: FILE_TYPES })
}

const fileTreeNodeSchema = fileTreeRecordSchema(6)

const tabHolderSchema = recordSchema(['label', 'items'], {
  label: 'string',
  items: 'nodes',
  content: 'nodes',
})

const accordionHolderSchema = recordSchema(['title', 'items'], {
  title: 'string',
  items: 'nodes',
})

const diagramNodeSchema = recordSchema(['id', 'label'], {
  id: 'string',
  label: 'string',
  sub: 'string',
  type: 'string',
  x: 'number',
  y: 'number',
  w: 'number',
  h: 'number',
  tag: 'string',
}, {}, { type: DIAGRAM_NODE_TYPES })

const diagramEdgeSchema = recordSchema(['from', 'to'], {
  from: 'string',
  to: 'string',
  label: 'string',
  kind: 'string',
  route: 'string',
}, {}, { kind: DIAGRAM_EDGE_KINDS, route: DIAGRAM_ROUTES })

const diagramZoneSchema = recordSchema(['label'], {
  label: 'string',
  x: 'number',
  y: 'number',
  w: 'number',
  h: 'number',
})

const diagramThemeSchema = recordSchema([], {
  paper: 'string',
  'paper-2': 'string',
  ink: 'string',
  muted: 'string',
  soft: 'string',
  rule: 'string',
  accent: 'string',
  'accent-tint': 'string',
  link: 'string',
})

/** Root GenUI specification metadata used by diagnostics. */
export const GENUI_SPEC_SCHEMA = schema(['items'], {
  title: 'string',
  gap: 'number',
  panel: 'boolean',
  append: 'boolean',
  items: 'nodes',
})

/** Backwards-friendly short alias for the root specification schema. */
export const SPEC_SCHEMA = GENUI_SPEC_SCHEMA

/**
 * Native component field metadata.
 *
 * This is intentionally explicit rather than inferred from TypeScript
 * interfaces: the registry is also consumed at runtime by normalization and
 * diagnostics, where erased interfaces are unavailable.
 */
export const COMPONENT_SCHEMAS: Readonly<Record<string, ComponentSchema>> = {
  accordion: schema(['items'], { ...nodeFields, items: 'array' }, {}, { nested: { items: accordionHolderSchema } }),
  audio: schema(['src'], { ...nodeFields, src: 'string', alt: 'string', loop: 'boolean' }),
  avatar: schema(['name'], { ...nodeFields, name: 'string', color: 'string' }),
  badge: schema(['label'], { ...nodeFields, label: 'string', tone: 'string', icon: 'string' }, { text: 'label', value: 'label' }, { enums: { tone: BADGE_TONES } }),
  breadcrumb: schema(['items'], { ...nodeFields, items: 'array' }),
  button: schema(['label'], { ...nodeFields, label: 'string', tone: 'string', full: 'boolean', small: 'boolean', icon: 'string', action: 'string' }, {}, { enums: { tone: BUTTON_TONES } }),
  callout: schema(['content'], { ...nodeFields, title: 'string', content: 'string', tone: 'string' }, { kind: 'tone' }, { enums: { tone: CALLOUT_TONES } }),
  card: schema(['items'], { ...nodeFields, title: 'string', items: 'nodes' }, { label: 'title', content: 'items' }),
  chart: schema([], { ...nodeFields, kind: 'string', data: 'array', series: 'array' }, {}, {
    oneOfRequired: [['data', 'series']],
    conditionalRequired: [
      { kind: 'required-if', when: { field: 'kind', equals: 'line' }, required: ['data'] },
      { kind: 'required-if', when: { field: 'kind', equals: 'donut' }, required: ['data'] },
    ],
    nested: { data: chartDatumSchema, series: chartSeriesSchema },
    enums: { kind: CHART_KINDS },
    validator: { name: 'chart-renderability' },
  }),
  checkbox: schema(['label'], { ...nodeFields, label: 'string', checked: 'boolean', action: 'string' }),
  code: schema(['code'], { ...nodeFields, lang: 'string', code: 'string' }),
  col: schema(['items'], { ...nodeFields, items: 'nodes', gap: 'number' }),
  copy: schema(['text'], { ...nodeFields, label: 'string', text: 'string' }),
  diagram: schema(['kind', 'nodes'], { ...nodeFields, kind: 'string', variant: 'string', title: 'string', nodes: 'array', edges: 'array', zones: 'array', theme: 'object' }, {}, {
    nested: { nodes: diagramNodeSchema, edges: diagramEdgeSchema, zones: diagramZoneSchema, theme: diagramThemeSchema },
    enums: { kind: DIAGRAM_KINDS, variant: DIAGRAM_VARIANTS },
  }),
  diff: schema(['diffs'], { ...nodeFields, diffs: 'array' }, {}, { nested: { diffs: diffRecordSchema } }),
  divider: schema([], nodeFields),
  echart: schema([], { ...nodeFields, title: 'string', height: 'number', preset: 'string', data: 'array', series: 'array', option: 'object' }, {}, {
    oneOfRequired: [['option', 'data', 'series']],
    enums: { preset: ECHART_PRESETS },
  }),
  'file-tree': schema(['items'], { ...nodeFields, items: 'array' }, {}, { nested: { items: fileTreeNodeSchema } }),
  grid: schema(['items'], { ...nodeFields, cols: 'number', items: 'nodes' }),
  image: schema(['src'], { ...nodeFields, src: 'string', alt: 'string' }),
  input: schema([], { ...nodeFields, label: 'string', placeholder: 'string', value: 'string', inputType: 'string', action: 'string', id: 'string' }, {}, { enums: { inputType: INPUT_TYPES } }),
  json: schema(['value'], { ...nodeFields, value: 'unknown' }),
  keyvalue: schema(['pairs'], { ...nodeFields, pairs: 'array' }, {}, { nested: { pairs: keyValueRecordSchema } }),
  link: schema(['label'], { ...nodeFields, label: 'string', href: 'string' }),
  list: schema(['items'], { ...nodeFields, items: 'array' }),
  mermaid: schema(['code'], { ...nodeFields, code: 'string' }),
  plot: schema(['series'], { ...nodeFields, series: 'array', xMin: 'number', xMax: 'number', yMin: 'number', yMax: 'number', title: 'string' }, {}, { nested: { series: plotSeriesSchema } }),
  progress: schema(['value'], { ...nodeFields, value: 'number', label: 'string', valueLabel: 'string' }),
  quiz: schema(['question', 'options'], { ...nodeFields, question: 'string', options: 'array', explanation: 'string', id: 'string', action: 'string' }),
  radio: schema(['options'], { ...nodeFields, label: 'string', options: 'array', selected: 'number', action: 'string', group: 'string', answer: 'unknown', explanation: 'string' }),
  row: schema(['items'], { ...nodeFields, items: 'nodes', wrap: 'boolean', spacer: 'boolean' }),
  scene3d: schema(['meshes'], { ...nodeFields, title: 'string', meshes: 'array', ambient: 'number', background: 'string' }, {}, { nested: { meshes: sceneMeshSchema } }),
  select: schema(['options'], { ...nodeFields, label: 'string', options: 'array', action: 'string', selected: 'number', id: 'string' }),
  slider: schema([], { ...nodeFields, label: 'string', min: 'number', max: 'number', step: 'number', value: 'number', action: 'string', id: 'string' }),
  spacer: schema([], nodeFields),
  stat: schema(['label', 'value'], { ...nodeFields, label: 'string', value: 'string', delta: 'string' }),
  steps: schema(['steps'], { ...nodeFields, steps: 'array', current: 'number' }, { items: 'steps' }, { nested: { steps: stepsRecordSchema } }),
  submit: schema(['label'], { ...nodeFields, label: 'string', action: 'string', resetAction: 'string', groups: 'array' }),
  switch: schema(['label'], { ...nodeFields, label: 'string', checked: 'boolean', action: 'string' }),
  table: schema(['columns', 'rows'], { ...nodeFields, columns: 'array', rows: 'array' }, { headers: 'columns', data: 'rows' }),
  tabs: schema(['tabs'], { ...nodeFields, tabs: 'array' }, {}, { nested: { tabs: tabHolderSchema } }),
  text: schema(['content'], { ...nodeFields, content: 'string', size: 'string', center: 'boolean' }, { text: 'content' }, { enums: { size: TEXT_SIZES } }),
  textarea: schema([], { ...nodeFields, label: 'string', placeholder: 'string', rows: 'number', value: 'string', action: 'string', id: 'string' }),
  timeline: schema(['items'], { ...nodeFields, items: 'array' }, {}, { nested: { items: timelineRecordSchema } }),
  video: schema(['src'], { ...nodeFields, src: 'string', alt: 'string', poster: 'string', loop: 'boolean', muted: 'boolean', aspectRatio: 'string' }, {}, { enums: { aspectRatio: MEDIA_ASPECT_RATIOS } }),
} as const

export const GENUI_NATIVE_TYPES: ReadonlySet<string> = new Set(Object.keys(COMPONENT_SCHEMAS))

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function isNode(value: unknown): value is Record<string, unknown> {
  const candidate = record(value)
  return candidate !== undefined && typeof candidate.type === 'string'
}

function normalizeAliasFields(value: Record<string, unknown>, path: string, type: string, warnings: GenuiDiagnostic[]): Record<string, unknown> {
  const definition = COMPONENT_SCHEMAS[type]
  if (definition === undefined) return value
  const out: Record<string, unknown> = { ...value }
  for (const [alias, canonical] of Object.entries(definition.aliases)) {
    if (!(alias in out)) continue
    const aliasPath = `${path}.${alias}`
    const keptCanonical = canonical in out
    if (!keptCanonical) out[canonical] = out[alias]
    delete out[alias]
    warnings.push({
      kind: 'alias',
      path: aliasPath,
      message: keptCanonical
        ? `${aliasPath} is ignored because canonical field '${canonical}' is present`
        : `${aliasPath} normalized/adopted as '${canonical}'`,
      type,
      field: alias,
      canonical,
    })
  }
  return out
}

function normalizeNode(value: unknown, path: string, warnings: GenuiDiagnostic[]): unknown {
  if (!isNode(value)) return value
  const type = value.type as string
  const definition = COMPONENT_SCHEMAS[type]
  // Custom nodes are opaque by contract: don't inspect or rewrite their data.
  if (definition === undefined) return value
  const out = normalizeAliasFields(value, path, type, warnings)
  const normalizeNodeValue = (child: unknown, childPath: string): unknown => normalizeNode(child, childPath, warnings)
  const normalizeNodeArray = (children: unknown, childPath: string): unknown => Array.isArray(children)
    ? children.map((child, index) => normalizeNodeValue(child, `${childPath}[${index}]`))
    : children

  if (type === 'row' || type === 'col' || type === 'grid' || type === 'card' || type === 'file-tree' || type === 'timeline' || type === 'breadcrumb') {
    if (type !== 'file-tree' && type !== 'timeline' && type !== 'breadcrumb') out.items = normalizeNodeArray(out.items, `${path}.items`)
  } else if (type === 'list' && Array.isArray(out.items)) {
    out.items = out.items.map((child, index) => isNode(child) ? normalizeNodeValue(child, `${path}.items[${index}]`) : child)
  } else if (type === 'tabs' && Array.isArray(out.tabs)) {
    out.tabs = out.tabs.map((tab, index) => {
      const holder = record(tab)
      if (holder === undefined) return tab
      const normalizedHolder = { ...holder }
      if ('content' in normalizedHolder) {
        const tabPath = `${path}.tabs[${index}].content`
        const hasItems = 'items' in normalizedHolder
        if (!hasItems) normalizedHolder.items = normalizedHolder.content
        delete normalizedHolder.content
        warnings.push({
          kind: 'alias',
          path: tabPath,
          message: hasItems
            ? `${tabPath} is ignored because canonical field 'items' is present`
            : `${tabPath} normalized/adopted as 'items'`,
          type,
          field: 'content',
          canonical: 'items',
        })
      }
      normalizedHolder.items = Array.isArray(normalizedHolder.items)
        ? normalizedHolder.items.map((child, childIndex) => normalizeNodeValue(child, `${path}.tabs[${index}].items[${childIndex}]`))
        : normalizedHolder.items === undefined
          ? normalizedHolder.items
          : [normalizeNodeValue(normalizedHolder.items, `${path}.tabs[${index}].items[0]`)]
      return normalizedHolder
    })
  } else if (type === 'accordion' && Array.isArray(out.items)) {
    out.items = out.items.map((item, index) => {
      const holder = record(item)
      if (holder === undefined) return item
      return { ...holder, items: Array.isArray(holder.items) ? holder.items.map((child, childIndex) => normalizeNodeValue(child, `${path}.items[${index}].items[${childIndex}]`)) : holder.items }
    })
  }
  return out
}

/**
 * Normalize a raw GenUI value into canonical field names.
 *
 * Only deterministic aliases and structural aliases are changed. Resource
 * limits, type repair, security filtering, and semantic validation remain in
 * the guard layer. Unknown component types are returned opaque.
 *
 * @param value - Raw GenUI spec or bare native component.
 * @returns Canonical value and stable alias diagnostics.
 */
export function normalizeGenuiSpec(value: unknown): { value: unknown; warnings: GenuiDiagnostic[] } {
  const warnings: GenuiDiagnostic[] = []
  const root = record(value)
  if (root === undefined) return { value, warnings }
  const out = { ...root }
  if (Array.isArray(out.items)) {
    out.items = out.items.map((item, index) => normalizeNode(item, `items[${index}]`, warnings))
  } else if (typeof out.type === 'string') {
    return { value: normalizeNode(out, 'spec', warnings), warnings }
  }
  return { value: out, warnings }
}

function visitNativeNodes(value: unknown, path: string, visit: (node: Record<string, unknown>, path: string, schema: ComponentSchema) => void): void {
  if (!isNode(value)) return
  const type = value.type as string
  const definition = COMPONENT_SCHEMAS[type]
  if (definition === undefined) return
  visit(value, path, definition)
  const children = (child: unknown, childPath: string): void => visitNativeNodes(child, childPath, visit)
  if ((type === 'row' || type === 'col' || type === 'grid' || type === 'card') && Array.isArray(value.items)) {
    value.items.forEach((child, index) => children(child, `${path}.items[${index}]`))
  } else if (type === 'list' && Array.isArray(value.items)) {
    value.items.forEach((child, index) => children(child, `${path}.items[${index}]`))
  } else if (type === 'tabs' && Array.isArray(value.tabs)) {
    value.tabs.forEach((tab, index) => {
      const holder = record(tab)
      if (holder === undefined) return
      if (Array.isArray(holder.items)) holder.items.forEach((child, childIndex) => children(child, `${path}.tabs[${index}].items[${childIndex}]`))
      else children(holder.items, `${path}.tabs[${index}].items`)
    })
  } else if (type === 'accordion' && Array.isArray(value.items)) {
    value.items.forEach((item, index) => {
      const holder = record(item)
      if (holder?.items !== undefined && Array.isArray(holder.items)) holder.items.forEach((child, childIndex) => children(child, `${path}.items[${index}].items[${childIndex}]`))
    })
  }
}

function pushUnknownField(
  warnings: GenuiDiagnostic[],
  path: string,
  field: string,
  type: string,
): void {
  warnings.push({
    kind: 'unknown-field',
    path: `${path}.${field}`,
    message: `${path}.${field}: unknown field for '${type}'`,
    type,
    field,
  })
}

function diagnoseRecordFields(
  value: unknown,
  path: string,
  definition: ComponentRecordSchema,
  type: string,
  warnings: GenuiDiagnostic[],
): void {
  const holder = record(value)
  if (holder === undefined) return
  for (const field of Object.keys(holder)) {
    if (field in definition.fields) continue
    pushUnknownField(warnings, path, field, type)
  }
  for (const [field, nested] of Object.entries(definition.nested)) {
    const nestedValue = holder[field]
    if (Array.isArray(nestedValue)) {
      nestedValue.forEach((item, index) => diagnoseRecordFields(item, `${path}.${field}[${index}]`, nested, type, warnings))
    } else if (nestedValue !== undefined) {
      diagnoseRecordFields(nestedValue, `${path}.${field}`, nested, type, warnings)
    }
  }
}

function diagnoseNestedFields(
  node: Record<string, unknown>,
  path: string,
  definition: ComponentSchema,
  warnings: GenuiDiagnostic[],
): void {
  for (const [field, nested] of Object.entries(definition.nested)) {
    const nestedValue = node[field]
    if (Array.isArray(nestedValue)) {
      nestedValue.forEach((item, index) => diagnoseRecordFields(item, `${path}.${field}[${index}]`, nested, node.type as string, warnings))
    } else if (nestedValue !== undefined) {
      diagnoseRecordFields(nestedValue, `${path}.${field}`, nested, node.type as string, warnings)
    }
  }
}

/**
 * Diagnose unknown direct fields on native nodes.
 *
 * Unknown types are intentionally skipped so custom renderers retain their
 * opaque extension payloads. Native unknown fields are warnings, not errors.
 *
 * @param value - Canonical or raw GenUI value.
 * @returns Stable field diagnostics in tree order.
 */
export function diagnoseUnknownGenuiFields(value: unknown): GenuiDiagnostic[] {
  const warnings: GenuiDiagnostic[] = []
  const root = record(value)
  if (root === undefined) return warnings
  const visit = (node: Record<string, unknown>, path: string, definition: ComponentSchema): void => {
    for (const field of Object.keys(node)) {
      if (field === 'type' || field in definition.fields) continue
      pushUnknownField(warnings, path, field, node.type as string)
    }
    diagnoseNestedFields(node, path, definition, warnings)
  }
  if (Array.isArray(root.items)) {
    for (const field of Object.keys(root)) {
      if (field in GENUI_SPEC_SCHEMA.fields) continue
      pushUnknownField(warnings, 'spec', field, 'spec')
    }
    root.items.forEach((item, index) => visitNativeNodes(item, `items[${index}]`, visit))
  } else if (typeof root.type === 'string') {
    // A bare component root is a documented shorthand, so its `type` belongs
    // to the native node schema rather than the root specification schema.
    visitNativeNodes(root, 'spec', visit)
  } else {
    for (const field of Object.keys(root)) {
      if (field in GENUI_SPEC_SCHEMA.fields) continue
      pushUnknownField(warnings, 'spec', field, 'spec')
    }
  }
  return warnings
}
