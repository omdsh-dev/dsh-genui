// @vitest-environment jsdom
// DOM render channel: pure-plugin fence rendering on pristine hosts.
// Builds the stock CodeBlock surface (`.md-code-block` + banner label div +
// `<pre>`) inside a conversation row and drives the observer pipeline.
import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installDomFenceRenderer } from '../src/client/dom-fence.tsx'
import { inject } from '../src/client/index.tsx'
import { clearSessionPanel, getPanelSpec } from '../src/client/panel-store.ts'

const VALID_SPEC = '{"title":"卡片","items":[{"type":"text","content":"你好，世界"}]}'
const BUTTON_SPEC = '{"items":[{"type":"button","label":"刷新","action":"refresh"}]}'
const PANEL_SPEC = '{"panel":true,"title":"面板A","items":[{"type":"text","content":"A"}]}'
const BROKEN_SPEC = '{"items":[{"type":"text","content":'

function makeCtx(sessionId: string | undefined, send: ReturnType<typeof vi.fn>): Context {
  return {
    sessions: { list: { getSnapshot: () => ({ current: sessionId }) } },
  } as unknown as Context
}

/** Stock CodeBlock surface: wrapper.md-code-block > banner > label div + pre. */
function stockCodeBlock(raw: string, lang: string): HTMLElement {
  const block = document.createElement('div')
  block.className = 'md-code-block'
  const banner = document.createElement('div')
  const label = document.createElement('div')
  label.textContent = lang
  banner.appendChild(label)
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = raw
  pre.appendChild(code)
  block.appendChild(banner)
  block.appendChild(pre)
  return block
}

/** Deepsuite-style fence surface (issue #6): `.code-block` / span language
 * label + copy button in the banner, body wrapped in a content div. */
function deepsuiteCodeBlock(raw: string, lang: string, cls = 'code-block'): HTMLElement {
  const block = document.createElement('div')
  block.className = cls
  const banner = document.createElement('div')
  const label = document.createElement('span')
  label.textContent = lang
  const copy = document.createElement('button')
  copy.textContent = '复制'
  banner.appendChild(label)
  banner.appendChild(copy)
  const content = document.createElement('div')
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = raw
  pre.appendChild(code)
  content.appendChild(pre)
  block.appendChild(banner)
  block.appendChild(content)
  return block
}

function assistantRow(anchorKey: string, streaming = false): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('data-chat-anchor-key', anchorKey)
  row.setAttribute('data-chat-flow-kind', 'assistant-step')
  if (streaming) row.setAttribute('data-streaming', '')
  return row
}

