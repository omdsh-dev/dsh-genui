// @vitest-environment jsdom
// GenUI v2.5 interaction hardening:
// 1) buttons WITHOUT action render DISABLED (honest affordance — dead
//    clickable-looking buttons were the top field complaint);
// 2) textarea and quiz now support `action` (blur / answer selection);
// 3) grouped radios record selections locally and a `submit` node collects
//    ALL groups into ONE [genui-action] (the 交卷 pattern) instead of
//    per-click round trips.
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownText } from './markdown-labels.tsx'
import { hasFenceRegistry } from './helpers/fence-host'
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

describe.skipIf(!hasFenceRegistry)('v2.5: honest button affordance', () => {
  it('renders a button without action as DISABLED (display-only)', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      { type: 'button', label: '导出', tone: 'primary' },
    ] })} />)
    const button = container.querySelector('button')!
    expect(button.disabled).toBe(true)
  })

  it('renders a button with action + provider as enabled', () => {
    const { container } = render(
      <GenuiActionContext.Provider value={() => {}}>
        <MarkdownText text={fenced({ items: [
          { type: 'button', label: '刷新', action: 'refresh' },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    const button = container.querySelector('button')!
    expect(button.disabled).toBe(false)
  })

  it('renders an action button as DISABLED without a provider (no signal path)', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      { type: 'button', label: '刷新', action: 'refresh' },
    ] })} />)
    const button = container.querySelector('button')!
    expect(button.disabled).toBe(true)
  })
})

describe.skipIf(!hasFenceRegistry)('v2.5: textarea action', () => {
  it('fires on blur with the typed value', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced({ items: [
          { type: 'textarea', label: '备注', action: 'save-note' },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    const ta = container.querySelector('textarea')!
    fireEvent.change(ta, { target: { value: '已核对' } })
    fireEvent.blur(ta)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['save-note', { type: 'textarea', value: '已核对' }]])
  })

  it('does not fire without an action', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced({ items: [
          { type: 'textarea', label: '备注' },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    const ta = container.querySelector('textarea')!
    fireEvent.change(ta, { target: { value: 'x' } })
    fireEvent.blur(ta)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toHaveLength(0)
  })
})

describe.skipIf(!hasFenceRegistry)('v2.5: quiz action', () => {
  it('sends the chosen answer to the model while keeping local judging', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced({ items: [
          { type: 'quiz', question: '1+1=?', action: 'answer-q1', options: [
            { label: '1', correct: false },
            { label: '2', correct: true, feedback: '对！' },
          ] },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    const options = container.querySelectorAll('[data-genui-quiz] button')
    fireEvent.click(options[1]!)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['answer-q1', { type: 'quiz', question: '1+1=?', answer: '2', correct: true }]])
    // local judging still works in place
    expect(container.textContent).toContain('回答正确')
  })

  it('does not fire when the quiz has no action', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced({ items: [
          { type: 'quiz', question: '1+1=?', options: [
            { label: '2', correct: true },
          ] },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    fireEvent.click(container.querySelector('[data-genui-quiz] button')!)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toHaveLength(0)
  })
})

describe.skipIf(!hasFenceRegistry)('v2.5: submit 交卷 aggregation', () => {
  const paper = {
    items: [
      { type: 'radio', label: '第1题', group: 'q1', options: ['A', 'B'] },
      { type: 'radio', label: '第2题', group: 'q2', options: ['C', 'D'] },
      { type: 'submit', label: '交卷', action: 'grade', groups: ['q1', 'q2'] },
    ],
  }

  it('stays disabled until EVERY listed group is answered, then fires ONE action with all answers', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced(paper)} />
      </GenuiActionContext.Provider>,
    )
    const submit = container.querySelector('[class*="submitRow"] button') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    // answer q1 only → still disabled, hint shows progress (click the SECOND
    // option: index 0 is pre-selected and clicking it fires no change event)
    const radioGroups = container.querySelectorAll('[role="radiogroup"]')
    fireEvent.click(radioGroups[0]!.querySelectorAll('input')[1]!)
    expect(submit.disabled).toBe(true)
    expect(container.querySelector('[class*="submitHint"]')?.textContent).toContain('已选 1/2')

    // answer q2 → enabled
    fireEvent.click(radioGroups[1]!.querySelectorAll('input')[1]!)
    expect(submit.disabled).toBe(false)

    // 交卷: ONE action with both answers, no per-click spam
    fireEvent.click(submit)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['grade', { type: 'submit', answers: { q1: 'B', q2: 'D' }, total: 2, answered: 2 }]])
  })

  it('records grouped selections WITHOUT firing per-click actions', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced(paper)} />
      </GenuiActionContext.Provider>,
    )
    const radioGroups = container.querySelectorAll('[role="radiogroup"]')
    fireEvent.click(radioGroups[0]!.querySelectorAll('input')[1]!)
    fireEvent.click(radioGroups[1]!.querySelectorAll('input')[1]!)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toHaveLength(0) // nothing fired per click
  })

  it('enables after ≥1 answer when no groups list is given', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced({ items: [
          { type: 'radio', label: '第1题', group: 'q1', options: ['A', 'B'] },
          { type: 'submit', label: '交卷', action: 'grade' },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    const submit = container.querySelector('[class*="submitRow"] button') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(container.querySelectorAll('[role="radiogroup"] input')[1]!)
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['grade', { type: 'submit', answers: { q1: 'B' }, total: 1, answered: 1 }]])
  })

  it('keeps legacy per-click radio action when no group is set', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced({ items: [
          { type: 'radio', label: '主题', action: 'pick-theme', options: ['浅色', '深色'] },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    fireEvent.click(container.querySelectorAll('[role="radiogroup"] input')[1]!)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['pick-theme', { type: 'radio', value: '深色' }]])
  })
})

