// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})

beforeEach(() => {
  vi.useFakeTimers()
})

function quizSpec(id: string | undefined, question: string) {
  return {
    items: [
      {
        type: 'quiz',
        ...(id !== undefined ? { id } : {}),
        question,
        options: [{ label: '2' }, { label: '4', correct: true }],
      },
    ],
  }
}

function renderBlock(spec: unknown, stateKey: string) {
  return render(<GenuiBlock spec={spec as never} stateKey={stateKey} />)
}

describe('quiz id reset', () => {
  it('bumping quiz id clears the answered state at the same tree position', () => {
    const stateKey = 'quiz-id-reset'
    const { rerender } = renderBlock(quizSpec('q1', '1+1=?'), stateKey)
    const options = screen.getAllByRole('button')
    expect(options.length).toBe(2)
    fireEvent.click(options[0])
    // Both option buttons lock once answered (the retry button stays enabled).
    expect(options.every(b => b.disabled)).toBe(true)

    rerender(<GenuiBlock spec={quizSpec('q2', '2+2=?') as never} stateKey={stateKey} />)
    const fresh = screen.getAllByRole('button')
    // Reset: the new question renders unanswered (retry button gone).
    expect(fresh.length).toBe(2)
    expect(fresh.every(b => !b.disabled)).toBe(true)
  })

  it('the same id keeps the answered state across re-renders', () => {
    const stateKey = 'quiz-id-reset-same'
    const { rerender } = renderBlock(quizSpec('q1', '1+1=?'), stateKey)
    const options = screen.getAllByRole('button')
    fireEvent.click(options[0])
    expect(options.every(b => b.disabled)).toBe(true)

    // Change a non-id field so the re-render is real: an identical spec
    // would be dropped by GenuiBlock's specEquivalent() memo comparator
    // and the assertion would pass without QuizNode ever re-rendering.
    rerender(<GenuiBlock spec={quizSpec('q1', '3+3=?') as never} stateKey={stateKey} />)
    // Still answered: only the retry button remains clickable.
    expect(screen.getAllByRole('button').filter(b => !b.disabled).length).toBe(1)
  })
})
