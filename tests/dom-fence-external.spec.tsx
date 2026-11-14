import { afterEach, expect, it } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import { installDomFenceRenderer } from '../src/client/dom-fence.tsx'

afterEach(() => { cleanup(); document.body.innerHTML = '' })

async function outsideFence(initial = false, direct = false) {
  const transcript = document.createElement('div')
  transcript.dataset.chatFlow = ''
  document.body.append(transcript)
  const ctx = { sessions: {
    list: { getSnapshot: () => ({ ids: ['review'] }) },
    retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: 1 } }) }),
  } } as unknown as Context
  const fixture = document.createElement('div')
  const block = document.createElement('div')
  block.className = 'md-code-block'
  const banner = document.createElement('div')
  const label = document.createElement('div')
  label.textContent = 'dsh-ui'
  banner.append(label)
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = JSON.stringify({items:[{type:'text', content:'original'}]})
  pre.append(code); block.append(banner, pre); fixture.append(block)
  const projection = direct ? block : fixture
  if (initial) document.body.prepend(projection)
  const dispose = installDomFenceRenderer(ctx, () => {})
  if (!initial) document.body.prepend(projection)
  const scope = direct ? document.body : fixture
  await waitFor(() => expect(scope.querySelector('.genui-dom-fence')?.textContent).toContain('original'))
  return { dispose, fixture: scope, block, code }
}

it('continues updating a discovered external fence', async () => {
  const f = await outsideFence()
  try {
    f.code.textContent = JSON.stringify({items:[{type:'text', content:'updated'}]})
    await waitFor(() => expect(f.fixture.querySelector('.genui-dom-fence')?.textContent).toContain('updated'))
  } finally { f.dispose() }
})

it.each([false, true])('keeps initially mounted external fences live (direct body child: %s)', async direct => {
  const f = await outsideFence(true, direct)
  try {
    f.code.textContent = JSON.stringify({items:[{type:'text', content:'updated'}]})
    await waitFor(() => expect(f.fixture.querySelector('.genui-dom-fence')?.textContent).toContain('updated'))
    f.block.style.display = ''
    await waitFor(() => expect(f.block.style.display).toBe('none'))
  } finally { f.dispose() }
})

it('keeps a known external fence live after it moves to another connected wrapper', async () => {
  const f = await outsideFence()
  const next = document.createElement('section')
  document.body.append(next)
  try {
    next.append(f.block, f.block.nextElementSibling!)
    await new Promise(resolve => setTimeout(resolve, 300))
    f.code.textContent = JSON.stringify({items:[{type:'text', content:'moved'}]})
    await waitFor(() => expect(next.querySelector('.genui-dom-fence')?.textContent).toContain('moved'))
  } finally { f.dispose() }
})

it('observes external streaming completion and preserves trailing explanation text', async () => {
  const f = await outsideFence()
  try {
    f.fixture.setAttribute('data-streaming', '')
    f.code.textContent += '\nExplanation outside JSON'
    await waitFor(() => expect(f.block.style.display).toBe('none'))
    f.fixture.removeAttribute('data-streaming')
    await waitFor(() => expect(f.fixture.querySelector('[role=alert]')).not.toBeNull())
    expect(f.block.style.display).not.toBe('none')
    expect(f.block.textContent).toContain('Explanation outside JSON')
    f.code.textContent = JSON.stringify({items:[{type:'text', content:'corrected'}]})
    await waitFor(() => expect(f.fixture.querySelector('.genui-dom-fence')?.textContent).toContain('corrected'))
  } finally { f.dispose() }
})

it('observes streaming completion above an initially mounted projection wrapper', async () => {
  const f = await outsideFence(true)
  const section = document.createElement('section')
  section.setAttribute('data-streaming', '')
  f.fixture.replaceWith(section)
  section.append(f.fixture)
  try {
    f.code.textContent = '{"items":[{"type":"text","content":'
    await waitFor(() => expect(f.fixture.querySelector('[data-genui-skeleton]')).not.toBeNull())
    section.removeAttribute('data-streaming')
    await waitFor(() => expect(f.fixture.querySelector('[role=alert]')).not.toBeNull())
    expect(f.block.style.display).not.toBe('none')
  } finally { f.dispose() }
})

it('repairs a wiped external fence without leaving hidden source and blank UI', async () => {
  const f = await outsideFence()
  const container = f.fixture.querySelector('.genui-dom-fence')!
  const children = Array.from(container.childNodes)
  try {
    container.replaceChildren()
    await waitFor(() => expect(container.childElementCount).toBeGreaterThan(0))
    expect(container.textContent).toContain('original')
  } finally {
    if (container.childNodes.length === 0) container.append(...children)
    f.dispose()
  }
})
