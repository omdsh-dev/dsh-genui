import { describe, expect, it } from 'vitest'
import {
  diagnoseUnknownGenuiFields,
  normalizeGenuiSpec,
  processGenuiSpec,
  repairGenuiSpec,
  validateGenuiSpec,
} from '../src/client/guard.ts'

describe('GenUI runtime schema normalization', () => {
  it('normalizes every issue #102 alias with stable warning paths', () => {
    const result = normalizeGenuiSpec({ items: [
      { type: 'card', label: '标题', content: [{ type: 'text', text: '卡片' }] },
      { type: 'table', headers: ['名称'], data: [['苹果']] },
      { type: 'callout', kind: 'warning', content: '注意' },
      { type: 'steps', items: [{ title: '第一步' }] },
    ] })
    expect(result.value).toEqual({ items: [
      { type: 'card', title: '标题', items: [{ type: 'text', content: '卡片' }] },
      { type: 'table', columns: ['名称'], rows: [['苹果']] },
      { type: 'callout', tone: 'warning', content: '注意' },
      { type: 'steps', steps: [{ title: '第一步' }] },
    ] })
    expect(result.warnings.map(warning => [warning.path, warning.field, warning.canonical])).toEqual([
      ['items[0].label', 'label', 'title'],
      ['items[0].content', 'content', 'items'],
      ['items[0].items[0].text', 'text', 'content'],
      ['items[1].headers', 'headers', 'columns'],
      ['items[1].data', 'data', 'rows'],
      ['items[2].kind', 'kind', 'tone'],
      ['items[3].items', 'items', 'steps'],
    ])
  })

  it('keeps canonical fields when an alias is also present', () => {
    const result = normalizeGenuiSpec({ items: [
      { type: 'card', title: 'canonical', label: 'legacy', items: [], content: [{ type: 'text', content: 'ignored' }] },
      { type: 'table', columns: ['canonical'], headers: ['legacy'], rows: [], data: [['ignored']] },
    ] })
    expect(result.value).toEqual({ items: [
      { type: 'card', title: 'canonical', items: [] },
      { type: 'table', columns: ['canonical'], rows: [] },
    ] })
    expect(result.warnings).toHaveLength(4)
    expect(validateGenuiSpec(result.value).ok).toBe(true)
    expect(normalizeGenuiSpec(result.value)).toEqual({ value: result.value, warnings: [] })
  })

  it('retains existing compatibility aliases and table object semantics', () => {
    const result = processGenuiSpec({ items: [
      { type: 'text', text: '旧文本' },
      { type: 'badge', text: '文本徽章' },
      { type: 'badge', value: '值徽章' },
      { type: 'tabs', tabs: [{ label: '一', content: { type: 'text', content: '内容' } }] },
      { type: 'table', columns: [{ title: '名称', key: 'name' }], data: [{ name: '苹果' }] },
    ] })
    expect(result.errors).toEqual([])
    expect(result.repaired?.items).toEqual([
      { type: 'text', content: '旧文本' },
      { type: 'badge', label: '文本徽章' },
      { type: 'badge', label: '值徽章' },
      { type: 'tabs', tabs: [{ label: '一', items: [{ type: 'text', content: '内容' }] }] },
      { type: 'table', columns: ['名称'], rows: [['苹果']] },
    ])
  })

  it('warns for native unknown fields but keeps custom nodes opaque', () => {
    const native = diagnoseUnknownGenuiFields({ items: [
      { type: 'callout', content: 'x', typo: true },
      { type: 'custom-widget', typo: true, nested: { type: 'callout', kind: 'error' } },
    ] })
    expect(native).toHaveLength(1)
    expect(native[0]).toMatchObject({ path: 'items[0].typo', field: 'typo', type: 'callout' })
    const result = processGenuiSpec({ items: [
      { type: 'callout', content: 'x', typo: true },
      { type: 'custom-widget', typo: true },
    ] })
    expect(result.errors).toEqual([])
    expect(result.warnings.some(warning => warning.path === 'items[0].typo')).toBe(true)
    expect(result.warnings.some(warning => warning.path.includes('items[1]'))).toBe(false)
    expect(result.repaired?.items[1]).toEqual({ type: 'custom-widget', typo: true })
  })

  it('reports native nodes dropped by repair with declared/rendered counts', () => {
    const result = processGenuiSpec({ items: [
      { type: 'table', columns: {}, rows: 42 },
      { type: 'text', content: '保留' },
    ] })
    expect(result.declaredCount).toBe(2)
    expect(result.renderedCount).toBe(1)
    expect(result.errors.some(error => error.includes('declared 2, rendered 1'))).toBe(true)
    expect(result.repaired?.items).toEqual([{ type: 'text', content: '保留' }])
  })

  it('makes direct repair and validation consume canonical aliases', () => {
    const raw = { items: [
      { type: 'callout', kind: 'info', content: 'hello' },
      { type: 'steps', items: [{ title: 'one' }] },
    ] }
    expect(validateGenuiSpec(raw)).toEqual({ ok: true, errors: [] })
    expect(repairGenuiSpec(raw)).toEqual({ items: [
      { type: 'callout', content: 'hello', tone: 'info' },
      { type: 'steps', steps: [{ title: 'one' }] },
    ] })
  })
})
