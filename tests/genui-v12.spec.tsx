// @vitest-environment jsdom
// GenUI v1.2/v1.3: chart variants (line/donut/grouped bars), interactive
// controls (radio/switch/textarea/accordion/copy), and lazy modules
// (mermaid, scene3d) render from a ```dsh-ui fence without crashing.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownText } from './markdown-labels.tsx'
import { registerGenuiComponent } from './host-registry.ts'
import { hasFenceRegistry } from './setup'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GENUI_ACTION_DEBOUNCE_MS } from '../src/client/GenuiBlock.tsx'
import { sampleExpr } from '../src/client/safe-math.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function fenced(spec: unknown): string {
  return `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
}

describe.skipIf(!hasFenceRegistry)('chart variants', () => {
  it('renders a line chart', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'chart', kind: 'line', data: [
        { label: '一', value: 10 }, { label: '二', value: 20 }, { label: '三', value: 15 },
      ] },
    ] })} />)
    expect(document.querySelector('svg path')).not.toBeNull()
  })

  it('renders a donut chart with total', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'chart', kind: 'donut', data: [
        { label: 'A', value: 30 }, { label: 'B', value: 70 },
      ] },
    ] })} />)
    expect(document.body.textContent).toContain('100')
    expect(document.body.textContent).toContain('A · 30')
  })

  it('renders grouped bars from series', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'chart', series: [
        { label: '本月', color: '#6ea8ff', data: [{ label: 'Q1', value: 3 }, { label: 'Q2', value: 5 }] },
        { label: '上月', color: '#34d399', data: [{ label: 'Q1', value: 2 }, { label: 'Q2', value: 4 }] },
      ] },
    ] })} />)
    expect(document.querySelectorAll('[class*="groupedFill"]').length).toBe(4)
  })
})

describe.skipIf(!hasFenceRegistry)('interactive controls', () => {
  it('renders a radio group with local selection', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'radio', label: '主题', options: ['浅色', '深色', '跟随系统'] },
    ] })} />)
    expect(screen.getByRole('radiogroup')).toBeTruthy()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    fireEvent.click(radios[1]!)
    expect((radios[1] as HTMLInputElement).checked).toBe(true)
  })

  it('renders a switch and toggles it', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'switch', label: '自动保存', checked: true },
    ] })} />)
    const sw = screen.getByRole('switch')
    expect(sw.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('false')
  })

  it('renders a textarea', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'textarea', label: '备注', placeholder: '输入…', rows: 3 },
    ] })} />)
    const ta = document.querySelector('textarea')
    expect(ta).not.toBeNull()
    expect(ta!.getAttribute('rows')).toBe('3')
  })

  it('renders an accordion and expands items', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'accordion', items: [
        { title: '基础信息', items: [{ type: 'text', content: '内部内容' }] },
        { title: '高级', items: [{ type: 'text', content: '高级选项' }] },
      ] },
    ] })} />)
    expect(screen.getByText('基础信息')).toBeTruthy()
    expect(screen.getByText('内部内容')).toBeTruthy() // first open by default
    expect(document.body.textContent).not.toContain('高级选项')
    fireEvent.click(screen.getByText('高级'))
    expect(screen.getByText('高级选项')).toBeTruthy()
  })

  it('renders a copy chip', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'copy', label: '复制命令', text: 'pnpm build' },
    ] })} />)
    expect(screen.getByRole('button', { name: '复制命令' })).toBeTruthy()
  })
})

describe.skipIf(!hasFenceRegistry)('lazy advanced components', () => {
  it('renders a mermaid node with fallback while loading', async () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'mermaid', code: 'graph TD\nA[开始] --> B[结束]' },
    ] })} />)
    // Either the rendered diagram or the loading fallback appears synchronously.
    const hasFallback = document.body.textContent?.includes('渲染中') === true
    expect(document.body.textContent).toContain('graph TD')
    expect(hasFallback || document.querySelector('[data-genui-mermaid]') !== null).toBe(true)
  })

  it('renders a scene3d node without crashing in jsdom', async () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'scene3d', title: '立方体', meshes: [
        { shape: 'box', size: [1, 1, 1], color: '#6ea8ff', position: [0, 0, 0] },
      ] },
    ] })} />)
    expect(document.querySelector('[data-genui-scene3d]')).not.toBeNull()
    // jsdom has no WebGL; the loading hint or error state is acceptable, but
    // the node itself must exist.
    expect(document.body.textContent).toContain('立方体')
  })
})

describe.skipIf(!hasFenceRegistry)('v1.4 content structure components', () => {
  it('renders a timeline with markers', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'timeline', items: [
        { title: '项目启动', desc: '初始化仓库', time: '09:00' },
        { title: '完成开发', desc: '功能全部实现', time: '15:30' },
      ] },
    ] })} />)
    expect(screen.getByText('项目启动')).toBeTruthy()
    expect(screen.getByText('完成开发')).toBeTruthy()
    expect(document.querySelectorAll('[class*="tlDot"]').length).toBe(2)
  })

  it('renders a file tree with folders and files', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'file-tree', items: [
        { name: 'src', type: 'dir', children: [
          { name: 'index.ts', type: 'file' },
          { name: 'genui', type: 'dir', children: [{ name: 'spec.ts', type: 'file' }] },
        ] },
        { name: 'package.json', type: 'file' },
      ] },
    ] })} />)
    expect(screen.getByText('src')).toBeTruthy()
    expect(screen.getByText('index.ts')).toBeTruthy()
    expect(screen.getByText('spec.ts')).toBeTruthy()
    expect(screen.getByText('package.json')).toBeTruthy()
  })

  it('renders a breadcrumb trail with current marker', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'breadcrumb', items: ['首页', '设置', '账户'] },
    ] })} />)
    expect(screen.getByText('首页')).toBeTruthy()
    expect(screen.getByText('账户')).toBeTruthy()
    expect(document.querySelectorAll('[class*="bcSep"]').length).toBe(2)
  })
})

describe.skipIf(!hasFenceRegistry)('GenUI v2 event loop', () => {
  // Actions are trailing-debounced per name (GENUI_ACTION_DEBOUNCE_MS);
  // assertions advance past the window.
  it('fires onGenuiAction when a button with action is clicked', () => {
    vi.useFakeTimers()
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced({ items: [
          { type: 'button', label: '刷新', action: 'refresh' },
          { type: 'button', label: '普通按钮' },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    const buttons = container.querySelectorAll('button')
    fireEvent.click(buttons[0]!)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['refresh', { type: 'button', label: '刷新' }]])
    // 无 action 的按钮不触发
    fireEvent.click(buttons[1]!)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toHaveLength(1)
  })

  it('fires onGenuiAction for switch and checkbox', () => {
    vi.useFakeTimers()
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced({ items: [
          { type: 'switch', label: '自动保存', checked: true, action: 'toggle-save' },
          { type: 'checkbox', label: '同意', action: 'agree' },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    fireEvent.click(container.querySelector('[role="switch"]')!)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions[0]).toEqual(['toggle-save', { type: 'switch', checked: false }])
    fireEvent.click(container.querySelector('input[type="checkbox"]')!)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions[1]).toEqual(['agree', { type: 'checkbox', checked: true }])
  })

  it('does not fire actions without a provider (v1 behavior)', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      { type: 'button', label: '刷新', action: 'refresh' },
    ] })} />)
    fireEvent.click(container.querySelector('button')!)
    // No provider: nothing to observe; the click must not throw.
    expect(true).toBe(true)
  })
})

describe.skipIf(!hasFenceRegistry)('GenUI v2 interactive plot', () => {
  it('renders parameter sliders and re-renders on drag', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      { type: 'plot', title: '可调正弦', series: [
        { expr: 'a * sin(x)', label: 'sin', params: [{ name: 'a', value: 1, min: 0, max: 5 }] },
      ] },
    ] })} />)
    expect(document.querySelector('[data-genui-plot]')).not.toBeNull()
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement | null
    expect(slider).not.toBeNull()
    expect(slider!.min).toBe('0')
    expect(slider!.max).toBe('5')
    // Drag the slider → live re-render must not throw and value updates.
    fireEvent.change(slider!, { target: { value: '3' } })
    expect((container.querySelector('input[type="range"]') as HTMLInputElement).value).toBe('3')
  })

  it('evaluates params in expressions', () => {
    const pts = sampleExpr('a * x', -1, 1, 3, { a: 2 })
    expect(pts).toHaveLength(3)
    expect(pts[0]![1]).toBeCloseTo(-2)
    expect(pts[2]![1]).toBeCloseTo(2)
  })

  it('keeps x as the sampling variable even when a param is named x-like', () => {
    // x is reserved; a param literally named x must not shadow it.
    const pts = sampleExpr('x', -2, 2, 5, { x: 99 })
    expect(pts[0]![1]).toBeCloseTo(-2)
    expect(pts[4]![1]).toBeCloseTo(2)
  })
})

describe.skipIf(!hasFenceRegistry)('GenUI component registry', () => {
  it('renders a plugin-registered custom type', () => {
    const dispose = registerGenuiComponent('weather', ({ node }) => (
      <div data-testid="weather-card">{String(node.temp)}°C {String(node.condition)}</div>
    ))
    try {
      const { container } = render(<MarkdownText text={fenced({ items: [
        { type: 'weather', temp: 24, condition: '晴' },
      ] })} />)
      expect(container.querySelector('[data-testid="weather-card"]')?.textContent).toBe('24°C 晴')
    } finally {
      dispose()
    }
  })

  it('renders nothing for an unregistered unknown type', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      { type: 'not-a-real-type', anything: true },
    ] })} />)
    // Renders the block but no content from the unknown node.
    expect(container.querySelector('[data-genui]')).not.toBeNull()
  })

  it('refuses duplicate registration', () => {
    const d1 = registerGenuiComponent('dup-test', () => null)
    try {
      expect(() => registerGenuiComponent('dup-test', () => null)).toThrow(/already registered/)
    } finally {
      d1()
    }
  })
})
