import { describe, expect, it } from 'vitest'
import { completeFenceJson, repairFenceJson } from '../src/shared/fence-repair.ts'
import { resolveFence } from '../src/shared/fence-resolve.ts'

const title = String.raw`stm32 资料\参考手册\ 现在的内容`
const fence = `{"title":"${title}","gap":10,"items":[{"type":"list","items":["a"]}]}`

describe('fence JSON repair of invalid escapes (issue #467)', () => {
  it('preserves the reported Windows path in both repair tiers', () => {
    const text = JSON.stringify({ title, gap: 10, items: [{ type: 'list', items: ['a'] }] })
    for (const repair of [repairFenceJson, completeFenceJson]) {
      expect(repair(fence)).toEqual({ text, repairs: 2 })
    }
    expect(resolveFence(fence, { settled: true }).spec?.title).toBe(title)
  })

  it('only doubles illegal escapes in a string that also contains legal escapes', () => {
    const raw = String.raw`{"value":"C:\\bin\n\t\u4e2d\/\" \q \u12zz"}`
    const text = String.raw`{"value":"C:\\bin\n\t\u4e2d\/\" \\q \\u12zz"}`
    for (const repair of [repairFenceJson, completeFenceJson]) {
      expect(repair(raw)).toEqual({ text, repairs: 2 })
      expect(repair(text)).toBeNull()
    }
  })

  it('waits for settlement before supplying missing closing delimiters', () => {
    const raw = String.raw`{"items":[{"type":"text","content":"C:\项目"},`
    expect(repairFenceJson(raw)).toBeNull()
    expect(resolveFence(raw, { settled: false }).spec).toBeNull()
    expect(resolveFence(raw, { settled: true }).spec?.items).toEqual([
      { type: 'text', content: String.raw`C:\项目` },
    ])
  })

  it('retains both nodes when a repaired escape follows an already renderable node', () => {
    const raw = String.raw`{"items":[{"type":"text","content":"说明"},{"type":"text","content":"C:\项目"}]}`
    expect(resolveFence(raw, { settled: true }).spec?.items).toEqual([
      { type: 'text', content: '说明' },
      { type: 'text', content: String.raw`C:\项目` },
    ])
  })

  it('keeps following prose visible when only the JSON prefix can be repaired', () => {
    const tail = '\n围栏后的说明'
    expect(repairFenceJson(fence + tail)).toBeNull()
    expect(resolveFence(fence + tail, { settled: true })).toMatchObject({
      spec: null,
      unconsumedText: tail,
    })
  })
})
