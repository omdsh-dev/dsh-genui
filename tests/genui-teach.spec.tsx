// @vitest-environment jsdom
// Teaching components: quiz judging, plot animation bar, reset, staggered reveal.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasFenceRegistry } from './setup'

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
import { MarkdownText } from './markdown-labels.tsx'

afterEach(cleanup)

function fenced(spec: unknown): string {
  return `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
}

describe.skipIf(!hasFenceRegistry)('quiz component', () => {
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

describe.skipIf(!hasFenceRegistry)('plot animation', () => {
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

describe.skipIf(!hasFenceRegistry)('staggered reveal', () => {
  it('wraps root items with incremental reveal delays', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      { type: 'stat', label: 'A', value: '1' },
      { type: 'stat', label: 'B', value: '2' },
      { type: 'stat', label: 'C', value: '3' },
    ] })} />)
    const reveals = container.querySelectorAll('[class*="reveal"]')
    expect(reveals.length).toBe(3)
    const delays = [...reveals].map(el => {
      const st = el.getAttribute('style') ?? ''
      const m = st.match(/animationDelay:\s*([0-9.]+)ms/) ?? st.match(/animation-delay:\s*([0-9.]+)ms/)
      return m ? Number(m[1]) : 0
    })
    expect(delays[0]!).toBe(0)
    expect(delays[1]!).toBeGreaterThan(delays[0]!)
    expect(delays[2]!).toBeGreaterThan(delays[1]!)
  })
})
