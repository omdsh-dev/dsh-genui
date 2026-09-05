// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderGenuiFence, resolveGenuiSpec } from '../src/client/fence-render.tsx'
import { createRenderUiTool, createValidateDshUiTool } from '../src/plugin/tool.ts'

afterEach(cleanup)

describe('native chart renderability contract', () => {
  it('rejects series-only line charts on the direct fence path', () => {
    const raw = JSON.stringify({
      items: [{
        type: 'chart',
        kind: 'line',
        series: [{ label: 'A', data: [{ label: '周一', value: 128 }] }],
      }],
    })
    expect(resolveGenuiSpec(raw)).toBeNull()

    render(<div>{renderGenuiFence(raw, 'line-series')}</div>)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('chart 字段验证失败')
    expect(alert.textContent).toContain('series is only supported for bars')
    expect(alert.textContent).toContain('data is required for line')
  })

  it('rejects empty chart collections before they can render blank', () => {
    expect(resolveGenuiSpec(JSON.stringify({
      items: [{ type: 'chart', data: [] }],
    }))).toBeNull()

    expect(resolveGenuiSpec(JSON.stringify({
      items: [{ type: 'chart', series: [] }],
    }))).toBeNull()

    expect(resolveGenuiSpec(JSON.stringify({
      items: [{
        type: 'chart',
        series: [{ label: 'A', data: [] }],
      }],
    }))).toBeNull()
  })

  it('keeps grouped bars valid with non-empty series data', () => {
    const spec = resolveGenuiSpec(JSON.stringify({
      items: [{
        type: 'chart',
        kind: 'bars',
        series: [{ label: 'A', data: [{ label: '周一', value: 128 }] }],
      }],
    }))
    expect(spec).not.toBeNull()
    expect(spec!.items[0]).toMatchObject({ type: 'chart', kind: 'bars' })
  })

  it('allows extension fields but native repair ignores them', () => {
    const spec = resolveGenuiSpec(JSON.stringify({
      items: [{
        type: 'chart',
        kind: 'line',
        data: [{ label: '周一', value: 128, extension: true }],
        extension: { owner: 'another-plugin' },
      }],
    })) as { items: Array<Record<string, unknown> & { data?: Array<Record<string, unknown>> }> } | null

    expect(spec).not.toBeNull()
    expect(spec!.items[0]).not.toHaveProperty('extension')
    expect(spec!.items[0]!.data?.[0]).not.toHaveProperty('extension')
  })

  it('keeps validate, render metadata, and fence resolution on one canonical tree', async () => {
    const input = {
      title: '协议别名',
      items: [
        { type: 'card', label: '卡片', content: [{ type: 'text', text: '内容' }] },
        { type: 'table', headers: ['名称'], data: [['苹果']] },
        { type: 'callout', kind: 'warning', content: '注意' },
        { type: 'steps', items: [{ title: '第一步' }] },
      ],
    }
    const validation = String(await createValidateDshUiTool().execute({ spec: JSON.stringify(input) }))
    expect(validation).toContain('✅')
    expect(validation).toContain('items[0].label → items[0].title')
    expect(validation).toContain('items[1].headers → items[1].columns')
    expect(validation).toContain('items[2].kind → items[2].tone')
    expect(validation).toContain('items[3].items → items[3].steps')

    const renderTool = createRenderUiTool()
    const meta = renderTool.output.presentationMeta!({ spec: input })
    const resolved = resolveGenuiSpec(JSON.stringify(input))
    expect(meta).toEqual(resolved)
    expect(meta).toMatchObject({
      title: '协议别名',
      items: [
        { type: 'card', title: '卡片', items: [{ type: 'text', content: '内容' }] },
        { type: 'table', columns: ['名称'], rows: [['苹果']] },
        { type: 'callout', tone: 'warning', content: '注意' },
        { type: 'steps', steps: [{ title: '第一步' }] },
      ],
    })
  })

  it('warns for native extension fields while preserving custom renderer payloads', async () => {
    const input = {
      items: [
        { type: 'callout', content: '保留', extension: true },
        { type: 'custom-widget', extension: { owner: 'plugin' } },
      ],
    }
    const validation = String(await createValidateDshUiTool().execute({ spec: JSON.stringify(input) }))
    expect(validation).toContain('✅')
    expect(validation).toContain('items[0].extension')
    expect(validation).toContain('unknown field')

    const renderTool = createRenderUiTool()
    const meta = renderTool.output.presentationMeta!({ spec: input }) as {
      items: Array<Record<string, unknown>>
    }
    expect(meta.items[0]).not.toHaveProperty('extension')
    expect(meta.items[1]).toEqual(input.items[1])
    expect(await renderTool.execute({ spec: input })).toContain('2 个组件')
  })
})
