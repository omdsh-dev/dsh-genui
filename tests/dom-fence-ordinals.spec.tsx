// @vitest-environment jsdom
import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installDomFenceRenderer } from '../src/client/dom-fence.tsx'
import * as fenceRender from '../src/client/fence-render.tsx'
import { clearSessionPanel } from '../src/client/panel-store.ts'

const spec = (content: string) => JSON.stringify({ items: [{ type: 'text', content }] })

function fixture(index: number, streaming = false) {
  const row = document.createElement('div')
  row.dataset.chatFlowKind = 'assistant-step'
  if (streaming) row.dataset.streaming = ''
  const block = document.createElement('div')
  block.className = 'md-code-block'
  const banner = document.createElement('div')
  banner.dataset.codeBlockBanner = ''
  const label = document.createElement('div')
  label.textContent = 'dsh-ui'
  banner.append(label)
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = spec(`fixture-${index}`)
  pre.append(code)
  block.append(banner, pre)
  row.append(block)
  return { row, block, code, label }
}

function context(source = false) {
  let notifySource: (() => void) | undefined
  const ctx = {
    sessions: {
      list: { getSnapshot: () => ({ ids: ['ordinal-session'] }) },
      retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: 1 } }) }),
    },
    ...(source ? { get: () => ({ binding: () => ({ target: () => ({
      getSnapshot: () => ({ nodes: { get: () => undefined } }),
      subscribe: (listener: () => void) => { notifySource = listener; return () => { notifySource = undefined } },
    }) }) }) } : {}),
  } as unknown as Context
  return { ctx, notifySource: () => notifySource?.() }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 30))
async function until(predicate: () => boolean) {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return
    await tick()
  }
  expect(predicate()).toBe(true)
}
const contentOf = (f: ReturnType<typeof fixture>) => f.block.nextElementSibling?.textContent ?? ''

