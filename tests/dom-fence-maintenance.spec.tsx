// @vitest-environment jsdom
// Synthetic observer regressions for #321. These exercise real React roots and
// MutationObserver/rAF, not wall-clock benchmarks or a real DSH session.
import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installDomFenceRenderer } from '../src/client/dom-fence.tsx'

const spec = (content: string) => JSON.stringify({ items: [{ type: 'text', content }] })
const broken = '{"items":[{"type":"stat","value":"bad"'
const form = JSON.stringify({ items: [
  { type: 'input', id: 'name', label: 'Name' },
  { type: 'button', label: 'Confirm', action: 'confirm' },
] })
function fixture(index: number, raw = spec(`synthetic-${index}`), language = 'dsh-ui') {
  const row = document.createElement('div')
  row.setAttribute('data-chat-anchor-key', `synthetic-${index}`)
  row.setAttribute('data-chat-node-key', `synthetic-${index}`)
  row.setAttribute('data-chat-flow-kind', 'assistant-step')
  const block = document.createElement('div')
  block.className = 'md-code-block'
  const banner = document.createElement('div')
  banner.setAttribute('data-code-block-banner', '')
  const label = document.createElement('div')
  label.textContent = language
  banner.append(label)
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = raw
  pre.append(code)
  block.append(banner, pre)
  row.append(block)
  return { row, block, code, label }
}
function context(): Context {
  return { sessions: {
    list: { getSnapshot: () => ({ ids: ['synthetic-session'] }) },
    retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: 1 } }) }),
  } } as unknown as Context
}
const tick = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await tick() }
  expect(predicate()).toBe(true)
}
function replacement(f: ReturnType<typeof fixture>) {
  return f.block.nextElementSibling as HTMLElement | null
}
function diagnostic(f: ReturnType<typeof fixture>) {
  return f.block.previousElementSibling as HTMLElement | null
}
let slowSweep: (() => void) | undefined
beforeEach(() => {
  // jsdom's requestAnimationFrame is interval-backed. Suppress only the
  // five-second rotation and fifteen-second safety sweep; keep root watching
  // and observer/rAF behavior real.
  const realSetInterval = window.setInterval.bind(window)
  const realClearInterval = window.clearInterval.bind(window)
  const excludedMaintenance = 2147483647
  const excludedRotation = 2147483646
  vi.spyOn(window, 'setInterval').mockImplementation((handler, delay, ...args) => {
    if (delay === 15_000) {
      slowSweep = handler as () => void
      return excludedMaintenance
    }
    if (delay === 5_000) return excludedRotation
    return realSetInterval(handler, delay, ...args)
  })
  vi.spyOn(window, 'clearInterval').mockImplementation(id => {
    if (id !== excludedMaintenance && id !== excludedRotation) realClearInterval(id)
  })
})
afterEach(() => { cleanup(); document.body.innerHTML = ''; slowSweep = undefined; vi.restoreAllMocks() })

