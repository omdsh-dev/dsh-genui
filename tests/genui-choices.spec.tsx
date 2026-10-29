// @vitest-environment jsdom
// `choices`: a decision list. The contract worth pinning is that the trade-off
// travels WITH the option (that is the reason the node exists — `radio` options
// are bare strings), and that submitting never claims the work is done.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GenuiActionContext } from '../src/client/action-context.ts'
import { analyzeSubmissionRegistry } from '../src/client/submission-registry.ts'
import { ChoicesNode } from '../src/client/blocks/choices.tsx'
import { processGenuiSpec } from '../src/client/guard.ts'
import { t } from '../src/client/i18n/index.ts'
import type { GenuiChoices } from '../src/client/spec.ts'

afterEach(cleanup)

const base: GenuiChoices = {
  type: 'choices',
  title: '先做哪个',
  prompt: '只能选一个开始，代价写在每一项下面。',
  submit: '就这么定',
  action: 'choose-next',
  items: [
    { label: '追问带现场', hint: '地基，但要先做稳定节点身份', meta: 'P0' },
    { label: '改动汇报完整形态', hint: '独立，今天就能用', meta: 'P0', recommended: true },
    { label: '表单作用域', hint: '增量最大，依赖前两项', disabled: true, reason: '需要稳定节点身份' },
  ],
}

const renderWithAction = (node: GenuiChoices) => {
  const send = vi.fn()
  const view = render(
    <GenuiActionContext.Provider value={send}>
      <ChoicesNode node={node} />
    </GenuiActionContext.Provider>,
  )
  return { ...view, send }
}

describe('ChoicesNode', () => {
  it('keeps each option cost visible next to its label', () => {
    const { container } = render(<ChoicesNode node={base} />)
    expect(container.textContent).toContain('追问带现场')
    expect(container.textContent).toContain('地基，但要先做稳定节点身份')
    expect(container.textContent).toContain('P0')
    expect(container.textContent).toContain(t('block.choices.recommended'))
  })

  it('renders a disabled option without hiding it, and keeps the reason', () => {
    const { container } = render(<ChoicesNode node={base} />)
    const controls = container.querySelectorAll<HTMLInputElement>('input')
    expect(controls[2]?.disabled).toBe(true)
    expect(container.textContent).toContain('需要稳定节点身份')
    expect(container.textContent).toContain(t('block.choices.unavailable'))
  })

  it('single mode replaces the selection; submit is disabled until something is picked', () => {
    const { container } = render(<ChoicesNode node={base} />)
    const submit = container.querySelector<HTMLButtonElement>('button')!
    expect(submit.disabled).toBe(true)

    const inputs = container.querySelectorAll<HTMLInputElement>('input')
    fireEvent.click(inputs[0]!)
    expect(inputs[0]?.checked).toBe(true)
    fireEvent.click(inputs[1]!)
    expect(inputs[0]?.checked).toBe(false)
    expect(inputs[1]?.checked).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(false)
  })

  it('submits the chosen labels once and says so without claiming completion', () => {
    const { container, send } = renderWithAction(base)
    fireEvent.click(container.querySelectorAll<HTMLInputElement>('input')[1]!)
    fireEvent.click(container.querySelector<HTMLButtonElement>('button')!)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('choose-next', {
      question: '只能选一个开始，代价写在每一项下面。',
      selected: ['改动汇报完整形态'],
      mode: 'single',
    })
    expect(container.textContent).toContain(t('block.choices.sent'))

    // Editing clears the "sent" line — the model acted on the previous answer.
    fireEvent.click(container.querySelectorAll<HTMLInputElement>('input')[0]!)
    expect(container.textContent).not.toContain(t('block.choices.sent'))
  })

  it('multi mode toggles and respects the cap', () => {
    const { container } = renderWithAction({ ...base, mode: 'multi', max: 2, items: base.items.slice(0, 2) })
    const inputs = container.querySelectorAll<HTMLInputElement>('input')
    fireEvent.click(inputs[0]!)
    fireEvent.click(inputs[1]!)
    expect(container.textContent).toContain(t('block.choices.count', { count: '2' }))
    fireEvent.click(container.querySelector<HTMLButtonElement>('button')!)
    expect(container.textContent).toContain(t('block.choices.sent'))
  })

  it('stays local when no action is declared, and says so', () => {
    const { container } = renderWithAction({ ...base, action: undefined })
    fireEvent.click(container.querySelectorAll<HTMLInputElement>('input')[0]!)
    fireEvent.click(container.querySelector<HTMLButtonElement>('button')!)
    // The label must describe what happened: a local record is not a delivery.
    expect(container.textContent).toContain(t('block.choices.localOnly'))
    expect(container.textContent).not.toContain(t('block.choices.sent'))
  })
})