beforeEach(() => {
  // Keep observer, root watching and rAF real; hold only the periodic
  // five-second rotation and fifteen-second full maintenance passes.
  const setInterval = window.setInterval.bind(window)
  const clearInterval = window.clearInterval.bind(window)
  const excludedMaintenance = 2147483647
  const excludedRotation = 2147483646
  vi.spyOn(window, 'setInterval').mockImplementation((handler, delay, ...args) => {
    if (delay === 15_000) return excludedMaintenance
    if (delay === 5_000) return excludedRotation
    return setInterval(handler, delay, ...args)
  })
  vi.spyOn(window, 'clearInterval').mockImplementation(id => {
    if (id !== excludedMaintenance && id !== excludedRotation) clearInterval(id)
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  clearSessionPanel('ordinal-session')
  localStorage.clear()
  vi.restoreAllMocks()
})

it('discovers the document once when mounting many anchorless fences', async () => {
  const fences = Array.from({ length: 12 }, (_, index) => fixture(index))
  document.body.append(...fences.map(f => f.row))
  const queries = vi.spyOn(document, 'querySelectorAll')
  const dispose = installDomFenceRenderer(context().ctx, () => {})
  try {
    await until(() => fences.every(f => contentOf(f).includes('fixture-')))
    expect(queries.mock.calls.filter(([selector]) => selector === 'span')).toHaveLength(1)
  } finally { dispose() }
})

it.each([false, true])('does not query the document as an anchorless body grows (source notifications: %s)', async source => {
  const fences = Array.from({ length: 12 }, (_, index) => fixture(index, index === 11))
  document.body.append(...fences.map(f => f.row))
  const active = fences[11]!
  const { ctx, notifySource } = context(source)
  const dispose = installDomFenceRenderer(ctx, () => {})
  try {
    await until(() => fences.every(f => contentOf(f).includes('fixture-')))
    await tick()
    const queries = vi.spyOn(document, 'querySelectorAll')
    for (let index = 0; index < 3; index++) {
      active.code.firstChild!.textContent = spec(`streamed-${index}`)
      if (source) notifySource()
      await until(() => contentOf(active).includes(`streamed-${index}`))
    }
    expect(queries.mock.calls.map(([selector]) => selector)).toEqual([])
  } finally { dispose() }
})

it('does not query document candidates or rows when a settled anchorless body changes', async () => {
  const fences = [fixture(0), fixture(1)]
  document.body.append(...fences.map(f => f.row))
  const dispose = installDomFenceRenderer(context().ctx, () => {})
  try {
    await until(() => fences.every(f => contentOf(f).includes('fixture-')))
    await tick()
    const queries = vi.spyOn(document, 'querySelectorAll')
    fences[1]!.code.firstChild!.textContent = spec('settled-update')
    await until(() => contentOf(fences[1]!).includes('settled-update'))
    expect(queries.mock.calls.map(([selector]) => selector)).toEqual([])
  } finally { dispose() }
})

it('ignores reader-word insertions and syntax-highlighting spans during body growth', async () => {
  const active = fixture(1, true)
  const reasoning = document.createElement('div')
  reasoning.dataset.chatGroupPart = 'reasoning'
  document.body.append(reasoning, active.row)
  const dispose = installDomFenceRenderer(context().ctx, () => {})
  try {
    await until(() => contentOf(active).includes('fixture-1'))
    await tick()
    const queries = vi.spyOn(document, 'querySelectorAll')
    for (let index = 0; index < 3; index++) {
      const word = document.createElement('span')
      word.dataset.readerWord = ''
      word.textContent = `word-${index}`
      reasoning.append(word)
      const highlight = document.createElement('span')
      highlight.textContent = spec(`highlighted-${index}`)
      active.code.replaceChildren(highlight)
      await until(() => contentOf(active).includes(`highlighted-${index}`))
    }
    expect(queries.mock.calls).toEqual([])
  } finally { dispose() }
})

function observeSource(f: ReturnType<typeof fixture>) {
  const render = vi.spyOn(fenceRender, 'renderResolvedFenceNode')
  return () => render.mock.calls.findLast(([raw]) => raw === f.code.textContent)?.[2]?.source
}

it('keeps global ordinals and row order correct after history insertion, removal and reordering', async () => {
  const first = fixture(1)
  const active = fixture(2)
  document.body.append(first.row, active.row)
  const source = observeSource(active)
  const dispose = installDomFenceRenderer(context().ctx, () => {})
  const refresh = () => { active.code.firstChild!.textContent += ' ' }
  try {
    await until(() => source()?.id === 'dom:unknown:2')
    expect(source()?.order).toEqual([1, 0, 2])
    const history = fixture(0)
    document.body.prepend(history.row)
    refresh()
    await until(() => source()?.id === 'dom:unknown:3')
    expect(source()?.order).toEqual([2, 0, 3])
    history.row.remove()
    refresh()
    await until(() => source()?.id === 'dom:unknown:2')
    expect(source()?.order).toEqual([1, 0, 2])
    document.body.append(first.row)
    refresh()
    await until(() => source()?.id === 'dom:unknown:1')
    expect(source()?.order).toEqual([0, 0, 1])
  } finally { dispose() }
})

it('recomputes settled membership and preserves identity-less streaming renders', async () => {
  const first = fixture(1, true)
  const active = fixture(2)
  document.body.append(first.row, active.row)
  const source = observeSource(active)
  const render = vi.spyOn(fenceRender, 'renderResolvedFenceNode')
  const dispose = installDomFenceRenderer(context().ctx, () => {})
  try {
    await until(() => source()?.id === 'dom:unknown:1')
    expect(render.mock.calls.find(([raw]) => raw === first.code.textContent)?.[2]?.source).toBeUndefined()
    first.row.removeAttribute('data-streaming')
    active.code.firstChild!.textContent += ' '
    await until(() => source()?.id === 'dom:unknown:2')
    first.row.dataset.streaming = ''
    active.code.firstChild!.textContent += ' '
    await until(() => source()?.id === 'dom:unknown:1')
  } finally { dispose() }
})

it('invalidates a changed banner and generic-body eligibility without stale ordinals', async () => {
  const first = fixture(1)
  const active = fixture(2)
  document.body.append(first.row, active.row)
  const source = observeSource(active)
  const dispose = installDomFenceRenderer(context().ctx, () => {})
  const refresh = () => { active.code.firstChild!.textContent += ' ' }
  try {
    await until(() => source()?.id === 'dom:unknown:2')
    first.label.textContent = 'json'
    refresh()
    await until(() => source()?.id === 'dom:unknown:1')
    first.label.textContent = 'Code'
    refresh()
    await until(() => source()?.id === 'dom:unknown:2')
    first.code.firstChild!.textContent = 'not a GenUI spec'
    refresh()
    await until(() => source()?.id === 'dom:unknown:1')
    first.code.firstChild!.textContent = spec('generic recovered')
    refresh()
    await until(() => source()?.id === 'dom:unknown:2')
  } finally { dispose() }
})

it('updates tag-text membership when the same span becomes complete or ceases to be a fence', async () => {
  const first = document.createElement('span')
  first.textContent = '<dsh-ui>'
  const active = fixture(2)
  document.body.append(first, active.row)
  const source = observeSource(active)
  const dispose = installDomFenceRenderer(context().ctx, () => {})
  const refresh = () => { active.code.firstChild!.textContent += ' ' }
  try {
    await until(() => source()?.id === 'dom:unknown:1')
    first.textContent = `<dsh-ui>${spec('tag text')}</dsh-ui>`
    refresh()
    await until(() => source()?.id === 'dom:unknown:2')
    first.textContent = 'ordinary span'
    refresh()
    await until(() => source()?.id === 'dom:unknown:1')
  } finally { dispose() }
})

it('reclassifies source-backed language while retaining the document topology', async () => {
  const first = fixture(1)
  first.label.textContent = 'Code'
  first.row.dataset.chatNodeKey = 'source-first'
  const active = fixture(2)
  document.body.append(first.row, active.row)
  let ready = false
  let update: (() => void) | undefined
  const ctx = context().ctx
  Object.assign(ctx, { get: () => ({ binding: () => ({ target: () => ({
    getSnapshot: () => ({ nodes: { get: () => ready ? {
      kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: `\`\`\`json\n${first.code.textContent}\n\`\`\`` }] },
    } : undefined } }),
    subscribe: (listener: () => void) => { update = listener; return () => {} },
  }) }) }) })
  const source = observeSource(active)
  const dispose = installDomFenceRenderer(ctx, () => {})
  try {
    await until(() => source()?.id === 'dom:unknown:2')
    await tick()
    const queries = vi.spyOn(document, 'querySelectorAll')
    ready = true
    update?.()
    active.code.firstChild!.textContent += ' '
    await until(() => source()?.id === 'dom:unknown:1')
    expect(first.block.hasAttribute('data-genui-rendered')).toBe(false)
    expect(queries.mock.calls).toEqual([])
  } finally { dispose() }
})

