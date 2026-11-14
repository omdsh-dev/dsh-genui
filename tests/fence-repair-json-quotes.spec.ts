// Synthetic regressions for issue #239. The original 539-fence corpus is not
// available here; these pin the three reported mixed-escaping shapes instead.
import { describe, expect, it, vi } from 'vitest'
import { completeFenceJson, repairFenceJson } from '../src/shared/fence-repair.ts'
import { resolveFence } from '../src/shared/fence-resolve.ts'

const snippets = [
  ['JSON object', String.raw`by_domain_delta_mean = {\"domain_absent": -0.230159}`],
  ['JSON array', String.raw`labels = [\"#全运会#","演唱会"]`],
  ['function call', String.raw`repo.query_topics(source=\"weibo_hot_search", limit=N)`],
] as const

function fence(value: string): string {
  return `{"items":[{"type":"keyvalue","pairs":[{"key":"例子","value":"${value}"}]}]}`
}

function parsedValue(text: string): string {
  return JSON.parse(text).items[0].pairs[0].value as string
}

describe('quote disambiguation for JSON-like text in values (issue #239)', () => {
  it.each(snippets)('repairs the reported %s shape in both tiers', (_name, snippet) => {
    const raw = fence(snippet)
    expect(() => JSON.parse(raw)).toThrow()
    const expected = snippet.replaceAll('\\"', '"')
    for (const repair of [repairFenceJson, completeFenceJson]) {
      const result = repair(raw)
      expect(result).not.toBeNull()
      expect(parsedValue(result!.text)).toBe(expected)
      expect(result!.repairs).toBeGreaterThan(0)
    }
  })

  it('tries whole-body quote alternatives before taking a shorter settled prefix', () => {
    const raw = '{"value":"嵌入 "one"} 然后继续"}'
    for (const repair of [repairFenceJson, completeFenceJson]) {
      const result = repair(raw)
      expect(result).not.toBeNull()
      expect(JSON.parse(result!.text)).toEqual({ value: '嵌入 "one"} 然后继续' })
    }
  })

  it('retains the longer settled prefix found by quote backtracking', () => {
    const raw = '{"value":"嵌入 "one"} 然后继续"}</p>'
    expect(repairFenceJson(raw)).toBeNull()
    const result = completeFenceJson(raw)
    expect(result).not.toBeNull()
    expect(JSON.parse(result!.text)).toEqual({ value: '嵌入 "one"} 然后继续' })
  })

  it('never absorbs junk into an already-valid original root', () => {
    const value = { value: 'say "one"' }
    const prefix = JSON.stringify(value)
    for (const junk of ['{"x":"two"}', ' extra "quoted" prose', '</p>']) {
      const raw = prefix + junk
      expect(repairFenceJson(raw)).toBeNull()
      const result = completeFenceJson(raw)
      expect(result).not.toBeNull()
      expect(JSON.parse(result!.text)).toEqual(value)
      expect(result!.text).toBe(prefix)
    }
  })

  it('keeps commas and brackets inside repaired strings', () => {
    const snippet = '示例 "逗号, } 与括号, ]" 结束'
    for (const repair of [repairFenceJson, completeFenceJson]) {
      const result = repair(fence(snippet))
      expect(result).not.toBeNull()
      expect(parsedValue(result!.text)).toBe(snippet)
    }
  })

  it.each(snippets)('reports the unconsumed tail when repairing %s', (_name, snippet) => {
    const raw = `${fence(snippet)}</p>`
    expect(repairFenceJson(raw)).toBeNull()
    const completed = completeFenceJson(raw)
    expect(completed).not.toBeNull()
    expect(parsedValue(completed!.text)).toBe(snippet.replaceAll('\\"', '"'))
    // Repair may recover the JSON, but rendering must not hide the original tail.
    expect(completed!.unconsumedText).toBe('</p>')
    expect(resolveFence(raw, { settled: true }).unconsumedText).toBe('</p>')
    expect(resolveFence(raw, { settled: true }).spec).toBeNull()
    expect(resolveFence(raw, { settled: false }).spec).toBeNull()
  })

  it('composes quoted snippets, trailing commas and missing terminators', () => {
    const raw = fence(snippets[2][1]).slice(0, -3) + ','
    expect(repairFenceJson(raw)).toBeNull()
    const completed = completeFenceJson(raw)
    expect(completed).not.toBeNull()
    expect(parsedValue(completed!.text)).toBe('repo.query_topics(source="weibo_hot_search", limit=N)')
  })

  it('preserves genuine sibling fields, nested values and their escapes', () => {
    const raw = `{"value":"${snippets[0][1]}","siblings":[true,false,null,-1.2e3,{"label":"say \\\"ok\\\"","path":"C:\\\\tools"}],"tail":"after"}`
    const expected = {
      value: 'by_domain_delta_mean = {"domain_absent": -0.230159}',
      siblings: [true, false, null, -1200, { label: 'say "ok"', path: 'C:\\tools' }],
      tail: 'after',
    }
    for (const repair of [repairFenceJson, completeFenceJson]) {
      const result = repair(raw)
      expect(result).not.toBeNull()
      expect(JSON.parse(result!.text)).toEqual(expected)
    }
  })

  it('does not change valid punctuation-ambiguous JSON or escape sequences', () => {
    const values = [
      '嵌入 {"first":"one", "second":"two"} 然后继续',
      '"key": ["a", "b"], } ] :',
      String.raw`C:\\tools\name "quote" \\ tail`,
    ]
    for (const value of values) {
      const raw = JSON.stringify({ items: [{ type: 'text', content: value }], extra: [true, false, null, -1.2e3] })
      expect(repairFenceJson(raw)).toBeNull()
      expect(completeFenceJson(raw)).toBeNull()
    }
  })

  it('preserves existing escaped quotes and backslashes while repairing', () => {
    const snippet = String.raw`C:\\tools\\name says \"ok\"; tab=\t; source=\"weibo_hot_search", limit=N)`
    const raw = fence(snippet)
    const expected = 'C:\\tools\\name says "ok"; tab=\t; source="weibo_hot_search", limit=N)'
    for (const repair of [repairFenceJson, completeFenceJson]) {
      const result = repair(raw)
      expect(result).not.toBeNull()
      expect(parsedValue(result!.text)).toBe(expected)
    }
  })

  it('does not manufacture a value for invalid bare tokens', () => {
    for (const raw of ['{"x":broken}', '{"x":"ok","y":broken}', '{"x":"ok":broken}', '{"x":[true,broken]}', String.raw`{"x":["say \"ok\"",broken]}`, 'not JSON']) {
      expect(repairFenceJson(raw)).toBeNull()
      expect(completeFenceJson(raw)).toBeNull()
    }
  })

  it('handles deep structures and long quote runs without recursive search', () => {
    const depth = 2000
    const raw = '['.repeat(depth) + '"' + '"'.repeat(20000) + 'tail"' + ']'.repeat(depth)
    const repaired = repairFenceJson(raw)
    expect(repaired).not.toBeNull()
    let value: unknown = JSON.parse(repaired!.text)
    for (let i = 0; i < depth; i++) value = (value as unknown[])[0]
    expect(value).toBe('"'.repeat(20000) + 'tail')
  })

  it('bounds ambiguous search even with thousands of suspicious terminators', () => {
    const values = Array.from({ length: 2000 }, () => 'say "a" tail')
    const prefix = '{"values":[' + values.map(value => `"${value}"`).join(',') + ']}'
    const raw = `${prefix} trailing junk`
    for (const repair of [repairFenceJson, completeFenceJson]) {
      const parse = vi.spyOn(JSON, 'parse')
      let result: ReturnType<typeof repair>
      try {
        result = repair(raw)
        // Initial body/prefix checks, at most 32 candidate parses and 32
        // prefix validations. This is a deterministic cap, not a timing test.
        expect(parse.mock.calls.length).toBeLessThanOrEqual(66)
        if (repair === completeFenceJson) expect(parse.mock.calls.length).toBeGreaterThan(2)
      } finally {
        parse.mockRestore()
      }
      if (repair === repairFenceJson) expect(result!).toBeNull()
      else expect(JSON.parse(result!.text)).toEqual({ values })
    }
  })
})
