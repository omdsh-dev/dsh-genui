// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'

afterEach(cleanup)

describe('file-tree collapse identity', () => {
  it('keeps directories at the same depth/index under different parents independent', () => {
    const spec = repairGenuiSpec({
      items: [{
        type: 'file-tree',
        items: [
          { name: 'A', type: 'dir', children: [
            { name: 'foo', type: 'dir', children: [{ name: 'a.txt', type: 'file' }] },
          ] },
          { name: 'B', type: 'dir', children: [
            { name: 'bar', type: 'dir', children: [{ name: 'b.txt', type: 'file' }] },
          ] },
        ],
      }],
    })!

    render(
      <GenuiActionContext.Provider value={undefined}>
        <GenuiBlock spec={spec} />
      </GenuiActionContext.Provider>,
    )

    expect(screen.getByText('a.txt')).toBeTruthy()
    expect(screen.getByText('b.txt')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /foo/ }))
    expect(screen.queryByText('a.txt')).toBeNull()
    expect(screen.getByText('b.txt')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /foo/ }))
    expect(screen.getByText('a.txt')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /bar/ }))
    expect(screen.getByText('a.txt')).toBeTruthy()
    expect(screen.queryByText('b.txt')).toBeNull()
  })
})
