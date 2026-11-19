import type { GenuiSpec } from '../client/spec.ts'
import { evaluateComputed, resolveComputedSpec } from '../client/computed.ts'
import { compileSubmissionRegistry, resolveSubmitState } from '../client/submission-registry.ts'
import type { NativeState } from './dsh-go-types.ts'

/** One submission snapshot shared by native rendering and dispatch. */
export function nativeSubmission(spec: GenuiSpec,state: NativeState,groups?: string[]) {
  const registry = compileSubmissionRegistry(resolveComputedSpec(spec,evaluateComputed(spec,state.fields)))
  const answers: Record<string,string> = Object.create(null), fields: Record<string,string> = Object.create(null)
  for (const member of registry.members.values()) {
    const value = state.fields[member.key]
    if (member.kind === 'radio' && value !== undefined) answers[member.key] = value
    if (member.kind === 'field' && !member.secret && value !== undefined && value.trim() !== '') fields[member.key] = value
  }
  const multiAnswers = Object.fromEntries(Object.entries(state.choices).flatMap(([key,values]) => {
    const member = registry.members.get(key)
    return member?.kind === 'checkbox' ? [[key,values.filter(v => member.choices.has(v))]]:[]
  }))
  const collectedAnswers = {...answers,...Object.fromEntries(Object.entries(multiAnswers).map(([key,values]) => {
    const member = registry.members.get(key)
    return [key,values.map(value => member?.kind === 'checkbox' ? member.choices.get(value)!:value)]
  }))}
  const resolved = resolveSubmitState({registry,...(groups ? {groups}:{}),state:{answers,fields,multiAnswers,secretFields:new Set()}})
  return {registry,resolved,answers,fields,collectedAnswers}
}
