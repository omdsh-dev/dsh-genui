import { GENUI_CHECKBOX_VALUE, GENUI_COMPUTED_CELL } from './spec.ts'
import type { GenuiComputed, GenuiComputedCell, GenuiComputedFormat, GenuiNode, GenuiSpec } from './spec.ts'
import { compileMathExprProgram, parseDecimalNumber } from './safe-math.ts'
import { GENUI_LIMITS } from './genui-runtime/index.ts'
import { walkGenuiNodes } from './walk-spec.ts'

const COMPUTED_ID = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const COMPUTED_REFERENCE_PATTERN = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g
const COMPUTED_TEMPLATE_FIELDS: Record<string, ReadonlySet<string>> = {
  text: new Set(['content']),
  button: new Set(['label']),
  input: new Set(['label', 'placeholder']),
  select: new Set(['label']),
  checkbox: new Set(['label']),
  link: new Set(['label']),
  image: new Set(['alt', 'caption']),
  audio: new Set(['alt']),
  video: new Set(['alt']),
  svg: new Set(['title']),
  badge: new Set(['label']),
  hero: new Set(['title', 'subtitle', 'value', 'label', 'delta']),
  stat: new Set(['label', 'value', 'delta']),
  progress: new Set(['label', 'valueLabel']),
  divider: new Set(['label']),
  arrow: new Set(['label']),
  icon: new Set(['label']),
  avatar: new Set(['name']),
  copy: new Set(['label']),
  breadcrumb: new Set(['items']),
  radio: new Set(['label', 'explanation']),
  card: new Set(['title', 'eyebrow']),
  list: new Set(['items']),
  table: new Set(['columns']),
  blocks: new Set(['title', 'caption']),
  accordion: new Set(['items']),
  tabs: new Set(['tabs']),
  plot: new Set(['title']),
  diagram: new Set(['title']),
  scene3d: new Set(['title']),
  echart: new Set(['title']),
  callout: new Set(['title', 'content']),
  steps: new Set(['steps']),
  keyvalue: new Set(['pairs']),
  quiz: new Set(['question', 'explanation']),
  submit: new Set(['label']),
  switch: new Set(['label']),
  slider: new Set(['label']),
  textarea: new Set(['label', 'placeholder']),
  timeline: new Set(['items']),
}

/** 判断规格字段是否用于展示可插值的文字。 */
export function isComputedTemplateField(type: unknown, key: string): boolean {
  return typeof type === 'string' && (COMPUTED_TEMPLATE_FIELDS[type]?.has(key) ?? false)
}

export type ComputedTemplateScope = boolean | 'blocks-row' | 'blocks-cell'
export type ComputedNodeScope = boolean | 'nested-items'

/** 只有组件容器的子节点字段允许再次识别组件；原始数据中的 type 没有组件含义。 */
export function getComputedChildNodeScope(type: unknown, key: string, parentScope: ComputedNodeScope): ComputedNodeScope {
  if (parentScope === 'nested-items') return key === 'items'
  if (parentScope !== true) return false
  if (type === 'tabs') return key === 'tabs' ? 'nested-items' : false
  if (type === 'accordion') return key === 'items' ? 'nested-items' : false
  if (type === 'table') return key === 'details'
  return key === 'items' && ['row', 'col', 'grid', 'card', 'carousel', 'list'].includes(String(type))
}

/** 为嵌套展示数据选择模板范围，并在组件边界重置继承范围。 */
export function getComputedTemplateScope(type: unknown, key: string, parentScope: ComputedTemplateScope): ComputedTemplateScope {
  if (typeof type === 'string') {
    if (type === 'blocks' && key === 'rows') return 'blocks-row'
    return isComputedTemplateField(type, key)
  }
  if (parentScope === 'blocks-row') {
    if (key === 'cells') return 'blocks-cell'
    return key === 'label'
  }
  if (parentScope === 'blocks-cell') return key === 'text' || key === 'sub'
  return parentScope
}

export interface ComputedEvaluation {
  values: Record<string, number>
  formatted: Record<string, string>
  errors: Record<string, string>
}

export interface ComputedGraph {
  order: GenuiComputed[]
  errors: Record<string, string>
}

