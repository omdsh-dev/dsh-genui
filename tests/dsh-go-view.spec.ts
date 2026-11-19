import { describe, expect, it } from 'vitest'
import { toDshGoView } from '../src/plugin/dsh-go-view.ts'
import { createRenderUiTool } from '../src/plugin/tool.ts'
import { processGenuiSpec } from '../src/client/guard.ts'
import type { GenuiSpec } from '../src/client/spec.ts'
import fixtures from './fixtures/dsh-go-native.json'

const spec: GenuiSpec = { title: '订单', items: [
  { type: 'row', items: [{ type: 'stat', label: '金额', value: '¥1,024', delta: '+12%' }, { type: 'progress', value: 72, label: '目标' }] },
  { type: 'chart', kind: 'bars', data: [{ label: '一月', value: 10 }, { label: '二月', value: 20 }] },
  { type: 'table', columns: ['名称', '数量'], rows: [['A', 12], ['B', 0]] },
  { type: 'callout', tone: 'warning', title: '注意', content: '数据尚未结算' },
  { type: 'steps', current: 1, steps: [{ title: '收到' }, { title: '处理中', desc: '等待确认' }, { title: '完成' }] },
  { type: 'keyvalue', pairs: [{ key: '负责人', value: 'taek' }] },
] }

describe('dsh-go native projection', () => {
  it.each(fixtures)('shared native contract: $name', fixture => {
    expect(toDshGoView(fixture.spec as GenuiSpec)).toEqual(fixture.native)
  })
  it('adds native metadata while preserving the complete web spec and input', () => {
    const original = structuredClone(spec)
    const meta = createRenderUiTool().output.presentationMeta!({ spec }) as Record<string, unknown>
    expect(meta['dsh-go/view']).toEqual({ type: 'stack', title: '订单', children: [
      { type: 'row', children: [{ type: 'metric', label: '金额', value: '¥1,024', caption: '+12%' }, { type: 'progress', value: 72, label: '目标' }] },
      { type: 'chart', kind: 'bar', categories: ['一月', '二月'], series: [{ name: '', values: [10, 20] }] },
      { type: 'table', columns: ['名称', '数量'], rows: [['A', 12], ['B', 0]] },
      { type: 'callout', tone: 'warn', text: '注意\n数据尚未结算' },
      { type: 'steps', items: [{ label: '收到', status: 'done' }, { label: '处理中', status: 'current', detail: '等待确认' }, { label: '完成', status: 'todo' }] },
      { type: 'keyValue', items: [['负责人', 'taek']] },
    ] })
    expect(processGenuiSpec(meta).spec).toEqual(processGenuiSpec(original).spec)
    expect(spec).toEqual(original)
    expect(JSON.parse(JSON.stringify(meta))).toEqual(meta)
  })

  it('aligns series by label, retaining gaps and zeroes', () => {
    expect(toDshGoView({ items: [{ type: 'chart', kind: 'line', data: [], series: [
      { label: 'A', data: [{ label: 'Jan', value: 0 }, { label: 'Feb', value: null }] },
      { label: 'B', data: [{ label: 'Feb', value: 5 }, { label: 'Mar', value: 9 }] },
    ] }] })?.children).toEqual([{ type: 'chart', kind: 'line', categories: ['Jan', 'Feb', 'Mar'], series: [
      { name: 'A', values: [0, null, null] }, { name: 'B', values: [null, 5, 9] },
    ] }])
  })

  it('preserves default completed steps and card headings', () => {
    expect(toDshGoView({ items: [{ type: 'card', title: 'Card', eyebrow: 'Section', items: [
      { type: 'steps', steps: [{ title: 'Done' }] },
    ] }] })?.children).toEqual([{ type: 'stack', children: [
      { type: 'text', text: 'Section' }, { type: 'text', text: 'Card' },
      { type: 'steps', items: [{ label: 'Done', status: 'done' }] },
    ] }])
  })

  it.each([
    { items: [{ type: 'button', label: 'Submit', action: 'submit' }] },
    { items: [{ type: 'echart', option: { series: [] } }] },
    { items: [{ type: 'chart', stacked: true, data: [{ label: 'A', value: 5 }] }] },
    { items: [{ type: 'chart', data: [{ label: 'A', value: 1 }, { label: 'A', value: 2 }] }] },
    { items: [{ type: 'table', columns: ['A'], rows: [[1]], details: [[{ type: 'text', content: 'detail' }]] }] },
    { items: [{ type: 'text', content: 'Panel' }], panel: true },
  ])('keeps unsupported cards on the full web path, with no partial native card: %j', value => {
    expect(toDshGoView(value as GenuiSpec)).toBeNull()
  })

  it('keeps advanced component metadata intact when native projection is unavailable', () => {
    const input = { items: [{ type: 'button', label: 'Continue', action: 'continue' }] }
    const meta = createRenderUiTool().output.presentationMeta!({ spec: input })
    expect(meta).toEqual(processGenuiSpec(input).spec)
  })

  it('rejects native budgets without truncation, including UTF-8 byte length', () => {
    expect(toDshGoView({ items: Array.from({ length: 17 }, () => ({ type: 'text', content: 'x' })) })).toBeNull()
    expect(toDshGoView({ items: [{ type: 'text', content: 'x'.repeat(2001) }] })).toBeNull()
    expect(toDshGoView({ items: Array.from({ length: 3 }, () => ({ type: 'text', content: '界'.repeat(1000) })) })).toBeNull()
    expect(toDshGoView({ items: [{ type: 'table', columns: ['A'], rows: Array.from({ length: 51 }, () => [1]) }] })).toBeNull()
    let deep: GenuiSpec = { items: [{ type: 'text', content: 'deep' }] }
    for (let i = 0; i < 6; i++) deep = { items: [{ type: 'col', items: deep.items }] }
    expect(toDshGoView(deep)).toBeNull()
    expect(toDshGoView({ items: Array.from({ length: 4 }, () => ({ type: 'row', items: Array.from({ length: 10 }, () => ({ type: 'text', content: 'node' })) })) })).toBeNull()
  })

  it('never throws on malformed replay input', () => {
    for (const value of [null, {}, { items: [null] }, { items: [{ type: 'row' }] }]) {
      expect(toDshGoView(value as GenuiSpec)).toBeNull()
    }
  })
})
