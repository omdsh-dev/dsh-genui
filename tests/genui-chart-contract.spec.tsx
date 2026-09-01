// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderGenuiFence, resolveGenuiSpec } from '../src/client/fence-render.tsx'

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
})
