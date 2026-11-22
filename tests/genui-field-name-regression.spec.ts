// Regression corpus for the fence-killing field-name defects observed in two
// real sessions (2026-09-15, dsh-genui 0.10.0 / upstream main 0.11.1-preview.1):
// 62 emitted ```dsh-ui fences, 17 of which never rendered. Every one of the 17
// was a single component dropped by repair — `callout.text`, `table` without
// `columns`, `keyvalue.items` — which fails `isRenderableProcess` and sends the
// WHOLE fence back to a raw code block (fence-render.tsx → resolveGenuiSpec
// null → FenceFallback / DOM-channel "keep the stock block").
//
// The bodies below are reduced but shape-faithful samples of those fences
// (values trimmed, field names verbatim). Each must render; a regression here
// means a user sees raw JSON instead of the UI the model intended.
import { describe, expect, it } from 'vitest'
import { processGenuiSpec, isRenderableProcess } from '../src/client/guard.ts'
import { parsePartialGenuiSpec } from '../src/client/parse-partial.ts'

/** The render decision the fence channels actually make, minus React. */
function renders(raw: string): boolean {
  const parsed = parsePartialGenuiSpec(raw)
  if (parsed === null) return false
  return isRenderableProcess(processGenuiSpec(parsed))
}

describe('field-name regression corpus (real-session fences)', () => {
  it.each([
    ['callout 正文写成 text', '{"title":"内网待办","items":[{"type":"callout","tone":"warning","title":"待确认","text":"① registry push 未执行；② 镜像源待确认。"}]}'],
    ['callout 正文写成 body', '{"items":[{"type":"callout","body":"注意：写入前先备份。"}]}'],
    ['keyvalue 用 items 装键值对', '{"title":"设计定稿","items":[{"type":"keyvalue","items":[["设计文档","plans/result-export.md"],["提交","03afb1e"]]}]}'],
    ['keyvalue 用 rows 装键值对', '{"items":[{"type":"keyvalue","rows":[{"key":"任务卡","value":"7/7"},{"key":"pytest","value":"327 passed"}]}]}'],
    ['table 只给 data 二维数组', '{"title":"交付汇总","items":[{"type":"table","data":[["任务","负责人","结果"],["t1 实现","engineer","✅ 550 行"],["t2 测试","engineer","✅ 213 项"]]}]}'],
    ['table 只给 headers+data', '{"items":[{"type":"table","headers":["检查项","结果"],"data":[["/health","200 OK"],["首页未登录","302 → CAS"]]}]}'],
    ['diff 用 items', '{"items":[{"type":"diff","items":[{"path":"app/api.py","oldText":null,"newText":"def export_csv(): ..."}]}]}'],
    ['image 用 url', '{"items":[{"type":"image","url":"https://example.com/a.png","alt":"封面"}]}'],
    ['code 用 content', '{"items":[{"type":"code","lang":"python","content":"rows_to_csv(rows)"}]}'],
    ['copy 用 content', '{"items":[{"type":"copy","content":"git push origin main"}]}'],
    ['quiz 用 title+choices', '{"items":[{"type":"quiz","title":"哪个是只读语句？","choices":["SELECT","INSERT"],"answer":0}]}'],
  ])('renders a fence whose component uses the model-intuitive field name: %s', (_label, raw) => {
    expect(renders(raw)).toBe(true)
  })

  it.each([
    ['mermaid', 'flowchart TD\n A-->B'],
    ['svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'],
  ])('renders %s when the model puts its source in content or text (issue #466)', (type, code) => {
    for (const field of ['content', 'text']) {
      expect(renders(JSON.stringify({ items: [{ type, [field]: code }] }))).toBe(true)
    }
    // Canonical source wins if supplied. A non-string alias still fails validation.
    const canonical = processGenuiSpec({ items: [{ type, code, content: 'ignored' }] })
    expect(canonical.repaired?.items[0]).toMatchObject({ type, code })
    const invalid = processGenuiSpec({ items: [{ type, content: 42 }] })
    expect(invalid.errors).toContain(`items[0]: type '${type}' requires code (string)`)
    expect(isRenderableProcess(invalid)).toBe(false)
  })

  // Issue #186 corpus: high-frequency miswrites observed across ten degraded
  // real-session fences (0.11.0 / DSH 0.1.5-rc.2). Each must now render
  // outright — the aliases/normalization fix them before validation.
  it.each([
    ['table 用 items 装二维数组且缺 columns', '{"items":[{"type":"table","items":[["检查项","结果"],["/health","200 OK"],["首页未登录","302 → CAS"]]}]}'],
    ['keyvalue 记录写成 {label,value}', '{"items":[{"type":"keyvalue","items":[{"label":"任务卡","value":"7/7"},{"label":"pytest","value":"327 passed"}]}]}'],
    ['file-tree 用 nodes 且记录写成 {label,desc,children}', '{"items":[{"type":"file-tree","nodes":[{"label":"src","desc":"源码","children":[{"label":"main.py"}]},{"label":"README.md"}]}]}'],
    ['callout tone 写 danger 且正文写成 desc', '{"items":[{"type":"callout","tone":"danger","desc":"镜像源待确认。"}]}'],
    ['根级直接发组件数组', '[{"type":"stat","label":"通过","value":"327"},{"type":"callout","content":"全部通过。"}]'],
  ])('renders an issue #186 miswrite outright: %s', (_label, raw) => {
    expect(renders(raw)).toBe(true)
  })

  it('unwraps a double-encoded fence body (issue #186 case 8)', () => {
    const inner = JSON.stringify({ items: [{ type: 'stat', label: '通过', value: '327' }] })
    // The whole spec arrived as a JSON string (literal \" in the fence body).
    expect(renders(JSON.stringify(inner))).toBe(true)
    const parsed = parsePartialGenuiSpec(JSON.stringify(inner))
    expect(parsed).not.toBeNull()
    expect(processGenuiSpec(parsed).repaired?.items).toEqual([{ type: 'stat', label: '通过', value: '327' }])
  })

  it('repairs the issue #186 shapes into canonical trees', () => {
    const processed = processGenuiSpec(JSON.parse('{"items":[{"type":"file-tree","nodes":[{"label":"src","children":[{"label":"main.py"}]}]}]}'))
    // label→name at every depth, `type:dir` defaulted for parents, stray
    // record fields (desc) dropped silently by repair.
    expect(processed.repaired?.items[0]).toEqual({
      type: 'file-tree',
      items: [{ name: 'src', type: 'dir', children: [{ name: 'main.py' }] }],
    })
    const callout = processGenuiSpec(JSON.parse('{"items":[{"type":"callout","tone":"danger","desc":"x"}]}'))
    expect(callout.repaired?.items[0]).toEqual({ type: 'callout', content: 'x', tone: 'error' })
    const table = processGenuiSpec(JSON.parse('{"items":[{"type":"table","items":[["检查项","结果"],["/health","200"]]}]}'))
    expect(table.repaired?.items[0]).toEqual({ type: 'table', columns: ['检查项', '结果'], rows: [['/health', '200']] })
  })

  it('renders the two real large fences end to end', () => {    // The MR17072 risk-inventory fence (api.shop.sc.weibo.com session): a
    // callout + 8-row table + list, previously degraded to one code block.
    const riskInventory = JSON.stringify({
      title: 'MR !7072 代码评审 · 潜在风险清单',
      gap: 14,
      items: [
        { type: 'callout', tone: 'error', title: '阻断项：MR 自带的 CI 用例在 HEAD 上是红的', text: '断言 Meituanoffline.php 不得出现 fetch_row，但 HEAD 又改回去了。' },
        {
          type: 'table',
          columns: ['级别', '位置', '问题', '后果'],
          rows: [
            ['阻断', 'tests/FixjdstatusControllerTest.php:135', 'R1 的 fetch_one 修复被 HEAD 回退', 'CI 必红，合不进去'],
            ['高', 'Fixjdstatus.php:650,658', 'sync 的 .sync_offset 在 dry-run 时也落盘', '先跑 dry-run 会静默空跑'],
            ['中', 'Model/Product/Updatecount.php:230-235', '告警名额先占用再删除', '发送失败时该窗口没有告警'],
            ['低', 'Jd/Info.php + 5 处调用方', '返回值契约变更', '已逐个核查，无回归'],
          ],
        },
        {
          type: 'list',
          items: [
            { title: '先定 R1 口径', description: '恢复 fetch_one 并保留守卫用例，或同步删掉用例与文档结论' },
            { title: 'offset 写入加 if ($do)', description: '只在批量真正写入成功后才推进' },
          ],
        },
      ],
    })
    expect(renders(riskInventory)).toBe(true)

    // The result-export design fence (clickhouse session): a nested-array
    // list plus keyvalue, previously degraded to one code block.
    const designSummary = JSON.stringify({
      title: '结果导出 CSV · 设计定稿',
      gap: 12,
      items: [
        {
          type: 'list',
          items: [
            ['数据源：点击导出时服务端重查该 Tab 原始 SQL（走 /api/query 全管线）'],
            ['格式：仅 CSV（RFC 4180 + UTF-8 BOM）'],
            ['文件名：<表名>-<YYYYMMDD-HHMMSS>.csv'],
          ],
        },
        { type: 'keyvalue', items: [['设计文档', 'plans/result-export.md'], ['提交', '03afb1e（已推送）']] },
      ],
    })
    expect(renders(designSummary)).toBe(true)
  })

  it('documents the still-open object-array table case', () => {
    // `{type:'table', data:[{col:…}, …]}` with NO columns is still dropped:
    // object rows carry their own header keys, and deriving columns from them
    // without a declared column set is a separate design decision (it would
    // silently invent column order). It stays a known gap, not a silent fix.
    expect(renders('{"items":[{"type":"table","data":[{"tool":"a","result":"✅"}]}]}')).toBe(false)
  })

  it('renders and repairs the cell-dump shapes the model writes for lists/pairs', () => {
    const parsed = parsePartialGenuiSpec(JSON.stringify({
      items: [
        { type: 'list', items: [['数据源：a'], ['格式：b']] },
        { type: 'list', items: [{ title: '先定 R1 口径', description: '恢复 fetch_one' }] },
        { type: 'keyvalue', items: [['设计文档', 'plans/x.md']] },
      ],
    }))
    expect(parsed).not.toBeNull()
    const processed = processGenuiSpec(parsed as unknown)
    expect(processed.errors).toEqual([])
    expect(isRenderableProcess(processed)).toBe(true)
    // Without these the list renders EMPTY and the keyvalue loses every pair —
    // both are "renders but shows nothing" variants of the same field-name
    // class of defect.
    expect(processed.repaired?.items).toEqual([
      { type: 'list', items: ['数据源：a', '格式：b'] },
      { type: 'list', items: [{ title: '先定 R1 口径', desc: '恢复 fetch_one' }] },
      { type: 'keyvalue', pairs: [{ key: '设计文档', value: 'plans/x.md' }] },
    ])
  })

  it('leaves canonical bodies untouched (no alias churn)', () => {
    const canonical = JSON.stringify({
      title: '合法围栏',
      items: [
        { type: 'callout', tone: 'info', title: '标题', content: '正文' },
        { type: 'keyvalue', pairs: [{ key: 'k', value: 'v' }] },
        { type: 'table', columns: ['a'], rows: [['1']] },
      ],
    })
    const parsed = parsePartialGenuiSpec(canonical)
    expect(parsed).not.toBeNull()
    const processed = processGenuiSpec(parsed as unknown)
    expect(processed.errors).toEqual([])
    expect(processed.warnings).toEqual([])
    expect(processed.repaired?.items).toEqual([
      { type: 'callout', tone: 'info', title: '标题', content: '正文' },
      { type: 'keyvalue', pairs: [{ key: 'k', value: 'v' }] },
      { type: 'table', columns: ['a'], rows: [['1']] },
    ])
  })
})