it.each([5, 25])('does not read unrelated mounted fences for one labelled body update (M=%s)', async count => {
  const fixtures = Array.from({ length: count }, (_, index) => fixture(index, index === 1 ? form : undefined))
  document.body.append(...fixtures.map(f => f.row))
  const composer = document.createElement('div')
  composer.setAttribute('data-composer-seat', '')
  const draft = document.createTextNode('synthetic draft')
  composer.append(draft)
  document.body.append(composer)
  const dispose = installDomFenceRenderer(context(), () => {})
  try {
    await until(() => fixtures.every(f => replacement(f)?.childElementCount))
    const input = replacement(fixtures[1])!.querySelector('input')!
    fireEvent.change(input, { target: { value: 'keep my input' } })
    await tick(80)
    const containers = fixtures.slice(1).map(replacement)
    const spies = fixtures.slice(1).map(f => vi.spyOn(f.block, 'querySelectorAll'))
    const bodyReads = fixtures.slice(1).map(f => vi.spyOn(f.code, 'textContent', 'get'))
    draft.data += ' composer only'
    await tick(80)
    expect(spies.every(spy => spy.mock.calls.length === 0)).toBe(true)
    expect(bodyReads.every(spy => spy.mock.calls.length === 0)).toBe(true)
    draft.data += ' mixed batch'
    fixtures[0].code.firstChild!.textContent = spec('changed')
    await until(() => replacement(fixtures[0])?.textContent?.includes('changed') === true)
    await tick(80)
    const counts = spies.map(spy => spy.mock.calls.length)
    const rawCounts = bodyReads.map(spy => spy.mock.calls.length)
    console.log('TRACK_321_MAINTENANCE', JSON.stringify({ mounts: count, untouchedSelectorCalls: counts.reduce((a, b) => a + b, 0), untouchedBodyReads: rawCounts.reduce((a, b) => a + b, 0), counts, rawCounts }))
    expect(rawCounts).toEqual(Array(count - 1).fill(0))
    expect(counts).toEqual(Array(count - 1).fill(0))
    fixtures.slice(1).forEach((f, i) => expect(replacement(f)).toBe(containers[i]))
    expect(replacement(fixtures[1])!.querySelector('input')).toBe(input)
    expect(input.value).toBe('keep my input')
  } finally { dispose() }
})

it('rechecks only the changed diagnostic and preserves unrelated diagnostic DOM', async () => {
  const changed = fixture(1, broken)
  const untouched = fixture(2, broken)
  document.body.append(changed.row, untouched.row)
  const dispose = installDomFenceRenderer(context(), () => {})
  try {
    await until(() => diagnostic(changed)?.childElementCount && diagnostic(untouched)?.childElementCount ? true : false)
    await tick(80)
    const existing = diagnostic(untouched)
    const reads = vi.spyOn(untouched.block, 'querySelectorAll')
    changed.code.firstChild!.textContent = spec('recovered')
    await until(() => replacement(changed)?.textContent?.includes('recovered') === true)
    await tick(80)
    expect(reads).not.toHaveBeenCalled()
    expect(diagnostic(untouched)).toBe(existing)
    expect(existing?.childElementCount).toBeGreaterThan(0)
    expect(changed.row.querySelector('.genui-dom-fence-diagnostic')).toBeNull()
  } finally { dispose() }
})

it('handles sibling insertion, removal and replacement without revisiting another row', async () => {
  const changed = fixture(1)
  const untouched = fixture(2, form)
  document.body.append(changed.row, untouched.row)
  const dispose = installDomFenceRenderer(context(), () => {})
  try {
    await until(() => replacement(changed)?.childElementCount && replacement(untouched)?.childElementCount ? true : false)
    await tick(80)
    const reads = vi.spyOn(untouched.block, 'querySelectorAll')
    const original = replacement(changed)
    const prose = document.createElement('p')
    prose.textContent = 'Keep this sibling visible'
    changed.block.after(prose)
    await until(() => replacement(changed) === original)
    const added = fixture(3)
    changed.row.append(added.block)
    await until(() => replacement(added)?.textContent?.includes('synthetic-3') === true)
    added.block.remove()
    await tick(80)
    expect(changed.row.querySelectorAll('.genui-dom-fence')).toHaveLength(1)
    const newBlock = fixture(4)
    changed.block.replaceWith(newBlock.block)
    await until(() => replacement(newBlock)?.textContent?.includes('synthetic-4') === true)
    expect(original?.isConnected).toBe(false)
    expect(changed.row.querySelectorAll('.genui-dom-fence')).toHaveLength(1)
    expect(prose.isConnected).toBe(true)
    expect(reads).not.toHaveBeenCalled()
  } finally { dispose() }
})

