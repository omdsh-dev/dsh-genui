// @vitest-environment jsdom
// GenUI v2.6 LOCAL-FIRST interaction:
// 1) submit grades IN PLACE when the questions carry `answer`/`explanation`
//    data — score + per-question ✓/✗ + explanations, zero model round trip,
//    questions lock until 重新作答 resets them locally;
// 2) without answer data the submit keeps the v2.5 fallback (ONE action);
// 3) actionable buttons show a brief local "已响应" feedback on click.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownText } from './markdown-labels.tsx'
import { hasFenceRegistry } from './setup'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GENUI_ACTION_DEBOUNCE_MS } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
beforeEach(() => {
  vi.useFakeTimers()
})

function fenced(spec: unknown): string {
  return `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
}

/** A 2-question paper WITH local answers. */
const paper = {
  items: [
    { type: 'radio', label: '1. 9+6=？', group: 'q1', answer: 1, explanation: '9+6=15，个位相加', options: ['14', '15', '16'] },
    { type: 'radio', label: '2. 首都是？', group: 'q2', answer: '北京', explanation: '北京是首都', options: ['上海', '广州', '北京'] },
    { type: 'submit', label: '交卷', action: 'grade', groups: ['q1', 'q2'] },
  ],
}

describe.skipIf(!hasFenceRegistry)('v2.6: local grading (zero round trip)', () => {
  it('grades IN PLACE: score, per-question ✓/✗, correct answers, explanations — NO action fired', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced(paper)} />
      </GenuiActionContext.Provider>,
    )
    const groups = container.querySelectorAll('[role="radiogroup"]')
    fireEvent.click(groups[0]!.querySelectorAll('input')[1]!) // q1: 15 ✓
    fireEvent.click(groups[1]!.querySelectorAll('input')[2]!) // q2: 北京 ✓
    fireEvent.click(container.querySelector('[class*="submitRow"] button')!)

    const grade = container.querySelector('[data-genui-grade]')
    expect(grade).not.toBeNull()
    expect(grade!.textContent).toContain('2 / 2')
    expect(grade!.textContent).toContain('得分')
    expect(grade!.textContent).toContain('9+6=？')
    expect(grade!.textContent).toContain('个位相加')
    expect(grade!.textContent).toContain('北京是首都')
    // all answered correctly: no ✗ rows, no 正确答案 reveals
    expect(grade!.textContent).not.toContain('✗')
    expect(grade!.textContent).not.toContain('正确答案')
    // zero model round trip
    expect(actions).toHaveLength(0)
  })

  it('marks wrong answers with ✗ and reveals the correct answer + explanation', () => {
    const { container } = render(<MarkdownText text={fenced(paper)} />)
    const groups = container.querySelectorAll('[role="radiogroup"]')
    fireEvent.click(groups[0]!.querySelectorAll('input')[0]!) // q1: 14 ✗
    fireEvent.click(groups[1]!.querySelectorAll('input')[0]!) // q2: 上海 ✗
    fireEvent.click(container.querySelector('[class*="submitRow"] button')!)

    const grade = container.querySelector('[data-genui-grade]')!
    expect(grade.textContent).toContain('0 / 2')
    expect(grade.textContent).toContain('✗')
    expect(grade.textContent).toContain('正确答案：15')
    expect(grade.textContent).toContain('正确答案：北京')
    expect(grade.textContent).toContain('9+6=15，个位相加')
  })

  it('locks the questions after grading; 重新作答 resets locally and unlocks', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced(paper)} />
      </GenuiActionContext.Provider>,
    )
    const groups = container.querySelectorAll('[role="radiogroup"]')
    const inputs = () => [...container.querySelectorAll('[role="radiogroup"] input')] as HTMLInputElement[]
    fireEvent.click(groups[0]!.querySelectorAll('input')[1]!)
    fireEvent.click(groups[1]!.querySelectorAll('input')[1]!)
    fireEvent.click(container.querySelector('[class*="submitRow"] button')!)

    // graded → locked
    expect(inputs().every(i => i.disabled)).toBe(true)
    expect(container.querySelector('[data-genui-grade]')).not.toBeNull()

    // 重新作答 → reset, unlocked, no action
    fireEvent.click(container.querySelector('[data-genui-grade] button')!)
    expect(container.querySelector('[data-genui-grade]')).toBeNull()
    expect(container.querySelector('[class*="submitRow"] button')).not.toBeNull()
    expect(inputs().every(i => !i.disabled)).toBe(true)
    expect(actions).toHaveLength(0)

    // can answer and grade again (inputs order: q1[0..2], q2[3..5])
    fireEvent.click(inputs()[1]!) // q1: 15 ✓
    fireEvent.click(inputs()[4]!) // q2: 广州 ✗
    fireEvent.click(container.querySelector('[class*="submitRow"] button')!)
    expect(container.querySelector('[data-genui-grade]')!.textContent).toContain('1 / 2')
  })

  it('fires resetAction (optional) when 重新作答 is clicked', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec = { ...paper, items: [...paper.items] }
    spec.items[2] = { ...spec.items[2]!, resetAction: 'redo' }
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced(spec)} />
      </GenuiActionContext.Provider>,
    )
    const groups = container.querySelectorAll('[role="radiogroup"]')
    fireEvent.click(groups[0]!.querySelectorAll('input')[1]!) // q1: 15 ✓
    fireEvent.click(groups[1]!.querySelectorAll('input')[2]!) // q2: 北京 ✓
    fireEvent.click(container.querySelector('[class*="submitRow"] button')!)
    fireEvent.click(container.querySelector('[data-genui-grade] button')!)
    // resetAction goes through the same per-name trailing debounce
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['redo', { type: 'submit-reset', groups: ['q1', 'q2'] }]])
  })
})

describe.skipIf(!hasFenceRegistry)('v2.6: fallback keeps v2.5 behavior without answers', () => {
  it('sends ONE action when no question carries answer data', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced({ items: [
          { type: 'radio', label: '第1题', group: 'q1', options: ['A', 'B'] },
          { type: 'radio', label: '第2题', group: 'q2', options: ['C', 'D'] },
          { type: 'submit', label: '交卷', action: 'grade', groups: ['q1', 'q2'] },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    const groups = container.querySelectorAll('[role="radiogroup"]')
    fireEvent.click(groups[0]!.querySelectorAll('input')[1]!)
    fireEvent.click(groups[1]!.querySelectorAll('input')[1]!)
    fireEvent.click(container.querySelector('[class*="submitRow"] button')!)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['grade', { type: 'submit', answers: { q1: 'B', q2: 'D' }, total: 2, answered: 2 }]])
    expect(container.querySelector('[data-genui-grade]')).toBeNull()
  })

  it('grades locally WITHOUT any action provider (fully offline)', () => {
    const { container } = render(<MarkdownText text={fenced(paper)} />)
    const groups = container.querySelectorAll('[role="radiogroup"]')
    fireEvent.click(groups[0]!.querySelectorAll('input')[1]!) // q1: 15 ✓
    fireEvent.click(groups[1]!.querySelectorAll('input')[2]!) // q2: 北京 ✓
    const submit = container.querySelector('[class*="submitRow"] button') as HTMLButtonElement
    expect(submit.disabled).toBe(false) // local grading does not need the model channel
    fireEvent.click(submit)
    expect(container.querySelector('[data-genui-grade]')!.textContent).toContain('2 / 2')
  })
})

describe.skipIf(!hasFenceRegistry)('v2.6: button local click feedback', () => {
  it('shows 已触发 after clicking an actionable button, then clears', () => {
    const { container } = render(
      <GenuiActionContext.Provider value={() => {}}>
        <MarkdownText text={fenced({ items: [
          { type: 'button', label: '刷新', action: 'refresh' },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    const button = container.querySelector('button')!
    expect(button.textContent).not.toContain('已触发')
    fireEvent.click(button)
    expect(button.textContent).toContain('已触发')
    act(() => { vi.advanceTimersByTime(1400) })
    expect(button.textContent).not.toContain('已触发')
  })

  it('does not show feedback on inert (disabled) buttons', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      { type: 'button', label: '展示' },
    ] })} />)
    const button = container.querySelector('button')!
    fireEvent.click(button)
    expect(button.textContent).not.toContain('已触发')
    expect(button.disabled).toBe(true)
  })
})

describe.skipIf(!hasFenceRegistry)('v2.6: guard coverage', () => {
  it('repair keeps radio answer (index + label) / explanation and submit resetAction', () => {
    const spec = repairGenuiSpec({
      items: [
        { type: 'radio', label: 'q', group: 'g', answer: 2, explanation: '因为…', options: ['a', 'b', 'c'] },
        { type: 'radio', label: 'q2', group: 'g2', answer: 'c', options: ['a', 'b', 'c'] },
        { type: 'submit', label: '交卷', action: 'g', resetAction: 'redo', groups: ['g', 'g2'] },
      ],
    })
    const items = spec!.items as Array<Record<string, unknown>>
    expect(items[0]!.answer).toBe(2)
    expect(items[0]!.explanation).toBe('因为…')
    expect(items[1]!.answer).toBe('c')
    expect((items[2] as { resetAction?: string }).resetAction).toBe('redo')
  })

  it('repair drops an out-of-range answer index and keeps a valid one', () => {
    const spec = repairGenuiSpec({
      items: [
        { type: 'radio', label: 'q', group: 'g', answer: 99, options: ['a', 'b'] },
        { type: 'radio', label: 'q2', group: 'g2', answer: 1, options: ['a', 'b'] },
      ],
    })
    const items = spec!.items as Array<Record<string, unknown>>
    expect(items[0]!.answer).toBeUndefined()
    expect(items[1]!.answer).toBe(1)
  })

  it('validate accepts the new optional fields', () => {
    const result = validateGenuiSpec({
      items: [
        { type: 'radio', label: 'q', group: 'g', answer: 0, explanation: 'x', options: ['a'] },
        { type: 'submit', label: '交卷', action: 'g', resetAction: 'r', groups: ['g'] },
      ],
    })
    expect(result.ok).toBe(true)
  })
})