describe('choices as a paper question (what retires radio)', () => {
  const paper: GenuiChoices = {
    type: 'choices',
    title: '第 1 题',
    prompt: '哪个方案会先撑不住？',
    group: 'q1',
    answer: '方案 A',
    explanation: '单机写入是瓶颈。',
    items: [
      { label: '方案 A', hint: '写入放大 4 倍' },
      { label: '方案 B', hint: '读路径可水平扩' },
    ],
  }

  it('records the pick into the shared registry instead of local state', () => {
    const setAnswer = vi.fn()
    const answers = { answers: {}, multiAnswers: {}, fields: {}, secretFields: new Set(), invalidNumericFields: new Set(), registry: { members: new Map() }, locked: false, round: 0, setAnswer } as never
    const { container } = render(<ChoicesNode node={paper} answers={answers} />)
    fireEvent.click(container.querySelectorAll<HTMLInputElement>('input')[0]!)
    expect(setAnswer).toHaveBeenCalledWith('q1', '方案 A')
    // The paper's own submit node collects it; this node must not render one.
    expect(container.querySelector('button')).toBeNull()
  })

  it('locks the rows once the paper is graded', () => {
    const answers = { answers: { q1: '方案 B' }, multiAnswers: {}, fields: {}, secretFields: new Set(), invalidNumericFields: new Set(), registry: { members: new Map() }, locked: true, round: 0, setAnswer: vi.fn() } as never
    const { container } = render(<ChoicesNode node={paper} answers={answers} />)
    const inputs = container.querySelectorAll<HTMLInputElement>('input')
    expect(inputs[0]?.disabled).toBe(true)
    expect(inputs[1]?.checked).toBe(true)
  })

  it('is eligible for local grading through the submission registry', () => {
    const { registry } = analyzeSubmissionRegistry({
      title: 'T',
      items: [paper, { type: 'submit', label: '交卷', groups: ['q1'] }],
    } as never)
    expect(registry.members.get('q1')).toMatchObject({
      kind: 'radio',
      answer: '方案 A',
      options: ['方案 A', '方案 B'],
    })
  })
})

describe('a submit that cannot send', () => {
  it('never claims the choice was sent when the spec carries no action', () => {
    // Repro of a real report: the block said "已发送" while nothing left the page.
    const { container } = render(<ChoicesNode node={{ ...base, action: undefined }} />)
    fireEvent.click(container.querySelectorAll<HTMLInputElement>('input')[0]!)
    fireEvent.click(screen.getByRole('button', { name: '就这么定' }))
    expect(container.textContent).toContain(t('block.choices.localOnly'))
    expect(container.textContent).not.toContain(t('block.choices.sent'))
  })

  it('is a validation error for the model to write submit without action', () => {
    const result = processGenuiSpec({
      items: [{ type: 'choices', submit: '先做这个', items: [{ label: 'A' }, { label: 'B' }] }],
    })
    expect(result.errors.join(' ')).toContain('requires action')
  })
})

describe('choices guard', () => {
  const wrap = (node: unknown): unknown => ({ title: 'T', items: [node] })

  it('drops options without a label and keeps the rest', () => {
    const result = processGenuiSpec(wrap({
      type: 'choices',
      items: [{ label: 'A', hint: 'h' }, { hint: 'no label' }, { label: 'B', disabled: true, reason: 'r' }],
    }))
    expect(result.errors.join(' ')).toContain('items[1]')
    const node = result.spec?.items[0] as GenuiChoices | undefined
    expect(node?.type).toBe('choices')
    expect(node?.items.map(item => item.label)).toEqual(['A', 'B'])
  })

  it('rejects an empty option list', () => {
    const result = processGenuiSpec(wrap({ type: 'choices', items: [] }))
    expect(result.errors.join(' ')).toContain('choices')
  })
})