/**
 * 收集可供 Computed 表达式读取的非密码字段 ID。
 *
 * @param spec - 已修复的 GenUI 规格。
 * @returns 符合表达式名称规则的字段 ID 集合。
 */
export function getComputedInputIds(spec: GenuiSpec): Set<string> {
  const ids = new Set<string>()
  walkGenuiNodes(spec, node => {
    if (node.type !== 'input' && node.type !== 'select' && node.type !== 'slider' && node.type !== 'textarea') return
    if (node.type === 'input' && node.inputType === 'password') return
    if (node.id !== undefined && COMPUTED_ID.test(node.id)) ids.add(node.id)
  })
  return ids
}

/** 收集重复声明的数值输入字段 ID。 */
export function getDuplicateComputedInputIds(spec: GenuiSpec): string[] {
  const counts = new Map<string, number>()
  walkGenuiNodes(spec, node => {
    if (node.type !== 'input' && node.type !== 'select' && node.type !== 'slider' && node.type !== 'textarea') return
    if (node.type === 'input' && node.inputType === 'password') return
    if (node.id !== undefined && COMPUTED_ID.test(node.id)) counts.set(node.id, (counts.get(node.id) ?? 0) + 1)
  })
  return [...counts].filter(([, count]) => count > 1).map(([id]) => id)
}

/**
 * 检查计算定义并按字段依赖关系生成执行顺序。
 *
 * @param definitions - 规格声明的计算字段。
 * @param inputIds - 可读取的输入字段 ID。
 * @param duplicateInputIds - 重复声明的输入字段 ID。
 * @returns 有序计算定义及对应错误。
 */
export function buildComputedGraph(
  definitions: readonly GenuiComputed[],
  inputIds: ReadonlySet<string>,
  duplicateInputIds: ReadonlySet<string> = new Set(),
  allowExternalReferences = false,
): ComputedGraph {
  const errors = Object.create(null) as Record<string, string>
  const formulas = new Map<string, GenuiComputed>()
  if (definitions.length > GENUI_LIMITS.maxComputedFields) {
    const firstExcess = definitions[GENUI_LIMITS.maxComputedFields]!
    errors[firstExcess.id] = `计算字段数量超过 ${GENUI_LIMITS.maxComputedFields} 个`
  }
  const declaredFormulaIds = new Set<string>()
  for (const definition of definitions.slice(0, GENUI_LIMITS.maxComputedFields)) {
    if (!COMPUTED_ID.test(definition.id)) {
      errors[definition.id] = '计算字段 ID 格式无效'
      continue
    }
    declaredFormulaIds.add(definition.id)
    if (inputIds.has(definition.id) || formulas.has(definition.id)) {
      errors[definition.id] = '计算字段 ID 重复'
      continue
    }
    formulas.set(definition.id, definition)
  }

  const symbols = Object.fromEntries([...inputIds, ...formulas.keys()].map(id => [id, 0]))
  const programs = new Map<string, string[]>()
  for (const [id, definition] of formulas) {
    const program = compileMathExprProgram(definition.expr, { vars: symbols, allowImplicitVariables: false, allowUnboundVariables: allowExternalReferences })
    if (program === null) {
      errors[id] = '表达式无效或引用了未声明字段'
      continue
    }
    const duplicateInput = program.variables.find(name => duplicateInputIds.has(name))
    if (duplicateInput !== undefined) errors[id] = `输入字段 ${duplicateInput} ID 重复，无法计算`
    programs.set(id, program.variables.filter(name => declaredFormulaIds.has(name)))
  }

  const order: GenuiComputed[] = []
  const state = new Map<string, 'visiting' | 'visited'>()
  const path: string[] = []
  const visit = (id: string): void => {
    if (state.get(id) === 'visited' || errors[id] !== undefined) return
    if (state.get(id) === 'visiting') {
      const start = path.indexOf(id)
      for (const cycleId of path.slice(start)) errors[cycleId] = '存在循环依赖'
      return
    }
    state.set(id, 'visiting')
    path.push(id)
    for (const dependency of programs.get(id) ?? []) {
      visit(dependency)
      if (errors[dependency] !== undefined && errors[id] === undefined) errors[id] = `依赖字段 ${dependency} 无效`
    }
    path.pop()
    state.set(id, 'visited')
    const definition = formulas.get(id)
    if (definition !== undefined && errors[id] === undefined) order.push(definition)
  }
  for (const id of formulas.keys()) visit(id)
  return { order, errors }
}

