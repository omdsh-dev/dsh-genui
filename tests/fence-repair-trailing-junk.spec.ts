// @vitest-environment jsdom
// Regression: a fence body that combines TWO defects — unescaped half-width
// quotes inside a value AND trailing junk after the root value — used to be
// unrecoverable, so the whole fence degraded to a code block with the red
// "JSON 解析失败" banner.
//
// Real sample (insight 主题调研, 2026-09-29): the model wrote
//   …并覆盖"不带开关 ⇒ enabled 为 False" ✓…          ← two raw quotes
//   …"columns":{"title":"…"}</p>                     ← stray HTML tag
// Tier-1 escapes the quotes but its contract is "the WHOLE body must parse",
// and tier-2 had the same contract, so both refused. Measured on that session's
// 539 fences: 37 unrenderable before, 22 after this fix (15 rescued).
import { describe, expect, it } from 'vitest'
import { completeFenceJson, repairFenceJson } from '../src/shared/fence-repair.ts'
import { resolveFence } from '../src/shared/fence-resolve.ts'

/** The exact body captured from the session log (quotes + `</p>`). */
const QUOTES_AND_JUNK = "{\"gap\": 8, \"items\": [{\"pairs\": [{\"key\": \"① 采集→博文 这条链已接通（两处，都可一行回退）\", \"value\": \"① **采集侧**：新增 `--save-blogs`（**默认关** ✗）+ `--save-limit-per-topic`（默认 20 ✓）⇒ 在**已有**取博文的那一轮里顺手 `save_blogs`（**零新增请求** ✓）；\\n② **编排侧**：collect 阶段 argv **显式打开** `--save-blogs` ✓，并在阶段 doc 记 `save_blogs = {enabled, limit_per_topic, round_saved_total, note}` ✓ —— **可回退 = 去掉那一个参数** ✓。\\n验证 ✓：**78 passed** ✓；用例断言的是**真实 argv 列表**与**阶段 doc 字段**（不是源码串 ✓），并覆盖\"不带开关 ⇒ enabled 为 False\" ✓；变异只做一次（删参数 ⇒ 恰好一条用例红 ✓，`cmp` 还原 ✓）。\"}, {\"key\": \"② 我暂不开最后一张 MR（避免又撞冲突）\", \"value\": \"**原因**：新卡改的文件与还没合的 **`!80`** **重叠**（都是 `scripts/tb2_autotrain.py` + `tests/test_autotrain_e2e.py` ✓）⇒ 如果现在就基于 `release` 开新 MR，会**再演一次今天那个冲突** ✗ ⇒ ⇒ **正确顺序**：你先把 **`!80`** 合掉（现在无冲突、2 文件 ✓）⇒ 我立刻开最后一张 ✓（那时它就只含新改动 ✓、天然无冲突 ✓）。\"}], \"type\": \"keyvalue\"}], \"title\": \"两张落库卡完成；等你合 !80 我再开最后一张 MR\"}</p>"

describe('tier-2: trailing junk after a complete root value', () => {
  it('repairs the real sample instead of dropping every repair', () => {
    // Tier-1 must stay strict: it also runs while streaming, where adopting a
    // balanced prefix could publish a half-written body.
    expect(repairFenceJson(QUOTES_AND_JUNK)).toBeNull()

    const completed = completeFenceJson(QUOTES_AND_JUNK)
    expect(completed).not.toBeNull()
    const value = JSON.parse(completed!.text) as { title?: string; items?: unknown[] }
    expect(value.title).toContain('两张落库卡完成')
    expect(value.items).toHaveLength(1)
    // The stray tag is gone; the escaped quotes survive inside the string.
    expect(completed!.text).not.toContain('</p>')
    expect(completed!.text).toContain('并覆盖\\"不带开关')
  })

  it('keeps the source visible instead of silently discarding the tail', () => {
    // Only a settled reply may use tier-2 (context.source exists in the client).
    expect(resolveFence(QUOTES_AND_JUNK, { settled: true }).spec).toBeNull()
    expect(resolveFence(QUOTES_AND_JUNK, { settled: true }).unconsumedText).toBe('</p>')
    expect(resolveFence(QUOTES_AND_JUNK, { settled: false }).spec).toBeNull()
  })

  it('returns trailing prose separately so callers cannot silently discard it', () => {
    const raw = '{"items":[{"type":"text","content":"好"}],"title":"尾随文字"}这是一句解释。'
    const completed = completeFenceJson(raw)
    expect(completed).not.toBeNull()
    expect(completed!.unconsumedText).toBe('这是一句解释。')
    expect(JSON.parse(completed!.text)).toEqual({ items: [{ type: 'text', content: '好' }], title: '尾随文字' })
  })

  it('still refuses when the root itself is invalid', () => {
    // Nothing JSON-shaped at all.
    expect(completeFenceJson('这不是 JSON，只是一句话')).toBeNull()
    // Junk after a balanced closer whose prefix is NOT valid JSON → the
    // fallback must not manufacture a body.
    expect(completeFenceJson('{"items": [broken} </p>')).toBeNull()
    // An unterminated root is still completed by the closer-append scan (that
    // is the pre-existing tier-2 contract, unchanged here).
    const truncated = completeFenceJson('{"items":[{"type":"text","content":"好"}]')
    expect(truncated).not.toBeNull()
    expect(JSON.parse(truncated!.text)).toEqual({ items: [{ type: 'text', content: '好' }] })
  })
})