it('restores distinct durable input state after disposing and reinstalling anchorless roots', async () => {
  const first = fixture(1)
  const second = fixture(2)
  const form = JSON.stringify({ items: [{ type: 'input', id: 'name', label: 'Name' }] })
  first.code.textContent = form
  second.code.textContent = form
  document.body.append(first.row, second.row)
  let dispose = installDomFenceRenderer(context().ctx, () => {})
  try {
    await until(() => second.block.nextElementSibling?.querySelector('input') != null)
    const input = second.block.nextElementSibling!.querySelector('input')!
    fireEvent.change(input, { target: { value: 'second only' } })
    // Production saves are debounced; disposing before the write cancels it.
    await until(() => Object.values(localStorage).some(value => value.includes('second only')))
    dispose()
    dispose = installDomFenceRenderer(context().ctx, () => {})
    await until(() => second.block.nextElementSibling?.querySelector('input')?.value === 'second only')
    expect(first.block.nextElementSibling?.querySelector('input')?.value).toBe('')
  } finally { dispose() }
})

it.each(['move', 'attribute'] as const)('drops excluded tag-text candidates after an ancestor %s', async change => {
  const row = document.createElement('div')
  row.dataset.chatFlowKind = 'assistant-step'
  const wrapper = document.createElement('div')
  const first = document.createElement('span')
  const second = document.createElement('span')
  first.textContent = `<dsh-ui>${spec('first')}</dsh-ui>`
  second.textContent = `<dsh-ui>${spec('second')}</dsh-ui>`
  wrapper.append(first)
  row.append(wrapper, second)
  document.body.append(row)
  const render = vi.spyOn(fenceRender, 'renderResolvedFenceNode')
  const key = (text: string) => render.mock.calls.findLast(([raw]) => raw.includes(text))?.[1]
  const dispose = installDomFenceRenderer(context().ctx, () => {})
  try {
    await until(() => key('second') === 'dom:unknown:2')
    if (change === 'move') {
      const reasoning = document.createElement('div')
      reasoning.dataset.chatGroupPart = 'reasoning'
      row.append(reasoning)
      reasoning.append(wrapper)
    } else wrapper.dataset.chatGroupPart = 'reasoning'
    second.firstChild!.textContent = `<dsh-ui>${spec('second-updated')}</dsh-ui>`
    await until(() => key('second-updated') === 'dom:unknown:1')
    const third = document.createElement('span')
    third.textContent = `<dsh-ui>${spec('third')}</dsh-ui>`
    row.append(third)
    await until(() => key('third') === 'dom:unknown:2')
    expect(key('third')).not.toBe(key('second-updated'))
  } finally { dispose() }
})

