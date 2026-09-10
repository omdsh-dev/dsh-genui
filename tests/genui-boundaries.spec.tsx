// @vitest-environment jsdom
// GenUI hardening boundaries (design 2026-08-12):
// 1) forms inside tabs share the block-level answers/fields registry;
// 2) field invariants: blank values leave the registry, spec defaults
//    register at mount, submit computes answered/ready/payload from ONE
//    filled-fields view (whitespace preserved, blanks filtered);
// 3) IME three-layer protection: Enter / Ctrl(Cmd)+Enter never submit while
//    composing (ref, native isComposing, keyCode 229), and the 10ms
//    composition-end delay covers Safari's closing keydown;
// 4) password inputs stay masked, never persist, never join submit
//    collection, and restore blank — while their own action still delivers.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownText } from './markdown-labels.tsx'
import { hasFenceRegistry } from './helpers/fence-host'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GENUI_ACTION_DEBOUNCE_MS } from '../src/client/GenuiBlock.tsx'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})
beforeEach(() => {
  vi.useFakeTimers()
})

function fenced(spec: unknown): string {
  return `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
}

function renderBlock(spec: unknown, stateKey: string | undefined, onAction?: (a: string, p: Record<string, unknown>) => void) {
  const inner = <GenuiBlock spec={spec as never} stateKey={stateKey} />
  return render(onAction === undefined
    ? inner
    : <GenuiActionContext.Provider value={onAction}>{inner}</GenuiActionContext.Provider>)
}

const gradeSpec = {
  items: [
    { type: 'tabs', tabs: [
      { label: '题目', items: [
        { type: 'radio', label: 'Q1', group: 'q1', options: ['甲', '乙'], answer: 0, explanation: '甲对' },
        { type: 'input', label: '姓名', id: 'name', placeholder: '你的名字' },
        { type: 'submit', label: '交卷', action: 'submit-paper', groups: ['q1'] },
      ] },
    ] },
  ],
}

describe.skipIf(!hasFenceRegistry)('forms inside tabs share the block answers registry', () => {
  it('grades locally inside a tab and keeps the answer when switching tabs', () => {
    const onAction = vi.fn()
    renderBlock(gradeSpec, undefined, onAction)
    // answer the grouped radio inside the tab
    fireEvent.click(screen.getByRole('radio', { name: '甲' }))
    fireEvent.click(screen.getByRole('button', { name: '交卷' }))
    // local grading result appears (no round trip)
    expect(screen.getByText(/得分/)).toBeTruthy()
    expect(onAction).not.toHaveBeenCalled()
    // switching away and back keeps the graded result
    fireEvent.click(screen.getAllByRole('tab')[0]!)
    expect(screen.getByText(/得分/)).toBeTruthy()
  })

  it('submits with both answers and fields from inside a tab', () => {
    const onAction = vi.fn()
    renderBlock({
      items: [
        { type: 'tabs', tabs: [
          { label: '表单', items: [
            { type: 'radio', label: 'Q1', group: 'q1', options: ['甲', '乙'] },
            { type: 'input', label: '姓名', id: 'name' },
            { type: 'submit', label: '发送', action: 'send', groups: ['q1'] },
          ] },
        ] },
      ],
    }, undefined, onAction)
    fireEvent.click(screen.getByRole('radio', { name: '甲' }))
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: '小张' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).toHaveBeenCalledWith('send', expect.objectContaining({
      answers: { q1: '甲' },
      fields: { name: '小张' },
    }))
  })

  it('switching tabs does not lose the typed field value', () => {
    const onAction = vi.fn()
    renderBlock({
      items: [
        { type: 'tabs', tabs: [
          { label: 'A', items: [{ type: 'input', label: '名字', id: 'n' }] },
          { label: 'B', items: [{ type: 'text', content: 'B 内容' }] },
        ] },
        { type: 'submit', label: '发送', action: 'send' },
      ],
    }, undefined, onAction)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '阿强' } })
    fireEvent.click(screen.getByRole('tab', { name: 'B' }))
    fireEvent.click(screen.getByRole('tab', { name: 'A' }))
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('阿强')
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).toHaveBeenCalledWith('send', expect.objectContaining({ fields: { n: '阿强' } }))
  })
})

describe.skipIf(!hasFenceRegistry)('field invariants', () => {
  it('clearing an input re-disables submit', () => {
    const onAction = vi.fn()
    renderBlock({ items: [
      { type: 'input', label: 'F', id: 'f' },
      { type: 'submit', label: '发送', action: 'send' },
    ] }, undefined, onAction)
    const submit = screen.getByRole('button', { name: '发送' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '值' } })
    expect(submit.disabled).toBe(false)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    expect(submit.disabled).toBe(true)
  })

  it('whitespace-only values never enable submit and never join the payload', () => {
    const onAction = vi.fn()
    renderBlock({ items: [
      { type: 'input', label: 'A', id: 'a' },
      { type: 'input', label: 'B', id: 'b' },
      { type: 'submit', label: '发送', action: 'send' },
    ] }, undefined, onAction)
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: '   ' } })
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: '真实值' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).toHaveBeenCalledWith('send', expect.objectContaining({ fields: { b: '真实值' } }))
  })

  it('a spec-provided default value registers at mount (submit enabled immediately)', () => {
    const onAction = vi.fn()
    renderBlock({ items: [
      { type: 'input', label: 'F', id: 'f', value: '默认值' },
      { type: 'submit', label: '发送', action: 'send' },
    ] }, undefined, onAction)
    const submit = screen.getByRole('button', { name: '发送' }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).toHaveBeenCalledWith('send', expect.objectContaining({ fields: { f: '默认值' } }))
  })

  it('preserves the user string verbatim (no payload trimming)', () => {
    const onAction = vi.fn()
    renderBlock({ items: [
      { type: 'input', label: 'F', id: 'f' },
      { type: 'submit', label: '发送', action: 'send' },
    ] }, undefined, onAction)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  首尾空格  ' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).toHaveBeenCalledWith('send', expect.objectContaining({ fields: { f: '  首尾空格  ' } }))
  })
})

describe.skipIf(!hasFenceRegistry)('IME protection (three layers)', () => {
  const inputSpec = { items: [
    { type: 'input', label: 'F', id: 'f', action: 'input-action' },
    { type: 'textarea', label: 'T', id: 't', action: 'ta-action' },
  ] }

  it('input Enter with native isComposing does not submit', () => {
    const onAction = vi.fn()
    renderBlock(inputSpec, undefined, onAction)
    fireEvent.keyDown(screen.getAllByRole('textbox')[0]!, { key: 'Enter', isComposing: true })
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('input Enter with keyCode 229 does not submit', () => {
    const onAction = vi.fn()
    renderBlock(inputSpec, undefined, onAction)
    const input = screen.getAllByRole('textbox')[0]!
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('composition start → end → immediate Enter does not submit (Safari closing keydown)', () => {
    const onAction = vi.fn()
    renderBlock(inputSpec, undefined, onAction)
    const input = screen.getAllByRole('textbox')[0]!
    fireEvent.compositionStart(input)
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' }) // lands inside the 10ms window
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('a normal Enter after the composition window submits exactly once', () => {
    const onAction = vi.fn()
    renderBlock(inputSpec, undefined, onAction)
    const input = screen.getAllByRole('textbox')[0]!
    fireEvent.compositionStart(input)
    fireEvent.compositionEnd(input)
    vi.advanceTimersByTime(10) // composition-end delay elapsed
    fireEvent.keyDown(input, { key: 'Enter' })
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith('input-action', expect.objectContaining({ type: 'input', submit: true }))
  })

  it('textarea Ctrl/Cmd+Enter during composition does not submit; after it does', () => {
    const onAction = vi.fn()
    renderBlock(inputSpec, undefined, onAction)
    const ta = screen.getAllByRole('textbox')[1]!
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true, isComposing: true })
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true })
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith('ta-action', expect.objectContaining({ type: 'textarea', submit: true }))
  })
})

describe.skipIf(!hasFenceRegistry)('password boundary (masked, never persisted, never collected)', () => {
  const KEY = 'boundary-test-key'
  const passSpec = { items: [
    { type: 'input', label: '口令', id: 'pw', inputType: 'password', action: 'pw-action' },
    { type: 'input', label: '昵称', id: 'nick' },
    { type: 'submit', label: '发送', action: 'send' },
  ] }

  it('renders a masked password input (no plaintext field)', () => {
    renderBlock(passSpec, KEY, vi.fn())
    const pw = screen.getByLabelText('口令') as HTMLInputElement
    expect(pw.type).toBe('password')
    expect(pw.type).not.toBe('text')
  })

  it('never persists the password value to localStorage', () => {
    renderBlock(passSpec, KEY, vi.fn())
    fireEvent.change(screen.getByLabelText('口令'), { target: { value: 's3cret!' } })
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '小明' } })
    vi.advanceTimersByTime(400) // durable-save debounce
    const raw = localStorage.getItem('dsh.genui.interaction')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as { blocks: Record<string, { fields?: Record<string, string> }> }
    const block = parsed.blocks[KEY]!
    expect(block.fields).toBeDefined()
    expect(block.fields!.pw).toBeUndefined()
    expect(block.fields!.nick).toBe('小明')
  })

  it('restores blank after refresh (password never survives a remount)', () => {
    renderBlock(passSpec, KEY, vi.fn())
    fireEvent.change(screen.getByLabelText('口令'), { target: { value: 's3cret!' } })
    vi.advanceTimersByTime(400)
    cleanup()
    renderBlock(passSpec, KEY, vi.fn())
    expect((screen.getByLabelText('口令') as HTMLInputElement).value).toBe('')
  })

  it('excludes the password field from submit collection', () => {
    const onAction = vi.fn()
    renderBlock(passSpec, KEY, onAction)
    fireEvent.change(screen.getByLabelText('口令'), { target: { value: 's3cret!' } })
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '小明' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).toHaveBeenCalledWith('send', expect.objectContaining({ fields: { nick: '小明' } }))
    const payload = onAction.mock.calls[0]![1] as { fields: Record<string, string> }
    expect(payload.fields.pw).toBeUndefined()
  })

  it('a password-only form cannot enable submit (nothing to collect), but its own action still delivers', () => {
    const onAction = vi.fn()
    renderBlock({ items: [
      { type: 'input', label: '口令', id: 'pw', inputType: 'password', action: 'pw-action' },
      { type: 'submit', label: '发送', action: 'send' },
    ] }, KEY, onAction)
    const submit = screen.getByRole('button', { name: '发送' }) as HTMLButtonElement
    fireEvent.change(screen.getByLabelText('口令'), { target: { value: 's3cret!' } })
    expect(submit.disabled).toBe(true)
    // the input's own action fires on explicit Enter (user-authorized)
    fireEvent.keyDown(screen.getByLabelText('口令'), { key: 'Enter' })
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(onAction).toHaveBeenCalledWith('pw-action', expect.objectContaining({ type: 'input', value: 's3cret!', submit: true }))
  })
})
