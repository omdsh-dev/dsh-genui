// @vitest-environment jsdom
// Partial genui parsing: while the fence body grows, finished components
// must extract and render; unfinished tails must drop.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { parsePartialGenuiSpec, collectPartialCandidates, setMaxPartialRepairAttempts } from '../src/client/parse-partial.ts'

afterEach(cleanup)

describe('parsePartialGenuiSpec', () => {
  it('parses a complete spec', () => {
    const spec = parsePartialGenuiSpec('{"items":[{"type":"text","content":"A"}]}')
    expect(spec?.items).toHaveLength(1)
  })

  it('wraps a single-component root into a col (documented fence vocabulary)', () => {
    // Regression: bare component bodies (no root `items`) were rejected —
    // the DOM channel kept the code block with a parse-failure warning.
    const spec = parsePartialGenuiSpec('{"type":"callout","tone":"info","title":"T","content":"c"}')
    expect(spec).not.toBeNull()
    expect(spec!.items).toHaveLength(1)
    expect((spec!.items[0] as { type: string }).type).toBe('callout')
  })

  it('hoists panel/append from a single-component root onto the wrapper', () => {
    const spec = parsePartialGenuiSpec('{"type":"text","content":"x","panel":true,"append":true}')
    expect(spec?.panel).toBe(true)
    expect(spec?.append).toBe(true)
  })

  it('still rejects non-component roots without an items array', () => {
    expect(parsePartialGenuiSpec('{"title":"x"}')).toBeNull()
    expect(parsePartialGenuiSpec('{"foo":1}')).toBeNull()
  })

  it('extracts finished components while the array is still growing', () => {
    // 第 1 个元素完成，第 2 个未写完 —— 应只返回第 1 个
    const spec = parsePartialGenuiSpec('{"items":[{"type":"text","content":"A"},{"type":"stat","labe')
    expect(spec?.items).toHaveLength(1)
    expect((spec!.items[0] as { type: string }).type).toBe('text')
  })

  it('extracts two finished components before the third', () => {
    const spec = parsePartialGenuiSpec('{"items":[{"type":"text","content":"A"},{"type":"stat","label":"B","value":"1"},{"type":"but')
    expect(spec?.items).toHaveLength(2)
    expect((spec!.items[0] as { type: string }).type).toBe('text')
    expect((spec!.items[1] as { type: string }).type).toBe('stat')
  })

  it('handles a trailing comma after the last finished element', () => {
    const spec = parsePartialGenuiSpec('{"items":[{"type":"text","content":"A"},')
    expect(spec?.items).toHaveLength(1)
  })

  it('returns null when no element is complete yet', () => {
    expect(parsePartialGenuiSpec('{"items":[{"type":"tex')).toBeNull()
    expect(parsePartialGenuiSpec('{"title":')).toBeNull()
  })

  it('does not choke on brackets inside strings', () => {
    const spec = parsePartialGenuiSpec('{"items":[{"type":"text","content":"a {b} [c] }"},{"type":"but')
    expect(spec?.items).toHaveLength(1)
    expect((spec!.items[0] as { content: string }).content).toBe('a {b} [c] }')
  })

  it('keeps escaping inside strings', () => {
    const spec = parsePartialGenuiSpec('{"items":[{"type":"code","code":"a \\"quote\\" b"},{"type":"di')
    expect(spec?.items).toHaveLength(1)
  })
})

describe('partial render while streaming', () => {
  it('renders finished components from an incomplete fence while streaming', () => {
    // 围栏没闭合、第 2 个组件没写完 —— 已完成的 text + stat 应渲染
    const partial = '```dsh-ui\n{"items":[{"type":"text","content":"你好"},{"type":"stat","label":"进度","value":"50%"},{"type":"but'
    const { container } = render(<MarkdownText text={partial} streaming />)
    // 已完成的组件渲染出来了
    expect(container.textContent).toContain('你好')
    expect(container.textContent).toContain('进度')
    // 未完成的按钮不渲染
    expect(container.textContent).not.toContain('button')
  })

  it('grows the render as more components complete', () => {
    const head = '```dsh-ui\n{"items":[{"type":"text","content":"A"},'
    const r1 = render(<MarkdownText text={head + '{"type":"text","content":"B"}'} streaming />)
    // 两个都完成
    expect(r1.container.textContent).toContain('A')
    expect(r1.container.textContent).toContain('B')
    r1.unmount()
    // 只有一个完成
    const r2 = render(<MarkdownText text={head} streaming />)
    expect(r2.container.textContent).toContain('A')
    expect(r2.container.textContent).not.toContain('B')
  })
})

describe('bounded repair (single scan, capped attempts)', () => {
  afterEach(() => {
    setMaxPartialRepairAttempts(32)
  })

  it('scans the pathological 24 KB / 8000-object input once, ≤32 candidates', () => {
    const items = Array.from({ length: 8000 }, (_, i) => `{"type":"text","content":"c${i}"}`).join(',')
    const raw = `{"items":[${items}`
    const { candidates, scannedChars } = collectPartialCandidates(raw)
    expect(scannedChars).toBe(raw.length) // one full pass, no re-scans
    expect(candidates.length).toBeLessThanOrEqual(32)
  })

  it('keeps total JSON.parse calls within 1 full + the repair budget', () => {
    const raw = '{"items":[' + Array.from({ length: 8000 }, (_, i) => `{"type":"text","content":"c${i}"}`).join(',') + ',"type":"bu'
    const parseSpy = vi.spyOn(JSON, 'parse')
    const result = parsePartialGenuiSpec(raw)
    expect(result).not.toBeNull()
    // The bound is an UPPER cap (1 full + the repair budget), not an exact
    // count — the pathological input usually recovers on the first candidate.
    expect(parseSpy.mock.calls.length).toBeLessThanOrEqual(33)
    parseSpy.mockRestore()
  })

  it('respects an injected smaller repair budget', () => {
    setMaxPartialRepairAttempts(4)
    const raw = '{"items":[' + Array.from({ length: 8000 }, (_, i) => `{"type":"text","content":"c${i}"}`).join(',') + ',"type":"bu'
    const parseSpy = vi.spyOn(JSON, 'parse')
    parsePartialGenuiSpec(raw)
    expect(parseSpy.mock.calls.length).toBeLessThanOrEqual(5) // 1 full + 4 repair attempts
    parseSpy.mockRestore()
  })

  it('still recovers the ordinary streaming prefixes (no regression)', () => {
    expect(parsePartialGenuiSpec('{"items":[{"type":"text","content":"A"},{"type":"stat","labe')?.items).toHaveLength(1)
    expect(parsePartialGenuiSpec('{"items":[{"type":"text","content":"A"},')?.items).toHaveLength(1)
    expect(parsePartialGenuiSpec('{"items":[{"type":"text","content":"a {b} [c] }"},{"type":"but')?.items).toHaveLength(1)
  })
})