it('refreshes cached row order after host routing attributes change', async () => {
  const first = fixture(1)
  const active = fixture(2)
  first.row.removeAttribute('data-chat-flow-kind')
  document.body.append(first.row, active.row)
  const source = observeSource(active)
  const dispose = installDomFenceRenderer(context().ctx, () => {})
  try {
    await until(() => source()?.order[0] === 0)
    first.row.dataset.chatFlowKind = 'assistant-step'
    active.code.firstChild!.textContent += ' '
    await until(() => source()?.order[0] === 1)
    active.row.dataset.chatAnchorKey = 'assistant:7:step:3'
    active.code.firstChild!.textContent += ' '
    await until(() => source()?.id === 'dom:assistant:7:step:3:1')
  } finally { dispose() }
})

it('invalidates a code surface moved inside a wrapper into an excluded plugin subtree', async () => {
  const first = fixture(1)
  const active = fixture(2)
  const wrapper = document.createElement('section')
  wrapper.append(first.block)
  first.row.append(wrapper)
  document.body.append(first.row, active.row)
  const source = observeSource(active)
  const dispose = installDomFenceRenderer(context().ctx, () => {})
  try {
    await until(() => source()?.id === 'dom:unknown:2')
    const excluded = document.createElement('div')
    excluded.className = 'genui-dom-fence'
    document.body.append(excluded)
    excluded.append(wrapper)
    active.code.firstChild!.textContent += ' '
    await until(() => source()?.id === 'dom:unknown:1')
  } finally { dispose() }
})

it.each(['text', 'replacement'] as const)('discovers an unknown-class surface after a banner %s change', async change => {
  const first = fixture(1), active = fixture(2)
  first.block.className = 'unknown-host-surface'
  first.label.textContent = 'json'
  document.body.append(first.row, active.row)
  const source = observeSource(active)
  const dispose = installDomFenceRenderer(context().ctx, () => {})
  try {
    await until(() => source()?.id === 'dom:unknown:1')
    if (change === 'text') first.label.firstChild!.textContent = 'dsh-ui'
    else {
      const label = document.createElement('div')
      label.textContent = 'dsh-ui'
      first.label.replaceWith(label)
    }
    active.code.firstChild!.textContent += ' '
    await until(() => source()?.id === 'dom:unknown:2')
  } finally { dispose() }
})

it('starts fresh document ordinals when switching sessions without replacing the active fence', async () => {
  const first = fixture(1)
  const active = fixture(2)
  document.body.append(first.row, active.row)
  let session = 'ordinal-session'
  let update: (() => void) | undefined
  const ctx = context().ctx
  Object.assign(ctx.sessions.list, {
    getSnapshot: () => ({ ids: [session] }),
    subscribe: (listener: () => void) => { update = listener; return () => {} },
  })
  const source = observeSource(active)
  const dispose = installDomFenceRenderer(ctx, () => {})
  try {
    await until(() => source()?.id === 'dom:unknown:2')
    session = 'ordinal-session-next'
    first.row.remove()
    update?.()
    active.code.firstChild!.textContent += ' '
    await until(() => source()?.id === 'dom:unknown:1')
    const render = vi.mocked(fenceRender.renderResolvedFenceNode)
    expect(render.mock.calls.findLast(([raw]) => raw === active.code.textContent)?.[2]?.sessionId).toBe(session)
  } finally { dispose(); clearSessionPanel(session) }
})
