import { GENUI_LIMITS } from './genui-runtime/index.ts'
import type { GenuiSpec } from './spec.ts'
import { isDatePickerValueValid } from './date-picker.ts'
import { GENUI_CHECKBOX_VALUE } from './spec.ts'
import { walkGenuiNodes } from './walk-spec.ts'

export type SubmissionMember = RadioSubmissionMember | CheckboxSubmissionMember | FieldSubmissionMember

export interface RadioSubmissionMember {
  kind: 'radio'
  key: string
  label: string
  options: string[]
  answer?: number | string
  explanation?: string
}

export interface CheckboxSubmissionMember {
  kind: 'checkbox'
  key: string
  /** 来源文案模板 → 当前显示文案。 */
  choices: Map<string, string>
}

export interface FieldSubmissionMember {
  kind: 'field'
  key: string
  fieldType: 'input' | 'editor' | 'textarea' | 'select' | 'slider' | 'map' | 'diagram' | 'date-picker' | 'segmented-control'
  secret: boolean
  datePicker?: { mode: 'single' | 'range'; min?: string; max?: string }
}

export interface SubmissionRegistry {
  members: ReadonlyMap<string, SubmissionMember>
}

export interface SubmitInteractionState {
  answers: Record<string, string>
  multiAnswers: Record<string, string[]>
  fields: Record<string, string>
  secretFields: ReadonlySet<string>
  /** Field ids / groups hidden by a `when` condition: out of scope entirely. */
  hidden?: ReadonlySet<string>
}

export interface ResolvedSubmitState {
  scope: SubmissionMember[]
  answered: number
  total: number
  localGradeEligible: boolean
  hasOutOfScopePayload: boolean
}

/** 从 spec 建立成员表，并诊断 submission key 和 submit.groups。 */
export function analyzeSubmissionRegistry(spec: GenuiSpec, allowExternalGroups = false): { registry: SubmissionRegistry; diagnostics: string[] } {
  const members = new Map<string, SubmissionMember>()
  const paths = new Map<string, string>()
  const diagnostics: string[] = []
  const submits: Array<{ groups: string[]; path: string }> = []

  walkGenuiNodes(spec, (node, path) => {
    if (node.type === 'submit') {
      if (node.groups !== undefined) submits.push({ groups: node.groups, path })
      return
    }
    let member: SubmissionMember | undefined
    let keyPath: string
    switch (node.type) {
      case 'radio':
        if (node.group === undefined) return
        member = { kind: 'radio', key: node.group, label: node.label ?? node.group, options: node.options.slice(0, GENUI_LIMITS.maxOptions), ...(node.answer === undefined ? {} : { answer: node.answer }), ...(node.explanation === undefined ? {} : { explanation: node.explanation }) }
        keyPath = `${path}.group`
        break
      case 'choices':
        // A `choices` list with a `group` is a paper question: single-select,
        // graded from `answer` exactly like `radio` — but each option keeps its
        // cost line, which `radio`'s bare strings cannot carry.
        if (node.group === undefined) return
        member = {
          kind: 'radio',
          key: node.group,
          label: node.title ?? node.prompt ?? node.group,
          options: node.items.map(item => item.label).slice(0, GENUI_LIMITS.maxOptions),
          ...(node.answer === undefined ? {} : { answer: node.answer }),
          ...(node.explanation === undefined ? {} : { explanation: node.explanation }),
        }
        keyPath = `${path}.group`
        break
      case 'checkbox':
        if (node.group === undefined) return
        member = { kind: 'checkbox', key: node.group, choices: new Map([[node[GENUI_CHECKBOX_VALUE] ?? node.label, node.label]]) }
        keyPath = `${path}.group`
        break
      case 'input':
      case 'textarea':
      case 'editor':
      case 'select':
      case 'slider':
      case 'date-picker':
      case 'segmented-control':
      case 'map':
      case 'diagram':
        if (node.id === undefined) return
        member = {
          kind: 'field', key: node.id, fieldType: node.type, secret: node.type === 'input' && node.inputType === 'password',
          ...(node.type === 'date-picker' ? { datePicker: { mode: node.mode ?? 'single', ...(node.min === undefined ? {} : { min: node.min }), ...(node.max === undefined ? {} : { max: node.max }) } } : {}),
        }
        keyPath = `${path}.id`
        break
      default:
        return
    }
    if (member === undefined) return
    const existing = members.get(member.key)
    if (existing !== undefined) {
      if (existing.kind !== 'checkbox' || member.kind !== 'checkbox') {
        diagnostics.push(`${keyPath} conflicts with ${paths.get(member.key)}: submission key '${member.key}' is already used`)
      } else {
        for (const [value, label] of member.choices) existing.choices.set(value, label)
      }
      return
    }
    members.set(member.key, member)
    paths.set(member.key, keyPath)
  })

  for (const { groups, path } of submits) {
    const seen = new Set<string>()
    groups.forEach((key, index) => {
      const at = `${path}.groups[${index}]`
      if (seen.has(key)) diagnostics.push(`${at}: duplicate submission member '${key}'`)
      seen.add(key)
      const member = members.get(key)
      if (member === undefined && !allowExternalGroups) diagnostics.push(`${at}: submit.groups references unknown submission member '${key}'`)
      else if (member?.kind === 'field' && member.secret) diagnostics.push(`${at}: submit.groups cannot require secret field '${key}'`)
    })
  }
  return { registry: { members }, diagnostics }
}

