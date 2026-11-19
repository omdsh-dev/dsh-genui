// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { validateGenuiSpec } from '../src/client/guard.ts'
import { t } from '../src/client/i18n/index.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

afterEach(() => { cleanup(); localStorage.clear() })

describe('date-picker component', () => {
  it('accepts calendar dates and ISO date intervals within their bounds', () => {
    expect(validateGenuiSpec({ items: [
      { type: 'date-picker', mode: 'single', value: '2026-10-12', min: '2026-10-01', max: '2026-10-31' },
      { type: 'date-picker', mode: 'range', value: '2026-10-12/2026-10-18' },
    ] }).ok).toBe(true)
  })

  it.each([
    { mode: 'single', value: '2026-02-30' },
    { mode: 'single', value: '0000-01-01' },
    { mode: 'single', min: '0000-01-01' },
    { mode: 'single', max: '0000-12-31' },
    { mode: 'range', value: '0000-01-01/2026-10-12' },
    { mode: 'single', value: '2026-10-12', min: '2026-10-13' },
    { mode: 'single', min: '2026-11-01', max: '2026-10-01' },
    { mode: 'range', value: '2026-10-18/2026-10-12' },
    { mode: 'range', value: '2026-10-12' },
  ])('rejects invalid date-picker data: $mode $value', input => {
    expect(validateGenuiSpec({ items: [{ type: 'date-picker', ...input }] }).ok).toBe(false)
  })

  it('stores a selected date in shared state and submits the displayed value', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec: GenuiSpec = { items: [
      { type: 'date-picker', id: 'departure', label: 'Departure', value: '2026-10-12' },
      { type: 'submit', label: 'Send', action: 'send_dates', groups: ['departure'] },
    ] }
    render(<GenuiActionContext.Provider value={(action, payload) => actions.push([action, payload])}>
      <GenuiBlock spec={spec} />
    </GenuiActionContext.Provider>)

    const date = screen.getByLabelText('Departure') as HTMLInputElement
    expect(date.value).toBe('2026-10-12')
    fireEvent.change(date, { target: { value: '2026-10-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(actions[0]?.[1].fields).toEqual({ departure: '2026-10-20' })
  })

  it('keeps an incomplete or reversed range out of submission', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec: GenuiSpec = { items: [
      { type: 'date-picker', id: 'travel', label: 'Travel', mode: 'range' },
      { type: 'submit', label: 'Send', action: 'send_dates', groups: ['travel'] },
    ] }
    render(<GenuiActionContext.Provider value={(action, payload) => actions.push([action, payload])}>
      <GenuiBlock spec={spec} />
    </GenuiActionContext.Provider>)

    const start = screen.getByLabelText(t('block.datePicker.start'))
    const end = screen.getByLabelText(t('block.datePicker.end'))
    const submit = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    fireEvent.change(start, { target: { value: '2026-10-20' } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(end, { target: { value: '2026-10-18' } })
    expect(screen.getByRole('status').textContent).toBe(t('block.datePicker.invalidRange'))
    expect(submit.disabled).toBe(true)
    fireEvent.change(end, { target: { value: '2026-10-24' } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    expect(actions[0]?.[1].fields).toEqual({ travel: '2026-10-20/2026-10-24' })
  })

  it('clears a selected date range when updated bounds exclude it', () => {
    const spec: GenuiSpec = { items: [
      { type: 'date-picker', id: 'travel', label: 'Travel', mode: 'range', min: '2026-10-01', max: '2026-10-31' },
      { type: 'submit', label: 'Send', action: 'send_dates', groups: ['travel'] },
    ] }
    const onAction = () => undefined
    const view = render(<GenuiActionContext.Provider value={onAction}><GenuiBlock spec={spec} /></GenuiActionContext.Provider>)
    fireEvent.change(screen.getByLabelText(t('block.datePicker.start')), { target: { value: '2026-10-20' } })
    fireEvent.change(screen.getByLabelText(t('block.datePicker.end')), { target: { value: '2026-10-24' } })
    expect((screen.getByLabelText(t('block.datePicker.start')) as HTMLInputElement).value).toBe('2026-10-20')
    expect((screen.getByLabelText(t('block.datePicker.end')) as HTMLInputElement).value).toBe('2026-10-24')
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false)

    view.rerender(<GenuiActionContext.Provider value={onAction}><GenuiBlock spec={{ ...spec, items: [
      { type: 'date-picker', id: 'travel', label: 'Travel', mode: 'range', min: '2026-10-01', max: '2026-10-22' },
      spec.items[1]!,
    ] }} /></GenuiActionContext.Provider>)

    expect((screen.getByLabelText(t('block.datePicker.start')) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(t('block.datePicker.end')) as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('excludes an out-of-bounds restored date from a submission with another field', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec: GenuiSpec = { items: [
      { type: 'input', label: 'Name', id: 'name' },
      { type: 'date-picker', id: 'travel', label: 'Travel', min: '2026-10-01', max: '2026-10-22' },
      { type: 'submit', label: 'Send', action: 'send_form' },
    ] }
    render(<GenuiActionContext.Provider value={(action, payload) => actions.push([action, payload])}>
      <GenuiBlock spec={spec} stateKey="date-picker-restore" initialState={{ fields: { name: '', travel: '2026-10-20/2026-10-24' } }} />
    </GenuiActionContext.Provider>)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(actions[0]?.[1].fields).toEqual({ name: 'Ada' })
  })

  it('does not expose an out-of-bounds date to sibling conditions', () => {
    const spec: GenuiSpec = { items: [
      { type: 'date-picker', id: 'travel', label: 'Travel', min: '2026-10-01', max: '2026-10-22' },
      { type: 'text', content: 'Unavailable date selected', when: { field: 'travel', op: 'eq', value: '2026-10-30' } },
    ] }
    render(<GenuiBlock spec={spec} />)

    const date = screen.getByLabelText('Travel') as HTMLInputElement
    fireEvent.change(date, { target: { value: '2026-10-30' } })

    expect(screen.queryByText('Unavailable date selected')).toBeNull()
    expect(date.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('status').textContent).toBe(t('block.datePicker.invalidDate'))
  })

  it('does not expose a restored value while the date-picker is hidden', () => {
    const spec: GenuiSpec = { items: [
      { type: 'segmented-control', label: 'Visibility', options: ['Show', 'Hide'], value: 'Hide', id: 'visibility' },
      { type: 'date-picker', id: 'travel', label: 'Travel', min: '2026-10-01', max: '2026-10-22', when: { field: 'visibility', op: 'eq', value: 'Show' } },
      { type: 'date-picker', id: 'return', label: 'Return', value: '2026-10-21', when: { field: 'travel', op: 'eq', value: '2026-10-20' } },
      { type: 'text', content: 'Travel plan ready', when: { field: 'return', op: 'eq', value: '2026-10-21' } },
    ] }
    render(<GenuiBlock spec={spec} stateKey="hidden-date-picker-restore" initialState={{ fields: {
      visibility: 'Hide', travel: '2026-10-20',
    } }} />)

    expect(screen.queryByLabelText('Travel')).toBeNull()
    expect(screen.queryByLabelText('Return')).toBeNull()
    expect(screen.queryByText('Travel plan ready')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Show' }))
    expect(screen.getByLabelText('Travel')).toBeTruthy()
    expect(screen.getByLabelText('Return')).toBeTruthy()
    expect(screen.getByText('Travel plan ready')).toBeTruthy()
  })
})


describe('date-picker state regressions', () => {
  it.each(['constructor', 'toString', '__proto__'])('uses only own stored fields for %s', id => {
    const spec: GenuiSpec = { items: [
      { type: 'date-picker', id, label: 'Date', value: '2026-10-12' },
      { type: 'submit', label: 'Send', action: 'send', groups: [id] },
    ] }
    expect(validateGenuiSpec(spec).ok).toBe(true)
    const events: Record<string, unknown>[] = []
    render(<GenuiActionContext.Provider value={(_action, payload) => { events.push(payload) }}>
      <GenuiBlock spec={spec} />
    </GenuiActionContext.Provider>)
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2026-10-12')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(events[0]?.fields).toEqual({ [id]: '2026-10-12' })
  })

  it('keeps the native date input and submission empty for a restored zero year', () => {
    const spec: GenuiSpec = { items: [
      { type: 'date-picker', id: 'date', label: 'Date' },
      { type: 'submit', label: 'Send', action: 'send', groups: ['date'] },
    ] }
    render(<GenuiActionContext.Provider value={() => undefined}>
      <GenuiBlock spec={spec} initialState={{ fields: { date: '0000-01-01' } }} />
    </GenuiActionContext.Provider>)
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
    expect(validateGenuiSpec({ items: [{ type: 'date-picker', value: '0001-01-01' }] }).ok).toBe(true)
    expect(validateGenuiSpec({ items: [{ type: 'date-picker', value: '2024-02-29' }] }).ok).toBe(true)
  })

  it.each(['single', 'range'] as const)('registers a displayed %s draft when updated bounds make it valid', mode => {
    const selected = mode === 'range' ? '2026-10-20/2026-10-30' : '2026-10-30'
    const spec: GenuiSpec = { items: [
      { type: 'date-picker', id: 'date', label: 'Date', mode, min: '2026-10-01', max: '2026-10-22' },
      { type: 'text', content: 'Ready', when: { field: 'date', op: 'eq', value: selected } },
      { type: 'submit', label: 'Send', action: 'send', groups: ['date'] },
    ] }
    const events: Record<string, unknown>[] = []
    const onAction = (_action: string, payload: Record<string, unknown>): void => { events.push(payload) }
    const view = render(<GenuiActionContext.Provider value={onAction}><GenuiBlock spec={spec} /></GenuiActionContext.Provider>)
    if (mode === 'range') fireEvent.change(screen.getByLabelText(t('block.datePicker.start')), { target: { value: '2026-10-20' } })
    const date = screen.getByLabelText(mode === 'range' ? t('block.datePicker.end') : 'Date') as HTMLInputElement
    fireEvent.change(date, { target: { value: '2026-10-30' } })
    expect(date.getAttribute('aria-invalid')).toBe('true')
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
    view.rerender(<GenuiActionContext.Provider value={onAction}><GenuiBlock spec={{ ...spec, items: [
      { type: 'date-picker', id: 'date', label: 'Date', mode, min: '2026-10-01', max: '2026-10-31' }, ...spec.items.slice(1),
    ] }} /></GenuiActionContext.Provider>)
    expect(date.value).toBe('2026-10-30')
    expect(date.hasAttribute('aria-invalid')).toBe(false)
    expect(screen.getByText('Ready')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(events[0]?.fields).toEqual({ date: selected })
  })
})
