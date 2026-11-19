// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenuiBlock, GENUI_ACTION_DEBOUNCE_MS } from '../src/client/GenuiBlock.tsx'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { repairGenuiSpec } from '../src/client/guard.ts'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})

const rows = [['Alpha', '30'], ['Beta', '10'], ['Gamma', '20']]
const details = rows.map(([name]) => [
  { type: 'text', content: `Details for ${name}` },
  { type: 'button', label: `Inspect ${name}`, action: `inspect-${name}` },
])

function mount(table: Record<string, unknown> = {}) {
  const actions: string[] = []
  const spec = repairGenuiSpec({ items: [
    { type: 'input', id: 'q', label: 'Filter services' },
    { type: 'select', id: 'sort', options: ['Duration'] },
    { type: 'table', columns: ['Service', 'Duration'], rows, details,
      filter: 'q', sortField: 'sort', ...table },
  ] })!
  const out = render(
    <GenuiActionContext.Provider value={action => actions.push(action)}>
      <GenuiBlock spec={spec} />
    </GenuiActionContext.Provider>,
  )
  const filter = (value: string) => fireEvent.change(out.container.querySelector('input')!, { target: { value } })
  const toggle = (name: string) => {
    const row = [...out.container.querySelectorAll('tbody tr')]
      .find(element => element.querySelector('td')?.textContent?.includes(name))
    expect(row).toBeDefined()
    const button = row!.querySelector('button[aria-expanded]')
    expect(button).not.toBeNull()
    fireEvent.click(button!)
  }
  return { ...out, actions, filter, toggle }
}

describe('table filtering preserves original row/detail identity', () => {
  it('keeps the no-filter detail and action control working', () => {
    const out = mount()
    out.toggle('Beta')
    fireEvent.click(out.getByRole('button', { name: 'Inspect Beta' }))
    act(() => vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS))
    expect(out.actions).toEqual(['inspect-Beta'])
  })

  it('opens the filtered row detail and dispatches that row action', () => {
    const out = mount()
    out.filter('Beta')
    out.toggle('Beta')
    fireEvent.click(out.container.querySelector('[class*="detailBody"] button')!)
    act(() => vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS))
    expect(out.actions).toEqual(['inspect-Beta'])
    expect(out.container.querySelector('[class*="detailBody"]')?.textContent).toContain('Details for Beta')
    expect(out.container.textContent).not.toContain('Details for Alpha')
  })

  it('does not invent a toggle for a filtered row with null details', () => {
    const out = mount({ details: [details[0], null, details[2]] })
    out.filter('Beta')
    expect(out.container.querySelector('tbody button[aria-expanded]')).toBeNull()
  })

  it('does not lose a valid detail after filtering out a null-detail row', () => {
    const out = mount({ details: [null, details[1], details[2]] })
    out.filter('Beta')
    out.toggle('Beta')
    expect(out.container.textContent).toContain('Details for Beta')
  })

  it('retains the same expanded row when earlier rows are filtered out', () => {
    const out = mount()
    out.toggle('Beta')
    out.filter('Beta')
    expect(out.container.querySelector('[class*="detailBody"]')?.textContent).toContain('Details for Beta')
  })

  it('does not transfer an expanded first row to a different filtered row', () => {
    const out = mount()
    out.toggle('Alpha')
    out.filter('Beta')
    expect(out.container.querySelector('[class*="detailBody"]')).toBeNull()
  })

  it('keeps a filtered expansion on the same row after clearing the filter', () => {
    const out = mount()
    out.filter('Beta')
    out.toggle('Beta')
    out.filter('')
    expect(out.container.querySelector('[class*="detailBody"]')?.textContent).toContain('Details for Beta')
  })

  it('combines case-insensitive filtering and header sorting without moving details', () => {
    const out = mount()
    out.filter('A') // all three match
    fireEvent.click(out.getByRole('button', { name: 'Duration' }))
    out.toggle('Beta')
    expect(out.container.querySelector('[class*="detailBody"]')?.textContent).toContain('Details for Beta')
    out.filter('  gAmMa  ')
    out.toggle('Gamma')
    expect(out.container.querySelector('[class*="detailBody"]')?.textContent).toContain('Details for Gamma')
  })

  it('combines column-restricted filtering and bound sorting', () => {
    const out = mount({ rows: [['Hidden', '90'], ['Keep-Z', '20'], ['Keep-A', '10']],
      filterColumn: 0 })
    out.filter('Keep')
    fireEvent.change(out.container.querySelector('select')!, { target: { value: 'Duration' } })
    out.toggle('Keep-A')
    // Details remain aligned to the original third row, not filtered index 1.
    expect(out.container.querySelector('[class*="detailBody"]')?.textContent).toContain('Details for Gamma')
  })

  it('preserves the existing visible index-column presentation', () => {
    const out = mount({ columns: ['Number', 'Service'], types: ['index', 'text'],
      rows: [['', 'Alpha'], ['', 'Beta'], ['', 'Gamma']], details: undefined, filterColumn: 1 })
    out.filter('Beta')
    expect(out.container.querySelector('tbody td')?.textContent).toBe('1')
  })

  it('keeps a surviving group collapsed through filtering and clearing', () => {
    const out = mount({
      types: ['group', 'num'],
      rows: [['Drop', ''], ['Drop-child', '30'], ['Keep', ''], ['Keep-child', '10']],
      details: [null, details[0], null, details[1]],
    })
    out.toggle('Keep')
    out.filter('Keep')
    expect(out.container.querySelector('tbody button')?.getAttribute('aria-expanded')).toBe('false')
    expect(out.container.querySelector('tbody')?.textContent).not.toContain('Keep-child')
    out.filter('')
    expect(out.container.querySelector('tbody')?.textContent).toContain('Drop-child')
    expect(out.container.querySelector('tbody')?.textContent).not.toContain('Keep-child')
    out.toggle('Keep')
    out.toggle('Keep-child')
    expect(out.container.querySelector('[class*="detailBody"]')?.textContent).toContain('Details for Beta')
  })

  it('does not transfer a filtered-out group collapse to another group', () => {
    const out = mount({
      types: ['group', 'num'],
      rows: [['Drop', ''], ['Drop-child', '30'], ['Keep', ''], ['Keep-child', '10']],
      details: [null, details[0], null, details[1]],
    })
    out.toggle('Drop')
    out.filter('Keep')
    expect(out.container.querySelector('tbody button')?.getAttribute('aria-expanded')).toBe('true')
    expect(out.container.querySelector('tbody')?.textContent).toContain('Keep-child')
    out.toggle('Keep-child')
    expect(out.container.querySelector('[class*="detailBody"]')?.textContent).toContain('Details for Beta')
  })

  it('preserves visible index values as rows move through sorting', () => {
    const out = mount({
      columns: ['Service', 'Number', 'Duration'], types: ['text', 'index', 'num'],
      rows: [['Drop', '', '30'], ['Keep-Z', '', '20'], ['Keep-A', '', '10']],
      details: undefined, filterColumn: 0,
    })
    const indexes = () => [...out.container.querySelectorAll('[class*="cellIndex"]')]
      .map(element => element.textContent)
    out.filter('Keep')
    expect(indexes()).toEqual(['1', '2'])
    fireEvent.click(out.getByRole('button', { name: 'Duration' }))
    expect(indexes()).toEqual(['2', '1'])
    fireEvent.click(out.getByRole('button', { name: 'Duration' }))
    expect(indexes()).toEqual(['1', '2'])
    out.filter('')
    expect(indexes()).toEqual(['1', '2', '3'])
  })
})