/** 收集表单规格中的初始值，供首次渲染的计算读取。 */
function collectInputDefaults(spec: GenuiSpec): Record<string, string> {
  const defaults = Object.create(null) as Record<string, string>
  walkGenuiNodes(spec, node => {
    if (node.type !== 'input' && node.type !== 'textarea' && node.type !== 'slider' && node.type !== 'select') return
    if (node.id === undefined) return
    if (node.type === 'input' && node.inputType !== 'password' && node.value !== undefined) defaults[node.id] = node.value
    if (node.type === 'textarea' && node.value !== undefined) defaults[node.id] = node.value
    if (node.type === 'slider') defaults[node.id] = String(node.value ?? node.min ?? 0)
    if (node.type === 'select' && node.selected !== undefined) defaults[node.id] = node.options[node.selected] ?? ''
  })
  return defaults
}

/** 按字段指定的 Intl.NumberFormat 选项生成显示文本。 */
function formatComputedValue(value: number, format: GenuiComputedFormat | undefined): string {
  if (format === undefined) return String(value)
  const options: Intl.NumberFormatOptions = {
    style: format.style ?? 'decimal',
    ...(format.currency === undefined ? {} : { currency: format.currency }),
    ...(format.minimumFractionDigits === undefined ? {} : { minimumFractionDigits: format.minimumFractionDigits }),
    ...(format.maximumFractionDigits === undefined ? {} : { maximumFractionDigits: format.maximumFractionDigits }),
  }
  return new Intl.NumberFormat(format.locale, options).format(value)
}

/**
 * 读取输入字段并计算所有可用的 Computed 值。
 *
 * @param spec - 已修复的 GenUI 规格。
 * @param fields - 当前交互状态中的字段值。
 * @returns 数值结果、格式化结果和计算错误。
 */
export function evaluateComputed(spec: GenuiSpec, fields: Readonly<Record<string, string>>): ComputedEvaluation {
  const inputIds = getComputedInputIds(spec)
  const definitions = spec.computed ?? []
  const duplicateInputIds = new Set(getDuplicateComputedInputIds(spec))
  const graph = buildComputedGraph(definitions, inputIds, duplicateInputIds)
  const errors = Object.assign(Object.create(null) as Record<string, string>, graph.errors)
  const computedIds = definitions.slice(0, GENUI_LIMITS.maxComputedFields).map(item => item.id)
  const fieldValues = { ...collectInputDefaults(spec), ...fields }
  const numericValues = Object.create(null) as Record<string, number>
  const formatted = Object.create(null) as Record<string, string>

  for (const definition of graph.order) {
    const programVariables = Object.create(null) as Record<string, number>
    const programReferences = compileMathExprProgram(definition.expr, {
      vars: Object.fromEntries([...inputIds, ...computedIds].map(id => [id, 0])),
      allowImplicitVariables: false,
    })
    if (programReferences === null) {
      errors[definition.id] = '表达式无效或引用了未声明字段'
      continue
    }
    let invalidInput: string | undefined
    for (const name of programReferences.variables) {
      if (Object.hasOwn(numericValues, name)) {
        programVariables[name] = numericValues[name]!
        continue
      }
      if (!inputIds.has(name)) {
        invalidInput = name
        break
      }
      const raw = Object.hasOwn(fieldValues, name) ? fieldValues[name] : undefined
      const value = raw === undefined ? undefined : parseDecimalNumber(raw)
      if (value === undefined) {
        invalidInput = name
        break
      }
      numericValues[name] = value
      programVariables[name] = value
    }
    if (invalidInput !== undefined) {
      errors[definition.id] = `字段 ${invalidInput} 需要有效数值`
      continue
    }
    const program = compileMathExprProgram(definition.expr, { vars: programVariables, allowImplicitVariables: false })
    if (program === null) {
      errors[definition.id] = '表达式无效或引用了未声明字段'
      continue
    }
    const value = program.evaluate(0)
    if (!Number.isFinite(value)) {
      errors[definition.id] = '计算结果超出有效数值范围'
      continue
    }
    numericValues[definition.id] = value
    formatted[definition.id] = formatComputedValue(value, definition.format)
  }

  return { values: Object.fromEntries(Object.entries(numericValues).filter(([id]) => !inputIds.has(id))), formatted, errors }
}

