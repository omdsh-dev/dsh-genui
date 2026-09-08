// @vitest-environment jsdom
// The render_ui tool's keyed toolview: reads the repaired spec from the
// result node's meta and renders through GenuiBlock; falls back to a summary
// row while the call runs or when meta is missing (replay of old logs).
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { GenuiToolView } from '../src/client/toolview.tsx'

afterEach(cleanup)

function props(block: ToolCallBlock): ToolCallViewProps {
  return {
    callId: 'call-1',
    toolName: 'render_ui',
    block,
    openFile: () => {},
  } as unknown as ToolCallViewProps
}

const resultBlock = (meta: unknown): ToolCallBlock => ({
  kind: 'tool-result',
  seq: 1,
  time: 0,
  callId: 'call-1',
  call: { name: 'render_ui', argsRaw: '{}' },
  callTime: 1,
  content: [],
  isError: false,
  meta,
  callView: null,
  resultView: null,
  subCalls: [],
} as unknown as ToolCallBlock)

describe('GenuiToolView', () => {
  it('renders the spec from result meta', () => {
    render(<GenuiToolView {...props(resultBlock({ title: '监控面板', items: [
      { type: 'stat', label: 'CPU', value: '42%' },
      { type: 'progress', value: 72 },
    ] }))} />)
    const block = document.querySelector('[data-genui]')
    expect(block).not.toBeNull()
    expect(block!.textContent).toContain('监控面板')
    expect(document.body.textContent).toContain('CPU')
    expect(document.body.textContent).toContain('42%')
  })

  it('repairs a hostile meta spec before rendering (caps honored)', () => {
    render(<GenuiToolView {...props(resultBlock({ items: Array.from({ length: 500 }, (_, i) => ({ type: 'text', content: `t${i}` })) }))} />)
    expect(document.body.textContent).toContain('t0')
    expect(document.body.textContent).not.toContain('t499')
  })

  it('falls back to a summary row while the call is running (no meta)', () => {
    render(<GenuiToolView {...props({ callId: 'call-1', name: 'render_ui', argsRaw: '{}', turn: 1, step: 1, time: 0, callView: null, subCalls: [] } as unknown as ToolCallBlock)} />)
    const fallback = document.querySelector('[data-genui-tool]')
    expect(fallback).not.toBeNull()
    expect(fallback!.textContent).toContain('call-1')
    expect(document.querySelector('[data-genui]')).toBeNull()
  })

  it('falls back when meta is not a spec (replayed log without projection)', () => {
    render(<GenuiToolView {...props(resultBlock({ some: 'junk' }))} />)
    expect(document.querySelector('[data-genui-tool]')).not.toBeNull()
    expect(document.querySelector('[data-genui]')).toBeNull()
  })
})