it('repairs moved and emptied roots before the next frame, preserving input and pending actions', async () => {
  const changed = fixture(1, form)
  const untouched = fixture(2)
  const failed = fixture(3, broken)
  const destination = document.createElement('div')
  document.body.append(changed.row, untouched.row, failed.row, destination)
  const send = vi.fn()
  const dispose = installDomFenceRenderer(context(), send)
  try {
    await until(() => replacement(changed)?.querySelector('input') != null && diagnostic(failed)?.childElementCount ? true : false)
    await tick(80)
    const container = replacement(changed)!
    const errorContainer = diagnostic(failed)!
    const errorChild = errorContainer.firstChild
    const input = container.querySelector('input')!
    fireEvent.change(input, { target: { value: 'retained' } })
    fireEvent.click(container.querySelector('button')!)
    const reads = vi.spyOn(untouched.block, 'querySelectorAll')
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length })
    container.replaceChildren()
    errorContainer.replaceChildren()
    await Promise.resolve()
    expect(container.querySelector('input')).toBe(input)
    expect(errorContainer.firstChild).toBe(errorChild)
    destination.append(changed.block, failed.block)
    await Promise.resolve()
    expect(replacement(changed)).toBe(container)
    expect(diagnostic(failed)).toBe(errorContainer)
    container.remove()
    errorContainer.remove()
    await Promise.resolve()
    expect(replacement(changed)).toBe(container)
    expect(diagnostic(failed)).toBe(errorContainer)
    expect(input.value).toBe('retained')
    expect(changed.block.style.display).toBe('none')
    changed.block.remove()
    failed.block.remove()
    await Promise.resolve()
    expect(container.isConnected).toBe(false)
    expect(errorContainer.isConnected).toBe(false)
    expect(reads).not.toHaveBeenCalled()
    await until(() => send.mock.calls.length === 1)
    expect(send).toHaveBeenCalledTimes(1)
  } finally { dispose() }
})

it('maintains a removed-only body change, language changes, and streaming settle without the slow sweep', async () => {
  const changed = fixture(1)
  const failed = fixture(2, broken)
  const streaming = fixture(3, '{"items":[{"type":"text","content":')
  streaming.row.setAttribute('data-streaming', '')
  document.body.append(changed.row, failed.row, streaming.row)
  const dispose = installDomFenceRenderer(context(), () => {})
  try {
    await until(() => replacement(changed)?.childElementCount && diagnostic(failed)?.childElementCount && replacement(streaming)?.childElementCount ? true : false)
    changed.code.replaceChildren()
    failed.label.textContent = 'json'
    streaming.row.removeAttribute('data-streaming')
    await until(() => !changed.block.hasAttribute('data-genui-rendered') && diagnostic(failed) === null && !streaming.block.hasAttribute('data-genui-rendered'))
    expect(changed.block.style.display).toBe('')
    expect(streaming.block.style.display).toBe('')
  } finally { dispose() }
})

it('repairs a host style reset immediately through the observer', async () => {
  const f = fixture(1)
  document.body.append(f.row)
  const dispose = installDomFenceRenderer(context(), () => {})
  try {
    await until(() => replacement(f)?.childElementCount ? true : false)
    await tick(80)
    const reads = vi.spyOn(f.block, 'querySelectorAll')
    f.block.style.display = ''
    await until(() => f.block.style.display === 'none')
    expect(reads).not.toHaveBeenCalled()
  } finally { dispose() }
})

it('retains a low-frequency full maintenance safety sweep', async () => {
  const f = fixture(1)
  document.body.append(f.row)
  const dispose = installDomFenceRenderer(context(), () => {})
  try {
    await until(() => replacement(f)?.childElementCount ? true : false)
    await tick(80)
    const reads = vi.spyOn(f.block, 'querySelectorAll')
    expect(slowSweep).toBeDefined()
    slowSweep?.()
    expect(reads).toHaveBeenCalled()
  } finally { dispose() }
})