async function tick(ms = 40): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('installDomFenceRenderer', () => {
  it('declares its cordis service injects (boot sweep depends on it)', () => {
    // 回归钉：曾丢失 inject 导出 → 宿主 fiber inject waiting 失效 →
    // apply 早于 slots 服务运行 → 整页 "Failed to load plugins"。
    expect([...inject].sort()).toEqual(['inputTriggers', 'sessions', 'slots'])
  })

  it('renders a settled dsh-ui fence into its own root and hides the stock block', async () => {
    const row = assistantRow('s7')
    const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(block.style.display).toBe('none')
      const container = row.querySelector('.genui-dom-fence')
      expect(container).not.toBeNull()
      expect(container!.textContent).toContain('你好，世界')
    } finally {
      dispose()
    }
  })

  it('ignores non-dsh-ui code blocks', async () => {
    const row = assistantRow('s8')
    const ts = stockCodeBlock('const x = 1', 'ts')
    const plain = stockCodeBlock('hello', '')
    row.appendChild(ts)
    row.appendChild(plain)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      expect(ts.hasAttribute('data-genui-rendered')).toBe(false)
      expect(plain.hasAttribute('data-genui-rendered')).toBe(false)
      expect(ts.style.display).toBe('')
    } finally {
      dispose()
    }
  })

  it('mounts while streaming once a component parses, and re-renders as the body grows', async () => {
    const row = assistantRow('s9', true)
    // Real host behaviour: the language label is EMPTY while streaming
    // (MarkdownText passes lang={streaming ? undefined : lang}) — the fence
    // is identified by content, not by label.
    const block = stockCodeBlock('{"items":[{"type":"text","content":"你好，世界"},{"type":"te', '')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      // Taken over during streaming: the first finished component renders.
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(block.style.display).toBe('none')
      const container = row.querySelector('.genui-dom-fence')
      expect(container).not.toBeNull()
      expect(container!.textContent).toContain('你好，世界')
      // The body grows: the second finished component appears without settle.
      block.querySelector('code')!.textContent = '{"items":[{"type":"text","content":"你好，世界"},{"type":"text","content":"第二块"}]}'
      await tick()
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('第二块')
    } finally {
      dispose()
    }
  })

  it('keeps the stock block visible while no component has finished (streaming half)', async () => {
    const row = assistantRow('s9b', true)
    const block = stockCodeBlock('{"items":[{"type":"text","content":', 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(block.style.display).toBe('')
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
      // The component closes: takeover happens while still streaming.
      block.querySelector('code')!.textContent = '{"items":[{"type":"text","content":"你好，世界"}]}'
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('你好，世界')
    } finally {
      dispose()
    }
  })

  it('publishes a streaming panel:true fence only after the reply settles', async () => {
    const row = assistantRow('s9c', true)
    const block = stockCodeBlock('{"panel":true,"title":"面板A","items":[{"type":"text","content":"A"}]', '')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      // Streaming: the block is taken over (hidden, empty root) but the
      // panel store stays untouched — identity-less renders never publish.
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(block.style.display).toBe('none')
      expect(row.querySelector('.genui-dom-fence')?.textContent).toBe('')
      expect(getPanelSpec('sess-1')).toBeNull()
      // Settle: the label materialises (host behaviour) and the mount
      // re-renders with the stable source → publish once.
      const label = block.querySelector('div')
      label!.textContent = 'dsh-ui'
      row.removeAttribute('data-streaming')
      await tick()
      expect(getPanelSpec('sess-1')?.title).toBe('面板A')
    } finally {
      dispose()
    }
  })

  it('restores the stock block when a content-identified fence settles as another language', async () => {
    const row = assistantRow('s9e', true)
    // A ```json fence whose streaming body happens to parse as a GenUI spec:
    // taken over by content while streaming, reverted once the label arrives.
    const block = stockCodeBlock('{"items":[{"type":"text","content":"你好，世界"}]', '')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(row.querySelector('.genui-dom-fence')).not.toBeNull()
      // Settle as ```json: the label says json → restore the stock block.
      const label = block.querySelector('div')
      label!.textContent = 'json'
      row.removeAttribute('data-streaming')
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(block.style.display).toBe('')
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
    } finally {
      dispose()
    }
  })

  it('re-applies the surgery when a host re-render wipes the container', async () => {
    const row = assistantRow('s9d', true)
    const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      const container = row.querySelector<HTMLElement>('.genui-dom-fence')
      expect(container).not.toBeNull()
      // Simulate a host React re-render dropping the foreign node and
      // resetting the hide during streaming.
      container!.remove()
      block.style.display = ''
      await tick()
      expect(container!.isConnected).toBe(true)
      expect(container!.previousElementSibling).toBe(block)
      expect(block.style.display).toBe('none')
    } finally {
      dispose()
    }
  })

  it('keeps the stock block visible for an unrepairable body', async () => {
    const row = assistantRow('s10')
    const block = stockCodeBlock(BROKEN_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(block.style.display).toBe('')
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
    } finally {
      dispose()
    }
  })

  it('relays component actions through the injected sender', async () => {
    const row = assistantRow('s11')
    const block = stockCodeBlock(BUTTON_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      const button = row.querySelector('.genui-dom-fence button')
      expect(button).not.toBeNull()
      fireEvent.click(button!)
      // The action rides the per-action trailing debounce (300ms).
      await tick(400)
      expect(send).toHaveBeenCalledTimes(1)
      const [sessionId, action] = send.mock.calls[0] as [string, string, unknown]
      expect(sessionId).toBe('sess-1')
      expect(action).toBe('refresh')
    } finally {
      dispose()
    }
  })

  it('publishes a panel:true fence to the panel store without mounting UI', async () => {
    const row = assistantRow('s12')
    const block = stockCodeBlock(PANEL_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(block.style.display).toBe('none')
      // The publisher renders nothing: the mounted root is an empty container.
      const container = row.querySelector('.genui-dom-fence')
      expect(container).not.toBeNull()
      expect(container!.textContent).toBe('')
      expect(getPanelSpec('sess-1')?.title).toBe('面板A')
    } finally {
      dispose()
    }
  })

  it('unmounts and restores the stock block when the row leaves the DOM', async () => {
    const row = assistantRow('s13')
    const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      row.remove()
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(block.style.display).toBe('')
      expect(block.isConnected).toBe(false)
    } finally {
      dispose()
    }
  })

  it('skips fences without a current session (renders with no persistence)', async () => {
    const row = assistantRow('s14')
    const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx(undefined, send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('你好，世界')
    } finally {
      dispose()
    }
  })
})

