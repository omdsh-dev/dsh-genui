// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TabsNode } from '../src/client/blocks/advanced.tsx'
import type { GenuiTabs } from '../src/client/spec.ts'

afterEach(cleanup)

function tabs(labels: string[]): GenuiTabs {
  return {
    type: 'tabs',
    tabs: labels.map(label => ({ label, items: [] })),
  }
}

describe('tabs active index lifecycle', () => {
  it('clamps the active tab when the model removes trailing tabs', () => {
    const view = render(<TabsNode tabs={tabs(['A', 'B', 'C'])} />)
    fireEvent.click(screen.getByRole('tab', { name: 'C' }))
    expect(screen.getByRole('tab', { name: 'C' }).getAttribute('aria-selected')).toBe('true')

    view.rerender(<TabsNode tabs={tabs(['A', 'B'])} />)

    const remaining = screen.getAllByRole('tab')
    expect(remaining).toHaveLength(2)
    expect(screen.getByRole('tab', { name: 'B' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel')).toBeTruthy()
  })

  it('handles an empty tab list without producing an invalid keyboard target', () => {
    const view = render(<TabsNode tabs={tabs(['A'])} />)
    expect(screen.getByRole('tab', { name: 'A' })).toBeTruthy()

    view.rerender(<TabsNode tabs={tabs([])} />)

    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.queryByRole('tabpanel')).toBeNull()
  })
})
