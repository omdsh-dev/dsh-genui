/** Runtime metadata shared by GenUI normalization and diagnostics. */

export type ComponentFieldKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'nodes'
  | 'array'
  | 'object'
  | 'unknown'

export interface ComponentSchema {
  readonly required: readonly string[]
  readonly fields: Readonly<Record<string, ComponentFieldKind>>
  readonly aliases: Readonly<Record<string, string>>
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
): ComponentSchema => ({ required, fields, aliases })

const nodeFields = { type: 'string' } as const

/**
 * Native component field metadata.
 *
 * This is intentionally explicit rather than inferred from TypeScript
 * interfaces: the registry is also consumed at runtime by normalization and
 * diagnostics, where erased interfaces are unavailable.
 */
export const COMPONENT_SCHEMAS: Readonly<Record<string, ComponentSchema>> = {
  accordion: schema(['items'], { ...nodeFields, items: 'array' }),
  audio: schema(['src'], { ...nodeFields, src: 'string', alt: 'string', loop: 'boolean' }),
  avatar: schema(['name'], { ...nodeFields, name: 'string', color: 'string' }),
  badge: schema(['label'], { ...nodeFields, label: 'string', tone: 'string', icon: 'string' }, { text: 'label', value: 'label' }),
  breadcrumb: schema(['items'], { ...nodeFields, items: 'array' }),
  button: schema(['label'], { ...nodeFields, label: 'string', tone: 'string', full: 'boolean', small: 'boolean', icon: 'string', action: 'string' }),
  callout: schema(['content'], { ...nodeFields, title: 'string', content: 'string', tone: 'string' }, { kind: 'tone' }),
  card: schema(['items'], { ...nodeFields, title: 'string', items: 'nodes' }, { label: 'title', content: 'items' }),
  chart: schema(['data'], { ...nodeFields, kind: 'string', data: 'array', series: 'array' }),
  checkbox: schema(['label'], { ...nodeFields, label: 'string', checked: 'boolean', action: 'string' }),
  code: schema(['code'], { ...nodeFields, lang: 'string', code: 'string' }),
  col: schema(['items'], { ...nodeFields, items: 'nodes', gap: 'number' }),
  copy: schema(['text'], { ...nodeFields, label: 'string', text: 'string' }),
  diagram: schema(['kind', 'nodes'], { ...nodeFields, kind: 'string', variant: 'string', title: 'string', nodes: 'array', edges: 'array', zones: 'array', theme: 'object' }),
  diff: schema(['diffs'], { ...nodeFields, diffs: 'array' }),
  divider: schema([], nodeFields),
  echart: schema([], { ...nodeFields, title: 'string', height: 'number', preset: 'string', data: 'array', series: 'array', option: 'object' }),
  'file-tree': schema(['items'], { ...nodeFields, items: 'array' }),
  grid: schema(['cols', 'items'], { ...nodeFields, cols: 'number', items: 'nodes' }),
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
  tabs: schema(['tabs'], { ...nodeFields, tabs: 'array' }),
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
        : `${aliasPath} normalized to '${canonical}'`,
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
            : `${tabPath} normalized to 'items'`,
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
      warnings.push({
        kind: 'unknown-field',
        path: `${path}.${field}`,
        message: `${path}.${field}: unknown field for '${node.type}'`,
        type: node.type as string,
        field,
      })
    }
  }
  if (Array.isArray(root.items)) root.items.forEach((item, index) => visitNativeNodes(item, `items[${index}]`, visit))
  else if (typeof root.type === 'string') visitNativeNodes(root, 'spec', visit)
  return warnings
}
