import type { GenuiComputed, GenuiComputedFormat, GenuiNode, GenuiSpec } from './spec.ts'
import { compileMathExprProgram } from './safe-math.ts'
import { GENUI_LIMITS } from './genui-runtime/index.ts'
import { walkGenuiNodes } from './walk-spec.ts'

const COMPUTED_ID = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const COMPUTED_REFERENCE_PATTERN = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g

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

/**
 * 检查计算定义并按字段依赖关系生成执行顺序。
 *
 * @param definitions - 规格声明的计算字段。
 * @param inputIds - 可读取的输入字段 ID。
 * @returns 有序计算定义及对应错误。
 */
export function buildComputedGraph(definitions: readonly GenuiComputed[], inputIds: ReadonlySet<string>): ComputedGraph {
  const errors = Object.create(null) as Record<string, string>
  const formulas = new Map<string, GenuiComputed>()
  if (definitions.length > GENUI_LIMITS.maxComputedFields) {
    const firstExcess = definitions[GENUI_LIMITS.maxComputedFields]!
    errors[firstExcess.id] = `计算字段数量超过 ${GENUI_LIMITS.maxComputedFields} 个`
  }
  for (const definition of definitions.slice(0, GENUI_LIMITS.maxComputedFields)) {
    if (!COMPUTED_ID.test(definition.id)) {
      errors[definition.id] = '计算字段 ID 格式无效'
      continue
    }
    if (inputIds.has(definition.id) || formulas.has(definition.id)) {
      errors[definition.id] = '计算字段 ID 重复'
      continue
    }
    formulas.set(definition.id, definition)
  }

  const symbols = Object.fromEntries([...inputIds, ...formulas.keys()].map(id => [id, 0]))
  const programs = new Map<string, string[]>()
  for (const [id, definition] of formulas) {
    const program = compileMathExprProgram(definition.expr, { vars: symbols, allowImplicitVariables: false })
    if (program === null) {
      errors[id] = '表达式无效或引用了未声明字段'
      continue
    }
    programs.set(id, program.variables.filter(name => formulas.has(name)))
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
    for (const dependency of programs.get(id) ?? []) visit(dependency)
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
  const graph = buildComputedGraph(definitions, inputIds)
  const computedIds = definitions.slice(0, GENUI_LIMITS.maxComputedFields).map(item => item.id)
  const fieldValues = { ...collectInputDefaults(spec), ...fields }
  const numericValues = Object.create(null) as Record<string, number>
  const formatted = Object.create(null) as Record<string, string>
  const errors = Object.assign(Object.create(null) as Record<string, string>, graph.errors)

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
      const value = raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw)
      if (!Number.isFinite(value)) {
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
function resolveComputedValue(value: unknown, key: string | undefined, result: ComputedEvaluation, referenceAllowed = false, chartReference = false): unknown {
  if (typeof value === 'string') {
    if (key === 'id' || key === 'type' || key === 'expr' || key === 'action' || key === 'href' || key === 'src' || key === 'poster') return value
    return value.replace(COMPUTED_REFERENCE_PATTERN, (_match, id: string) => result.formatted[id] ?? '无效输入')
  }
  if (Array.isArray(value)) return value.map(item => resolveComputedValue(item, undefined, result, referenceAllowed, chartReference))
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (referenceAllowed && Object.keys(record).length === 1 && typeof record.$computed === 'string') {
    if (!Object.hasOwn(result.values, record.$computed)) return chartReference ? null : '无效输入'
    const computedValue = result.values[record.$computed]!
    return chartReference && Math.abs(computedValue) > 1e12 ? null : computedValue
  }
  return Object.fromEntries(Object.entries(record).map(([entryKey, entryValue]) => [
    entryKey,
    resolveComputedValue(entryValue, entryKey, result,
      record.type === 'table' && entryKey === 'rows'
        || (record.type === 'chart' || record.type === 'echart') && (entryKey === 'data' || entryKey === 'series')
        || record.type === 'echart' && entryKey === 'option'
        || referenceAllowed,
      (record.type === 'chart' || record.type === 'echart') && (entryKey === 'data' || entryKey === 'series' || entryKey === 'option')
        || chartReference),
  ]))
}

/** 移除没有有效数值的图表点，保证图表只收到可绘制数据。 */
function filterInvalidChartData(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach(filterInvalidChartData)
    return
  }
  const record = value as Record<string, unknown>
  if ((record.type === 'chart' || record.type === 'echart') && Array.isArray(record.data)) {
    record.data = record.data.filter(point => point !== null && typeof point === 'object'
      && typeof (point as Record<string, unknown>).value === 'number')
  }
  if ((record.type === 'chart' || record.type === 'echart') && Array.isArray(record.series)) {
    const series = record.series.filter(item => item !== null && typeof item === 'object'
      && Array.isArray((item as Record<string, unknown>).data)) as Array<Record<string, unknown>>
    const dataSets = series.map(item => item.data as unknown[])
    if (dataSets.length === 1) {
      series[0]!.data = dataSets[0]!.filter(point => point !== null && typeof point === 'object'
        && typeof (point as Record<string, unknown>).value === 'number')
    } else if (dataSets.length > 1) {
      const alignedIndexes = Array.from({ length: Math.min(...dataSets.map(data => data.length)) }, (_unused, index) => index)
        .filter(index => dataSets.every(data => {
          const point = data[index]
          return point !== null && typeof point === 'object' && typeof (point as Record<string, unknown>).value === 'number'
        }))
      for (let index = 0; index < series.length; index++) {
        const data = dataSets[index]!
        series[index]!.data = alignedIndexes.map(pointIndex => data[pointIndex])
      }
    }
  }
  Object.values(record).forEach(filterInvalidChartData)
}

/**
 * 将模板引用和数值引用解析到待渲染组件树中。
 *
 * @param spec - 原始已修复规格。
 * @param result - 当前字段状态对应的计算结果。
 * @returns 已替换引用的规格副本。
 */
export function resolveComputedSpec(spec: GenuiSpec, result: ComputedEvaluation): GenuiSpec {
  const items = resolveComputedValue(spec.items, undefined, result) as GenuiNode[]
  const title = spec.title === undefined ? undefined : resolveComputedValue(spec.title, undefined, result) as string
  filterInvalidChartData(items)
  return { ...spec, ...(title === undefined ? {} : { title }), items }
}
