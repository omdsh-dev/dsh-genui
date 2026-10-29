// @vitest-environment jsdom
// Conditional visibility (`when`): a decision tree reacts to the block's own
// state, and a hidden field must neither submit a stale value nor look
// unanswered. Those two rules are what make it a feature rather than CSS.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { collectHiddenKeys, evaluateWhen } from '../src/client/conditions.ts'
import { processGenuiSpec } from '../src/client/guard.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

afterEach(cleanup)

const EMPTY = { fields: {}, answers: {}, multiAnswers: {} }
const state = (fields: Record<string, string> = {}, answers: Record<string, string> = {}, multiAnswers: Record<string, string[]> = {}) =>
  ({ fields, answers, multiAnswers })

describe('evaluateWhen', () => {
  it('compares a field value for eq / neq', () => {
    expect(evaluateWhen({ field: 'entity', op: 'eq', value: '公司' }, state({ entity: '公司' }))).toBe(true)
    expect(evaluateWhen({ field: 'entity', op: 'eq', value: '公司' }, state({ entity: '个人' }))).toBe(false)
    expect(evaluateWhen({ field: 'entity', op: 'neq', value: '公司' }, state({ entity: '个人' }))).toBe(true)
  })

  it('reads radio and choices groups from answers, not fields', () => {
    expect(evaluateWhen({ field: 'plan', op: 'eq', value: '自定义' }, state({}, { plan: '自定义' }))).toBe(true)
  })

  it('matches any selected label for in / not-in', () => {
    const when = { field: 'tags', op: 'in' as const, value: ['A', 'B'] }
    expect(evaluateWhen(when, state({}, {}, { tags: ['B', 'C'] }))).toBe(true)
    expect(evaluateWhen(when, state({}, {}, { tags: ['C'] }))).toBe(false)
    expect(evaluateWhen({ ...when, op: 'not-in' }, state({}, {}, { tags: ['C'] }))).toBe(true)
  })

  it('compares numbers with gt / gte / lt / lte and ignores non-numeric drafts', () => {
    expect(evaluateWhen({ field: 'amount', op: 'gt', value: 1000 }, state({ amount: '1500' }))).toBe(true)
    expect(evaluateWhen({ field: 'amount', op: 'gt', value: 1000 }, state({ amount: '900' }))).toBe(false)
    expect(evaluateWhen({ field: 'amount', op: 'gte', value: 1000 }, state({ amount: '1000' }))).toBe(true)
    expect(evaluateWhen({ field: 'amount', op: 'lt', value: 10 }, state({ amount: 'abc' }))).toBe(false)
  })

  it('has empty / not-empty / checked shorthands', () => {
    expect(evaluateWhen({ field: 'taxId', op: 'empty' }, state({ taxId: '  ' }))).toBe(true)
    expect(evaluateWhen({ field: 'taxId', op: 'not-empty' }, state({ taxId: '9133' }))).toBe(true)
    expect(evaluateWhen({ field: 'notify', op: 'checked' }, state({ notify: 'true' }))).toBe(true)
    expect(evaluateWhen({ field: 'notify', op: 'checked' }, EMPTY)).toBe(false)
  })

  it('reports a malformed operator as false instead of throwing', () => {
    expect(evaluateWhen({ field: 'x', op: 'bogus' as never, value: 1 }, EMPTY)).toBe(false)
  })
})

describe('collectHiddenKeys', () => {
  it('collects the hidden node and every key beneath a hidden container', () => {
    const items = [
      { type: 'select', id: 'entity', options: ['公司', '个人'] },
      {
        type: 'card',
        when: { field: 'entity', op: 'eq', value: '公司' },
        items: [
          { type: 'input', id: 'taxId', label: '税号' },
          { type: 'input', id: 'bankAccount', label: '账号' },
        ],
      },
      { type: 'input', id: 'nickname', label: '昵称' },
    ]
    expect([...collectHiddenKeys(items, state({ entity: '个人' }))].sort()).toEqual(['bankAccount', 'taxId'])
    expect([...collectHiddenKeys(items, state({ entity: '公司' }))]).toEqual([])
  })
})

const tree: GenuiSpec = {
  items: [
    { type: 'select', id: 'entity', label: '主体', options: ['公司', '个人'] },
    { type: 'input', id: 'taxId', label: '税号', when: { field: 'entity', op: 'eq', value: '公司' } },
    { type: 'submit', label: '提交', action: 'send' },
  ],
} as GenuiSpec

describe('a conditional field in a real block', () => {
  it('stays hidden until the condition holds, then appears', () => {
    render(<GenuiBlock spec={tree} />)
    expect(screen.queryByLabelText('税号')).toBeNull()
    // The select renders its option labels; pick the one that satisfies `when`.
    const select = document.querySelector('select')!
    fireEvent.change(select, { target: { value: '公司' } })
    expect(screen.getByLabelText('税号')).not.toBeNull()
    fireEvent.change(select, { target: { value: '个人' } })
    expect(screen.queryByLabelText('税号')).toBeNull()
  })

  it('does not submit a value the reader cannot see', async () => {
    const action = vi.fn()
    // The block reads its handler from the plugin-owned action context.
    render(<GenuiActionContext.Provider value={action}><GenuiBlock spec={tree} /></GenuiActionContext.Provider>)
    const select = document.querySelector('select')!
    fireEvent.change(select, { target: { value: '公司' } })
    fireEvent.change(screen.getByLabelText('税号'), { target: { value: '9133' } })
    // Hide it again: the value stays in state but must leave the payload.
    fireEvent.change(select, { target: { value: '个人' } })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    await vi.waitFor(() => expect(action).toHaveBeenCalled())
    const payload = action.mock.calls[0]![1] as { fields?: Record<string, string> }
    expect(payload.fields ?? {}).not.toHaveProperty('taxId')
  })
})

describe('when guard', () => {
  const wrap = (node: unknown): unknown => ({ items: [node] })

  it('keeps a well-formed condition and drops a malformed one', () => {
    const ok = processGenuiSpec(wrap({ type: 'text', content: 'a', when: { field: 'x', op: 'eq', value: '1' } }))
    expect(ok.errors).toHaveLength(0)
    expect(ok.spec?.items[0]).toMatchObject({ when: { field: 'x', op: 'eq', value: '1' } })

    const bad = processGenuiSpec(wrap({ type: 'text', content: 'a', when: { field: 'x', op: 'nope' } }))
    expect(bad.errors.join(' ')).toContain('when.op')
  })

  it('requires an array for in / not-in', () => {
    const result = processGenuiSpec(wrap({ type: 'text', content: 'a', when: { field: 'x', op: 'in', value: 'a' } }))
    expect(result.errors.join(' ')).toContain("requires an array")
  })
})