/** 编译供运行时读取的静态 submission 成员表。 */
export function compileSubmissionRegistry(spec: GenuiSpec): SubmissionRegistry {
  return analyzeSubmissionRegistry(spec).registry
}

/** 根据当前交互状态判断一个 submission member 是否完成。 */
export function isSubmissionMemberAnswered(member: SubmissionMember, state: SubmitInteractionState): boolean {
  switch (member.kind) {
    case 'radio': return state.answers[member.key] !== undefined
    case 'checkbox': return state.multiAnswers[member.key]?.some(value => member.choices.has(value)) ?? false
    case 'field': {
      if (member.secret) return false
      if (!Object.hasOwn(state.fields, member.key)) return false
      const value = state.fields[member.key]
      if (value === undefined || value.trim() === '') return false
      if (member.fieldType === 'date-picker') {
        return isDatePickerValueValid(value, member.datePicker?.mode ?? 'single', member.datePicker?.min, member.datePicker?.max)
      }
      return true
    }
  }
}

/** 计算 submit 进度和纯本地判卷条件。 */
export function resolveSubmitState({ registry, groups, state }: {
  registry: SubmissionRegistry
  groups?: string[]
  state: SubmitInteractionState
}): ResolvedSubmitState {
  // Hidden members are out of scope entirely: a control the reader cannot see
  // must neither count toward completion nor keep the submit disabled.
  const hidden = state.hidden ?? new Set<string>()
  // A member is identified by its own key (a group, or a field id).
  const isHidden = (member: SubmissionMember): boolean => hidden.has(member.key)
  const hasUnknownMember = groups?.some(key => !registry.members.has(key) && !hidden.has(key)) ?? false
  const scope = groups === undefined
    ? [...registry.members.values()].filter(member => !isHidden(member) && isSubmissionMemberAnswered(member, state))
    : groups.flatMap(key => {
      const member = registry.members.get(key)
      return member === undefined ? [] : [member]
    })
  const answered = scope.filter(member => isSubmissionMemberAnswered(member, state)).length
  const total = groups === undefined ? scope.length : groups.filter(key => !hidden.has(key)).length
  const scopeKeys = new Set(scope.map(member => member.key))
  const hasOutOfScopePayload = Object.keys(state.answers).some(key => !scopeKeys.has(key))
    || Object.keys(state.multiAnswers).some(key => !scopeKeys.has(key))
    || Object.entries(state.fields).some(([key, value]) => {
      if (value.trim() === '' || state.secretFields.has(key) || scopeKeys.has(key)) return false
      const member = registry.members.get(key)
      return member?.kind !== 'field' || member.fieldType !== 'date-picker' || isSubmissionMemberAnswered(member, state)
    })
  const localGradeEligible = !hasUnknownMember && scope.length > 0
    && scope.every(member => member.kind === 'radio')
    && scope.some(member => member.kind === 'radio' && member.answer !== undefined)
  return { scope, answered, total, localGradeEligible, hasOutOfScopePayload }
}