describe('anchor-less rows (Safari fallback render path)', () => {
  // 回归钉 #1: Safari 宿主渲染消息行时省略 data-chat-anchor-key（该属性是
  // React key 派生值，key 为 undefined 时 React 直接不渲染属性）→ rowOf 落空
  // → DOM 通道静默放弃所有围栏。降级链必须兜住：flow 行属性 → 代码块自身。
  it('renders a settled dsh-ui fence when the row lacks data-chat-anchor-key', async () => {
    const row = document.createElement('div')
    row.setAttribute('data-chat-flow-kind', 'assistant-step')
    const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-safari-1', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(block.style.display).toBe('none')
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('你好，世界')
    } finally {
      dispose()
    }
  })

  it('renders a fence with no owning row at all (block directly in the body)', async () => {
    const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    document.body.appendChild(block)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-safari-2', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(block.style.display).toBe('none')
      expect(document.querySelector('.genui-dom-fence')?.textContent).toContain('你好，世界')
    } finally {
      dispose()
    }
  })

  it('assigns distinct fallback identities to sibling fences in an anchor-less row', async () => {
    // 两个 panel:true 围栏在同一无锚点行内不得折叠成同一个 dom:unknown:N
    // source：后一个 fence 的 replace 应赢得 fold（证明是两个不同 source），
    // 而不是被当作第一个的幂等重放丢弃（那样快照会停在「面板A」）。
    const row = document.createElement('div')
    row.setAttribute('data-chat-flow-kind', 'assistant-step')
    const first = stockCodeBlock('{"panel":true,"title":"面板A","items":[{"type":"text","content":"A"}]}', 'dsh-ui')
    const second = stockCodeBlock('{"panel":true,"title":"面板B","items":[{"type":"text","content":"B"}]}', 'dsh-ui')
    row.appendChild(first)
    row.appendChild(second)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-safari-3', send), send)
    try {
      await tick()
      expect(getPanelSpec('sess-safari-3')?.title).toBe('面板B')
    } finally {
      dispose()
    }
  })

  it('warns once when the row anchor is missing, and stays silent for anchored rows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const anchored = assistantRow('s15')
    const anchoredBlock = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    anchored.appendChild(anchoredBlock)
    document.body.appendChild(anchored)
    const bare = document.createElement('div')
    const bareBlock = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    bare.appendChild(bareBlock)
    document.body.appendChild(bare)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-safari-4', send), send)
    try {
      await tick()
      await tick()
      const calls = warn.mock.calls.filter(([m]) => String(m).includes('[dsh-genui]'))
      // 恰好一条诊断：只有无锚点块；锚点块跨多轮 sweep 也不得告警。
      expect(calls).toHaveLength(1)
      expect(String(calls[0]![0])).toContain('data-chat-anchor-key')
      // 两个围栏都照常渲染（降级不丢内容）。
      expect(anchoredBlock.hasAttribute('data-genui-rendered')).toBe(true)
      expect(bareBlock.hasAttribute('data-genui-rendered')).toBe(true)
    } finally {
      dispose()
      warn.mockRestore()
    }
  })

  it('warns once for a settled unrepairable body', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const row = assistantRow('s16')
    const block = stockCodeBlock(BROKEN_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-safari-5', send), send)
    try {
      await tick()
      await tick()
      const calls = warn.mock.calls.filter(([m]) => String(m).includes('[dsh-genui]'))
      expect(calls).toHaveLength(1)
      expect(String(calls[0]![0])).toContain('does not parse')
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
    } finally {
      dispose()
      warn.mockRestore()
    }
  })
})

