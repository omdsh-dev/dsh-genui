// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { renderMermaidMock } = vi.hoisted(() => ({ renderMermaidMock: vi.fn() }))
vi.mock('../src/client/mermaid-lazy.ts', () => ({ renderMermaid: renderMermaidMock }))

import { MermaidNode } from '../src/client/blocks/advanced.tsx'
import type { GenuiMermaid } from '../src/client/spec.ts'

afterEach(() => {
  cleanup()
  renderMermaidMock.mockReset()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (window as unknown as { __GenuiAssets__?: unknown }).__GenuiAssets__
  document.body.removeAttribute('style')
})

const node = (code: string): GenuiMermaid => ({ type: 'mermaid', code })

describe('Mermaid render state', () => {
  it('passes the final diagram element to the renderer for font measurement', async () => {
    renderMermaidMock.mockResolvedValue('<svg/>')
    const view = render(<MermaidNode node={node('graph TD\nA --> B')} />)
    await waitFor(() => expect(renderMermaidMock).toHaveBeenCalledTimes(1))
    expect(renderMermaidMock.mock.calls[0]![1].target).toBe(view.container.firstElementChild)
  })

  it('refreshes a mounted diagram when its local font changes', async () => {
    renderMermaidMock.mockResolvedValue('<svg/>')
    const view = render(<MermaidNode node={node('graph TD\nA --> B')} />)
    await waitFor(() => expect(renderMermaidMock).toHaveBeenCalledTimes(1))
    const target = view.container.firstElementChild as HTMLElement
    await act(async () => { target.style.fontFamily = 'monospace' })
    await waitFor(() => expect(renderMermaidMock).toHaveBeenCalledTimes(2))
  })

  it('refreshes when the diagram card overrides its palette', async () => {
    renderMermaidMock.mockResolvedValue('<svg/>')
    const view = render(<MermaidNode node={node('graph TD\nA --> B')} />)
    await waitFor(() => expect(renderMermaidMock).toHaveBeenCalledTimes(1))
    const target = view.container.firstElementChild as HTMLElement
    await act(async () => { target.style.setProperty('--dsw-alias-bg-layer-2', 'rgba(44,44,46,.4)') })
    await waitFor(() => expect(renderMermaidMock).toHaveBeenCalledTimes(2))
  })

  it('refreshes when a theme stylesheet changes without a body attribute change', async () => {
    renderMermaidMock.mockResolvedValue('<svg/>')
    const sheet = document.createElement('style')
    sheet.textContent = 'body { --dsw-alias-bg-layer-2: #2c2c2e; }'
    document.head.append(sheet)
    try {
      render(<MermaidNode node={node('graph TD\nA --> B')} />)
      await waitFor(() => expect(renderMermaidMock).toHaveBeenCalledTimes(1))
      await act(async () => { sheet.textContent = 'body { --dsw-alias-bg-layer-2: rgba(44,44,46,.4); }' })
      await waitFor(() => expect(renderMermaidMock).toHaveBeenCalledTimes(2))
      await act(async () => { sheet.textContent += ' body { --unrelated: 1; }' })
      expect(renderMermaidMock).toHaveBeenCalledTimes(2)
    } finally { sheet.remove() }
  })

  it('recovers from an error when code changes to a valid diagram', async () => {
    renderMermaidMock
      .mockRejectedValueOnce(new Error('bad syntax'))
      .mockResolvedValueOnce('<svg><text>valid diagram</text></svg>')

    const view = render(<MermaidNode node={node('bad')} />)
    await screen.findByText('图表渲染失败，已显示源码')

    view.rerender(<MermaidNode node={node('graph TD\nA --> B')} />)
    expect(screen.getByText('渲染中…')).toBeTruthy()

    await waitFor(() => {
      const rendered = view.container.querySelector('[data-genui-mermaid]')
      expect(rendered).not.toBeNull()
      expect(rendered!.innerHTML).toContain('valid diagram')
    })
    expect(screen.queryByText('图表渲染失败，已显示源码')).toBeNull()
  })

  it('clears an old rendered SVG while new code is loading', async () => {
    let resolveNext!: (svg: string) => void
    const nextRender = new Promise<string>(resolve => { resolveNext = resolve })
    renderMermaidMock
      .mockResolvedValueOnce('<svg><text>first</text></svg>')
      .mockReturnValueOnce(nextRender)

    const view = render(<MermaidNode node={node('graph TD\nA --> B')} />)
    await waitFor(() => {
      const rendered = view.container.querySelector('[data-genui-mermaid]')
      expect(rendered).not.toBeNull()
      expect(rendered!.innerHTML).toContain('first')
    })

    view.rerender(<MermaidNode node={node('graph TD\nC --> D')} />)
    expect(screen.getByText('渲染中…')).toBeTruthy()
    expect(view.container.querySelector('[data-genui-mermaid]')).toBeNull()

    resolveNext('<svg><text>second</text></svg>')
    await waitFor(() => {
      const rendered = view.container.querySelector('[data-genui-mermaid]')
      expect(rendered).not.toBeNull()
      expect(rendered!.innerHTML).toContain('second')
    })
  })

  function viewport(): (visible: boolean, index?: number) => void {
    const observers: Array<{ callback: IntersectionObserverCallback; target: Element }> = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element): void { observers.push({ callback: this.callback, target }) }
      disconnect(): void {}
    })
    return (visible, index = 0) => act(() => {
      const observer = observers[index]!
      observer.callback([{ target: observer.target, isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
  }

  it('waits for the viewport, cancels when leaving, and ignores stale output', async () => {
    const intersect = viewport()
    let resolveOld!: (svg: string) => void
    renderMermaidMock.mockImplementationOnce((_code, options) => {
      expect(options.signal.aborted).toBe(false)
      return new Promise<string>(resolve => { resolveOld = resolve })
    }).mockResolvedValueOnce('<svg><text>current</text></svg>')
    const view = render(<MermaidNode node={node('graph TD\nA --> B')} />)
    await act(async () => {})
    expect(renderMermaidMock).not.toHaveBeenCalled()
    intersect(true)
    await waitFor(() => expect(renderMermaidMock).toHaveBeenCalledTimes(1))
    intersect(false)
    expect(renderMermaidMock.mock.calls[0]![1].signal.aborted).toBe(true)
    intersect(true)
    await waitFor(() => expect(view.container.innerHTML).toContain('current'))
    await act(async () => { resolveOld('<svg><text>obsolete</text></svg>') })
    expect(view.container.innerHTML).not.toContain('obsolete')
    intersect(false)
    intersect(true)
    expect(renderMermaidMock).toHaveBeenCalledTimes(2)
  })

  it('keeps observing the same root after rendering and refreshes theme after reentry', async () => {
    const intersect = viewport()
    renderMermaidMock
      .mockResolvedValueOnce('<svg><text>light</text></svg>')
      .mockResolvedValueOnce('<svg><text>dark</text></svg>')
    const view = render(<MermaidNode node={node('graph TD\nA --> B')} />)
    const observedRoot = view.container.firstElementChild

    intersect(true)
    await waitFor(() => expect(view.container.innerHTML).toContain('light'))
    expect(view.container.firstElementChild).toBe(observedRoot)

    intersect(false)
    await act(async () => { document.body.style.setProperty('--dsw-alias-label-primary', '#ffffff') })
    expect(renderMermaidMock).toHaveBeenCalledTimes(1)

    intersect(true)
    await waitFor(() => expect(view.container.innerHTML).toContain('dark'))
    expect(view.container.firstElementChild).toBe(observedRoot)
    expect(renderMermaidMock).toHaveBeenCalledTimes(2)
  })

  it('discards unmounted and superseded source before starting engine work', async () => {
    const intersect = viewport()
    renderMermaidMock.mockResolvedValue('<svg/>')
    const view = render(<MermaidNode node={node('old')} />)
    view.rerender(<MermaidNode node={node('new')} />)
    view.unmount()
    intersect(true, 1)
    await act(async () => {})
    expect(renderMermaidMock).not.toHaveBeenCalled()
  })

  it('invalidates a mounted SVG on body theme-token changes, but not unrelated attributes', async () => {
    renderMermaidMock.mockResolvedValue('<svg><text>theme</text></svg>')
    render(<MermaidNode node={node('graph TD\nA --> B')} />)
    await waitFor(() => expect(renderMermaidMock).toHaveBeenCalledTimes(1))
    await act(async () => { document.body.style.setProperty('--unrelated', '1') })
    expect(renderMermaidMock).toHaveBeenCalledTimes(1)
    await act(async () => { document.body.style.setProperty('--dsw-alias-label-primary', '#ffffff') })
    await waitFor(() => expect(renderMermaidMock).toHaveBeenCalledTimes(2))
  })

  it('keeps offscreen SVG geometry during a pending theme refresh', async () => {
    const intersect = viewport()
    let finish!: (svg: string) => void
    renderMermaidMock.mockResolvedValueOnce('<svg height="900"><text>old palette</text></svg>')
      .mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve }))
    const view = render(<MermaidNode node={node('graph TD\nA --> B')} />)
    intersect(true)
    await waitFor(() => expect(view.container.innerHTML).toContain('old palette'))
    intersect(false)
    await act(async () => { document.body.style.setProperty('--dsw-alias-label-primary', '#ffffff') })
    expect(renderMermaidMock).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('svg')?.getAttribute('height')).toBe('900')
    intersect(true)
    await waitFor(() => expect(renderMermaidMock).toHaveBeenCalledTimes(2))
    expect(view.container.innerHTML).toContain('old palette')
    await act(async () => { finish('<svg height="900"><text>new palette</text></svg>') })
    expect(view.container.innerHTML).toContain('new palette')
  })

  it('does not publish a slow result for superseded source', async () => {
    let finishOld!: (svg: string) => void
    renderMermaidMock.mockImplementationOnce(() => new Promise<string>(resolve => { finishOld = resolve }))
      .mockResolvedValueOnce('<svg><text>new source</text></svg>')
    const view = render(<MermaidNode node={node('graph TD\nOld --> Source')} />)
    await waitFor(() => expect(renderMermaidMock).toHaveBeenCalledTimes(1))
    view.rerender(<MermaidNode node={node('graph TD\nNew --> Source')} />)
    await waitFor(() => expect(view.container.innerHTML).toContain('new source'))
    expect(renderMermaidMock.mock.calls[0]![1].signal.aborted).toBe(true)
    await act(async () => { finishOld('<svg><text>old source</text></svg>') })
    expect(view.container.innerHTML).not.toContain('old source')
  })
})

