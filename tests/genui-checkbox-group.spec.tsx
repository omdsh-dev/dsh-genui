// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock, GENUI_ACTION_DEBOUNCE_MS } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})

function renderWithActions(
  spec: GenuiSpec,
  actions: Array<[string, Record<string, unknown>]>,
  stateKey?: string,
) {
  return render(
    <GenuiActionContext.Provider value={(action, payload) => actions.push([action, payload])}>
      <GenuiBlock spec={spec} stateKey={stateKey} />
    </GenuiActionContext.Provider>,
  )
}

describe('checkbox group aggregation', () => {
  it('preserves and validates checkbox.group through the guard', () => {
    const raw = {
      items: [{ type: 'checkbox', label: '工序示意式', group: 'fig_types' }],
    }
    const repaired = repairGenuiSpec(raw)
    expect(repaired).not.toBeNull()
    expect((repaired!.items[0] as { group?: string }).group).toBe('fig_types')
    expect(validateGenuiSpec(raw).ok).toBe(true)

    const invalid = validateGenuiSpec({
      items: [{ type: 'checkbox', label: '工序示意式', group: 123 }],
    })
    expect(invalid.ok).toBe(false)
    expect(invalid.errors.join('\n')).toContain('group')
  })

  it('keeps grouped toggles local and submits all selected labels once', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec: GenuiSpec = {
      items: [
        { type: 'checkbox', label: '工序示意式', group: 'fig_types', action: 'ignored-toggle' },
        { type: 'checkbox', label: '节点大样式', group: 'fig_types' },
        { type: 'checkbox', label: '透视效果图', group: 'fig_types' },
        { type: 'submit', label: '锁定', action: 'submit_fig', groups: ['fig_types'] },
      ],
    }
    const { container } = renderWithActions(spec, actions)
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    const submit = container.querySelector<HTMLButtonElement>('[class*="submitRow"] button')!

    expect(submit.disabled).toBe(true)
    fireEvent.click(boxes[0]!)
    fireEvent.click(boxes[1]!)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toHaveLength(0)
    expect(boxes[0]!.checked).toBe(true)
    expect(boxes[1]!.checked).toBe(true)
    expect(submit.disabled).toBe(false)

    fireEvent.click(submit)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['submit_fig', {
      type: 'submit',
      answers: { fig_types: ['工序示意式', '节点大样式'] },
      total: 1,
      answered: 1,
    }]])
  })

  it('supports cancelling selections and disables submit after clearing the group', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec: GenuiSpec = {
      items: [
        { type: 'checkbox', label: 'A', group: 'styles' },
        { type: 'checkbox', label: 'B', group: 'styles' },
        { type: 'submit', label: '锁定', action: 'save', groups: ['styles'] },
      ],
    }
    const { container } = renderWithActions(spec, actions)
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    const submit = container.querySelector<HTMLButtonElement>('[class*="submitRow"] button')!

    fireEvent.click(boxes[0]!)
    fireEvent.click(boxes[1]!)
    fireEvent.click(boxes[0]!)
    expect(submit.disabled).toBe(false)

    fireEvent.click(submit)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['save', {
      type: 'submit',
      answers: { styles: ['B'] },
      total: 1,
      answered: 1,
    }]])

    fireEvent.click(boxes[1]!)
    expect(submit.disabled).toBe(true)
    expect(container.querySelector('[class*="submitHint"]')?.textContent).toContain('已选 0/1')
  })

  it('lets an explicitly cleared durable group override checked defaults', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec: GenuiSpec = {
      items: [
        { type: 'checkbox', label: '默认风格', group: 'styles', checked: true },
        { type: 'submit', label: '锁定', action: 'save', groups: ['styles'] },
      ],
    }

    const first = renderWithActions(spec, actions, 'checkbox-group:durable')
    const firstBox = first.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    const firstSubmit = first.container.querySelector<HTMLButtonElement>('[class*="submitRow"] button')!
    expect(firstBox.checked).toBe(true)
    expect(firstSubmit.disabled).toBe(false)

    fireEvent.click(firstBox)
    expect(firstBox.checked).toBe(false)
    expect(firstSubmit.disabled).toBe(true)
    vi.advanceTimersByTime(300)
    first.unmount()

    const second = renderWithActions(spec, actions, 'checkbox-group:durable')
    const restoredBox = second.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    const restoredSubmit = second.container.querySelector<HTMLButtonElement>('[class*="submitRow"] button')!
    expect(restoredBox.checked).toBe(false)
    expect(restoredSubmit.disabled).toBe(true)
  })

  it('keeps the legacy per-click action when group is absent', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec: GenuiSpec = {
      items: [{ type: 'checkbox', label: '启用', action: 'toggle' }],
    }
    const { container } = renderWithActions(spec, actions)
    const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!

    fireEvent.click(box)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['toggle', { type: 'checkbox', checked: true }]])
  })

  it('falls back to aggregation when a submit scope mixes local grading and checkbox groups', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec: GenuiSpec = {
      items: [
        { type: 'radio', label: '单选题', group: 'q1', options: ['A', 'B'], answer: 'B' },
        { type: 'checkbox', label: '附加项', group: 'extras' },
        { type: 'submit', label: '提交', action: 'save', groups: ['q1', 'extras'] },
      ],
    }
    const { container } = renderWithActions(spec, actions)
    fireEvent.click(container.querySelectorAll<HTMLInputElement>('[role="radiogroup"] input')[1]!)
    fireEvent.click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!)
    const submit = container.querySelector<HTMLButtonElement>('[class*="submitRow"] button')!
    expect(submit.disabled).toBe(false)

    fireEvent.click(submit)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['save', {
      type: 'submit',
      answers: { q1: 'B', extras: ['附加项'] },
      total: 2,
      answered: 2,
    }]])
    expect(container.querySelector('[data-genui-grade]')).toBeNull()
  })
  it('keeps visible selections and submitted answers aligned after a local reset', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec: GenuiSpec = { items: [
      { type: 'radio', label: '题目', group: 'q1', options: ['A', 'B'], answer: 'A' },
      { type: 'submit', label: '交卷', groups: ['q1'] },
      { type: 'checkbox', label: '附加项', group: 'extras' },
      { type: 'submit', label: '保存附加项', action: 'save', groups: ['extras'] },
    ] }
    const ui = renderWithActions(spec, actions)
    fireEvent.click(ui.getByLabelText('附加项'))
    fireEvent.click(ui.container.querySelector('input[type="radio"]')!)
    fireEvent.click(ui.getByRole('button', { name: '交卷' }))
    fireEvent.click(ui.getAllByRole('button', { name: '重新作答' })[0]!)
    expect((ui.getByLabelText('附加项') as HTMLInputElement).checked).toBe(false)
    expect((ui.getByRole('button', { name: '保存附加项' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(ui.getByLabelText('附加项'))
    fireEvent.click(ui.getByRole('button', { name: '保存附加项' }))
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['save', { type: 'submit', answers: { extras: ['附加项'] }, total: 1, answered: 1 }]])
  })

})