describe('persisted replay barrier across page refresh (issue #4)', () => {
  // 回归钉 #4: 宿主 anchor key 是 `<kindlen>:<kind><id>`，assistant step 的
  // id 是 `<turn>:<step>`（如 `14:assistant-step3:0`）。旧实现取 key 里第一个
  // 数字 = kind 长度常量 → 所有消息的 order[0] 相同 → 刷新后 replayBarrier
  // (= 持久化 maxSeenSeq = 该常量) 拒绝一切新 panel 围栏，dock 冻结且零日志。
  // 修复：order[0] 改为 turn*1000+step（随消息顺序严格单调），刷新后新消息
  // 的 turn 必然大于持久化屏障 → 正常更新。
  const PANEL = (title: string, content: string) =>
    `{"panel":true,"title":"${title}","items":[{"type":"text","content":"${content}"}]}`

  it('lets a new-turn panel fence update the dock after a refresh', async () => {
    const send = vi.fn()

    // ── 页面 1：turn 2 与 turn 3 的两个 panel 围栏（宿主真实 key 格式）──
    const row2 = assistantRow('14:assistant-step2:0')
    const blockA = stockCodeBlock(PANEL('面板A', 'A'), 'dsh-ui')
    row2.appendChild(blockA)
    document.body.appendChild(row2)
    const row3 = assistantRow('14:assistant-step3:0')
    const blockB = stockCodeBlock(PANEL('面板B', 'B'), 'dsh-ui')
    row3.appendChild(blockB)
    document.body.appendChild(row3)
    let dispose = installDomFenceRenderer(makeCtx('sess-refresh', send), send)
    try {
      await tick()
      expect(getPanelSpec('sess-refresh')?.title).toBe('面板B')

      // ── 刷新：内存态清空（localStorage 存活），新页面重装渲染器 ──
      dispose()
      clearSessionPanel('sess-refresh')
      document.body.innerHTML = ''
      dispose = installDomFenceRenderer(makeCtx('sess-refresh', send), send)
      await tick()

      // 历史重放（同一 DOM 重建）：被持久化屏障杀死，dock 保持面板B
      document.body.appendChild(row2)
      document.body.appendChild(row3)
      await tick()
      expect(getPanelSpec('sess-refresh')?.title).toBe('面板B')

      // ── 新消息（turn 4）：order[0]=4000 > 屏障 3000 → dock 必须更新 ──
      const row4 = assistantRow('14:assistant-step4:0')
      const blockC = stockCodeBlock(PANEL('面板C', 'C'), 'dsh-ui')
      row4.appendChild(blockC)
      document.body.appendChild(row4)
      await tick()
      expect(getPanelSpec('sess-refresh')?.title).toBe('面板C')
    } finally {
      dispose()
    }
  })

  it('keeps per-step monotonicity within one turn (later step wins)', async () => {
    // 同一 turn 内的多步：step 必须参与 seq，后一步的围栏覆盖前一步。
    const send = vi.fn()
    const rowA = assistantRow('14:assistant-step5:0')
    const blockA = stockCodeBlock(PANEL('面板甲', '甲'), 'dsh-ui')
    rowA.appendChild(blockA)
    document.body.appendChild(rowA)
    const rowB = assistantRow('14:assistant-step5:1')
    const blockB = stockCodeBlock(PANEL('面板乙', '乙'), 'dsh-ui')
    rowB.appendChild(blockB)
    document.body.appendChild(rowB)
    const dispose = installDomFenceRenderer(makeCtx('sess-refresh-step', send), send)
    try {
      await tick()
      expect(getPanelSpec('sess-refresh-step')?.title).toBe('面板乙')
    } finally {
      dispose()
    }
  })
})