const scheduled = await vi.importActual<typeof import('../src/client/mermaid-lazy.ts')>('../src/client/mermaid-lazy.ts')

function engine(render: (code: string) => Promise<string>): void {
  (window as unknown as { __GenuiAssets__: unknown }).__GenuiAssets__ = { mermaid: { renderMermaid: render } }
}

describe('Mermaid render scheduling', () => {
  it('preserves the target element through the lazy render queue', async () => {
    vi.useFakeTimers()
    document.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(250)
    const renderEngine = vi.fn(async () => '<svg/>')
    engine(renderEngine)
    const target = document.createElement('div')
    const job = scheduled.renderMermaid('diagram', { target })
    await vi.runAllTimersAsync()
    await job
    expect(renderEngine).toHaveBeenCalledWith('diagram', target)
  })

  it('runs one engine call at a time and yields a task between diagrams', async () => {
    vi.useFakeTimers()
    document.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(250)
    const events: string[] = []
    let finish!: (svg: string) => void
    engine(async code => {
      events.push(code)
      if (code === 'first') return new Promise<string>(resolve => { finish = resolve })
      return '<svg/>'
    })
    const first = scheduled.renderMermaid('first')
    const second = scheduled.renderMermaid('second')
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toEqual(['first'])
    setTimeout(() => events.push('input'), 0)
    finish('<svg/>')
    await first
    expect(events).toEqual(['first'])
    await vi.runAllTimersAsync()
    await second
    expect(events).toEqual(['first', 'input', 'second'])
  })

  it('cancels queued work without invoking the engine and continues after an error', async () => {
    vi.useFakeTimers()
    document.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(250)
    const draw = vi.fn(async code => {
      if (code === 'invalid') throw new Error('parse failed')
      return '<svg/>'
    })
    engine(draw)
    const controller = new AbortController()
    const canceled = scheduled.renderMermaid('obsolete', { signal: controller.signal }).catch(error => error)
    controller.abort()
    const invalid = scheduled.renderMermaid('invalid').catch(error => error)
    const valid = scheduled.renderMermaid('valid')
    await vi.runAllTimersAsync()
    expect(await canceled).toMatchObject({ name: 'AbortError' })
    expect(await invalid).toMatchObject({ message: 'parse failed' })
    expect(await valid).toBe('<svg/>')
    expect(draw.mock.calls.map(args => args[0])).toEqual(['invalid', 'valid'])
  })

  it('waits for a quiet scroll period, including nested scroll containers', async () => {
    vi.useFakeTimers()
    document.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(250)
    // Fake timers also control performance.now(), used by the quiet period.
    const draw = vi.fn(async () => '<svg/>')
    engine(draw)
    const job = scheduled.renderMermaid('diagram')
    const scroll = document.createElement('div')
    document.body.append(scroll)
    scroll.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(249)
    expect(draw).not.toHaveBeenCalled()
    scroll.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(249)
    expect(draw).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await job).toBe('<svg/>')
    expect(draw).toHaveBeenCalledTimes(1)
    scroll.remove()
  })

  it('waits for a scroll that happened while the queue was idle', async () => {
    vi.useFakeTimers()
    document.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(250)
    const draw = vi.fn(async () => '<svg/>')
    engine(draw)

    document.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(100)
    const first = scheduled.renderMermaid('after-idle-scroll')
    await vi.advanceTimersByTimeAsync(149)
    expect(draw).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(first).resolves.toBe('<svg/>')
    expect(draw).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(250)
    document.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(100)
    const second = scheduled.renderMermaid('after-queue-drained-scroll')
    await vi.advanceTimersByTimeAsync(149)
    expect(draw).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(second).resolves.toBe('<svg/>')
    expect(draw).toHaveBeenCalledTimes(2)
  })

  it('suspends hidden documents and resumes on visibilitychange', async () => {
    vi.useFakeTimers()
    document.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(250)
    let hidden = true
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    const draw = vi.fn(async () => '<svg/>')
    engine(draw)
    const job = scheduled.renderMermaid('diagram')
    await vi.runAllTimersAsync()
    expect(draw).not.toHaveBeenCalled()
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.runAllTimersAsync()
    expect(await job).toBe('<svg/>')
  })

  it('drops the result of a running canceled job without overlapping its successor', async () => {
    vi.useFakeTimers()
    document.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(250)
    let finish!: (svg: string) => void
    const draw = vi.fn(async () => new Promise<string>(resolve => { finish = resolve }))
    engine(draw)
    const controller = new AbortController()
    const canceled = scheduled.renderMermaid('running', { signal: controller.signal }).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    const next = scheduled.renderMermaid('next')
    await vi.advanceTimersByTimeAsync(0)
    expect(draw).toHaveBeenCalledTimes(1)
    draw.mockImplementation(async () => '<svg/>')
    finish('<svg>stale</svg>')
    await vi.runAllTimersAsync()
    expect(await canceled).toMatchObject({ name: 'AbortError' })
    expect(await next).toBe('<svg/>')
    expect(draw).toHaveBeenCalledTimes(2)
  })
})