it.each(['source', 'session'] as const)('invalidates existing mounts after a %s notification without a DOM mutation', async kind => {
  const f = fixture(1, spec('source-backed'), 'Code')
  document.body.append(f.row)
  let currentSession = 'session-a'
  let sourceReady = false
  let sourceUpdate: (() => void) | undefined
  let sessionUpdate: (() => void) | undefined
  const releases: string[] = []
  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => ({ ids: [currentSession] }),
        subscribe: (listener: () => void) => { sessionUpdate = listener; return () => { sessionUpdate = undefined } },
      },
      retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: 1 } }) }),
    },
    get: () => ({ binding: (id: string) => ({ target: () => ({
      getSnapshot: () => ({ nodes: { get: () => sourceReady ? { kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: `\`\`\`json\n${spec('source-backed')}\n\`\`\`` }] } } : undefined } }),
      subscribe: (listener: () => void) => { sourceUpdate = listener; return () => { releases.push(id) } },
    }) }) }),
  } as unknown as Context
  const dispose = installDomFenceRenderer(ctx, () => {})
  try {
    await until(() => replacement(f)?.childElementCount ? true : false)
    sourceReady = true
    if (kind === 'session') { currentSession = 'session-b'; sessionUpdate?.() }
    else sourceUpdate?.()
    await until(() => !f.block.hasAttribute('data-genui-rendered'))
    expect(f.block.style.display).toBe('')
    if (kind === 'session') expect(releases).toContain('session-a')
  } finally { dispose() }
})

it('unmounts a detached subtree of mounts and diagnostics without reading another row', async () => {
  const mounted = fixture(1, form)
  const failed = fixture(2, broken)
  const untouched = fixture(3)
  const wrapper = document.createElement('section')
  wrapper.append(mounted.row, failed.row)
  document.body.append(wrapper, untouched.row)
  const dispose = installDomFenceRenderer(context(), () => {})
  try {
    await until(() => replacement(mounted)?.childElementCount && diagnostic(failed)?.childElementCount && replacement(untouched)?.childElementCount ? true : false)
    await tick(80)
    const oldMount = replacement(mounted)!
    const oldDiagnostic = diagnostic(failed)!
    const reads = vi.spyOn(untouched.block, 'querySelectorAll')
    wrapper.remove()
    await Promise.resolve()
    expect(mounted.block.style.display).toBe('')
    expect(mounted.block.hasAttribute('data-genui-rendered')).toBe(false)
    expect(oldMount.parentNode).toBeNull()
    expect(oldDiagnostic.parentNode).toBeNull()
    expect(wrapper.querySelector('.genui-dom-fence, .genui-dom-fence-diagnostic')).toBeNull()
    document.body.append(wrapper)
    await until(() => replacement(mounted)?.querySelector('input') != null && diagnostic(failed)?.childElementCount ? true : false)
    expect(replacement(mounted)).not.toBe(oldMount)
    expect(diagnostic(failed)).not.toBe(oldDiagnostic)
    expect(reads).not.toHaveBeenCalled()
  } finally { dispose() }
})

it('invalidates an existing source-backed diagnostic on a session notification', async () => {
  const failed = fixture(1, broken, 'Code')
  document.body.append(failed.row)
  let currentSession = 'session-a'
  let sessionUpdate: (() => void) | undefined
  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => ({ ids: [currentSession] }),
        subscribe: (listener: () => void) => { sessionUpdate = listener; return () => {} },
      },
      retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: 1 } }) }),
    },
    get: () => ({ binding: (id: string) => ({ target: () => ({
      getSnapshot: () => ({ nodes: { get: () => ({ kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: `\`\`\`${id === 'session-a' ? 'dsh-ui' : 'json'}\n${broken}\n\`\`\`` }] } }) } }),
      subscribe: () => () => {},
    }) }) }),
  } as unknown as Context
  const dispose = installDomFenceRenderer(ctx, () => {})
  try {
    await until(() => diagnostic(failed)?.childElementCount ? true : false)
    currentSession = 'session-b'
    sessionUpdate?.()
    await until(() => diagnostic(failed) === null)
    expect(failed.block.style.display).toBe('')
    expect(failed.block.hasAttribute('data-genui-rendered')).toBe(false)
  } finally { dispose() }
})
