// @vitest-environment jsdom
// TemplateDrawer: the GenUI template center (0.9.4) — category filter,
// card grid, in-place demo preview, and the "try it" hook.
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TemplateDrawer } from '../src/client/TemplateDrawer.tsx'
import { GENUI_TEMPLATES } from '../src/client/templates.ts'

const renderDrawer = (onUse: (t: string) => void = () => {}): ReturnType<typeof render> =>
  render(<TemplateDrawer tab="templates" onUse={onUse} />)

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('TemplateDrawer', () => {
  it('渲染全部分类 chip 与模板卡片', () => {
    renderDrawer()
    for (const c of ['全部', '仪表盘', '数据', '流程', '图表', '交互', '测验', '高级']) {
      expect(screen.getByRole('tab', { name: c })).toBeTruthy()
    }
    for (const tpl of GENUI_TEMPLATES) {
      expect(screen.getByText(tpl.name)).toBeTruthy()
    }
  })

  it('分类过滤：点「测验」只显示图表类模板', () => {
    renderDrawer()
    fireEvent.click(screen.getByRole('tab', { name: '测验' }))
    expect(screen.queryByText('项目仪表盘')).toBeNull()
    expect(screen.getByText('随堂测验')).toBeTruthy()
  })

  it('点击卡片：预览渲染 demo 并显示「试用/复制」', async () => {
    renderDrawer()
    fireEvent.click(screen.getByText('项目仪表盘'))
    // Demo 预览由 GenuiBlock 渲染：首屏应有示例标题与 stat 标签
    const preview = document.querySelector('[data-genui-template-preview]')
    expect(preview).toBeTruthy()
    expect(screen.getByText('本周关键指标')).toBeTruthy()
    expect(screen.getByRole('button', { name: '试用：插入输入框' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /复制指令/ })).toBeTruthy()
  })

  it('「试用」回调收到模板指令', () => {
    const onUse = vi.fn()
    renderDrawer(onUse)
    fireEvent.click(screen.getByText('项目仪表盘'))
    fireEvent.click(screen.getByRole('button', { name: '试用：插入输入框' }))
    expect(onUse).toHaveBeenCalledTimes(1)
    expect(onUse.mock.calls[0][0]).toContain('dsh-ui')
    expect(onUse.mock.calls[0][0]).toContain('仪表盘')
  })

  it('「复制指令」走 clipboard（无 navigator 时静默容错）', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const onUse = vi.fn()
    renderDrawer(onUse)
    fireEvent.click(screen.getByText('项目仪表盘'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /复制指令/ }))
    })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain('dsh-ui')
  })

  it('成就面板渲染成就页（dsh-ui 自渲染，无多余 mode tabs）', () => {
    const withTab = render(<TemplateDrawer tab="achievements" onUse={() => {}} />)
    expect(document.querySelector('[data-genui-achievements]')).toBeTruthy()
    expect(screen.getByText(/GenUI 探索成就/)).toBeTruthy()
    // 抽屉内不再有「模板|成就」mode 切换（面板 header 按钮负责）
    expect(screen.queryByRole('tab', { name: '成就' })).toBeNull()
    withTab.unmount()
  })
})
