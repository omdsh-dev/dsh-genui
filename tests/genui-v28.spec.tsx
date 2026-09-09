// @vitest-environment jsdom
// v2.8 batch regressions:
// 1) GenuiBlock memo comparator skips re-renders when the spec content is
//    unchanged (streaming re-parse produces a fresh object per chunk);
// 2) select gains id/selected (durable + submit collection + placeholder);
// 3) link renders a real anchor for whitelisted hrefs and plain text without;
// 4) file-tree directories are locally collapsible;
// 5) negative chart values clamp (bars/donut) without breaking rendering;
// 6) blur sends an action ONLY when the field value changed since the last
//    delivery (no more empty focus-in/focus-out round trips).
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerGenuiComponent } from './host-registry.ts'
import { hasFenceRegistry } from './setup'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock, GENUI_ACTION_DEBOUNCE_MS } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
beforeEach(() => {
  vi.useFakeTimers()
})

function renderBlock(spec: unknown, actions: Array<[string, Record<string, unknown>]> = []) {
  return render(
    <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
      <GenuiBlock spec={repairGenuiSpec(spec)!} />
    </GenuiActionContext.Provider>,
  )
}

describe.skipIf(!hasFenceRegistry)('v2.8: memo comparator (streaming re-parse skips unchanged renders)', () => {
  it('does not re-render when an equal-but-fresh spec object arrives', () => {
    let renders = 0
    const dispose = registerGenuiComponent('probe', ({ node }: { node: { label?: string } }) => {
      renders += 1
      return <div data-probe>{node.label ?? 'probe'}</div>
    })
    try {
      const spec = repairGenuiSpec({
        items: [
          { type: 'text', content: '静态' },
          { type: 'probe', label: 'P' },
        ],
      })!
      const { rerender } = render(
        <GenuiActionContext.Provider value={undefined}>
          <GenuiBlock spec={spec} />
        </GenuiActionContext.Provider>,
      )
      expect(renders).toBe(1)
      // Fresh object, identical content (what a streaming chunk re-parse hands over).
      rerender(
        <GenuiActionContext.Provider value={undefined}>
          <GenuiBlock spec={JSON.parse(JSON.stringify(spec))!} />
        </GenuiActionContext.Provider>,
      )
      expect(renders).toBe(1)
      // Content actually changed → the block re-renders.
      rerender(
        <GenuiActionContext.Provider value={undefined}>
          <GenuiBlock spec={repairGenuiSpec({
            items: [
              { type: 'text', content: '静态' },
              { type: 'probe', label: 'Q' },
            ],
          })!} />
        </GenuiActionContext.Provider>,
      )
      expect(renders).toBe(2)
    } finally {
      dispose()
    }
  })
})

describe('v2.8: select id/selected', () => {
  it('shows a placeholder and pre-registers nothing without a default', () => {
    const { container } = renderBlock({
      items: [{ type: 'select', label: '环境', options: ['dev', 'prod'] }],
    })
    const select = container.querySelector('select')!
    expect(select.value).toBe('')
    expect(select.querySelector('option[value=""][hidden]')?.textContent).toBe('请选择…')
  })

  it('pre-selects a model default and fires an action with value + id on change', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = renderBlock({
      items: [{ type: 'select', label: '环境', options: ['dev', 'prod'], selected: 1, action: 'pick', id: 'env' }],
    }, actions)
    const select = container.querySelector('select')!
    expect(select.value).toBe('prod')
    fireEvent.change(select, { target: { value: 'dev' } })
    act(() => { vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS) })
    expect(actions).toEqual([['pick', { type: 'select', value: 'dev', id: 'env' }]])
  })

  it('collects the selected value into a sibling submit fields payload', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = renderBlock({
      items: [
        { type: 'select', label: '环境', options: ['dev', 'prod'], action: 'pick', id: 'env' },
        { type: 'submit', label: '交卷', action: 'send' },
      ],
    }, actions)
    fireEvent.change(container.querySelector('select')!, { target: { value: 'dev' } })
    // No groups → answered counts filled fields; the submit enables once a field has a value.
    const submit = container.querySelector('[class*="submitRow"] button')!
    expect((submit as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(submit)
    act(() => { vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS) })
    const submitAction = actions.find(([name]) => name === 'send')!
    expect(submitAction[1]).toMatchObject({ type: 'submit', fields: { env: 'dev' } })
  })
})

