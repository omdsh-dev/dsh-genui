// @vitest-environment jsdom
// Fence fallback diagnostics: a malformed ```dsh-ui body must never fail
// silently. While the host marks the message as streaming ([data-streaming])
// a partial body is expected and renders as a plain code block; once the
// message settles, a body that still does not parse as JSON shows a visible
// diagnostic (role=alert) with the parse position, keeping the raw code
// block below so no content is lost.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderGenuiFence } from '../src/client/index.tsx'

afterEach(cleanup)

// A body that neither parses as whole JSON nor yields any partial spec:
// the string value is cut mid-way and there is no closing `}` anywhere, so
// the partial parser has nothing to recover → the renderer falls back to
// the plain code block (the settled-defect path).
const BROKEN = '{"title":"演示","items":[{"type":"text","content":"半截'

// A body that fails whole-JSON parsing but yields a usable partial prefix:
// `{"items":[{"type":"text","content":"好了"}]}` is a complete spec, so the
// partial parser renders it; the trailing `,` + unclosed `{` never reaches
// the fallback. This documents the design boundary: partial UI renders, no
// error banner (the banner is only for the no-usable-content path).
const TRAILING = '{"title":"演示","items":[{"type":"text","content":"好了"}]},{"type":"text","content":"尾巴"}'

