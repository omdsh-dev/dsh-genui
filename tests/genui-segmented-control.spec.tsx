// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { collectHiddenKeys } from '../src/client/conditions.ts'
import { validateGenuiSpec } from '../src/client/guard.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

afterEach(() => { cleanup(); localStorage.clear() })

describe('segmented-control component', () => {
  it('validates unique options and a selected value from the option list', () => {
    expect(validateGenuiSpec({ items: [{
      type: 'segmented-control', options: ['Agenda', 'Map'], value: 'Agenda', id: 'view',
    }] }).ok).toBe(true)
    expect(validateGenuiSpec({ items: [{ type: 'segmented-control', options: [] }] }).ok).toBe(false)
    expect(validateGenuiSpec({ items: [{ type: 'segmented-control', options: ['A', 'A'] }] }).ok).toBe(false)
    expect(validateGenuiSpec({ items: [{ type: 'segmented-control', options: ['A'], value: 'B' }] }).ok).toBe(false)
  })

  it('updates sibling visibility and submits the selected shared value', async () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec: GenuiSpec = { items: [
      { type: 'segmented-control', label: 'View', options: ['Agenda', 'Map'], value: 'Agenda', id: 'view' },
      { type: 'text', content: 'Map details', when: { field: 'view', op: 'eq', value: 'Map' } },
      { type: 'submit', label: 'Send', action: 'send_view', groups: ['view'] },
    ] }
    render(<GenuiActionContext.Provider value={(action, payload) => actions.push([action, payload])}>
      <GenuiBlock spec={spec} />
    </GenuiActionContext.Provider>)

    expect(screen.queryByText('Map details')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Map' }))
    expect(await screen.findByText('Map details')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(actions[0]?.[1].fields).toEqual({ view: 'Map' })
  })

  it('emits the optional action on each local selection', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec: GenuiSpec = { items: [
      { type: 'segmented-control', options: ['Week', 'Month'], id: 'period', action: 'change_period' },
    ] }
    render(<GenuiActionContext.Provider value={(action, payload) => actions.push([action, payload])}>
      <GenuiBlock spec={spec} />
    </GenuiActionContext.Provider>)

    fireEvent.click(screen.getByRole('radio', { name: 'Month' }))
    expect(actions).toEqual([['change_period', { type: 'segmented-control', value: 'Month', id: 'period' }]])
  })

  it('does not expose a restored selection while its control is hidden', () => {
    const spec: GenuiSpec = { items: [
      { type: 'segmented-control', label: 'Visibility', options: ['Show', 'Hide'], value: 'Hide', id: 'visibility' },
      { type: 'segmented-control', label: 'View', options: ['Agenda', 'Map'], value: 'Map', id: 'view', when: { field: 'visibility', op: 'eq', value: 'Show' } },
      { type: 'text', content: 'Map details', when: { field: 'view', op: 'eq', value: 'Map' } },
    ] }
    render(<GenuiBlock spec={spec} stateKey="hidden-segmented-restore" initialState={{ fields: {
      visibility: 'Hide', view: 'Map',
    } }} />)

    expect(screen.queryByLabelText('View')).toBeNull()
    expect(screen.queryByText('Map details')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Show' }))
    expect(screen.getByLabelText('View')).toBeTruthy()
    expect(screen.getByText('Map details')).toBeTruthy()
  })

  it('bounds circular visibility evaluation and excludes unstable fields', () => {
    const items: GenuiSpec['items'] = [
      { type: 'input', id: 'a', value: '1', when: { field: 'b', op: 'empty' } },
      { type: 'input', id: 'b', value: '1', when: { field: 'a', op: 'empty' } },
    ]
    const hidden = collectHiddenKeys(items, {
      fields: { a: '1', b: '1' }, answers: {}, multiAnswers: {},
    })
    expect([...hidden].sort()).toEqual(['a', 'b'])
    const view = render(<GenuiBlock
      spec={{ items: [...items, { type: 'submit', label: 'Send', action: 'send' }] }}
      initialState={{ fields: { a: '1', b: '1' } }}
    />)
    expect(view.container.querySelector('[data-genui]')).not.toBeNull()
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('uses the updated legal default when streaming replaces all options', () => {
    const oldSpec: GenuiSpec = { items: [
      { type: 'segmented-control', label: 'Mode', id: 'mode', options: ['A', 'B'], value: 'A' },
      { type: 'submit', label: 'Send', action: 'send', groups: ['mode'] },
    ] }
    const actions: Record<string, unknown>[] = []
    const onAction = (_name: string, payload: Record<string, unknown>): void => { actions.push(payload) }
    const view = render(<GenuiActionContext.Provider value={onAction}>
      <GenuiBlock spec={oldSpec} />
    </GenuiActionContext.Provider>)
    expect((screen.getByRole('radio', { name: 'A' }) as HTMLInputElement).checked).toBe(true)
    view.rerender(<GenuiActionContext.Provider value={onAction}>
      <GenuiBlock spec={{ items: [
        { type: 'segmented-control', label: 'Mode', id: 'mode', options: ['C', 'D'], value: 'C' },
        oldSpec.items[1]!,
      ] }} />
    </GenuiActionContext.Provider>)
    expect((screen.getByRole('radio', { name: 'C' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(actions[0]?.fields).toEqual({ mode: 'C' })
  })

  it('keeps a still-valid user selection during option updates', () => {
    const spec: GenuiSpec = { items: [{ type: 'segmented-control', label: 'Mode', id: 'mode', options: ['A', 'B'], value: 'A' }] }
    const view = render(<GenuiBlock spec={spec} />)
    fireEvent.click(screen.getByRole('radio', { name: 'B' }))
    view.rerender(<GenuiBlock spec={{ items: [{ type: 'segmented-control', label: 'Mode', id: 'mode', options: ['B', 'C'], value: 'C' }] }} />)
    expect((screen.getByRole('radio', { name: 'B' }) as HTMLInputElement).checked).toBe(true)
  })

  it('excludes hidden dates nested inside tabs from sibling conditions and submit', () => {
    const spec: GenuiSpec = { items: [
      { type: 'segmented-control', id: 'visibility', options: ['Show', 'Hide'], value: 'Hide' },
      { type: 'tabs', tabs: [{ label: 'Date', items: [
        { type: 'date-picker', id: 'travel', when: { field: 'visibility', op: 'eq', value: 'Show' } },
      ] }] },
      { type: 'text', content: 'Date selected', when: { field: 'travel', op: 'not-empty' } },
      { type: 'submit', label: 'Send', action: 'send', groups: ['travel'] },
    ] }
    render(<GenuiBlock spec={spec} initialState={{ fields: { visibility: 'Hide', travel: '2026-10-20' } }} />)
    expect(screen.queryByText('Date selected')).toBeNull()
    expect(document.querySelector('input[type="date"]')).toBeNull()
  })

  it('submits a restored value when a hidden dependency makes its condition empty', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec: GenuiSpec = { items: [
      { type: 'segmented-control', options: ['Show', 'Hide'], value: 'Show', id: 'visibility' },
      { type: 'segmented-control', options: ['Agenda', 'Map'], value: 'Map', id: 'view', when: { field: 'visibility', op: 'eq', value: 'Hide' } },
      { type: 'segmented-control', label: 'Mode', options: ['On', 'Off'], value: 'On', id: 'mode', when: { field: 'view', op: 'empty' } },
      { type: 'submit', label: 'Send', action: 'send_mode', groups: ['mode'] },
    ] }
    render(<GenuiActionContext.Provider value={(action, payload) => actions.push([action, payload])}>
      <GenuiBlock spec={spec} stateKey="hidden-dependency-empty" initialState={{ fields: {
        visibility: 'Show', view: 'Map', mode: 'On',
      } }} />
    </GenuiActionContext.Provider>)

    expect(screen.getByLabelText('Mode')).toBeTruthy()
    const submit = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    expect(actions[0]?.[1].fields).toEqual({ visibility: 'Show', mode: 'On' })
  })
})
