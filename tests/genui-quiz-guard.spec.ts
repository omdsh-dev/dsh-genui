import { describe, expect, it } from 'vitest'
import { repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'

describe('repairGenuiSpec: quiz option healing (issue #57)', () => {
  it('wraps string options and applies a label answer', () => {
    const raw = {
      type: 'quiz',
      question: '下面哪个说法正确？',
      options: ['选项A', '选项B', '选项C'],
      answer: '选项B',
    }

    expect(validateGenuiSpec(raw).ok).toBe(true)
    const quiz = repairGenuiSpec(raw)?.items[0]
    expect(quiz).toEqual({
      type: 'quiz',
      question: '下面哪个说法正确？',
      options: [
        { label: '选项A' },
        { label: '选项B', correct: true },
        { label: '选项C' },
      ],
    })
  })

  it('applies a numeric answer index to string options', () => {
    const quiz = repairGenuiSpec({
      type: 'quiz', question: 'Q', options: ['A', 'B', 'C'], answer: 2,
    })?.items[0] as { options: Array<{ label: string; correct?: boolean }> }

    expect(quiz.options).toEqual([
      { label: 'A' },
      { label: 'B' },
      { label: 'C', correct: true },
    ])
  })

  it('keeps canonical option correctness authoritative over answer', () => {
    const quiz = repairGenuiSpec({
      type: 'quiz',
      question: 'Q',
      options: [
        { label: 'A', correct: true, feedback: 'yes' },
        { label: 'B' },
      ],
      answer: 'B',
    })?.items[0] as { options: Array<{ label: string; correct?: boolean; feedback?: string }> }

    expect(quiz.options).toEqual([
      { label: 'A', correct: true, feedback: 'yes' },
      { label: 'B' },
    ])
  })

  it('does not invent a correct option for an invalid answer', () => {
    const quiz = repairGenuiSpec({
      type: 'quiz', question: 'Q', options: ['A', 'B'], answer: 9,
    })?.items[0] as { options: Array<{ label: string; correct?: boolean }> }

    expect(quiz.options).toEqual([{ label: 'A' }, { label: 'B' }])
  })

  it('drops the whole quiz when no option is recoverable (issue #57)', () => {
    // Empty list or all-non-string non-object items must not survive as a
    // half-rendered "question without options" node.
    expect(repairGenuiSpec({ type: 'quiz', question: 'Q', options: [] })?.items).toHaveLength(0)
    expect(repairGenuiSpec({ type: 'quiz', question: 'Q', options: [123, null] })?.items).toHaveLength(0)
    // Object items without labels are equally unrecoverable.
    expect(repairGenuiSpec({ type: 'quiz', question: 'Q', options: [{ feedback: 'x' }] })?.items).toHaveLength(0)
  })

  it('marks only the first occurrence of a duplicate label as correct', () => {
    const quiz = repairGenuiSpec({
      type: 'quiz', question: 'Q', options: ['Same', 'Same'], answer: 'Same',
    })?.items[0] as { options: Array<{ label: string; correct?: boolean }> }

    expect(quiz.options).toEqual([{ label: 'Same', correct: true }, { label: 'Same' }])
  })

  it('accepts the last valid index as an answer', () => {
    const quiz = repairGenuiSpec({
      type: 'quiz', question: 'Q', options: ['A', 'B'], answer: 1,
    })?.items[0] as { options: Array<{ label: string; correct?: boolean }> }

    expect(quiz.options).toEqual([{ label: 'A' }, { label: 'B', correct: true }])
  })
})