describe('multi-surface discovery across host DOM shapes (issue #6)', () => {
  // 回归钉 #6: 宿主 DOM 的围栏表面并非只有 `.md-code-block`——deepsuite 风格
  // 渲染栈输出 `.code-block` / `.code-block-small`，语言标签是 span 而非 div，
  // 正文还可能被 content div 包裹。旧实现（单一选择器 + 只认 div 标签）在
  // 这类宿主上完全找不到围栏 → 静默保持代码块、控制台零报错。新实现按
  // label+pre 结构兜底识别，任何表面形态都能渲染。

  it('takes over a deepsuite-style .code-block surface (span label, wrapped body)', async () => {
    const row = assistantRow('s20')
    const block = deepsuiteCodeBlock(VALID_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-6-1', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(block.style.display).toBe('none')
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('你好，世界')
    } finally {
      dispose()
    }
  })

  it('takes over a .code-block-small surface', async () => {
    const row = assistantRow('s21')
    const block = deepsuiteCodeBlock(VALID_SPEC, 'dsh-ui', 'code-block-small')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-6-2', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('你好，世界')
    } finally {
      dispose()
    }
  })

  it('structural backstop: an unlisted surface class renders via label+pre, warning once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const row = assistantRow('s22')
    const block = deepsuiteCodeBlock(VALID_SPEC, 'dsh-ui', 'host-fence-v9')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-6-3', send), send)
    try {
      await tick()
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('你好，世界')
      // 漂移诊断恰好一条（跨多轮 sweep 不刷屏），且不再有「找不到围栏」式静默。
      const calls = warn.mock.calls.filter(([m]) => String(m).includes('围栏表面类名未被已知选择器命中'))
      expect(calls).toHaveLength(1)
    } finally {
      dispose()
      warn.mockRestore()
    }
  })

  it('never self-identifies through code that literally contains the text dsh-ui', async () => {
    // 代码体里出现 `dsh-ui` 字面量（如文档示例）不得让 json/ts 围栏误判为
    // dsh-ui：标签检查只认正文之外的叶子元素。
    const row = assistantRow('s23')
    const block = stockCodeBlock('{"items":[{"type":"text","content":"用 dsh-ui 围栏渲染"}]}', 'json')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-6-4', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(block.style.display).toBe('')
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
    } finally {
      dispose()
    }
  })

  it('only the outermost element of a nested modifier surface is taken over', async () => {
    // 宿主把 `code-block-small` 作为 `code-block` 的修饰子元素时，围栏只能
    // 接管一次（外层），不得把内外两层当两个围栏重复渲染。
    const row = assistantRow('s24')
    const outer = deepsuiteCodeBlock(VALID_SPEC, 'dsh-ui', 'code-block')
    const inner = document.createElement('div')
    inner.className = 'code-block-small'
    inner.textContent = 'modifier'
    outer.appendChild(inner)
    row.appendChild(outer)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-6-5', send), send)
    try {
      await tick()
      expect(outer.hasAttribute('data-genui-rendered')).toBe(true)
      expect(inner.hasAttribute('data-genui-rendered')).toBe(false)
      expect(outer.style.display).toBe('none')
      // 只挂了一个 genui 容器：内外层没有被当成两个围栏。
      expect(row.querySelectorAll('.genui-dom-fence')).toHaveLength(1)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('你好，世界')
    } finally {
      dispose()
    }
  })

  it('renders both fences when two .code-block surfaces sit side by side in one row', async () => {
    // 两个独立 deepsuite 围栏在同一行：不得被嵌套去重误伤，各自渲染且身份不折叠。
    const row = assistantRow('s25')
    const first = deepsuiteCodeBlock('{"panel":true,"title":"面板甲","items":[{"type":"text","content":"甲"}]}', 'dsh-ui')
    const second = deepsuiteCodeBlock('{"panel":true,"title":"面板乙","items":[{"type":"text","content":"乙"}]}', 'dsh-ui')
    row.appendChild(first)
    row.appendChild(second)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-6-6', send), send)
    try {
      await tick()
      expect(first.hasAttribute('data-genui-rendered')).toBe(true)
      expect(second.hasAttribute('data-genui-rendered')).toBe(true)
      expect(getPanelSpec('sess-6-6')?.title).toBe('面板乙')
    } finally {
      dispose()
    }
  })

  it('streaming takeover works on a deepsuite surface (content-identified, label verified at settle)', async () => {
    // 已知类名（.code-block）的异形表面与 .md-code-block 同权：流式期间按
    // 内容接管（首个完成组件即渲染），落定后按标签复核——异形表面不丢
    // 流式渲染能力。
    const row = assistantRow('s26', true)
    const block = deepsuiteCodeBlock('{"items":[{"type":"text","content":"你好，世界"},{"type":"te', '')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-6-7', send), send)
    try {
      await tick()
      // 流式：内容已解析出完成组件 → 已接管并渲染。
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('你好，世界')
      // 正文继续增长 → 实时重渲染。
      block.querySelector('code')!.textContent = '{"items":[{"type":"text","content":"你好，世界"},{"type":"text","content":"第二块"}]}'
      await tick()
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('第二块')
      // 落定：标签出现且是 dsh-ui → 保持渲染（带稳定身份）。
      block.querySelector('span')!.textContent = 'dsh-ui'
      row.removeAttribute('data-streaming')
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('你好，世界')
    } finally {
      dispose()
    }
  })
})

