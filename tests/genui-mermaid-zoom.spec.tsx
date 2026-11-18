// @vitest-environment jsdom
/**
 * Mermaid 节点的点击放大验收。
 *
 * 断言的是用户可见的 DOM 与几何结果，不是内部状态：完成态才有入口、
 * 打开后弹层里确实是矢量图、滚轮/拖拽改变 transform、关闭后焦点回去。
 * renderMermaid 被 mock，既避开 jsdom 没有 getBBox 的问题，也用来守护
 * 「弹层不得触发第二次 Mermaid 渲染」这条性能红线（上游 #443）。
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { renderMermaidMock } = vi.hoisted(() => ({ renderMermaidMock: vi.fn() }))
vi.mock('../src/client/mermaid-lazy.ts', () => ({ renderMermaid: renderMermaidMock }))

import { MermaidNode } from '../src/client/blocks/advanced.tsx'
import type { GenuiMermaid } from '../src/client/spec.ts'

const SVG_A = '<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg"><g><rect x="10" y="10" width="100" height="40"/><text x="20" y="35">A</text></g></svg>'
const SVG_B = '<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg"><g><rect x="10" y="10" width="100" height="40"/><text x="20" y="35">B</text></g></svg>'
const SVG_LINK = '<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg"><a href="https://example.com/"><rect x="10" y="10" width="100" height="40"/><text x="20" y="35">A</text></a><circle cx="300" cy="100" r="20"/></svg>'

const node = (code: string): GenuiMermaid => ({ type: 'mermaid', code })

afterEach(() => {
  cleanup()
  renderMermaidMock.mockReset()
  vi.restoreAllMocks()
})

async function ready(svg: string = SVG_A) {
  renderMermaidMock.mockResolvedValue(svg)
  const view = render(<MermaidNode node={node('graph TD\nA --> B')} />)
  await waitFor(() => expect(view.container.querySelector('[data-genui-mermaid]')).not.toBeNull())
  return view
}

function opener(view: ReturnType<typeof render>): HTMLButtonElement {
  const button = view.container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
  if (button === null) throw new Error('放大入口缺失')
  return button
}

function dialog(view: ReturnType<typeof render>): HTMLDialogElement {
  const element = view.container.querySelector('dialog')
  if (element === null) throw new Error('预览对话框缺失')
  return element
}

function surface(view: ReturnType<typeof render>): HTMLElement {
  const element = view.container.querySelector<HTMLElement>('[data-genui-mermaid-surface]')
  if (element === null) throw new Error('缩放图层缺失')
  return element
}

describe('Mermaid click-to-zoom', () => {
  it('只在图表渲染完成后提供放大入口，失败态不提供', async () => {
    renderMermaidMock.mockResolvedValue(SVG_A)
    const loading = render(<MermaidNode node={node('graph TD\nA --> B')} />)
    expect(loading.container.querySelector('button[aria-haspopup="dialog"]')).toBeNull()
    await waitFor(() => expect(loading.container.querySelector('button[aria-haspopup="dialog"]')).not.toBeNull())
    expect(loading.container.querySelector('button[aria-haspopup="dialog"]')?.getAttribute('aria-label')).toBe('放大图表')
    expect(loading.container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 400 200')
    loading.unmount()

    renderMermaidMock.mockRejectedValue(new Error('bad syntax'))
    const failed = render(<MermaidNode node={node('bad')} />)
    await waitFor(() => expect(failed.container.textContent).toContain('图表渲染失败，已显示源码'))
    expect(failed.container.querySelector('button[aria-haspopup="dialog"]')).toBeNull()
    expect(failed.container.querySelector('dialog')).toBeNull()
  })

  it('点击后在原生对话框显示同一份 SVG，不重跑 Mermaid，打开前不挂载副本', async () => {
    const view = await ready()
    const pane = dialog(view)
    expect(pane.querySelector('svg')).toBeNull()
    expect(pane.hasAttribute('open')).toBe(false)

    const button = opener(view)
    fireEvent.click(button)

    expect(pane.hasAttribute('open')).toBe(true)
    expect(pane.querySelector('svg')?.outerHTML).toContain('viewBox="0 0 400 200"')
    expect(pane.querySelector('svg')?.textContent).toContain('A')
    expect(renderMermaidMock).toHaveBeenCalledTimes(1)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭图表预览')
  })

  it('Esc、关闭按钮与遮罩点击都能关闭，并把焦点还给放大按钮', async () => {
    const view = await ready()
    const button = opener(view)
    const pane = dialog(view)
    fireEvent.click(button)

    fireEvent(pane, new Event('cancel', { cancelable: true }))
    expect(pane.hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(button)

    fireEvent.click(button)
    fireEvent.click(pane.querySelector<HTMLButtonElement>('button[aria-label="关闭图表预览"]')!)
    expect(pane.hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(button)

    fireEvent.click(button)
    // jsdom 的 dialog 没有布局，坐标取框外来模拟点在 ::backdrop 上。
    fireEvent.click(pane, { clientX: -1, clientY: -1 })
    expect(pane.hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(button)
  })

  it('滚轮缩放改变比例并阻止滚动透传', async () => {
    const view = await ready()
    fireEvent.click(opener(view))
    const pane = dialog(view)
    const stage = pane.querySelector<HTMLElement>('[data-genui-mermaid-stage]')!
    const layer = surface(view)

    expect(layer.style.transform).toContain('scale(1)')
    const wheel = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true })
    fireEvent(stage, wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(layer.style.transform).not.toContain('scale(1)')

    const wheelOut = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
    fireEvent(stage, wheelOut)
    expect(layer.style.transform).toContain('scale(1)')
  })

  it('工具栏放大、缩小、重置回到 1 倍零位移', async () => {
    const view = await ready()
    fireEvent.click(opener(view))
    const pane = dialog(view)
    const layer = surface(view)

    fireEvent.click(pane.querySelector<HTMLButtonElement>('button[aria-label="放大"]')!)
    expect(layer.style.transform).toContain('scale(1.25)')
    fireEvent.click(pane.querySelector<HTMLButtonElement>('button[aria-label="缩小"]')!)
    expect(layer.style.transform).toContain('scale(1)')
    fireEvent.click(pane.querySelector<HTMLButtonElement>('button[aria-label="放大"]')!)
    fireEvent.click(pane.querySelector<HTMLButtonElement>('button[aria-label="重置"]')!)
    expect(layer.style.transform).toContain('scale(1)')
    expect(layer.style.transform).toContain('translate(0px, 0px)')
  })

  it('拖拽平移改变位移', async () => {
    const view = await ready()
    fireEvent.click(opener(view))
    const pane = dialog(view)
    const stage = pane.querySelector<HTMLElement>('[data-genui-mermaid-stage]')!
    const layer = surface(view)

    fireEvent.pointerDown(stage, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(stage, { clientX: 140, clientY: 130, pointerId: 1 })
    fireEvent.pointerUp(stage, { clientX: 140, clientY: 130, pointerId: 1 })

    expect(layer.style.transform).toContain('translate(40px, 30px)')
  })

  it('图里的链接与选中的文字都不触发放大，点击空白处才放大', async () => {
    renderMermaidMock.mockResolvedValue(SVG_LINK)
    const view = render(<MermaidNode node={node('graph TD\nA --> B')} />)
    await waitFor(() => expect(view.container.querySelector('[data-genui-mermaid]')).not.toBeNull())
    const diagram = view.container.querySelector<HTMLElement>('[data-genui-mermaid] svg')!.parentElement!

    fireEvent.click(view.container.querySelector('a[href]')!, { bubbles: true })
    expect(dialog(view).hasAttribute('open')).toBe(false)

    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(view.container.querySelector('text')!)
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent.click(diagram, { bubbles: true })
    expect(dialog(view).hasAttribute('open')).toBe(false)
    selection?.removeAllRanges()

    fireEvent.click(view.container.querySelector('circle')!, { bubbles: true })
    expect(dialog(view).hasAttribute('open')).toBe(true)
  })

  it('迟到的 close 事件不会关掉刚重新打开的弹层', async () => {
    const view = await ready()
    const button = opener(view)
    const pane = dialog(view)
    fireEvent.click(button)
    fireEvent.click(pane.querySelector<HTMLButtonElement>('button[aria-label="关闭图表预览"]')!)
    expect(pane.hasAttribute('open')).toBe(false)

    fireEvent.click(button)
    expect(pane.hasAttribute('open')).toBe(true)
    // 上一次 close() 排队派发的事件晚到时，dialog 已经重新打开。
    fireEvent(pane, new Event('close'))
    expect(pane.hasAttribute('open')).toBe(true)
  })

  it('源码变化时收起旧图，弹层不自动重开，新图渲染完成后才再次提供放大入口', async () => {
    const view = await ready()
    const button = opener(view)
    fireEvent.click(button)
    expect(dialog(view).querySelector('svg')?.textContent).toContain('A')

    renderMermaidMock.mockResolvedValue(SVG_B)
    view.rerender(<MermaidNode node={node('graph TD\nC --> D')} />)
    expect(view.container.querySelector('button[aria-haspopup="dialog"]')).toBeNull()
    expect(view.container.querySelector('dialog')).toBeNull()

    await waitFor(() => expect(view.container.querySelector('button[aria-haspopup="dialog"]')).not.toBeNull())
    expect(dialog(view).hasAttribute('open')).toBe(false)
    expect(dialog(view).querySelector('svg')).toBeNull()
    fireEvent.click(opener(view))
    expect(dialog(view).querySelector('svg')?.textContent).toContain('B')
  })
})
