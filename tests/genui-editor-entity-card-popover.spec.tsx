import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { validateGenuiSpec, repairGenuiSpec } from '../src/client/guard.ts'
import type { GenuiSpec } from '../src/client/spec.ts'
import { analyzeSubmissionRegistry, resolveSubmitState } from '../src/client/submission-registry.ts'
import { analyzeGenuiPortability } from '../src/client/artifact/portability.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('Editor, Entity Card, and Popover', () => {
  it('registers the initial editor value for submit state before the user edits', async () => {
    const spec: GenuiSpec = {
      items: [
        { type: 'editor', id: 'draft', label: 'Working notes', value: 'Initial text' },
        { type: 'submit', label: 'Save', action: 'save', groups: ['draft'] },
      ],
    }
    let fields: Record<string, string> = {}
    render(<GenuiBlock spec={spec} onStateSnapshot={state => { fields = state.fields ?? {} }} />)
    await waitFor(() => expect(fields).toEqual({ draft: 'Initial text' }))

    const { registry } = analyzeSubmissionRegistry(spec)
    const result = resolveSubmitState({ registry, groups: ['draft'], state: {
      answers: {}, multiAnswers: {}, fields, secretFields: new Set(),
    } })
    expect(result.answered).toBe(1)
    expect(result.total).toBe(1)
  })

  it('autosaves editor drafts across block remounts and includes editor fields in submit state', async () => {
    const spec: GenuiSpec = {
      items: [
        { type: 'editor', id: 'draft', label: 'Working notes', value: 'Initial text' },
        { type: 'submit', label: 'Save', action: 'save', groups: ['draft'] },
      ],
    }
    const first = render(<GenuiBlock spec={spec} stateKey="editor-session" />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Working notes' }), { target: { value: 'Updated text' } })
    await waitFor(() => expect(localStorage.getItem('dsh.genui.interaction')).toContain('Updated text'))
    first.unmount()

    render(<GenuiBlock spec={spec} stateKey="editor-session" />)
    expect((screen.getByRole('textbox', { name: 'Working notes' }) as HTMLTextAreaElement).value).toBe('Updated text')

    const { registry, diagnostics } = analyzeSubmissionRegistry(spec)
    expect(diagnostics).toEqual([])
    expect(registry.members.get('draft')).toMatchObject({ kind: 'field', fieldType: 'editor' })
    const result = resolveSubmitState({ registry, groups: ['draft'], state: {
      answers: {}, multiAnswers: {}, fields: { draft: 'Updated text' }, secretFields: new Set(),
    } })
    expect(result.answered).toBe(1)
    expect(result.total).toBe(1)
  })

  it('renders entity metadata and sends its action through the host callback', () => {
    const events: Array<[string, Record<string, unknown>]> = []
    const spec: GenuiSpec = { items: [{
      type: 'entity-card',
      name: 'Ada Lovelace',
      image: '/ada.png',
      imageAlt: 'Portrait of Ada Lovelace',
      description: 'Mathematician',
      metadata: [{ label: 'Field', value: 'Computing' }],
      href: 'https://example.com/ada',
      sourceLabel: 'Source',
      actions: [{ label: 'Open details', action: 'open-ada' }],
    }] }

    render(<GenuiActionContext.Provider value={(action, payload) => events.push([action, payload])}>
      <GenuiBlock spec={spec} />
    </GenuiActionContext.Provider>)
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' }).textContent).toBe('Ada Lovelace')
    expect(screen.getByRole('img', { name: 'Portrait of Ada Lovelace' }).getAttribute('src')).toBe('/ada.png')
    expect(screen.getByText('Computing').textContent).toBe('Computing')
    expect(screen.getByRole('link', { name: 'Source' }).getAttribute('rel')).toBe('noopener noreferrer')
    fireEvent.click(screen.getByRole('button', { name: 'Open details' }))
    expect(events).toEqual([['open-ada', { type: 'entity-card', name: 'Ada Lovelace', label: 'Open details' }]])
    expect(analyzeGenuiPortability(spec)).toMatchObject({ externalMedia: ['/ada.png'], hasModelActions: true })
  })

  it('opens and closes popover details from the keyboard', async () => {
    const spec: GenuiSpec = { items: [{ type: 'popover', label: 'What is this?', content: 'Additional context.' }] }
    render(<GenuiBlock spec={spec} />)
    const trigger = screen.getByRole('button', { name: 'What is this?' })
    fireEvent.focus(trigger)
    expect((await screen.findByRole('dialog')).textContent).toContain('Additional context.')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('opens on click and dismisses when the user clicks outside', async () => {
    const spec: GenuiSpec = { items: [{ type: 'popover', label: 'Click details', content: 'Click content.', trigger: 'click' }] }
    render(<GenuiBlock spec={spec} />)
    fireEvent.click(screen.getByRole('button', { name: 'Click details' }))
    expect((await screen.findByRole('dialog')).textContent).toContain('Click content.')
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('opens hover details when the pointer enters the trigger', async () => {
    const spec: GenuiSpec = { items: [{ type: 'popover', label: 'Hover details', content: 'Hover content.', trigger: 'hover' }] }
    render(<GenuiBlock spec={spec} />)
    const trigger = screen.getByRole('button', { name: 'Hover details' })
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
    fireEvent.mouseEnter(trigger)
    fireEvent.mouseMove(trigger, { movementX: 1 })
    expect((await screen.findByRole('dialog')).textContent).toContain('Hover content.')
  })

  it('shows the avatar when an entity image fails to load, and recovers for a new source', () => {
    const first: GenuiSpec = { items: [{ type: 'entity-card', name: 'Example', image: '/missing.png' }] }
    const view = render(<GenuiBlock spec={first} />)
    const brokenImage = view.container.querySelector('img')
    expect(brokenImage).not.toBeNull()
    fireEvent.error(brokenImage!)
    expect(view.container.querySelector('img')).toBeNull()
    expect(screen.getByText('E')).not.toBeNull()
    view.rerender(<GenuiBlock spec={{ items: [{ type: 'entity-card', name: 'Example', image: '/working.png' }] }} />)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/working.png')
  })

  it('describes editor draft state without claiming persisted storage', () => {
    const spec: GenuiSpec = { items: [{ type: 'editor', id: 'draft', value: 'Hello', label: 'Draft' }] }
    render(<GenuiBlock spec={spec} />)
    expect(screen.getByRole('status').textContent).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft' }), { target: { value: 'Changed' } })
    expect(screen.getByRole('status').textContent).toMatch(/updated|已更新/i)
    expect(localStorage.getItem('dsh.genui.interaction')).toBeNull()
  })

  it('inherits the surrounding GenUI theme tokens in the portal', async () => {
    const spec: GenuiSpec = { items: [{ type: 'popover', label: 'Info', content: 'Details' }] }
    render(<GenuiBlock spec={spec} />)
    const trigger = screen.getByRole('button', { name: 'Info' })
    trigger.style.setProperty('--dsl-g-surface', 'rgb(12, 34, 56)')
    fireEvent.click(trigger)
    const panel = await screen.findByRole('dialog')
    expect(panel.style.getPropertyValue('--dsl-g-surface')).toBe('rgb(12, 34, 56)')
  })

  it('preserves every declared entity action tone', () => {
    const tones = ['primary', 'danger', 'success', 'ghost'] as const
    const spec: GenuiSpec = { items: [{
      type: 'entity-card', name: 'Actions',
      actions: tones.map(tone => ({ label: tone, action: tone, tone })),
    }] }
    render(<GenuiActionContext.Provider value={() => undefined}>
      <GenuiBlock spec={spec} />
    </GenuiActionContext.Provider>)
    for (const tone of tones) {
      expect(screen.getByRole('button', { name: tone }).getAttribute('data-tone')).toBe(tone)
    }
  })

  it('repairs unsafe entity links and rejects invalid popover settings', () => {
    const repaired = repairGenuiSpec({ items: [{
      type: 'entity-card', name: 'Example', image: 'javascript:alert(1)', href: 'javascript:alert(1)',
    }] })
    expect(repaired?.items[0]).toEqual({ type: 'entity-card', name: 'Example' })
    expect(validateGenuiSpec({ items: [{ type: 'popover', label: 'Info', content: 'Text', trigger: 'keyboard' }] }).ok).toBe(false)
  })
})


describe('editor and popover review regressions', () => {
  it.each(['constructor', 'toString', '__proto__'])('uses the model default for an unregistered editor field %s', id => {
    const spec: GenuiSpec = { items: [
      { type: 'editor', id, label: 'Draft', value: 'Initial text' },
      { type: 'submit', label: 'Send', action: 'send', groups: [id] },
    ] }
    expect(validateGenuiSpec(spec).ok).toBe(true)
    const events: Record<string, unknown>[] = []
    render(<GenuiActionContext.Provider value={(_action, payload) => { events.push(payload) }}>
      <GenuiBlock spec={spec} />
    </GenuiActionContext.Provider>)
    expect((screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement).value).toBe('Initial text')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(events[0]?.fields).toEqual({ [id]: 'Initial text' })
  })

  it('opens hover details without blurring an edited input or sending its action', async () => {
    const events: string[] = []
    render(<GenuiActionContext.Provider value={action => { events.push(action) }}>
      <GenuiBlock spec={{ items: [
        { type: 'input', id: 'name', label: 'Name', action: 'save_name' },
        { type: 'popover', label: 'Hover details', content: 'Explanation', trigger: 'hover' },
      ] }} />
    </GenuiActionContext.Provider>)
    const input = screen.getByRole('textbox', { name: 'Name' })
    act(() => input.focus())
    fireEvent.change(input, { target: { value: 'Ada' } })
    const trigger = screen.getByRole('button', { name: 'Hover details' })
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
    fireEvent.mouseEnter(trigger)
    fireEvent.mouseMove(trigger, { movementX: 1 })
    await screen.findByRole('dialog', { name: 'Hover details' })
    expect(document.activeElement).toBe(input)
    expect(events).toEqual([])
    fireEvent.blur(input)
    expect(events).toEqual(['save_name'])
  })
})
