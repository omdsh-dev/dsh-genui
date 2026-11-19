// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { resolveGenuiSpec } from '../src/client/fence-render.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'
import type { BlockInteractionState } from '../src/client/interaction-store.ts'
import type { GenuiSpec } from '../src/client/spec.ts'
import { GENUI_LIMITS } from '../src/client/genui-runtime/index.ts'

type Action = [string, Record<string, unknown>]

/** 在真实 GenuiBlock 中收集 action，保留组件原有的状态和 effect。 */
function mount(spec: GenuiSpec, actions: Action[], stateKey?: string, onStateSnapshot?: (state: BlockInteractionState) => void) {
  return render(<GenuiActionContext.Provider value={(action, payload) => actions.push([action, payload])}>
    <GenuiBlock spec={spec} stateKey={stateKey} onStateSnapshot={onStateSnapshot} />
  </GenuiActionContext.Provider>)
}

/** 获取 submit 按钮及其进度文字。 */
function submitUi(container: HTMLElement): { button: HTMLButtonElement; hint: string } {
  const row = container.querySelector('[class*="submitRow"]')!
  return { button: row.querySelector('button')!, hint: row.textContent ?? '' }
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})

describe('submit submission members', () => {
  it('uses computed radio labels and explanations in the final local grade', () => {
    const { container } = mount({
      computed: [{ id: 'answer', expr: '42' }],
      items: [
        { type: 'radio', group: 'q', label: 'Question {{answer}}', options: ['A', 'B'], answer: 0, explanation: 'Explanation {{answer}}' },
        { type: 'submit', label: 'Grade', groups: ['q'] },
      ],
    }, [])
    fireEvent.click(container.querySelector('input[type="radio"]')!)
    fireEvent.click(submitUi(container).button)
    const grade = container.querySelector('[data-genui-grade]')!
    expect(grade.textContent).toContain('Question 42')
    expect(grade.textContent).toContain('Explanation 42')
    expect(grade.textContent).not.toContain('{{')
  })

  it('clears invalid numeric drafts when streaming replaces an input with another control', () => {
    const actions: Action[] = []
    const spec: GenuiSpec = { items: [
      { type: 'input', id: 'amount', inputType: 'number', label: '金额', value: '2' },
      { type: 'submit', label: 'Send', action: 'send', groups: ['amount'] },
    ] }
    const view = mount(spec, actions)
    fireEvent.change(view.container.querySelector('input')!, { target: { value: '-' } })
    expect(submitUi(view.container).button.disabled).toBe(true)
    view.rerender(<GenuiActionContext.Provider value={(action, payload) => actions.push([action, payload])}>
      <GenuiBlock spec={{ items: [
        { type: 'select', id: 'amount', label: '金额', options: ['3'], selected: 0 },
        spec.items[1]!,
      ] }} />
    </GenuiActionContext.Provider>)
    expect(submitUi(view.container).button.disabled).toBe(false)
    fireEvent.click(submitUi(view.container).button)
    expect(actions).toEqual([['send', { type: 'submit', answers: {}, fields: { amount: '3' }, total: 1, answered: 1 }]])
  })

  it('submits Issue #228 input groups at 0/2, 1/2, and 2/2', () => {
    const actions: Action[] = []
    const spec: GenuiSpec = { items: [
      { type: 'input', id: 'e3_ll', label: 'Lower left 的 x', placeholder: '例如 1.30000' },
      { type: 'input', id: 'e3_ur', label: 'Upper right 的 x', placeholder: '例如 1.50000' },
      { type: 'submit', label: '交给助手看', action: 'grade_calc', groups: ['e3_ll', 'e3_ur'] },
    ] }
    const { container } = mount(spec, actions)
    const inputs = container.querySelectorAll('input')
    expect(submitUi(container).button.disabled).toBe(true)
    expect(submitUi(container).hint).toContain('已选 0/2')
    fireEvent.change(inputs[0]!, { target: { value: '1.3000' } })
    expect(submitUi(container).button.disabled).toBe(true)
    expect(submitUi(container).hint).toContain('已选 1/2')
    fireEvent.change(inputs[1]!, { target: { value: '0.5000' } })
    expect(submitUi(container).button.disabled).toBe(false)
    expect(submitUi(container).hint).toContain('已选 2/2')
    fireEvent.click(submitUi(container).button)
    expect(actions).toEqual([['grade_calc', { type: 'submit', answers: {}, fields: { e3_ll: '1.3000', e3_ur: '0.5000' }, total: 2, answered: 2 }]])
  })

  it('submits a field rendered from expanded table details', () => {
    const actions: Action[] = []
    const spec: GenuiSpec = { items: [
      { type: 'table', columns: ['项目'], rows: [['A']], details: [[{ type: 'input', id: 'note', label: '备注' }]] },
      { type: 'submit', label: '提交', action: 'send' },
    ] }
    const { container } = mount(spec, actions)
    expect(submitUi(container).button.disabled).toBe(true)
    fireEvent.click(container.querySelector('button[class*="detailToggle"]')!)
    fireEvent.change(container.querySelector('input:not([type="radio"]):not([type="checkbox"])')!, { target: { value: 'checked' } })
    expect(submitUi(container).button.disabled).toBe(false)
    fireEvent.click(submitUi(container).button)
    expect(actions).toEqual([['send', { type: 'submit', answers: {}, fields: { note: 'checked' }, total: 1, answered: 1 }]])
  })

  it('submits the surviving detail field on its original row after partial fence repair', () => {
    const actions: Action[] = []
    const spec = resolveGenuiSpec(JSON.stringify({ items: [
      { type: 'table', columns: ['Item'], rows: [['A'], ['B']], details: [{ type: 'text', content: 'bad entry' }, [{ type: 'text' }, { type: 'input', id: 'note', label: 'Note' }]] },
      { type: 'submit', label: 'Send', action: 'send', groups: ['note'] },
    ] }))
    expect(spec).not.toBeNull()
    const { container } = mount(spec!, actions)
    const rows = container.querySelectorAll('tbody tr')
    expect(rows[0]!.querySelector('button[class*="detailToggle"]')).toBeNull()
    fireEvent.click(rows[1]!.querySelector('button[class*="detailToggle"]')!)
    expect(submitUi(container).hint).toContain('已选 0/1')
    fireEvent.change(container.querySelector('input')!, { target: { value: 'checked' } })
    expect(submitUi(container).hint).toContain('已选 1/1')
    fireEvent.click(submitUi(container).button)
    expect(actions).toEqual([['send', { type: 'submit', answers: {}, fields: { note: 'checked' }, total: 1, answered: 1 }]])
  })

  it('does not expose group-header details as submission members', () => {
    const actions: Action[] = []
    const { container } = mount({ items: [
      { type: 'table', columns: ['区域', '数值'], types: ['group', 'num'], rows: [['华东', ''], ['上海', '120']], details: [[{ type: 'input', id: 'region_note' }], null] },
      { type: 'submit', label: '提交', action: 'send', groups: ['region_note'] },
    ] }, actions)
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('button[class*="detailToggle"]')).toBeNull()
    expect(submitUi(container).button.disabled).toBe(true)
    expect(submitUi(container).hint).toContain('已选 0/1')
    expect(actions).toEqual([])
  })

  it('does not register table details beyond the renderer row limit', () => {
    const actions: Action[] = []
    const rows = Array.from({ length: GENUI_LIMITS.maxTableRows + 1 }, (_unused, index) => [`row ${index}`])
    const details = Array.from({ length: rows.length }, (_unused, index) => index === rows.length - 1 ? [{ type: 'input' as const, id: 'last_row' }] : null)
    const { container } = mount({ items: [
      { type: 'table', columns: ['Row'], rows, details },
      { type: 'submit', label: '提交', action: 'send', groups: ['last_row'] },
    ] }, actions)
    expect(container.querySelector('input')).toBeNull()
    expect(submitUi(container).button.disabled).toBe(true)
    expect(submitUi(container).hint).toContain('已选 0/1')
    expect(actions).toEqual([])
  })

  it.each(['input', 'textarea'] as const)('%s requires a nonblank field value', type => {
    const actions: Action[] = []
    const { container } = mount({ items: [{ type, id: 'value' }, { type: 'submit', label: 'Send', action: 'send', groups: ['value'] }] }, actions)
    const field = container.querySelector(type)!
    expect(submitUi(container).button.disabled).toBe(true)
    fireEvent.change(field, { target: { value: 'entry' } })
    expect(submitUi(container).button.disabled).toBe(false)
    fireEvent.change(field, { target: { value: '   ' } })
    expect(submitUi(container).button.disabled).toBe(true)
    expect(submitUi(container).hint).toContain('已选 0/1')
  })

  it('counts select choice and slider mount default through their existing registration', () => {
    const actions: Action[] = []
    const select = mount({ items: [
      { type: 'select', id: 'choice', options: ['A', 'B'] },
      { type: 'submit', label: 'Send', action: 'send', groups: ['choice'] },
    ] }, actions)
    expect(submitUi(select.container).button.disabled).toBe(true)
    fireEvent.change(select.container.querySelector('select')!, { target: { value: 'B' } })
    expect(submitUi(select.container).button.disabled).toBe(false)
    select.unmount()

    const slider = mount({ items: [
      { type: 'slider', id: 'amount', label: 'Amount', min: 2, max: 10 },
      { type: 'submit', label: 'Send', action: 'send', groups: ['amount'] },
    ] }, actions)
    expect(submitUi(slider.container).hint).toContain('已选 1/1')
    fireEvent.click(submitUi(slider.container).button)
    expect(actions).toEqual([['send', { type: 'submit', answers: {}, fields: { amount: '2' }, total: 1, answered: 1 }]])
  })

  it('blocks submit while a required numeric draft is invalid and submits the corrected value', () => {
    const actions: Action[] = []
    const { container } = mount({
      computed: [{ id: 'double', expr: 'amount*2' }],
      items: [
        { type: 'input', id: 'amount', label: '金额', inputType: 'number', value: '2' },
        { type: 'text', content: '结果 {{double}}' },
        { type: 'submit', label: 'Send', action: 'send', groups: ['amount'] },
      ],
    }, actions)
    const input = container.querySelector('input')!

    expect(submitUi(container).button.disabled).toBe(false)
    fireEvent.change(input, { target: { value: '-' } })
    expect(input).toHaveProperty('value', '-')
    expect(submitUi(container).button.disabled).toBe(true)
    expect(container.textContent).toContain('请输入有效的十进制数值')
    expect(container.textContent).toContain('结果 4')
    fireEvent.click(submitUi(container).button)
    expect(actions).toEqual([])

    fireEvent.change(input, { target: { value: '3' } })
    expect(submitUi(container).button.disabled).toBe(false)
    fireEvent.click(submitUi(container).button)
    expect(actions).toEqual([['send', { type: 'submit', answers: {}, fields: { amount: '3' }, total: 1, answered: 1 }]])
  })

  it('rejects radix notation pasted into a numeric input', () => {
    const actions: Action[] = []
    const { container } = mount({ items: [
      { type: 'input', id: 'amount', label: '金额', inputType: 'number', value: '2' },
      { type: 'submit', label: 'Send', action: 'send', groups: ['amount'] },
    ] }, actions)
    const input = container.querySelector('input')!

    fireEvent.change(input, { target: { value: '0x10' } })
    expect(submitUi(container).button.disabled).toBe(true)
    expect(container.textContent).toContain('请输入有效的十进制数值')
    fireEvent.click(submitUi(container).button)
    expect(actions).toEqual([])
  })

  it('clears numeric draft validity when a streaming update changes the field to text', () => {
    const actions: Action[] = []
    const numericSpec: GenuiSpec = { items: [
      { type: 'input', id: 'amount', label: '金额', inputType: 'number', value: '2' },
      { type: 'submit', label: 'Send', action: 'send', groups: ['amount'] },
    ] }
    const view = mount(numericSpec, actions)
    const input = view.container.querySelector('input')!
    fireEvent.change(input, { target: { value: '-' } })
    expect(submitUi(view.container).button.disabled).toBe(true)

    view.rerender(<GenuiActionContext.Provider value={(action, payload) => actions.push([action, payload])}>
      <GenuiBlock spec={{ ...numericSpec, items: [
        { type: 'input', id: 'amount', label: '金额', inputType: 'text', value: '0' },
        numericSpec.items[1]!,
      ] }} />
    </GenuiActionContext.Provider>)

    expect(view.container.querySelector('input')).toHaveProperty('value', '-')
    expect(submitUi(view.container).button.disabled).toBe(false)
    fireEvent.click(submitUi(view.container).button)
    expect(actions).toEqual([['send', { type: 'submit', answers: {}, fields: { amount: '-' }, total: 1, answered: 1 }]])
  })

  it('counts mixed radio, checkbox, and field members and keeps their payload sections', () => {
    const actions: Action[] = []
    const { container } = mount({ items: [
      { type: 'radio', group: 'q1', options: ['A', 'B'] },
      { type: 'checkbox', group: 'styles', label: 'X' },
      { type: 'input', id: 'reason' },
      { type: 'submit', label: 'Send', action: 'send', groups: ['q1', 'styles', 'reason'] },
    ] }, actions)
    expect(submitUi(container).hint).toContain('已选 0/3')
    fireEvent.click(container.querySelectorAll('[type="radio"]')[1]!)
    expect(submitUi(container).hint).toContain('已选 1/3')
    fireEvent.click(container.querySelector('[type="checkbox"]')!)
    expect(submitUi(container).hint).toContain('已选 2/3')
    fireEvent.change(container.querySelector('input:not([type="radio"]):not([type="checkbox"])')!, { target: { value: 'because' } })
    expect(submitUi(container).hint).toContain('已选 3/3')
    fireEvent.click(submitUi(container).button)
    expect(actions).toEqual([['send', { type: 'submit', answers: { q1: 'B', styles: ['X'] }, fields: { reason: 'because' }, total: 3, answered: 3 }]])
  })

  it('counts checkbox and input together', () => {
    const actions: Action[] = []
    const { container } = mount({ items: [
      { type: 'checkbox', group: 'styles', label: 'X' }, { type: 'input', id: 'reason' },
      { type: 'submit', label: 'Send', action: 'send', groups: ['styles', 'reason'] },
    ] }, actions)
    fireEvent.click(container.querySelector('[type="checkbox"]')!)
    expect(submitUi(container).hint).toContain('已选 1/2')
    fireEvent.change(container.querySelector('input:not([type="checkbox"])')!, { target: { value: 'yes' } })
    expect(submitUi(container).hint).toContain('已选 2/2')
  })

  it('requires both radio and input members in an explicit scope', () => {
    const actions: Action[] = []
    const { container } = mount({ items: [
      { type: 'radio', group: 'q1', options: ['A', 'B'] }, { type: 'input', id: 'reason' },
      { type: 'submit', label: 'Send', action: 'send', groups: ['q1', 'reason'] },
    ] }, actions)
    expect(submitUi(container).hint).toContain('已选 0/2')
    fireEvent.click(container.querySelectorAll('[type="radio"]')[1]!)
    expect(submitUi(container).hint).toContain('已选 1/2')
    expect(submitUi(container).button.disabled).toBe(true)
    fireEvent.change(container.querySelector('input:not([type="radio"])')!, { target: { value: 'why' } })
    expect(submitUi(container).hint).toContain('已选 2/2')
    fireEvent.click(submitUi(container).button)
    expect(actions).toEqual([['send', { type: 'submit', answers: { q1: 'B' }, fields: { reason: 'why' }, total: 2, answered: 2 }]])
  })

  it('keeps submit without groups enabled after any answer and counts all answered members', () => {
    const actions: Action[] = []
    const { container } = mount({ items: [
      { type: 'radio', group: 'q1', options: ['A', 'B'] },
      { type: 'input', id: 'one' }, { type: 'input', id: 'two' },
      { type: 'submit', label: 'Send', action: 'send' },
    ] }, actions)
    expect(submitUi(container).button.disabled).toBe(true)
    const fields = container.querySelectorAll('input:not([type="radio"])')
    fireEvent.change(fields[0]!, { target: { value: '1' } })
    expect(submitUi(container).hint).toContain('已选 1/1')
    expect(submitUi(container).button.disabled).toBe(false)
    fireEvent.click(submitUi(container).button)
    expect(actions[0]).toEqual(['send', { type: 'submit', answers: {}, fields: { one: '1' }, total: 1, answered: 1 }])
    fireEvent.change(fields[1]!, { target: { value: '2' } })
    fireEvent.click(container.querySelectorAll('[type="radio"]')[1]!)
    expect(submitUi(container).hint).toContain('已选 3/3')
    fireEvent.click(submitUi(container).button)
    expect(actions[1]).toEqual(['send', { type: 'submit', answers: { q1: 'B' }, fields: { one: '1', two: '2' }, total: 3, answered: 3 }])
  })

  it('grades a pure radio scope locally without an action callback', () => {
    const actions: Action[] = []
    const { container } = mount({ items: [
      { type: 'radio', group: 'q1', label: 'Question', options: ['A', 'B'], answer: 1 },
      { type: 'submit', label: 'Grade', groups: ['q1'] },
    ] }, actions)
    fireEvent.click(container.querySelectorAll('[type="radio"]')[1]!)
    fireEvent.click(submitUi(container).button)
    expect(container.querySelector('[data-genui-grade]')?.textContent).toContain('1 / 1')
    expect(actions).toEqual([])
  })

  it('grades a radio answer locally when submit has no groups or action', () => {
    const actions: Action[] = []
    const { container } = mount({ items: [
      { type: 'radio', group: 'q1', label: 'Question', options: ['A', 'B'], answer: 1 },
      { type: 'submit', label: 'Grade' },
    ] }, actions)
    fireEvent.click(container.querySelectorAll('[type="radio"]')[1]!)
    expect(submitUi(container).button.disabled).toBe(false)
    fireEvent.click(submitUi(container).button)
    expect(container.querySelector('[data-genui-grade]')?.textContent).toContain('1 / 1')
    expect(actions).toEqual([])
  })

  it('keeps local grading available after an out-of-scope checkbox is cleared', () => {
    const actions: Action[] = []
    const { container } = mount({ items: [
      { type: 'radio', group: 'q1', label: 'Question', options: ['A', 'B'], answer: 1 },
      { type: 'checkbox', group: 'extras', label: 'Extra' },
      { type: 'submit', label: 'Grade', groups: ['q1'] },
    ] }, actions)
    fireEvent.click(container.querySelectorAll('[type="radio"]')[1]!)
    fireEvent.click(container.querySelector('[type="checkbox"]')!)
    fireEvent.click(container.querySelector('[type="checkbox"]')!)
    expect(submitUi(container).button.disabled).toBe(false)
    fireEvent.click(submitUi(container).button)
    expect(container.querySelector('[data-genui-grade]')?.textContent).toContain('1 / 1')
    expect(actions).toEqual([])
  })

  it('keeps a repaired submit with an unknown group mounted and disabled', () => {
    const actions: Action[] = []
    const spec = repairGenuiSpec({ items: [
      { type: 'radio', group: 'q1', options: ['A', 'B'], answer: 1 },
      { type: 'submit', label: 'Send', action: 'send', groups: ['missing'] },
    ] })!
    const { container } = mount(spec, actions)
    fireEvent.click(container.querySelectorAll('[type="radio"]')[1]!)
    expect(submitUi(container).button.disabled).toBe(true)
    expect(submitUi(container).hint).toContain('已选 0/1')
    expect(actions).toEqual([])
  })

  it('renders a direct block with a native tree deeper than the renderer limit', () => {
    const actions: Action[] = []
    let items: GenuiSpec['items'] = [{ type: 'text', content: 'deep' }]
    for (let depth = 0; depth < GENUI_LIMITS.maxDepth + 4; depth++) {
      items = [{ type: 'row', items }]
    }
    expect(() => mount({ items }, actions)).not.toThrow()
  })

  it.each([
    { name: 'field in scope', groups: ['q1', 'note'], extra: { type: 'input', id: 'note' } as const, select: 'input:not([type="radio"])', value: 'filled' },
    { name: 'field outside scope', groups: ['q1'], extra: { type: 'input', id: 'note' } as const, select: 'input:not([type="radio"])', value: 'filled' },
    { name: 'checkbox in scope', groups: ['q1', 'extras'], extra: { type: 'checkbox', group: 'extras', label: 'X' } as const, select: '[type="checkbox"]', value: undefined },
    { name: 'checkbox outside scope', groups: ['q1'], extra: { type: 'checkbox', group: 'extras', label: 'X' } as const, select: '[type="checkbox"]', value: undefined },
    { name: 'radio outside scope', groups: ['q1'], extra: { type: 'radio', group: 'other', options: ['X', 'Y'] } as const, select: '[type="radio"]', value: undefined },
  ])('sends an action with $name', ({ groups, extra, select, value }) => {
    const actions: Action[] = []
    const { container } = mount({ items: [
      { type: 'radio', group: 'q1', options: ['A', 'B'], answer: 1 }, extra,
      { type: 'submit', label: 'Grade', action: 'grade', groups },
    ] }, actions)
    fireEvent.click(container.querySelectorAll('[type="radio"]')[1]!)
    if (value === undefined) {
      const target = select === '[type="radio"]' ? container.querySelectorAll(select)[2] : container.querySelector(select)
      fireEvent.click(target!)
    } else fireEvent.change(container.querySelector(select)!, { target: { value } })
    fireEvent.click(submitUi(container).button)
    expect(container.querySelector('[data-genui-grade]')).toBeNull()
    expect(actions).toHaveLength(1)
    expect(actions[0]![0]).toBe('grade')
    if ('id' in extra) expect(actions[0]![1]).toMatchObject({ fields: { note: 'filled' } })
    if (extra.type === 'checkbox') expect(actions[0]![1]).toMatchObject({ answers: { extras: ['X'] } })
  })

  it('keeps groups outside the payload filter', () => {
    const actions: Action[] = []
    const { container } = mount({ items: [
      { type: 'radio', group: 'q1', options: ['A', 'B'] },
      { type: 'input', id: 'note' }, { type: 'checkbox', group: 'extras', label: 'X' },
      { type: 'submit', label: 'Send', action: 'send', groups: ['q1'] },
    ] }, actions)
    fireEvent.click(container.querySelectorAll('[type="radio"]')[1]!)
    fireEvent.change(container.querySelector('input:not([type="radio"]):not([type="checkbox"])')!, { target: { value: '已核对' } })
    fireEvent.click(container.querySelector('[type="checkbox"]')!)
    fireEvent.click(submitUi(container).button)
    expect(actions).toEqual([['send', { type: 'submit', answers: { q1: 'B', extras: ['X'] }, fields: { note: '已核对' }, total: 1, answered: 1 }]])
  })

  it('restores field readiness and preserves explicit empty values over spec defaults', () => {
    vi.useFakeTimers()
    const actions: Action[] = []
    const spec: GenuiSpec = { items: [
      { type: 'input', id: 'name', value: 'default' },
      { type: 'submit', label: 'Send', action: 'send', groups: ['name'] },
    ] }
    const first = mount(spec, actions, 'submit:field')
    fireEvent.change(first.container.querySelector('input')!, { target: { value: 'saved' } })
    act(() => { vi.advanceTimersByTime(300) })
    first.unmount()
    const second = mount(spec, actions, 'submit:field')
    expect((second.container.querySelector('input') as HTMLInputElement).value).toBe('saved')
    expect(submitUi(second.container).hint).toContain('已选 1/1')
    fireEvent.change(second.container.querySelector('input')!, { target: { value: '' } })
    act(() => { vi.advanceTimersByTime(300) })
    second.unmount()
    const third = mount(spec, actions, 'submit:field')
    expect((third.container.querySelector('input') as HTMLInputElement).value).toBe('')
    expect(submitUi(third.container).button.disabled).toBe(true)
  })

  it('keeps an explicitly emptied checkbox group empty after refresh', () => {
    vi.useFakeTimers()
    const actions: Action[] = []
    const spec: GenuiSpec = { items: [
      { type: 'checkbox', group: 'styles', label: 'A', checked: true },
      { type: 'submit', label: 'Send', action: 'send', groups: ['styles'] },
    ] }
    const first = mount(spec, actions, 'submit:checkbox')
    expect(submitUi(first.container).hint).toContain('已选 1/1')
    fireEvent.click(first.container.querySelector('[type="checkbox"]')!)
    expect(submitUi(first.container).hint).toContain('已选 0/1')
    act(() => { vi.advanceTimersByTime(300) })
    first.unmount()
    const second = mount(spec, actions, 'submit:checkbox')
    expect((second.container.querySelector('[type="checkbox"]') as HTMLInputElement).checked).toBe(false)
    expect(submitUi(second.container).button.disabled).toBe(true)
  })

  it('clears radio and checkbox state while retaining fields on retry', () => {
    const actions: Action[] = []
    const snapshots: BlockInteractionState[] = []
    const { container } = mount({ items: [
      { type: 'radio', group: 'q1', options: ['A', 'B'], answer: 1 },
      { type: 'checkbox', group: 'extras', label: 'X' },
      { type: 'input', id: 'note' },
      { type: 'submit', label: 'Grade', groups: ['q1'] },
    ] }, actions, undefined, state => { snapshots.push(state) })
    fireEvent.click(container.querySelectorAll('[type="radio"]')[1]!)
    fireEvent.click(submitUi(container).button)
    expect(container.querySelector('[data-genui-grade]')).not.toBeNull()
    fireEvent.click(container.querySelector('[type="checkbox"]')!)
    fireEvent.change(container.querySelector('input:not([type="radio"]):not([type="checkbox"])')!, { target: { value: 'keep' } })
    fireEvent.click(container.querySelector('[data-genui-grade] button')!)
    expect(snapshots.at(-1)).toMatchObject({ answers: {}, fields: { note: 'keep' }, locked: false })
    expect(snapshots.at(-1)?.multiAnswers).toBeUndefined()
    expect((container.querySelector('input:not([type="radio"]):not([type="checkbox"])') as HTMLInputElement).value).toBe('keep')
    expect((container.querySelector('[type="checkbox"]') as HTMLInputElement).checked).toBe(false)
    expect((container.querySelectorAll('[type="radio"]')[1] as HTMLInputElement).checked).toBe(false)
  })
})