describe('v2.8: honest link rendering', () => {
  it('renders a real anchor for a whitelisted href (target + rel)', () => {
    const { container } = renderBlock({
      items: [{ type: 'link', label: '文档', href: 'https://example.com/docs' }],
    })
    const a = container.querySelector('a[class*="link"]')
    expect(a).not.toBeNull()
    expect(a!.getAttribute('href')).toBe('https://example.com/docs')
    expect(a!.getAttribute('target')).toBe('_blank')
    expect(a!.getAttribute('rel')).toContain('noopener')
    expect(container.querySelector('button[class*="link"]')).toBeNull()
  })

  it('renders plain text — never a dead button — without a href', () => {
    const { container } = renderBlock({
      items: [{ type: 'link', label: '不可点链接' }],
    })
    const span = container.querySelector('span[class*="linkText"]')
    expect(span).not.toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
  })

  it('drops non-http(s) href schemes in the guard', () => {
    const spec = repairGenuiSpec({
      items: [{ type: 'link', label: 'x', href: 'javascript:alert(1)' }],
    })
    expect(spec?.items[0]).toMatchObject({ type: 'link', label: 'x' })
    expect((spec!.items[0] as { href?: string }).href).toBeUndefined()
  })
})

describe('v2.8: collapsible file-tree', () => {
  const tree = {
    items: [
      { name: 'src', type: 'dir', children: [
        { name: 'a.ts', type: 'file' },
        { name: 'b.ts', type: 'file' },
      ] },
      { name: 'README.md', type: 'file' },
    ],
  }

  it('collapses and re-expands a directory locally', () => {
    const { container } = renderBlock({ items: [{ type: 'file-tree', items: tree.items }] })
    expect(container.textContent).toContain('a.ts')
    const dir = container.querySelector('button[aria-expanded="true"]')!
    expect(dir.textContent).toContain('src')
    fireEvent.click(dir)
    expect(container.textContent).not.toContain('a.ts')
    expect(container.querySelector('button[aria-expanded="false"]')).not.toBeNull()
    fireEvent.click(container.querySelector('button[aria-expanded="false"]')!)
    expect(container.textContent).toContain('a.ts')
  })
})

describe('v2.8/v3: negative chart values draw below the zero line', () => {
  it('bars draw the negative value downward instead of clamping it away', () => {
    const { container } = renderBlock({
      items: [{ type: 'chart', data: [
        { label: 'A', value: 10 }, { label: 'B', value: -5 },
      ] }],
    })
    const fills = container.querySelectorAll('[class*="barFill"]')
    expect(fills).toHaveLength(2)
    // v3: the axis spans -5..10, so the zero line sits at 33.3% and the
    // negative bar occupies the band below it — a real height, not 0%.
    const negative = fills[1] as HTMLElement
    expect(Number.parseFloat(negative.style.height)).toBeGreaterThan(0)
    expect(Number.parseFloat(negative.style.bottom)).toBe(0)
    expect(negative.style.borderRadius).toContain('0 0')
    expect(container.textContent).toContain('-5')
  })

  it('donut ignores negative arcs and still renders', () => {
    const { container } = renderBlock({
      items: [{ type: 'chart', kind: 'donut', data: [
        { label: 'A', value: 30 }, { label: 'B', value: -7 },
      ] }],
    })
    // No crash; total clamps to the positive sum; the negative label still shows.
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).toContain('30')
    expect(container.textContent).toContain('B')
    expect(container.textContent).toContain('-7')
  })
})

describe('v2.8: blur sends only on change', () => {
  it('focus-in/focus-out without an edit fires nothing', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = renderBlock({
      items: [{ type: 'input', label: '名称', action: 'save', id: 'name' }],
    }, actions)
    const input = container.querySelector('input')!
    fireEvent.focus(input)
    fireEvent.blur(input)
    act(() => { vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS) })
    expect(actions).toHaveLength(0)
  })

  it('an edit delivers once on blur; a second unedited blur does not re-send', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = renderBlock({
      items: [{ type: 'input', label: '名称', action: 'save', id: 'name' }],
    }, actions)
    const input = container.querySelector('input')!
    fireEvent.change(input, { target: { value: '张三' } })
    fireEvent.blur(input)
    act(() => { vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS) })
    expect(actions).toEqual([['save', { type: 'input', value: '张三', id: 'name' }]])
    fireEvent.focus(input)
    fireEvent.blur(input)
    act(() => { vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS) })
    expect(actions).toHaveLength(1)
  })

  it('Enter submits with submit:true; the following blur does not double-send', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = renderBlock({
      items: [{ type: 'input', label: '名称', action: 'save', id: 'name' }],
    }, actions)
    const input = container.querySelector('input')!
    fireEvent.change(input, { target: { value: '李四' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    act(() => { vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS) })
    expect(actions).toEqual([['save', { type: 'input', value: '李四', id: 'name', submit: true }]])
    fireEvent.blur(input)
    act(() => { vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS) })
    expect(actions).toHaveLength(1)
  })
})
