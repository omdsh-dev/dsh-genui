// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { processGenuiSpec } from '../src/client/guard.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

afterEach(() => { cleanup(); localStorage.clear() })

// Reverse dependency order deliberately needs multiple visibility passes.
const spec: GenuiSpec = { items: [
  { type: 'text', content: 'Ready to book', when: { field: 'visit', op: 'not-empty' } },
  { type: 'date-picker', id: 'visit', label: 'Visit', when: { field: 'plan', op: 'eq', value: 'Advanced' } },
  { type: 'segmented-control', id: 'plan', label: 'Plan', options: ['Basic', 'Advanced'], when: { field: 'destination', op: 'eq', value: 'db' } },
  { type: 'diagram', id: 'destination', kind: 'flowchart', nodes: [{ id: 'db', label: 'Database' }, { id: 'web', label: 'Web' }], when: { field: 'show', op: 'eq', value: 'yes' } },
  { type: 'select', id: 'show', label: 'Show', options: ['yes', 'no'] },
  { type: 'submit', label: 'Send', action: 'send' },
] }
const restored = { fields: { show: 'no', destination: 'db', plan: 'Advanced', visit: '2026-10-20' } }

describe('combined diagram, segmented control and date state', () => {
  it('excludes a restored hidden chain and restores the same values when shown again', () => {
    const payloads: Record<string, unknown>[] = []
    render(<GenuiActionContext.Provider value={(_action, payload) => payloads.push(payload)}>
      <GenuiBlock spec={spec} initialState={restored} />
    </GenuiActionContext.Provider>)
    expect(screen.queryByText('Ready to book')).toBeNull()
    expect(screen.queryByLabelText('Visit')).toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(payloads[0]?.fields).toEqual({ show: 'no' })

    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'yes' } })
    expect(screen.getByRole('button', { name: 'Database' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('radio', { name: 'Advanced' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Visit') as HTMLInputElement).value).toBe('2026-10-20')
    expect(screen.getByText('Ready to book')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(payloads[1]?.fields).toEqual({ ...restored.fields, show: 'yes' })
  })

  it('drops a streamed-away selection and its dependent values from the payload', () => {
    const payloads: Record<string, unknown>[] = []
    const action = (_action: string, payload: Record<string, unknown>) => { payloads.push(payload) }
    const initialState = { fields: { ...restored.fields, show: 'yes' } }
    const view = render(<GenuiActionContext.Provider value={action}>
      <GenuiBlock spec={spec} initialState={initialState} />
    </GenuiActionContext.Provider>)
    expect(screen.getByText('Ready to book')).not.toBeNull()
    const replacement: GenuiSpec = { items: spec.items.map(node => node.type === 'diagram'
      ? { ...node, nodes: [{ id: 'web', label: 'Web' }] } : node) }
    view.rerender(<GenuiActionContext.Provider value={action}>
      <GenuiBlock spec={replacement} initialState={initialState} />
    </GenuiActionContext.Provider>)
    expect(screen.queryByText('Ready to book')).toBeNull()
    expect(screen.queryByLabelText('Visit')).toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(payloads[0]?.fields).toEqual({ show: 'yes' })
  })

  it('keeps an editor draft behind the date chain and preserves an explicit clear', () => {
    const payloads: Record<string, unknown>[] = []
    const withEditor: GenuiSpec = { items: [
      { type: 'editor', id: 'notes', label: 'Notes', value: 'Default', when: { field: 'visit', op: 'not-empty' } },
      ...spec.items,
    ] }
    render(<GenuiActionContext.Provider value={(_action, payload) => payloads.push(payload)}>
      <GenuiBlock spec={withEditor} initialState={{ fields: { ...restored.fields, notes: 'Saved draft' } }} />
    </GenuiActionContext.Provider>)
    expect(screen.queryByLabelText('Notes')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(payloads[0]?.fields).toEqual({ show: 'no' })
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'yes' } })
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Saved draft')
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'no' } })
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'yes' } })
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(payloads[1]?.fields).toEqual({ ...restored.fields, show: 'yes' })
  })

  it('rejects cycles through the new fields, including ancestor conditions', () => {
    const result = processGenuiSpec({ items: [
      { type: 'card', when: { field: 'visit', op: 'not-empty' }, items: [
        { type: 'diagram', id: 'destination', kind: 'flowchart', nodes: [{ id: 'db', label: 'Database' }] },
      ] },
      spec.items[2], spec.items[1],
    ] })
    expect(result.errors.join(' ')).toContain('circular visibility dependency')
  })
})