describe.skipIf(!hasFenceRegistry)('v2.5: guard coverage', () => {
  it('repair keeps action on quiz/textarea, group on radio, and the submit node', () => {
    const spec = repairGenuiSpec({
      items: [
        { type: 'quiz', question: 'q', action: 'a', options: [{ label: 'x', correct: true }] },
        { type: 'textarea', label: 't', action: 'b' },
        { type: 'radio', label: 'r', group: 'g1', options: ['x'] },
        { type: 'submit', label: '交卷', action: 'grade', groups: ['g1', 'g2'] },
      ],
    })
    expect(spec).not.toBeNull()
    const items = spec!.items as Array<Record<string, unknown>>
    expect(items[0]!.action).toBe('a')
    expect(items[1]!.action).toBe('b')
    expect(items[2]!.group).toBe('g1')
    expect(items[3]!.type).toBe('submit')
    expect((items[3] as { groups?: string[] }).groups).toEqual(['g1', 'g2'])
  })

  it('repair keeps a submit without action (local grading) and drops one without label', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'submit', groups: ['g1'] }, // no label → dropped
      { type: 'submit', label: '交卷' }, // no action → KEPT (local grading needs no round trip)
      { type: 'submit', label: '交卷', action: 'ok' },
    ] })
    const items = spec!.items as Array<Record<string, unknown>>
    expect(items).toHaveLength(2)
    expect(items[0]!.action).toBeUndefined()
    expect(items[1]!.action).toBe('ok')
  })

  it('validate requires submit label but treats action as optional', () => {
    const bad = validateGenuiSpec({ items: [{ type: 'submit' }] })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join('\n')).toContain("type 'submit' requires label")
    // A label-only submit is valid: when questions carry `answer` data the
    // click grades locally with zero round trip — no action needed.
    const good = validateGenuiSpec({ items: [{ type: 'submit', label: '交卷' }] })
    expect(good.ok).toBe(true)
    const withAction = validateGenuiSpec({ items: [{ type: 'submit', label: '交卷', action: 'grade' }] })
    expect(withAction.ok).toBe(true)
  })
})
