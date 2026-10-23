import { act, cleanup, fireEvent, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installDomFenceRenderer } from '../src/client/dom-fence.tsx'
import { installSidechatAdapter, mountSidechatSurface, type SidechatSurface } from '../src/client/sidechat-surface.tsx'

const body = JSON.stringify({ items: [
  { type: 'input', id: 'choice', label: 'Choice' },
  { type: 'submit', label: 'Send', action: 'continue' },
] })
const markdown = (raw = body, lang = 'dsh-ui') => `\`\`\`${lang}\n${raw}\n\`\`\``
const disposers: (() => void)[] = []

function hostBlock(raw = body): HTMLElement {
  const block = document.createElement('div')
  block.className = 'md-code-block'
  const banner = document.createElement('div')
  banner.textContent = 'Code'
  const pre = document.createElement('pre')
  pre.textContent = `${raw}\n`
  block.append(banner, pre)
  return block
}
function surface(extra: Partial<SidechatSurface> = {}, rawBodies = [body]): SidechatSurface {
  const root = document.createElement('div')
  root.setAttribute('data-genui-surface', 'dsh-better-sidebar/sidechat')
  root.append(...rawBodies.map(raw => hostBlock(raw)))
  document.body.append(root)
  return { root, source: 'dsh-better-sidebar/sidechat', threadId: 'child-a', eventSeq: 42,
    contentBlockIndex: 0, text: markdown(), sendPrompt: vi.fn(async () => {}), ...extra }
}
async function mount(value: SidechatSurface): Promise<() => void> {
  let dispose = () => {}
  await act(async () => { dispose = mountSidechatSurface(value) })
  disposers.push(dispose)
  return dispose
}
beforeEach(() => localStorage.clear())
afterEach(async () => {
  await act(async () => { for (const dispose of disposers.splice(0)) dispose() })
  cleanup()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('explicit sidechat surfaces', () => {
  it('keeps current main DOM renderer out of explicit surfaces even with a dsh-ui label', async () => {
    const value = surface()
    value.root.querySelector('.md-code-block > div')!.textContent = 'dsh-ui'
    const send = vi.fn()
    const ctx = { sessions: { list: { getSnapshot: () => ({ ids: ['main'] }) }, retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: 1 } }) }) } } as unknown as Context
    await act(async () => { disposers.push(installDomFenceRenderer(ctx, send)); await new Promise(resolve => setTimeout(resolve, 35)) })
    expect(value.root.querySelector('[data-genui]')).toBeNull()
    expect(value.root.querySelector<HTMLElement>('.md-code-block')!.style.display).toBe('')
    expect(send).not.toHaveBeenCalled()
  })

  it('renders one owning child and never asks for a main-session route', async () => {
    const value = surface()
    await mount(value)
    fireEvent.change(within(value.root).getByRole('textbox'), { target: { value: 'only-a' } })
    fireEvent.click(within(value.root).getByRole('button', { name: 'Send' }))
    expect(value.sendPrompt).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('"choice":"only-a"'))
    expect(vi.mocked(value.sendPrompt).mock.calls[0]![0]).toMatch(/^\[genui-action\] continue /)
  })

  it('isolates identical forms across child threads and original content blocks', async () => {
    const values = [surface(), surface({ threadId: 'child-b' }), surface({ contentBlockIndex: 2 })]
    for (const value of values) await mount(value)
    fireEvent.change(within(values[0]!.root).getByRole('textbox'), { target: { value: 'a-only' } })
    expect((within(values[1]!.root).getByRole('textbox') as HTMLInputElement).value).toBe('')
    expect((within(values[2]!.root).getByRole('textbox') as HTMLInputElement).value).toBe('')
    fireEvent.change(within(values[2]!.root).getByRole('textbox'), { target: { value: 'third-only' } })
    fireEvent.click(within(values[2]!.root).getByRole('button', { name: 'Send' }))
    expect(values[0]!.sendPrompt).not.toHaveBeenCalled()
    expect(values[1]!.sendPrompt).not.toHaveBeenCalled()
    expect(values[2]!.sendPrompt).toHaveBeenCalledTimes(1)
  })

  it('counts all source fences, preserving repeated bodies and ordinary JSON', async () => {
    const value = surface({ text: [markdown(), markdown(body, 'json'), markdown()].join('\n\n') }, [body, body, body])
    await mount(value)
    expect(value.root.querySelectorAll('[data-genui]')).toHaveLength(2)
    const code = value.root.querySelectorAll<HTMLElement>('.md-code-block')
    expect(code[0]!.style.display).toBe('none')
    expect(code[1]!.style.display).toBe('')
    expect(code[2]!.style.display).toBe('none')
    const fields = within(value.root).getAllByRole('textbox') as HTMLInputElement[]
    fireEvent.change(fields[0]!, { target: { value: 'first-only' } })
    expect(fields[1]!.value).toBe('')
  })

  it('matches nested quote/list fences by source order', async () => {
    const text = markdown().split('\n').map(line => `> ${line}`).join('\n') + '\n\n- item\n\n' + markdown().split('\n').map(line => `  ${line}`).join('\n')
    const value = surface({ text }, [body, body])
    await mount(value)
    expect(value.root.querySelectorAll('[data-genui]')).toHaveLength(2)
  })

  it.each([
    ['source', { source: 'other' }], ['empty thread', { threadId: '' }], ['missing thread', { threadId: undefined }],
    ['fractional seq', { eventSeq: 1.5 }], ['negative seq', { eventSeq: -1 }], ['missing index', { contentBlockIndex: undefined }],
    ['negative index', { contentBlockIndex: -1 }], ['missing sender', { sendPrompt: undefined }],
  ])('fails closed for %s', async (_, extra) => {
    const value = surface(extra as Partial<SidechatSurface>)
    await mount(value)
    expect(value.root.querySelector('[data-genui]')).toBeNull()
    expect(value.root.querySelector<HTMLElement>('.md-code-block')!.style.display).toBe('')
  })

  it.each([
    ['ordinary JSON', markdown(body, 'json'), body],
    ['unlabelled', markdown(body, ''), body],
    ['panel', markdown('{"panel":true,"items":[{"type":"text","content":"panel"}]}'), '{"panel":true,"items":[{"type":"text","content":"panel"}]}'],
    ['invalid body', markdown('{bad'), '{bad'],
    ['body mismatch', markdown(), '{}'],
  ])('keeps %s as original Markdown', async (_, text, raw) => {
    const value = surface({ text }, [raw])
    await mount(value)
    expect(value.root.querySelector('[data-genui]')).toBeNull()
    expect(value.root.querySelector<HTMLElement>('.md-code-block')!.style.display).toBe('')
  })

  it('waits for complete DOM shape, then handles late host code blocks', async () => {
    const value = surface({ text: markdown() + '\n\n' + markdown() })
    await mount(value)
    expect(value.root.querySelector('[data-genui]')).toBeNull()
    await act(async () => { value.root.append(hostBlock()) })
    expect(value.root.querySelectorAll('[data-genui]')).toHaveLength(2)
  })

  it('replaces a host DOM block and restores state without cross-thread reuse', async () => {
    const value = surface()
    await mount(value)
    fireEvent.change(within(value.root).getByRole('textbox'), { target: { value: 'remember' } })
    await act(async () => { value.root.replaceChildren(hostBlock()) })
    expect(value.root.querySelectorAll('[data-genui]')).toHaveLength(1)
    expect((within(value.root).getByRole('textbox') as HTMLInputElement).value).toBe('remember')
  })

  it('flushes an immediate edit on hide/unmount and restores only the same identity', async () => {
    const value = surface()
    const dispose = await mount(value)
    fireEvent.change(within(value.root).getByRole('textbox'), { target: { value: 'fast edit' } })
    await act(async () => { dispose() })
    expect(value.root.querySelector('[data-genui]')).toBeNull()
    expect(value.root.querySelector<HTMLElement>('.md-code-block')!.style.display).toBe('')
    await mount(value)
    expect((within(value.root).getByRole('textbox') as HTMLInputElement).value).toBe('fast edit')
    const other = surface({ eventSeq: 43 })
    await mount(other)
    expect((within(other.root).getByRole('textbox') as HTMLInputElement).value).toBe('')
  })

  it.each([false, true])('recovers a host-wiped replacement (nonempty=%s) without losing the last edit', async nonempty => {
    const value = surface()
    await mount(value)
    fireEvent.change(within(value.root).getByRole('textbox'), { target: { value: 'recover' } })
    await act(async () => {
      value.root.querySelector('[data-genui-explicit-fence]')!.replaceChildren(...(nonempty ? [document.createElement('span')] : []))
    })
    expect(value.root.querySelectorAll('[data-genui]')).toHaveLength(1)
    expect((within(value.root).getByRole('textbox') as HTMLInputElement).value).toBe('recover')
  })

  it.each([false, true])('safely disposes an immediately replaced host (nonempty=%s)', async nonempty => {
    const value = surface()
    const dispose = await mount(value)
    fireEvent.change(within(value.root).getByRole('textbox'), { target: { value: 'same-tick' } })
    await act(async () => {
      value.root.querySelector('[data-genui-explicit-fence]')!.replaceChildren(...(nonempty ? [document.createElement('span')] : []))
      dispose()
    })
    expect(value.root.querySelector('[data-genui]')).toBeNull()
    expect(value.root.querySelector<HTMLElement>('.md-code-block')!.style.display).toBe('')
    await mount(value)
    expect((within(value.root).getByRole('textbox') as HTMLInputElement).value).toBe('same-tick')
  })

  it('restores original code if a late DOM change breaks complete source alignment', async () => {
    const value = surface()
    await mount(value)
    await act(async () => { value.root.append(hostBlock('{}')) })
    expect(value.root.querySelector('[data-genui]')).toBeNull()
    expect(value.root.querySelector<HTMLElement>('.md-code-block')!.style.display).toBe('')
  })

  it('invalidates detached controls immediately before deferred root disposal', async () => {
    const value = surface()
    const dispose = await mount(value)
    const button = within(value.root).getByRole('button', { name: 'Send' })
    await act(async () => { dispose(); fireEvent.click(button) })
    expect(value.sendPrompt).not.toHaveBeenCalled()
  })

  it('handles rejected child sends without a main fallback', async () => {
    const value = surface({ sendPrompt: vi.fn(async () => { throw new Error('child unavailable') }) })
    await mount(value)
    fireEvent.change(within(value.root).getByRole('textbox'), { target: { value: 'send me' } })
    await act(async () => { fireEvent.click(within(value.root).getByRole('button', { name: 'Send' })) })
    expect(value.sendPrompt).toHaveBeenCalledTimes(1)
  })

  it('registers optionally and forwards the service disposer', () => {
    expect(() => installSidechatAdapter(undefined)()).not.toThrow()
    expect(() => installSidechatAdapter({})()).not.toThrow()
    const dispose = vi.fn()
    const registerSidechatSurfaceAdapter = vi.fn(() => dispose)
    expect(installSidechatAdapter({ registerSidechatSurfaceAdapter })).toBe(dispose)
    expect(registerSidechatSurfaceAdapter).toHaveBeenCalledWith({ id: 'dsh-genui', mount: mountSidechatSurface })
  })
})
