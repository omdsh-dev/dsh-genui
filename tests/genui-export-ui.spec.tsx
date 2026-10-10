import { Blob as NodeBlob } from 'node:buffer'
import { URL as NodeURL } from 'node:url'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ExportableGenuiBlock } from '../src/client/artifact/ExportableGenuiBlock.tsx'
import { renderGenuiFence } from '../src/client/index.tsx'
import { GenuiPanel } from '../src/client/panel.tsx'
import { applyPanelOperation, clearSessionPanel } from '../src/client/panel-store.ts'
import { GenuiToolView } from '../src/client/toolview.tsx'
import { TemplateDrawer } from '../src/client/TemplateDrawer.tsx'
import { setLocale } from '../src/client/i18n/index.ts'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'

afterEach(() => {
  cleanup()
  clearSessionPanel('artifact-ui')
  setLocale('zh')
})

function toolProps(): ToolCallViewProps {
  const block = {
    kind: 'tool-result', seq: 1, time: 0, callId: 'call-artifact', call: { name: 'render_ui', argsRaw: '{}' },
    callTime: 1, content: [], isError: false, meta: { items: [{ type: 'text', content: 'Tool result' }] },
    callView: null, resultView: null, subCalls: [],
  } as unknown as ToolCallBlock
  return { callId: 'call-artifact', toolName: 'render_ui', block, sessionId: 'tool-session', openFile: () => {} } as unknown as ToolCallViewProps
}

describe('artifact export entry points', () => {
  it('shows the export menu only after a fence settles', () => {
    const raw = JSON.stringify({ title: 'Ready', items: [{ type: 'text', content: 'content' }] })
    const streaming = render(renderGenuiFence(raw, 'stream', { sessionId: 's' }) as never)
    expect(screen.queryByRole('button', { name: '导出' })).toBeNull()
    streaming.unmount()
    render(renderGenuiFence(raw, 'settled', { sessionId: 's', source: { id: 'source-1', order: [1, 0, 0] } }) as never)
    expect(screen.getByRole('button', { name: '导出' })).toBeTruthy()
  })

  it('renders the export entry as a borderless icon-only trigger', () => {
    render(<ExportableGenuiBlock spec={{ items: [{ type: 'text', content: 'View' }] }} />)
    const trigger = screen.getByRole('button', { name: '导出' })
    expect(trigger.querySelector('svg')).toBeTruthy()
    expect(trigger.textContent).toBe('')
    expect(trigger.getAttribute('aria-label')).toBe('导出')
    expect(trigger.getAttribute('title')).toBe('导出')
  })

  it('shows export for settled tool and panel content', () => {
    const tool = render(<GenuiToolView {...toolProps()} />)
    expect(screen.getByRole('button', { name: '导出' })).toBeTruthy()
    tool.unmount()
    applyPanelOperation('artifact-ui', { sourceId: 'panel', order: [1, -1, 0], mode: 'replace', spec: { items: [{ type: 'text', content: 'Panel' }] } })
    render(<GenuiPanel sessionId="artifact-ui" sendGenuiAction={() => {}} insertTemplate={() => {}} />)
    fireEvent.click(document.querySelector('[data-genui-panel] .panelToggle') ?? document.querySelector('[data-genui-panel] button')!)
    expect(screen.getByRole('button', { name: '导出' })).toBeTruthy()
  })

  it('supports keyboard dismissal, accessible menu roles, English labels, and excludes template previews', () => {
    setLocale('en')
    const view = render(<ExportableGenuiBlock spec={{ items: [{ type: 'text', content: 'View' }] }} />)
    const trigger = screen.getByRole('button', { name: 'Export' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'HTML' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    view.unmount()
    setLocale('zh')
    render(<TemplateDrawer tab="templates" onUse={() => {}} />)
    fireEvent.click(screen.getByText('项目仪表盘'))
    expect(document.querySelector('[data-genui-template-preview] [data-genui-export]')).toBeNull()
  })

  it('explains why custom components prevent HTML export while keeping JSON available', () => {
    render(<ExportableGenuiBlock spec={{ items: [{ type: 'weather', temp: 20 }] } as never} />)
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    expect((screen.getByRole('menuitem', { name: 'HTML' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('menuitem', { name: 'GenUI JSON' })).toBeTruthy()
    expect(screen.getByText(/自定义组件 weather/)).toBeTruthy()
  })

  it('does not render status text after a successful export', async () => {
    const originalURL = globalThis.URL
    const originalBlob = globalThis.Blob
    const cancelDownload = (event: MouseEvent): void => {
      if (event.target instanceof HTMLAnchorElement && event.target.hasAttribute('download')) event.preventDefault()
    }
    globalThis.URL = NodeURL
    globalThis.Blob = NodeBlob
    document.addEventListener('click', cancelDownload, true)
    try {
      render(<ExportableGenuiBlock spec={{ items: [{ type: 'text', content: 'View' }] }} />)
      fireEvent.click(screen.getByRole('button', { name: '导出' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'GenUI JSON' }))
      await new Promise(resolve => window.setTimeout(resolve, 1))
      expect(screen.queryByText('正在准备下载…')).toBeNull()
      expect(screen.queryByText('已开始下载。')).toBeNull()
      expect(screen.queryByText('导出失败，请重试。')).toBeNull()
    } finally {
      document.removeEventListener('click', cancelDownload, true)
      globalThis.URL = originalURL
      globalThis.Blob = originalBlob
    }
  })
})