describe('shared markdown root with mixed code blocks (issue #13)', () => {
  // 回归钉 #13: 同一消息容器里 dsh-ui 围栏和 python/ts/bash 等普通代码块
  // 共存时，结构兜底从普通代码块的 <pre> 向上回溯，越过它自己的
  // .md-code-block 把共享的 .markdown 根容器误判为「dsh-ui 围栏」→ 整条消息
  // display:none，python 代码块被吞掉。兜底必须跳过已知表面的 <pre>，且
  // 标签判定不得认领嵌套代码块的 banner。

  /** Shared markdown root: the host renders one `.markdown` wrapper around
   * every code block of a message. */
  function markdownRoot(): HTMLElement {
    const root = document.createElement('div')
    root.className = 'markdown'
    return root
  }

  it('renders the dsh-ui fence and keeps a sibling python block untouched', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const row = assistantRow('s30')
    const root = markdownRoot()
    const genui = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    const python = stockCodeBlock('@dataclass\nclass LineSegment:\n    points: list', 'python')
    root.appendChild(genui)
    root.appendChild(python)
    row.appendChild(root)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-13-1', send), send)
    try {
      await tick()
      await tick()
      // dsh-ui 围栏正常接管；python 块与共享根容器都不许被隐藏或接管。
      expect(genui.hasAttribute('data-genui-rendered')).toBe(true)
      expect(genui.style.display).toBe('none')
      expect(python.hasAttribute('data-genui-rendered')).toBe(false)
      expect(python.style.display).toBe('')
      expect(python.textContent).toContain('LineSegment')
      expect(root.style.display).toBe('')
      // 恰好一个 genui 容器，且挂在 dsh-ui 块之后，而不是整条消息之后。
      expect(row.querySelectorAll('.genui-dom-fence')).toHaveLength(1)
      expect(root.querySelectorAll('.genui-dom-fence')).toHaveLength(1)
      const container = row.querySelector('.genui-dom-fence')
      expect(container?.previousElementSibling).toBe(genui)
      expect(container!.textContent).toContain('你好，世界')
      // 不该出现「未知表面类名」漂移告警：两个表面都是已知选择器命中的。
      const drift = warn.mock.calls.filter(([m]) => String(m).includes('围栏表面类名未被已知选择器命中'))
      expect(drift).toHaveLength(0)
    } finally {
      dispose()
      warn.mockRestore()
    }
  })

  it('renders the dsh-ui fence when the shared root contains TWO dsh-ui blocks', async () => {
    const row = assistantRow('s31')
    const root = markdownRoot()
    const first = stockCodeBlock(PANEL_SPEC, 'dsh-ui')
    const second = stockCodeBlock('{"panel":true,"title":"面板B","items":[{"type":"text","content":"B"}]}', 'dsh-ui')
    root.appendChild(first)
    root.appendChild(second)
    row.appendChild(root)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-13-2', send), send)
    try {
      await tick()
      // 两个 dsh-ui 块各自接管；面板 fold 走各自的 source，后者赢得 dock。
      expect(first.hasAttribute('data-genui-rendered')).toBe(true)
      expect(second.hasAttribute('data-genui-rendered')).toBe(true)
      expect(root.style.display).toBe('')
      expect(root.querySelectorAll('.genui-dom-fence')).toHaveLength(2)
      expect(getPanelSpec('sess-13-2')?.title).toBe('面板B')
    } finally {
      dispose()
    }
  })

  it('keeps the structural backstop working for an unknown surface beside a known python block', async () => {
    // 加固不能把结构兜底一并误杀：未知类名表面的 <pre> 没有已知祖先，仍要
    // 通过 label+pre 兜底被发现；旁边已知类名的 python 块继续被忽略。
    const row = assistantRow('s32')
    const root = markdownRoot()
    const unknown = deepsuiteCodeBlock(VALID_SPEC, 'dsh-ui', 'host-fence-v99')
    const python = stockCodeBlock('print("hello")', 'python')
    root.appendChild(unknown)
    root.appendChild(python)
    row.appendChild(root)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-13-3', send), send)
    try {
      await tick()
      expect(unknown.hasAttribute('data-genui-rendered')).toBe(true)
      expect(unknown.style.display).toBe('none')
      expect(python.hasAttribute('data-genui-rendered')).toBe(false)
      expect(python.style.display).toBe('')
      expect(root.style.display).toBe('')
      expect(root.querySelectorAll('.genui-dom-fence')).toHaveLength(1)
    } finally {
      dispose()
    }
  })
})
