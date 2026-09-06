// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderNode } from '../src/client/blocks/render-node.tsx'
import type { GenuiNode } from '../src/client/spec.ts'

afterEach(cleanup)

function layoutNode(type: 'row' | 'col'): GenuiNode {
  return {
    type,
    items: [{ type: 'input', label: 'Name' }],
  } as GenuiNode
}

function Harness({ type }: { type: 'row' | 'col' }) {
  return <>{renderNode(layoutNode(type), 0, undefined)}</>
}

describe('render dispatcher reconciliation', () => {
  it('preserves compatible layout host nodes and child local state', () => {
    const view = render(<Harness type="row" />)
    const host = view.container.firstElementChild
    const input = view.container.querySelector('input') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'Alice' } })
    expect(input.value).toBe('Alice')

    view.rerender(<Harness type="col" />)

    expect(view.container.firstElementChild).toBe(host)
    expect((view.container.querySelector('input') as HTMLInputElement).value).toBe('Alice')
  })
})
