import { describe, expect, it } from 'vitest'
import { completeFenceJson, repairFenceJson } from '../src/shared/fence-repair.ts'
import { resolveFence } from '../src/shared/fence-resolve.ts'
import { createValidateDshUiTool } from '../src/plugin/tool.ts'

describe('CJK structural punctuation (issue #369)', () => {
  it.each(['，', '、', '；'])('repairs %s between members and array values in both tiers', separator => {
    const raw = `{"items":[{"type":"text"${separator}"content":"甲，乙、丙；丁："}]${separator}"values":[1${separator}true${separator}null]}`
    const expected = { items: [{ type: 'text', content: '甲，乙、丙；丁：' }], values: [1, true, null] }
    for (const repair of [repairFenceJson, completeFenceJson]) {
      const result = repair(raw)
      expect(result).not.toBeNull()
      expect(JSON.parse(result!.text)).toEqual(expected)
      expect(result!.repairs).toBe(4)
    }
  })

  it('keeps full-width colons out of field names', () => {
    const raw = '{"items"：[{"type"："text"，"content"："正文：不改"}]}'
    for (const repair of [repairFenceJson, completeFenceJson]) {
      const result = repair(raw)
      expect(result).not.toBeNull()
      expect(JSON.parse(result!.text)).toEqual({ items: [{ type: 'text', content: '正文：不改' }] })
    }
  })

  it('preserves punctuation in strings with escaped or repaired interior quotes', () => {
    const content = '说明 "甲，乙：丙、丁；" 继续'
    const raw = `{"items"：[{"type":"text"，"content":"${content}"}]} `
    for (const repair of [repairFenceJson, completeFenceJson]) {
      const result = repair(raw)
      expect(result).not.toBeNull()
      expect(JSON.parse(result!.text)).toEqual({ items: [{ type: 'text', content }] })
      const escaped = repair(raw.replace(content, JSON.stringify(content).slice(1, -1)))
      expect(JSON.parse(escaped!.text)).toEqual({ items: [{ type: 'text', content }] })
    }
  })

  it('composes punctuation, valueless keys and a trailing comma', () => {
    const raw = '{"unused"、"items"：[{"type":"text"；"content":"正文"，}]，}'
    for (const repair of [repairFenceJson, completeFenceJson]) {
      const result = repair(raw)
      expect(result).not.toBeNull()
      expect(JSON.parse(result!.text)).toEqual({ items: [{ type: 'text', content: '正文' }] })
    }
  })

  it.each(['，', '、', '；', '：'])('preserves an unescaped inch mark followed by %s inside prose', punctuation => {
    const content = `尺寸为5"${punctuation}适合桌面`
    const raw = `{"items":[{"type":"text","content":"${content}"}]}`
    for (const repair of [repairFenceJson, completeFenceJson]) {
      const repaired = repair(raw)
      expect(repaired).not.toBeNull()
      expect(JSON.parse(repaired!.text)).toEqual({ items: [{ type: 'text', content }] })
    }
  })

  it('only completes an unfinished body after settling', () => {
    const raw = '{"items"：[{"type":"text"，"content":"正文：保留"'
    expect(repairFenceJson(raw)).toBeNull()
    expect(resolveFence(raw, { settled: false }).spec).toBeNull()
    const completed = completeFenceJson(raw)
    expect(completed).not.toBeNull()
    expect(JSON.parse(completed!.text)).toEqual({ items: [{ type: 'text', content: '正文：保留' }] })
    expect(resolveFence(raw, { settled: true }).spec?.items).toEqual([{ type: 'text', content: '正文：保留' }])
  })

  it('uses the same repair for rendering and the pre-emission validator', async () => {
    const raw = '{"items"：[{"type":"text"，"content":"甲，乙："}]}'
    expect(resolveFence(raw, { settled: false }).spec?.items).toEqual([{ type: 'text', content: '甲，乙：' }])
    const verdict = String(await createValidateDshUiTool().execute({ spec: raw }))
    expect(verdict).toContain('repair=applied')
    expect(verdict).toContain('next=emit_repaired_fence')
    expect(JSON.parse(verdict.split('repaired_json:\n```\n')[1]!.split('\n```')[0]!)).toEqual({
      items: [{ type: 'text', content: '甲，乙：' }],
    })
  })

  it('leaves valid JSON and invalid bare values alone', () => {
    const valid = JSON.stringify({ '字段：，': '路径\\文件、保留；引号"：', values: [1, true, null] })
    for (const repair of [repairFenceJson, completeFenceJson]) {
      expect(repair(valid)).toBeNull()
      expect(repair('{"value"：broken}')).toBeNull()
    }
  })
})
