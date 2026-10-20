// 真实 AgentLoop 集成测试：验证首次缺正文时提醒进入下一请求，
// 以及坏围栏修正只返回 reasoning 时，宿主重试仍能补出正文。
// 断言 provider 实际收到的请求、重试错误和最终会话正文。
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { LlmRuntime, LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { apply as applyGenui } from '../src/plugin/index.ts'

/** 交付提醒的稳定特征串，出现在 missingBodyCorrectionText 里。 */
const REMINDER_MARK = '本轮尚未产生正式回答'

const SPEC = JSON.stringify({ title: '集成测试', gap: 10, items: [{ type: 'callout', tone: 'info', title: '集成测试', content: '集成测试' }] })

/** 受控 provider：验证后可选先发坏围栏，再返回 reasoning-only 与正文。 */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(readonly repairBrokenFence: boolean) { super() }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const index = this.requests.length
    const chunks: StreamChunk[] = index === 1
      ? [
          { type: 'block-start', index: 0, blockType: 'tool-call' },
          { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-1', name: 'validate_dsh_ui', arguments: JSON.stringify({ spec: SPEC }) } },
          { type: 'finish', reason: { kind: 'tool-calls' } },
        ]
      : this.repairBrokenFence && index === 2
        ? [
            { type: 'block-start', index: 0, blockType: 'text' },
            { type: 'text-delta', index: 0, text: '```dsh-ui\n{"items":[{"type":"stat"}]}\n```' },
            { type: 'block-end', index: 0, block: { type: 'text', text: '```dsh-ui\n{"items":[{"type":"stat"}]}\n```' } },
            { type: 'finish', reason: { kind: 'stop' } },
          ]
      : index === (this.repairBrokenFence ? 3 : 2)
        ? [
            { type: 'block-start', index: 0, blockType: 'reasoning' },
            { type: 'reasoning-delta', index: 0, text: 'private reasoning draft' },
            { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'private reasoning draft' } },
            { type: 'finish', reason: { kind: 'stop' } },
          ]
        : [
            { type: 'block-start', index: 0, blockType: 'text' },
            { type: 'text-delta', index: 0, text: '补上的正文。' },
            { type: 'block-end', index: 0, block: { type: 'text', text: '补上的正文。' } },
            { type: 'finish', reason: { kind: 'stop' } },
          ]
    return (async function* () { for (const chunk of chunks) yield chunk })()
  }
}

/** 把一次请求的 messages 摊平成可搜索文本。 */
function messageText(options: GenerateOptions): string {
  return (options.messages ?? [])
    .map(message => (message.content ?? []).map(block => (block as { text?: string }).text ?? '').join(' '))
    .join(' | ')
}

describe('真实 AgentLoop：reasoning-only 后的提醒与重试恢复', () => {
  it.each([
    { name: 'steers a delivery reminder into the next request', repairBrokenFence: false },
    { name: 'retries when a render correction returns reasoning only', repairBrokenFence: true },
  ])('$name', async ({ repairBrokenFence }) => {
    const ctx = new Context()
    for (const plugin of [SessionProjectionRegistry, SessionStore, AgentRegistry, SystemPrompt, ToolRuntime, LlmRuntime]) {
      await ctx.plugin(plugin)
    }
    applyGenui(ctx, {})
    // 工具注册走 inject fiber，给它一轮微任务落地。
    await new Promise(resolve => setTimeout(resolve, 100))

    const adapter = new ScriptedAdapter(repairBrokenFence)
    ctx.llm.registerAdapter(['mock'], adapter)
    await ctx.plugin(AgentLoop, { agents: [] })

    const agent = await ctx.agentLoop.create('agentloop-reasoning-only', { provider: 'mock', model: 'mock-model' })
    // kick() 会把 driver 内的失败吞在边界里，测试期间显式记录，避免「0 请求」无从归因。
    const failures: unknown[] = []
    ctx.on('agent/error', payload => { failures.push((payload as { error?: unknown }).error) })
    const requestErrors: string[] = []
    // Model the host retry policy, with one retry so a regression cannot loop.
    ctx.on('agent/request-error', ({ failure }) => {
      requestErrors.push(failure.code ?? '')
      if (failure.code === 'EMPTY_RESPONSE' && requestErrors.length === 1) return { kind: 'retry' as const }
    })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: '请展示界面' }],
      source: { kind: 'user' },
    }))
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        agent.whenIdle(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('AgentLoop 未能在 20 秒内进入空闲状态')), 20000)
        }),
      ])
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
    if (adapter.requests.length === 0 && failures.length > 0) {
      throw new Error(`agent 未发出请求，driver 报错：${String((failures[0] as Error)?.message ?? failures[0])}`)
    }

    expect(failures).toEqual([])
    expect(adapter.requests).toHaveLength(repairBrokenFence ? 4 : 3)
    expect(requestErrors).toEqual(repairBrokenFence ? ['EMPTY_RESPONSE'] : [])
    expect(messageText(adapter.requests[1]!)).not.toContain(REMINDER_MARK)
    expect(messageText(adapter.requests[2]!)).toContain(repairBrokenFence ? 'status=render_failed' : REMINDER_MARK)
    const finalAssistant = agent.session.snapshotEvents().filter(event => event.type === 'assistant/message').at(-1)
    expect(JSON.stringify(finalAssistant?.data)).toContain('补上的正文。')
  }, 30000)
})