describe('fence fallback diagnostics', () => {
  it('shows no diagnostic while the message is streaming', () => {
    render(<div data-streaming="true">{renderGenuiFence(BROKEN, 'k1')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    // The raw body stays visible as a code block during streaming.
    expect(document.body.textContent).toContain('半截')
  })

  it('surfaces the parse failure once the message settles', () => {
    const { rerender } = render(<div data-streaming="true">{renderGenuiFence(BROKEN, 'k2')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    rerender(<div>{renderGenuiFence(BROKEN, 'k2')}</div>)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('解析失败')
    // Raw content preserved below the diagnostic.
    expect(document.body.textContent).toContain('半截')
  })

  it('treats hosts without the streaming marker as settled on first mount', () => {
    render(<div>{renderGenuiFence(BROKEN, 'k3')}</div>)
    expect(screen.getByRole('alert').textContent).toContain('解析失败')
  })

  it('stays silent for a valid settled body', () => {
    render(<div>{renderGenuiFence('{"title":"好","items":[{"type":"text","content":"正常"}]}', 'k4')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).toContain('正常')
  })

  it('renders partial UI for trailing junk without the diagnostic', () => {
    const { rerender } = render(<div data-streaming="true">{renderGenuiFence(TRAILING, 'k5')}</div>)
    rerender(<div>{renderGenuiFence(TRAILING, 'k5')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    // The finished prefix renders as real UI.
    expect(document.body.textContent).toContain('好了')
  })

  it('keeps the raw body visible alongside the diagnostic', () => {
    render(<div>{renderGenuiFence(BROKEN, 'k6')}</div>)
    expect(screen.getByRole('alert').textContent).toContain('解析失败')
    expect(document.body.textContent).toContain('半截')
  })
})

describe('tier-2 structural repair (settled messages only)', () => {
  // The rows array is closed with `}` instead of `]` — ending `"1"]}]}]}`
  // where `"1"]]}]}` was meant. The stray `}` lands BEFORE the table
  // object's own `}`, so the partial parser has no recoverable prefix
  // (it breaks on the mismatch and never sees the table's `}`): tier-2 must
  // skip the mismatched closer and render the repaired spec — no banner.
  const STRAY_CLOSER =
    '{"title":"x","items":[{"type":"table","columns":["a"],"rows":[["1"]}]}]}]}'
  // A missing closer (plain truncation): tier-2 appends the missing `]` `}`.
  const MISSING_CLOSER =
    '{"title":"x","items":[{"type":"text","content":"半截'

  it('repairs a mismatched closer once settled', () => {
    render(<div>{renderGenuiFence(STRAY_CLOSER, 't1', { source: { id: 's', order: [1, 0, 0] } })}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    // The repaired table renders silently — no amber note.
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.body.textContent).toContain('1')
  })

  it('repairs a missing closer once settled', () => {
    render(<div>{renderGenuiFence(MISSING_CLOSER, 't2', { source: { id: 's', order: [1, 0, 0] } })}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.body.textContent).toContain('半截')
  })

  it('never applies structural repair while streaming', () => {
    render(<div data-streaming="true">{renderGenuiFence(STRAY_CLOSER, 't3')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.body.textContent).toContain('rows')
  })

  // The exact real-world failure that motivated this repair: a long table
  // spec whose rows-array close `]` was emitted as `}` (ending `"]}]}]}`
  // instead of `"]]}]}`). Parse error at the stray `}` (position 649 in the
  // original). Partial parsing cannot recover (the mismatch precedes the
  // table object's own `}`) — only tier-2's skip-the-mismatch can.
  const REAL_WORLD =
    '{"title":"DSH 侧可复用缝隙","gap":10,"items":[{"type":"table","columns":["缝隙","作用","recap 用法"],"rows":[["ctx.llm","provider 中立 LLM 流式服务","recap 生成调用（compact-basic / dsh-rewind 同款）"],["ctx.commands","人类直接命令注册（/compact 模式）","注册 /recap，直接执行、零模型轮询"],["session 事件流","append-only 事件源（user/message、tool/result、request/header…）","recap 从事件流折叠来源 + 追加 log-only session/recap 事件"],["ctx.sessionTitle","异步 LLM 会话元数据模板","复制它的 get/refresh/register 服务形态"],["ctx.sessionProjections + Cache","状态驱动折叠单元，持久化缓存供 GUI 冷读","把 recap 注册为投影单元，GUI 免读全量日志"],["ctx.sessionQuery","会话读取/搜索","recap 历史检索"],["client-modules","dsh.client 声明 + /plugins/<id>/client.js","Web UI 渲染 recap 卡片"]}]}]}'

  it('repairs the real-world mismatched rows close', () => {
    render(<div>{renderGenuiFence(REAL_WORLD, 't4', { source: { id: 's', order: [1, 0, 0] } })}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    // The repaired table renders all seven rows.
    expect(document.body.textContent).toContain('ctx.sessionQuery')
    expect(document.body.textContent).toContain('Web UI 渲染 recap 卡片')
  })
})

describe('spec healing (parseable but structurally invalid)', () => {
  it('shows repaired schema failure instead of the original JSON parse failure', () => {
    const REPAIRED_SCHEMA_FAILURE = '{"items":[{"type":"stat","value":"好",},]}'
    render(<div>{renderGenuiFence(REPAIRED_SCHEMA_FAILURE, 's0')}</div>)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('stat')
    expect(alert.textContent).toContain('label')
    expect(alert.textContent).not.toContain('解析失败')
  })

  it('heals defects silently and renders the UI', () => {
    render(<div>{renderGenuiFence(
      '{"title":"x","items":[{"type":"table","columns":["a"],"rows":[["1"]]},[],["callout","info","已排除","x"],{"type":"button","label":"ok","action":"a"}]}',
      's1',
    )}</div>)
    // Healed nodes are dropped without any amber note.
    expect(screen.queryByRole('note')).toBeNull()
    // The repaired UI still renders.
    expect(document.body.textContent).toContain('ok')
  })

  it('stays silent for a clean spec', () => {
    render(<div>{renderGenuiFence('{"title":"x","items":[{"type":"text","content":"干净"}]}', 's2')}</div>)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('ignores unknown-type entries (plugin custom components are valid)', () => {
    render(<div>{renderGenuiFence('{"items":[{"type":"custom-thing","x":1}]}', 's3')}</div>)
    expect(screen.queryByRole('note')).toBeNull()
  })
})

describe('automatic quote-escape repair', () => {
  // The most common model typo: Chinese text quoted with ASCII half-width
  // quotes inside a JSON string value — the exact failure that used to land
  // on the red banner (e.g. 对"别名路径"判定失败). The renderer must heal
  // it and render the UI instead of showing the diagnostic.
  const QUOTED = '{"title":"演示","items":[{"type":"text","content":"对"别名路径"判定失败"}]}'

  it('heals free-standing quotes inside string values and renders the UI', () => {
    render(<div>{renderGenuiFence(QUOTED, 'r1')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    // The repaired spec renders as real UI (not a raw code block).
    expect(document.body.textContent).toContain('判定失败')
    // The auto-repair stays silent.
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('keeps the raw body as a code block when repair cannot succeed', () => {
    // Broken in a way the narrow repair cannot heal: unbalanced brackets.
    const UNREPAIRABLE = '{"title":"x","items":[{"type":"text","content":"半截'
    render(<div>{renderGenuiFence(UNREPAIRABLE, 'r2')}</div>)
    expect(screen.getByRole('alert').textContent).toContain('解析失败')
    expect(document.body.textContent).toContain('半截')
  })

  it('does not touch already-valid JSON with escaped quotes', () => {
    const VALID = '{"title":"x","items":[{"type":"text","content":"他说\\"你好\\""}]}'
    render(<div>{renderGenuiFence(VALID, 'r3')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.body.textContent).toContain('你好')
  })

  it('repairs multiple quoted phrases in one body', () => {
    const MULTI = '{"title":"x","items":[{"type":"text","content":"他说"好的"然后"走了""}]}'
    render(<div>{renderGenuiFence(MULTI, 'r4')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).toContain('走了')
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('heals the real-world failure: a table whose cells contain ASCII-quoted Chinese', () => {
    // Regression: the exact production incident — a table where several cell
    // values quote Chinese with half-width quotes (watch 对"别名路径"判定失败,
    // 必须是"空的", 断言"空环境"失败). This body previously landed on the
    // red diagnostic banner; the repair must render the full table instead.
    const REAL = '{"title":"11 个失败全清单","gap":8,"items":[{"type":"table","columns":["测试文件","测的是什么","为什么挂","跟我有关？"],"rows":[["hmr-config ×2","开发时配置文件热更新的监听行为","测试路径带符号链接（机器上 ~/.dsh/source/current 是指向快照的链接），watch 逻辑对"别名路径"判定失败","❌ 基线就挂（已在没改动的原始快照上复现）"],["profile ×1","profile 目录自愈：把"错误的符号链接"替换成对的","Node 24 的已知 bug：rmSync 删不掉指向目录的符号链接（报 EISDIR），自愈一触发就崩——这是机器上 AGENTS.md 里记录过的老坑","❌ 基线就挂"],["workspace-context ×1","把默认 DSH 数据目录标签成 ~/.dsh","测试断言依赖 HOME 环境变量指向；测试环境里 HOME 指向的位置使断言落空","❌ 基线就挂"],["ui-trajectory client-bundle ×1","加载预构建的轨迹视图 bundle 并验证注册","需要预先构建好的 bundle 产物，产物与源码不同步（过期产物）","❌ 基线就挂"],["workflow-workerthread ×1","验证 worker 子进程的环境必须是"空的"","本机全局环境变量（NODE_USE_ENV_PROXY、TSX_TSCONFIG_PATH 等）泄漏进 worker，测试断言"空环境"失败","❌ 基线就挂（同一环境变量也干扰了别处）"],["oxlint-contract ×1","代码检查器（oxlint）的报错文本格式","文本匹配偶发超时；单独重跑通过","❌ 并行负载 flaky"],["code-block ×1","代码高亮语法的懒加载","超时类（11 秒限），负载高时变慢；单独重跑通过","❌ 并行负载 flaky"],["acp-snapshot ×3~4","快照测试框架的回合等待时序","依赖事件时序，并行跑时偶发；单独跑 60/60 全过","❌ 并行负载 flaky"]]}]}'
    render(<div>{renderGenuiFence(REAL, 'r5')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    // The repaired table renders (spot-check cells from the raw body).
    expect(document.body.textContent).toContain('hmr-config')
    expect(document.body.textContent).toContain('别名路径')
    expect(document.body.textContent).toContain('空环境')
    expect(document.body.textContent).toContain('acp-snapshot')
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('drops trailing commas (tier-1, safe at any time)', () => {
    // The partial parser tolerates a trailing comma and renders the finished
    // components — either way the user sees UI, never the red banner.
    const TRAILING = '{"title":"x","items":[{"type":"text","content":"好"},]}'
    render(<div>{renderGenuiFence(TRAILING, 'r6')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).toContain('好')
  })

  it('completes missing brackets for settled messages (tier-2)', () => {
    // A body cut mid-structure: the partial parser renders the finished
    // prefix as UI; a settled message additionally heals the whole body.
    const CUT = '{"title":"x","items":[{"type":"text","content":"补全"}'
    render(<div>{renderGenuiFence(CUT, 'r7', { sessionId: 's', source: { id: 'x', order: [1, 0, 0] } })}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).toContain('补全')
  })

  it('does NOT complete a cut body while streaming (no source)', () => {
    // Without `context.source` the body may still be growing — completing it
    // would flash premature UI. It must stay a plain code block.
    const CUT = '{"title":"x","items":[{"type":"text","content":"半截'
    render(<div data-streaming="true">{renderGenuiFence(CUT, 'r8')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).toContain('半截')
    // Even settled-but-source-less hosts (non-conversation surfaces) keep the
    // code block + diagnostic rather than inventing content.
    const { rerender } = render(<div data-streaming="true">{renderGenuiFence(CUT, 'r9')}</div>)
    rerender(<div>{renderGenuiFence(CUT, 'r9')}</div>)
    expect(screen.getByRole('alert').textContent).toContain('解析失败')
  })

  it('completes an unterminated string for settled messages (tier-2)', () => {
    const CUT = '{"title":"x","items":[{"type":"text","content":"没闭合'
    render(<div>{renderGenuiFence(CUT, 'r10', { sessionId: 's', source: { id: 'x', order: [1, 0, 0] } })}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).toContain('没闭合')
    expect(screen.queryByRole('note')).toBeNull()
  })
})
