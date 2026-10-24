import { describe, expect, it } from 'vitest'
import { processGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'
import type { GenuiSpec } from '../src/client/spec.ts'
import { analyzeSubmissionRegistry, compileSubmissionRegistry, isSubmissionMemberAnswered, resolveSubmitState } from '../src/client/submission-registry.ts'
import type { SubmitInteractionState } from '../src/client/submission-registry.ts'
import { walkGenuiNodes } from '../src/client/walk-spec.ts'
import { GENUI_LIMITS } from '../src/client/genui-runtime/index.ts'

const emptyState: SubmitInteractionState = { answers: {}, multiAnswers: {}, fields: {}, secretFields: new Set() }

describe('submission registry', () => {
  it('visits every current GenUI node container with stable paths', () => {
    const spec = { items: [
      { type: 'row', items: [{ type: 'input', id: 'row' }] },
      { type: 'col', items: [{ type: 'textarea', id: 'col' }] },
      { type: 'grid', cols: 1, items: [{ type: 'select', id: 'grid', options: ['A'] }] },
      { type: 'card', items: [{ type: 'slider', id: 'card' }] },
      { type: 'tabs', tabs: [{ label: 'T', items: [{ type: 'radio', group: 'tab', options: ['A'] }] }] },
      { type: 'accordion', items: [{ title: 'A', items: [{ type: 'checkbox', group: 'fold', label: 'A' }] }] },
      { type: 'list', items: [{ type: 'input', id: 'list' }] },
      { type: 'table', columns: ['Item'], rows: [['A']], details: [[{ type: 'input', id: 'detail' }], null] },
    ] } as GenuiSpec
    const paths: string[] = []
    walkGenuiNodes(spec, (node, path) => { if ('id' in node || 'group' in node) paths.push(path) })
    expect(paths).toEqual([
      'items[0].items[0]', 'items[1].items[0]', 'items[2].items[0]', 'items[3].items[0]',
      'items[4].tabs[0].items[0]', 'items[5].items[0].items[0]', 'items[6].items[0]', 'items[7].details[0][0]',
    ])
    expect([...compileSubmissionRegistry(spec).members.keys()]).toEqual(['row', 'col', 'grid', 'card', 'tab', 'fold', 'list', 'detail'])
  })

  it('bounds direct traversal of cyclic component trees at the renderer depth limit', () => {
    const items: GenuiSpec['items'] = []
    const row = { type: 'row' as const, items }
    items.push(row)
    const paths: string[] = []
    walkGenuiNodes({ items }, (_node, path) => paths.push(path))
    expect(paths).toHaveLength(GENUI_LIMITS.maxDepth + 1)
    expect(paths.at(-1)).toBe(`items[0]${'.items[0]'.repeat(GENUI_LIMITS.maxDepth)}`)
  })

  it('compiles static radio, checkbox, and field members', () => {
    const spec = { items: [
      { type: 'radio', group: 'q1', label: 'Question', options: ['A', 'B'], answer: 1, explanation: 'Because' },
      { type: 'checkbox', group: 'styles', label: 'A' },
      { type: 'checkbox', group: 'styles', label: 'B' },
      { type: 'input', id: 'secret', inputType: 'password' },
      { type: 'textarea', id: 'note' },
      { type: 'select', id: 'choice', options: ['A'] },
      { type: 'slider', id: 'amount' },
    ] } as GenuiSpec
    const { registry, diagnostics } = analyzeSubmissionRegistry(spec)
    expect(diagnostics).toEqual([])
    expect([...registry.members.values()]).toEqual([
      { kind: 'radio', key: 'q1', label: 'Question', options: ['A', 'B'], answer: 1, explanation: 'Because' },
      { kind: 'checkbox', key: 'styles', choices: new Map([['A', 'A'], ['B', 'B']]) },
      { kind: 'field', key: 'secret', fieldType: 'input', secret: true },
      { kind: 'field', key: 'note', fieldType: 'textarea', secret: false },
      { kind: 'field', key: 'choice', fieldType: 'select', secret: false },
      { kind: 'field', key: 'amount', fieldType: 'slider', secret: false },
    ])
  })

  it('reports unknown, duplicate, secret, and colliding keys at their paths', () => {
    const cases: Array<{ items: GenuiSpec['items']; fragment: string }> = [
      { items: [{ type: 'submit', label: 'Send', groups: ['missing'] }], fragment: "items[0].groups[0]: submit.groups references unknown submission member 'missing'" },
      { items: [{ type: 'input', id: 'name' }, { type: 'submit', label: 'Send', groups: ['name', 'name'] }], fragment: "items[1].groups[1]: duplicate submission member 'name'" },
      { items: [{ type: 'input', id: 'name' }, { type: 'textarea', id: 'name' }], fragment: "items[1].id conflicts with items[0].id" },
      { items: [{ type: 'radio', group: 'q', options: ['A'] }, { type: 'radio', group: 'q', options: ['B'] }], fragment: "items[1].group conflicts with items[0].group" },
      { items: [{ type: 'radio', group: 'q', options: ['A'] }, { type: 'checkbox', group: 'q', label: 'B' }], fragment: "items[1].group conflicts with items[0].group" },
      { items: [{ type: 'radio', group: 'q', options: ['A'] }, { type: 'input', id: 'q' }], fragment: "items[1].id conflicts with items[0].group" },
      { items: [{ type: 'checkbox', group: 'q', label: 'A' }, { type: 'input', id: 'q' }], fragment: "items[1].id conflicts with items[0].group" },
      { items: [{ type: 'input', id: 'password', inputType: 'password' }, { type: 'submit', label: 'Send', groups: ['password'] }], fragment: "items[1].groups[0]: submit.groups cannot require secret field 'password'" },
    ]
    for (const { items, fragment } of cases) {
      const result = validateGenuiSpec({ items })
      expect(result.ok).toBe(false)
      expect(result.errors.some(error => error.includes(fragment)), fragment).toBe(true)
    }
    expect(validateGenuiSpec({ items: [
      { type: 'checkbox', group: 'styles', label: 'A' }, { type: 'checkbox', group: 'styles', label: 'B' },
      { type: 'submit', label: 'Send', action: 'send', groups: ['styles'] },
    ] }).ok).toBe(true)
    expect(processGenuiSpec({ items: [{ type: 'submit', label: 'Send', groups: ['missing'] }] }).errors)
      .toContain("items[0].groups[0]: submit.groups references unknown submission member 'missing'")
    expect(processGenuiSpec({ items: [
      { type: 'custom-renderer', payload: 'opaque' },
      { type: 'submit', label: 'Send', action: 'send', groups: ['missing'] },
    ] }).errors).toContain("items[1].groups[0]: submit.groups references unknown submission member 'missing'")
    expect(validateGenuiSpec({ items: [
      { type: 'tabs', tabs: [{ label: 'T', items: [{ type: 'input', id: 'key' }] }] },
      { type: 'accordion', items: [{ title: 'A', items: [{ type: 'radio', group: 'key', options: ['A'] }] }] },
    ] }).errors.some(error => error.includes('items[1].items[0].items[0].group conflicts with items[0].tabs[0].items[0].id'))).toBe(true)

    const unreachableDetail = { items: [
      { type: 'table', columns: ['A'], rows: [['1']], details: [null, [{ type: 'input', id: 'ghost' }]] },
      { type: 'submit', label: 'Send', action: 'send', groups: ['ghost'] },
    ] }
    expect(validateGenuiSpec(unreachableDetail).errors).toContain('items[0].details must not contain more entries than rows')
    expect([...compileSubmissionRegistry(unreachableDetail).members.keys()]).not.toContain('ghost')
    expect(processGenuiSpec(unreachableDetail).errors).toContain('items[0].details must not contain more entries than rows')

    const groupHeaderDetail = { items: [
      { type: 'table', columns: ['区域', '数值'], types: ['group', 'num'], rows: [['华东', ''], ['上海', '120']], details: [[{ type: 'input', id: 'region_note' }], null] },
      { type: 'submit', label: 'Send', action: 'send', groups: ['region_note'] },
    ] } as GenuiSpec
    expect([...compileSubmissionRegistry(groupHeaderDetail).members.keys()]).not.toContain('region_note')
    expect(validateGenuiSpec(groupHeaderDetail).errors).toContain("items[1].groups[0]: submit.groups references unknown submission member 'region_note'")
    expect(processGenuiSpec(groupHeaderDetail).errors).toContain("items[1].groups[0]: submit.groups references unknown submission member 'region_note'")
    expect((processGenuiSpec(groupHeaderDetail).repaired?.items[0] as { details?: unknown }).details).toBeUndefined()

    const headerlessDetail = { items: [
      { type: 'table', rows: [['姓名'], ['Alice']], details: [null, [{ type: 'input', id: 'headerless_ghost' }]] },
      { type: 'submit', label: 'Send', action: 'send', groups: ['headerless_ghost'] },
    ] } as GenuiSpec
    expect([...compileSubmissionRegistry(headerlessDetail).members.keys()]).not.toContain('headerless_ghost')
    expect(validateGenuiSpec(headerlessDetail).errors).toContain('items[0].details must not contain more entries than rows')

    const overwideHeaderDetail = { items: [
      { type: 'table', rows: [
        ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10', 'h11', 'h12', 'extra'],
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
      ], details: [null, [{ type: 'input', id: 'wide_ghost' }]] },
      { type: 'submit', label: 'Send', action: 'send', groups: ['wide_ghost'] },
    ] } as GenuiSpec
    expect([...compileSubmissionRegistry(overwideHeaderDetail).members.keys()]).not.toContain('wide_ghost')
    expect(validateGenuiSpec(overwideHeaderDetail).errors).toContain('items[0].details must not contain more entries than rows')
    expect(processGenuiSpec(overwideHeaderDetail).errors).toContain('items[0].details must not contain more entries than rows')
    expect((processGenuiSpec(overwideHeaderDetail).repaired?.items[0] as { rows: unknown[] }).rows).toHaveLength(1)

    const objectGroupHeaderDetail = { items: [
      {
        type: 'table', columns: [{ title: '区域', key: 'region' }, { title: '数值', key: 'value' }], types: ['group', 'num'],
        rows: [{ region: '华东', value: '' }, { region: '上海', value: '120' }],
        details: [[{ type: 'input', id: 'object_header_ghost' }], null],
      },
      { type: 'submit', label: 'Send', action: 'send', groups: ['object_header_ghost'] },
    ] } as GenuiSpec
    expect([...compileSubmissionRegistry(objectGroupHeaderDetail).members.keys()]).not.toContain('object_header_ghost')
    expect(validateGenuiSpec(objectGroupHeaderDetail).errors).toContain("items[1].groups[0]: submit.groups references unknown submission member 'object_header_ghost'")

    const cappedRows = Array.from({ length: 51 }, (_unused, index) => [`row ${index}`])
    const cappedDetails: Array<GenuiSpec['items'][number] | null> = Array.from({ length: 51 }, () => null)
    cappedDetails[50] = { type: 'input', id: 'capped_ghost' }
    const beyondRendererLimit = { items: [
      { type: 'table', columns: ['Row'], rows: cappedRows, details: cappedDetails.map(detail => detail === null ? null : [detail]) },
      { type: 'submit', label: 'Send', action: 'send', groups: ['capped_ghost'] },
    ] } as GenuiSpec
    expect([...compileSubmissionRegistry(beyondRendererLimit).members.keys()]).not.toContain('capped_ghost')
    expect(validateGenuiSpec(beyondRendererLimit).errors).toContain('items[0].details must not contain more entries than rows')
  })

  it('uses the single answered rule for all member kinds', () => {
    const registry = compileSubmissionRegistry({ items: [
      { type: 'radio', group: 'radio', options: ['A'] },
      { type: 'checkbox', group: 'check', label: 'A' },
      { type: 'input', id: 'field' },
      { type: 'input', id: 'secret', inputType: 'password' },
    ] })
    const radio = registry.members.get('radio')!
    const check = registry.members.get('check')!
    const field = registry.members.get('field')!
    const secret = registry.members.get('secret')!
    expect([radio, check, field, secret].map(member => isSubmissionMemberAnswered(member, emptyState))).toEqual([false, false, false, false])
    const state = { answers: { radio: 'A' }, multiAnswers: { check: ['A'] }, fields: { field: '  ', secret: 'hidden' }, secretFields: new Set(['secret']) }
    expect([radio, check, field, secret].map(member => isSubmissionMemberAnswered(member, state))).toEqual([true, true, false, false])
    expect(isSubmissionMemberAnswered(field, { ...state, fields: { ...state.fields, field: ' x ' } })).toBe(true)
  })

  it('counts explicit and implicit scope and preserves action delivery for other payload state', () => {
    const registry = compileSubmissionRegistry({ items: [
      { type: 'radio', group: 'q1', options: ['A', 'B'], answer: 1 },
      { type: 'input', id: 'one' }, { type: 'input', id: 'two' },
      { type: 'checkbox', group: 'extras', label: 'X' },
    ] })
    const state = { ...emptyState, answers: { q1: 'B' }, fields: { one: '1', two: '2' } }
    expect(resolveSubmitState({ registry, groups: ['one', 'two'], state })).toMatchObject({ answered: 2, total: 2, localGradeEligible: false, hasOutOfScopePayload: true })
    expect(resolveSubmitState({ registry, state })).toMatchObject({ answered: 3, total: 3, localGradeEligible: false, hasOutOfScopePayload: false })
    expect(resolveSubmitState({ registry, groups: ['q1'], state })).toMatchObject({ answered: 1, total: 1, localGradeEligible: true, hasOutOfScopePayload: true })
    expect(resolveSubmitState({ registry, groups: ['q1'], state: { ...emptyState, answers: { q1: 'B' } } })).toMatchObject({ answered: 1, total: 1, localGradeEligible: true, hasOutOfScopePayload: false })
    expect(resolveSubmitState({ registry, state: { ...emptyState, answers: { q1: 'B' } } })).toMatchObject({ answered: 1, total: 1, localGradeEligible: true, hasOutOfScopePayload: false })
    expect(resolveSubmitState({ registry, groups: ['q1', 'missing'], state: { ...emptyState, answers: { q1: 'B' } } })).toMatchObject({ answered: 1, total: 2, localGradeEligible: false, hasOutOfScopePayload: false })
    expect(resolveSubmitState({ registry, groups: ['q1'], state: { ...emptyState, answers: { q1: 'B' }, multiAnswers: { extras: [] } } })).toMatchObject({ localGradeEligible: true, hasOutOfScopePayload: true })
  })
})