/** 递归解析模板文字与数值对象引用。 */
function resolveComputedValue(
  value: unknown,
  key: string | undefined,
  result: ComputedEvaluation,
  referenceAllowed = false,
  chartReference = false,
  tableCellReference = false,
  templateAllowed: ComputedTemplateScope = false,
  nodeScope: ComputedNodeScope = false,
): unknown {
  if (typeof value === 'string') {
    if (!templateAllowed || key === 'id' || key === 'type' || key === 'expr' || key === 'action' || key === 'href' || key === 'src' || key === 'poster') return value
    return value.replace(COMPUTED_REFERENCE_PATTERN, (_match, id: string) => result.formatted[id] ?? '无效输入')
  }
  if (nodeScope === false && !referenceAllowed && !templateAllowed) return value
  if (Array.isArray(value)) return value.map(item => resolveComputedValue(item, undefined, result, referenceAllowed, chartReference, tableCellReference, templateAllowed, nodeScope))
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const nodeType = nodeScope === true ? record.type : undefined
  if (referenceAllowed && Object.keys(record).length === 1 && typeof record.$computed === 'string') {
    if (!Object.hasOwn(result.values, record.$computed)) return chartReference ? null : '无效输入'
    const computedValue = result.values[record.$computed]!
    if (tableCellReference) {
      const cell: GenuiComputedCell = {
        [GENUI_COMPUTED_CELL]: true,
        value: computedValue,
        formatted: result.formatted[record.$computed] ?? String(computedValue),
      }
      return cell
    }
    return chartReference && Math.abs(computedValue) > 1e12 ? null : computedValue
  }
  const resolved = Object.fromEntries(Object.entries(record).map(([entryKey, entryValue]) => [
    entryKey,
    resolveComputedValue(entryValue, entryKey, result,
      nodeType === 'table' && entryKey === 'rows'
        || (nodeType === 'chart' || nodeType === 'echart') && (entryKey === 'data' || entryKey === 'series')
        || nodeType === 'echart' && entryKey === 'option'
        || referenceAllowed,
      (nodeType === 'chart' || nodeType === 'echart') && (entryKey === 'data' || entryKey === 'series' || entryKey === 'option')
        || chartReference,
      nodeType === 'table' && entryKey === 'rows' || tableCellReference,
      getComputedTemplateScope(nodeType, entryKey, templateAllowed),
      getComputedChildNodeScope(nodeType, entryKey, nodeScope)),
  ]))
  // Keep selection identity separate from its changing display label. The
  // original template is stable and is already present in the exported spec.
  if (nodeType === 'checkbox' && typeof record.label === 'string') {
    Object.assign(resolved, { [GENUI_CHECKBOX_VALUE]: record.label })
  }
  // ECharts uses positional categories: a missing value must keep its slot.
  // Native charts consume only complete points and calculate their own axes.
  if (nodeType === 'chart' && Array.isArray(resolved.data)) {
    resolved.data = resolved.data.filter(point => point !== null && typeof point === 'object'
      && (point as Record<string, unknown>).value !== null)
  }
  return resolved
}

/**
 * 将模板引用和数值引用解析到待渲染组件树中。
 *
 * @param spec - 原始已修复规格。
 * @param result - 当前字段状态对应的计算结果。
 * @returns 已替换引用的规格副本。
 */
export function resolveComputedSpec(spec: GenuiSpec, result: ComputedEvaluation): GenuiSpec {
  const items = resolveComputedValue(spec.items, undefined, result, false, false, false, false, true) as GenuiNode[]
  const title = spec.title === undefined ? undefined : resolveComputedValue(spec.title, undefined, result, false, false, false, true) as string
  return { ...spec, ...(title === undefined ? {} : { title }), items }
}
