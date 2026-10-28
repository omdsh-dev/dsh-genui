// @vitest-environment jsdom
// Teaching components: quiz judging, plot animation bar, reset, entrance reveal.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// jsdom 没有真正的 requestAnimationFrame 循环；用可控 mock 手动推进帧。
let rafCallbacks: Array<(t: number) => void> = []
let rafTime = 0
beforeEach(() => {
  rafCallbacks = []
  rafTime = 0
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('performance', { now: () => rafTime })
})
function tick(ms: number): void {
  rafTime += ms
  const cbs = [...rafCallbacks]
  rafCallbacks = []
  for (const cb of cbs) cb(rafTime)
}
afterEach(() => {
  vi.unstubAllGlobals()
})
import { vi } from 'vitest'
import { MarkdownText } from './genui-markdown.tsx'

afterEach(cleanup)

function fenced(spec: unknown): string {
  return `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
}

describe('quiz component', () => {
  it('judges correct and wrong answers in place', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      { type: 'quiz', question: 'sin(0) 等于？', options: [
        { label: '0', correct: true, feedback: '对，sin(0)=0' },
        { label: '1', feedback: 'sin(0) 不是 1' },
      ], explanation: '单位圆上 0 弧度的 y 坐标为 0' },
    ] })} />)
    expect(container.querySelector('[data-genui-quiz]')).not.toBeNull()
    // 答错
    fireEvent.click(container.querySelectorAll('[data-genui-quiz] button')[1]!)
    expect(container.textContent).toContain('再想想')
    expect(container.textContent).toContain('sin(0) 不是 1')
    // 重新作答
    fireEvent.click(container.querySelector('[class*="quizRetry"]')!)
    // 答对
    fireEvent.click(container.querySelectorAll('[data-genui-quiz] button')[0]!)
    expect(container.textContent).toContain('回答正确')
    expect(container.textContent).toContain('单位圆上')
  })
})

describe('plot animation', () => {
  it('renders play button when a param has animateTo', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      { type: 'plot', series: [{ expr: 'a*sin(x)', params: [{ name: 'a', value: 1, min: 0, max: 5, animateTo: 3 }] }] },
    ] })} />)
    const play = container.querySelector('[class*="playBtn"]')
    expect(play).not.toBeNull()
    expect(play!.textContent).toContain('播放')
  })

  it('animates the parameter over time', async () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      { type: 'plot', series: [{ expr: 'a*sin(x)', params: [{ name: 'a', value: 1, min: 0, max: 5, animateTo: 3, durationMs: 200 }] }] },
    ] })} />)
    fireEvent.click(container.querySelector('[class*="playBtn"]')!)
    // 播放中：推进几帧，参数值应偏离初始值
    act(() => { tick(50); tick(50); tick(50) })
    const value = container.querySelector('[class*="sliderValue"]')?.textContent
    expect(value).not.toBe('1')
    // 推进到结束（durationMs 200），回到停止状态
    act(() => { tick(200) })
    expect(container.querySelector('[class*="playBtn"]')?.textContent).toContain('播放')
  }, 5000)

  it('resets params to declared defaults', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      { type: 'plot', series: [{ expr: 'a*x', params: [{ name: 'a', value: 1, min: 0, max: 5 }] }] },
    ] })} />)
    fireEvent.change(container.querySelector('input[type="range"]')!, { target: { value: '4' } })
    expect((container.querySelector('input[type="range"]') as HTMLInputElement).value).toBe('4')
    const resetBtn = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('重置'))
    expect(resetBtn).toBeTruthy()
    fireEvent.click(resetBtn!)
    expect((container.querySelector('input[type="range"]') as HTMLInputElement).value).toBe('1')
  })
})

describe('entrance reveal', () => {
  it('keeps a short stagger and caps the wait at 160ms', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      { type: 'stat', label: 'A', value: '1' },
      { type: 'stat', label: 'B', value: '2' },
      { type: 'stat', label: 'C', value: '3' },
    ] })} />)
    const reveals = container.querySelectorAll('[class*="reveal"]')
    expect(reveals.length).toBe(3)
    const delays = [...reveals].map(element => {
      const style = element.getAttribute('style') ?? ''
      const match = style.match(/animation[- ]delay:\s*([0-9.]+)ms/i)
      return match === null ? 0 : Number(match[1])
    })
    // 90ms of rhythm per item, capped at 160ms: he last item lands at ~410ms
    // (160 delay + 250ms fade) instead of the uncapped 1.17s.
    expect(delays).toEqual([0, 90, 160])
  })
})
