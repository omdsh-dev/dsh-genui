/** Runtime metadata shared by GenUI normalization and diagnostics. */

export type ComponentFieldKind =
  | 'string'
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
  readonly nested: Readonly<Record<string, ComponentRecordSchema>>
}

export interface ComponentSchema {
  readonly required: readonly string[]
  readonly fields: Readonly<Record<string, ComponentFieldKind>>
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

const schema = (
  required: readonly string[],
  fields: Readonly<Record<string, ComponentFieldKind>>,
  aliases: Readonly<Record<string, string>> = {},
  options: {
    oneOfRequired?: readonly (readonly string[])[]
    conditionalRequired?: readonly ComponentConditionalRule[]
    nested?: Readonly<Record<string, ComponentRecordSchema>>
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
    nested: options.nested ?? {},
    ...(options.validator === undefined ? {} : { validator: options.validator }),
  }
}

const recordSchema = (
  required: readonly string[],
  fields: Readonly<Record<string, ComponentFieldKind>>,
  nested: Readonly<Record<string, ComponentRecordSchema>> = {},
): ComponentRecordSchema => ({ required, fields, nested })

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
})

const diagramEdgeSchema = recordSchema(['from', 'to'], {
  from: 'string',
  to: 'string',
  label: 'string',
  kind: 'string',
  route: 'string',
})

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
  badge: schema(['label'], { ...nodeFields, label: 'string', tone: 'string', icon: 'string' }, { text: 'label', value: 'label' }),
  breadcrumb: schema(['items'], { ...nodeFields, items: 'array' }),
  button: schema(['label'], { ...nodeFields, label: 'string', tone: 'string', full: 'boolean', small: 'boolean', icon: 'string', action: 'string' }),
  callout: schema(['content'], { ...nodeFields, title: 'string', content: 'string', tone: 'string' }, { kind: 'tone' }),
  card: schema(['items'], { ...nodeFields, title: 'string', items: 'nodes' }, { label: 'title', content: 'items' }),
  chart: schema([], { ...nodeFields, kind: 'string', data: 'array', series: 'array' }, {}, {
    oneOfRequired: [['data', 'series']],
    conditionalRequired: [
      { kind: 'required-if', when: { field: 'kind', equals: 'line' }, required: ['data'] },
      { kind: 'required-if', when: { field: 'kind', equals: 'donut' }, required: ['data'] },
    ],
    nested: { data: chartDatumSchema, series: chartSeriesSchema },
    validator: { name: 'chart-renderability' },
  }),
  checkbox: schema(['label'], { ...nodeFields, label: 'string', checked: 'boolean', action: 'string' }),
  code: schema(['code'], { ...nodeFields, lang: 'string', code: 'string' }),
  col: schema(['items'], { ...nodeFields, items: 'nodes', gap: 'number' }),
  copy: schema(['text'], { ...nodeFields, label: 'string', text: 'string' }),
  diagram: schema(['kind', 'nodes'], { ...nodeFields, kind: 'string', variant: 'string', title: 'string', nodes: 'array', edges: 'array', zones: 'array', theme: 'object' }, {}, {
    nested: { nodes: diagramNodeSchema, edges: diagramEdgeSchema, zones: diagramZoneSchema, theme: diagramThemeSchema },
  }),
  diff: schema(['diffs'], { ...nodeFields, diffs: 'array' }),
  divider: schema([], nodeFields),
  echart: schema([], { ...nodeFields, title: 'string', height: 'number', preset: 'string', data: 'array', series: 'array', option: 'object' }, {}, {
    oneOfRequired: [['option', 'data', 'series']],
  }),
  'file-tree': schema(['items'], { ...nodeFields, items: 'array' }),
  grid: schema(['items'], { ...nodeFields, cols: 'number', items: 'nodes' }),
  image: schema(['src'], { ...nodeFields, src: 'string', alt: 'string' }),
  input: schema([], { ...nodeFields, label: 'string', placeholder: 'string', value: 'string', inputType: 'string', action: 'string', id: 'string' }),
  json: schema(['value'], { ...nodeFields, value: 'unknown' }),
  keyvalue: schema(['pairs'], { ...nodeFields, pairs: 'array' }),
  link: schema(['label'], { ...nodeFields, label: 'string', href: 'string' }),
  list: schema(['items'], { ...nodeFields, items: 'array' }),
  mermaid: schema(['code'], { ...nodeFields, code: 'string' }),
  plot: schema(['series'], { ...nodeFields, series: 'array', xMin: 'number', xMax: 'number', yMin: 'number', yMax: 'number', title: 'string' }),
  progress: schema(['value'], { ...nodeFields, value: 'number', label: 'string', valueLabel: 'string' }),
  quiz: schema(['question', 'options'], { ...nodeFields, question: 'string', options: 'array', explanation: 'string', id: 'string', action: 'string' }),
  radio: schema(['options'], { ...nodeFields, label: 'string', options: 'array', selected: 'number', action: 'string', group: 'string', answer: 'unknown', explanation: 'string' }),
  row: schema(['items'], { ...nodeFields, items: 'nodes', wrap: 'boolean', spacer: 'boolean' }),
  scene3d: schema(['meshes'], { ...nodeFields, title: 'string', meshes: 'array', ambient: 'number', background: 'string' }),
  select: schema(['options'], { ...nodeFields, label: 'string', options: 'array', action: 'string', selected: 'number', id: 'string' }),
  slider: schema([], { ...nodeFields, label: 'string', min: 'number', max: 'number', step: 'number', value: 'number', action: 'string', id: 'string' }),
  spacer: schema([], nodeFields),
  stat: schema(['label', 'value'], { ...nodeFields, label: 'string', value: 'string', delta: 'string' }),
  steps: schema(['steps'], { ...nodeFields, steps: 'array', current: 'number' }, { items: 'steps' }),
  submit: schema(['label'], { ...nodeFields, label: 'string', action: 'string', resetAction: 'string', groups: 'array' }),
  switch: schema(['label'], { ...nodeFields, label: 'string', checked: 'boolean', action: 'string' }),
  table: schema(['columns', 'rows'], { ...nodeFields, columns: 'array', rows: 'array' }, { headers: 'columns', data: 'rows' }),
  tabs: schema(['tabs'], { ...nodeFields, tabs: 'array' }, {}, { nested: { tabs: tabHolderSchema } }),
  text: schema(['content'], { ...nodeFields, content: 'string', size: 'string', center: 'boolean' }, { text: 'content' }),
  textarea: schema([], { ...nodeFields, label: 'string', placeholder: 'string', rows: 'number', value: 'string', action: 'string', id: 'string' }),
  timeline: schema(['items'], { ...nodeFields, items: 'array' }),
  video: schema(['src'], { ...nodeFields, src: 'string', alt: 'string', poster: 'string', loop: 'boolean', muted: 'boolean', aspectRatio: 'string' }),
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
