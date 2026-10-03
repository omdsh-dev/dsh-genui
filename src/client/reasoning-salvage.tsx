/**
 * 从思考块抢救界面（salvage）。
 *
 * 模型的退化形态：把**完整的 `dsh-ui` 围栏写进 reasoning 块**，然后在正文里不输出
 * 任何内容就结束本轮。`fence-feedback` 会在同一轮内最多纠正两次，但真实会话里出现过
 * 「收到纠正后逐字节重放同一段 reasoning」——纠正消息确实进了上下文（`inputTokens`
 * 从 189 涨到 1016），模型仍然零 token 正文。那种情况下回合内任何重试都不会有结果。
 *
 * 这个兜底不依赖模型：宿主的 ChatSnapshot 把 reasoning 也作为 assistant block 暴露，
 * 所以客户端能确定性读到那份围栏正文并解析出 spec。当**正文里没有可渲染的围栏**、
 * 而 reasoning 里有完整且可渲染的一份时，把界面**内联挂回消息列表**——围栏本来就是这条
 * 通道挂在宿主 assistant 行里的（宿主的 slot 体系没有消息级插槽，只有 session/composer/
 * input.dock，所以内联只能走 DOM 通道，而这正是本插件渲染围栏的既有方式）。宿主行始终
 * 找不到时才退回会话面板 dock。
 *
 * 刻意保守，避免与正常渲染抢位置：
 * - 只在 assistant step `settled` / `interrupted` 之后动作，流式中绝不触发；
 * - 正文里只要有一份能渲染的围栏就完全不动（那是正常路径的产物）；
 * - 面板里已经有内容时**不覆盖**——但这只约束「退回面板」那一步，绝不能阻止内联
 *   （早期实现把两者混在一起，面板被旧版写过一次之后所有内联抢救全部失效）；
 * - 每个 assistant step 只评估一次（`session:nodeKey`），刷新回来也不会重复；
 * - 内联容器挂在宿主行之后，宿主重渲染把它摘掉时按 tick 修回（与 DOM 围栏通道同一策略）。
 *
 * @module @changfenhuang/dsh-genui/client/reasoning-salvage
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import type { AssistantBlock, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { resolveFence } from '../shared/fence-resolve.ts'
import { t } from './i18n/index.ts'
import { GenuiActionContext, type GenuiActionHandler } from './action-context.ts'
import { GenuiBlock } from './GenuiBlock.tsx'
import css from './GenuiBlock.module.css'
import { getPanelSpec, requestPanelExpand, setLocalPanel } from './panel-store.ts'
import { resolveViewedSessionId } from './session-resolver.ts'
import { sourceFencesOfAssistant, sourceFencesOfReasoning, type SourceFence } from './source-fence.ts'
import type { GenuiSpec } from './spec.ts'

/** 围栏语言：只有这一种会被抢救（svg 围栏不在此列）。 */
const FENCE_LANG = 'dsh-ui'

/** Assistant step 的状态（宿主 ChatSnapshot 的子集）。 */
export type SalvageStatus = 'running' | 'settled' | 'interrupted'

/** 一次抢救的产物：已经带上来源标注、可直接发布的面板 spec。 */
export interface SalvagePlan {
  /** 面板标题。 */
  readonly title: string
  /** 已标注来源、可直接 `setLocalPanel` 的 spec。 */
  readonly spec: GenuiSpec
}

/** 最后一份**能渲染**的 dsh-ui 围栏（从后往前找，最近的一份优先）。 */
function renderableFenceOf(fences: readonly SourceFence[]): { spec: GenuiSpec; raw: string } | null {
  for (let index = fences.length - 1; index >= 0; index -= 1) {
    const fence = fences[index]
    if (fence === undefined) continue
    if (fence.lang !== FENCE_LANG) continue
    // 围栏开头那一行还没写完 → 流式半截，不是一个可用的正文。
    if (!fence.openingLineComplete) continue
    const resolution = resolveFence(fence.value, { settled: true })
    if (resolution.spec !== null) return { spec: resolution.spec, raw: fence.value }
  }
  return null
}

/** 在抢救出来的 spec 顶部加一条来源标注（面板里要能看出这不是模型正常发的）。 */
function withProvenance(spec: GenuiSpec): GenuiSpec {
  return {
    ...spec,
    items: [
      { type: 'callout', tone: 'warning', title: t('salvage.title'), content: t('salvage.body') },
      ...spec.items,
    ],
  }
}

/**
 * 纯决策：这一轮 assistant step 是否该被抢救，以及发布什么。
 *
 * @param input - 状态、内容块、以及两个去重/让位信号。
 * @returns 需要发布的 spec；不该动作时返回 null。
 */
export function planReasoningSalvage(input: {
  readonly status: SalvageStatus | undefined
  readonly blocks: readonly AssistantBlock[]
  readonly alreadySalvaged: boolean
}): SalvagePlan | null {
  if (input.alreadySalvaged) return null
  if (input.status !== 'settled' && input.status !== 'interrupted') return null
  // 正文里有能渲染的围栏 → 用户已经看到界面（正常路径），完全不动。
  if (renderableFenceOf(sourceFencesOfAssistant(input.blocks)) !== null) return null
  const salvaged = renderableFenceOf(sourceFencesOfReasoning(input.blocks))
  if (salvaged === null) return null
  return {
    title: typeof salvaged.spec.title === 'string' && salvaged.spec.title !== ''
      ? salvaged.spec.title
      : t('salvage.title'),
    spec: withProvenance(salvaged.spec),
  }
}

/** 宿主的 assistant 消息行选择器（与 DOM 围栏通道一致）。 */
const ASSISTANT_ROW = '[data-chat-flow-kind="assistant-step"]'
/** 抢救容器的类名（同时作为「这一行已经抢救过」的标记）。 */
const SALVAGE_CLASS = 'genui-reasoning-salvage'

/**
 * 找到某个 assistant step 对应的宿主消息行。
 *
 * 优先**正文行**（没有 `data-chat-group-part="reasoning"`），因为界面应该出现在回答的
 * 位置；正文为空时宿主可能只渲染了思考行，那就退而用思考行（容器挂在它后面仍然在消息流
 * 里可见）。
 *
 * @param key - ChatSnapshot 的稳定 context key。
 * @param root - 查询范围（默认 document），测试可注入。
 * @returns 宿主行；找不到返回 null。
 */
export function salvageRowFor(key: string, root: ParentNode = document): HTMLElement | null {
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(key)
    : key.replace(/"/g, '\\"')
  const rows = Array.from(root.querySelectorAll<HTMLElement>(`${ASSISTANT_ROW}[data-chat-node-key="${escaped}"]`))
  const body = rows.find(row => row.dataset.chatGroupPart !== 'reasoning')
  if (body !== undefined) return body
  if (rows.length > 0) return rows[0] ?? null
  return root.querySelector<HTMLElement>(`${ASSISTANT_ROW}[data-chat-anchor-key="${escaped}"]`)
}

/** 一次内联抢救的挂载记录。 */
export interface SalvageMount {
  /** 插件自有的容器（宿主行内的外来节点）。 */
  readonly container: HTMLElement
  /** 卸载并移除容器。 */
  dispose(): void
}

/**
 * 把抢救出来的界面挂进宿主消息行的**后面**。
 *
 * @param row - 宿主 assistant 行。
 * @param spec - 已标注来源的 spec。
 * @param render - 渲染函数（返回卸载函数）；测试可注入假实现。
 * @returns 挂载记录。
 */
export function mountSalvage(
  row: HTMLElement,
  spec: GenuiSpec,
  render: (container: HTMLElement, spec: GenuiSpec) => () => void,
): SalvageMount {
  const container = document.createElement('div')
  container.className = [SALVAGE_CLASS, css.salvageInline].filter(part => typeof part === 'string' && part !== '').join(' ')
  container.setAttribute('data-genui-salvage', '')
  row.after(container)
  const dispose = render(container, spec)
  return {
    container,
    dispose: () => {
      try {
        dispose()
      } catch {
        // 卸载失败也要把容器摘掉，绝不留一个空壳占位。
      }
      container.remove()
    },
  }
}

/** 读 `uiConversation` —— 可选服务，缺了就是没有抢救能力，绝不影响其余渲染。 */
function chatSourceOf(ctx: Context, sessionId: SessionId): { getSnapshot: () => ChatSnapshot | undefined } | undefined {
  try {
    if (typeof ctx.get !== 'function') return undefined
    const conversation = ctx.get('uiConversation', false) as Context['uiConversation'] | undefined
    const source = conversation?.binding(sessionId).target('chat')
    if (source === undefined) return undefined
    return {
      getSnapshot: () => {
        try {
          return source.getSnapshot()
        } catch {
          return undefined
        }
      },
    }
  } catch {
    return undefined
  }
}

/** 轮询间隔：与 DOM 通道的 sweep 同量级，抢救不需要更快。 */

/** 内联抢救的选项。 */
export interface ReasoningSalvageOptions {
  /**
   * 宿主的 action 回传（与 DOM 围栏通道同一个发送器）。缺省时抢救出来的界面仍然渲染，
   * 只是交互组件不会回传——比整块界面消失好。
   */
  readonly sendAction?: (sessionId: SessionId, action: string, payload: Record<string, unknown>) => void
  /** 轮询间隔覆盖（测试用）。 */
  readonly pollMs?: number
  /** 等宿主把消息行渲染出来的尝试次数，超过就退回面板。 */
  readonly rowTries?: number
  /** 面板被占时继续等宿主行的总 tick 上限（默认 60，约一分钟）。 */
  readonly maxPendingTicks?: number
}

/** 抢救容器挂在宿主行之后：宿主 React 重渲染会摘掉外来节点，按 tick 修回。 */
const DEFAULT_POLL_MS = 1000

/**
 * 安装抢救兜底。每 {@link DEFAULT_POLL_MS} 检查一次当前会话**最后一个已结束**的
 * assistant step：命中时把界面**内联挂回消息列表**；宿主行始终找不到时退回面板 dock。
 *
 * @param ctx - 客户端 cordis 上下文。
 * @param options - action 回传与轮询参数。
 * @returns 卸载函数。
 */
export function installReasoningSalvage(ctx: Context, options: ReasoningSalvageOptions = {}): () => void {
  /** 已经评估过的 step（`session:nodeKey`）——一个 step 只解析一次。 */
  const considered = new Set<string>()
  /** 已经内联挂上的抢救：nodeKey → 行与容器。 */
  const mounted = new Map<string, { row: HTMLElement; mount: SalvageMount }>()
  /** 已决定抢救、但宿主行还没出现（等几次，仍无则退回面板）。 */
  const pending = new Map<string, { sessionId: SessionId; plan: SalvagePlan; tries: number; total: number }>()
  const rowTries = options.rowTries ?? 3
  /** 面板被占时继续等宿主行的总次数上限（约一分钟），避免无限重试。 */
  const maxPendingTicks = options.maxPendingTicks ?? 60

  const renderInline = (sessionId: SessionId, spec: GenuiSpec) => (container: HTMLElement): (() => void) => {
    const root: Root = createRoot(container)
    const handler: GenuiActionHandler = (action, payload) => options.sendAction?.(sessionId, action, payload)
    root.render(createElement(
      GenuiActionContext.Provider,
      { value: handler },
      createElement(GenuiBlock, { spec }),
    ))
    return () => root.unmount()
  }

  /**
   * 退回面板：插件自有的可见界面，宿主结构变化时仍然有地方可看。
   *
   * @returns 是否真的发布（面板已被占用时不覆盖，返回 false 让调用方继续等宿主行）。
   */
  const publishToPanel = (sessionId: SessionId, plan: SalvagePlan): boolean => {
    let taken = false
    try {
      taken = getPanelSpec(sessionId) !== null
    } catch {
      taken = true
    }
    if (taken) {
      console.warn('[genui] reasoning salvage: panel already has content; keeping it inline-only')
      return false
    }
    try {
      setLocalPanel(sessionId, plan.spec)
      requestPanelExpand(sessionId)
      console.info('[genui] reasoning salvage fell back to the session panel')
      return true
    } catch (error) {
      console.warn(`[genui] reasoning salvage publish failed (${error instanceof Error ? error.message : String(error)})`)
      return false
    }
  }

  const repairMounts = (): void => {
    for (const [key, entry] of Array.from(mounted)) {
      if (!entry.row.isConnected) {
        entry.mount.dispose()
        mounted.delete(key)
        continue
      }
      // 宿主 React 重渲染会摘掉/移动外来节点：修回原位（与 DOM 围栏通道同一策略）。
      if (entry.mount.container.parentElement !== entry.row.parentElement
        || entry.mount.container.previousElementSibling !== entry.row) {
        entry.row.after(entry.mount.container)
      }
    }
  }

  const settlePending = (): void => {
    for (const [key, entry] of Array.from(pending)) {
      const row = salvageRowFor(key)
      if (row !== null) {
        pending.delete(key)
        if (!mounted.has(key)) {
          mounted.set(key, { row, mount: mountSalvage(row, entry.plan.spec, renderInline(entry.sessionId, entry.plan.spec)) })
        }
        continue
      }
      entry.tries += 1
      entry.total += 1
      if (entry.tries < rowTries) continue
      // 耐心用尽：试面板。面板被占（不覆盖）就继续等宿主行，直到总上限。
      if (publishToPanel(entry.sessionId, entry.plan)) {
        pending.delete(key)
        continue
      }
      entry.tries = 0
      if (entry.total >= maxPendingTicks) {
        pending.delete(key)
        console.warn(`[genui] reasoning salvage gave up on ${key}: no host row and the panel is taken`)
      }
    }
  }

  const evaluate = (): void => {
    repairMounts()
    settlePending()
    let sessionId: SessionId | undefined
    try {
      sessionId = resolveViewedSessionId(ctx.sessions.list.getSnapshot())
    } catch {
      return
    }
    if (sessionId === undefined) return
    const chat = chatSourceOf(ctx, sessionId)?.getSnapshot()
    if (chat === undefined) return
    let best: { key: string; status: SalvageStatus | undefined; blocks: readonly AssistantBlock[]; order: number } | undefined
    for (const node of chat.nodes.values()) {
      if (node.kind !== 'assistant-step') continue
      const data = node.data as { status?: SalvageStatus; turn?: number; step?: number; blocks?: readonly AssistantBlock[] }
      if (data.status === 'running') continue
      const order = (data.turn ?? 0) * 1000 + (data.step ?? 0)
      if (best === undefined || order >= best.order) {
        best = { key: node.key, status: data.status, blocks: data.blocks ?? [], order }
      }
    }
    if (best === undefined) return
    const marker = `${String(sessionId)}:${best.key}`
    if (considered.has(marker)) return
    considered.add(marker)
    const plan = planReasoningSalvage({
      status: best.status,
      blocks: best.blocks,
      alreadySalvaged: mounted.has(best.key),
    })
    if (plan === null) return
    // 内联优先：界面应该出现在它本该出现的位置。
    const row = salvageRowFor(best.key)
    if (row !== null) {
      mounted.set(best.key, { row, mount: mountSalvage(row, plan.spec, renderInline(sessionId, plan.spec)) })
      console.info(`[genui] recovered a reasoning-only fence from ${best.key} into the message list`)
      return
    }
    pending.set(best.key, { sessionId, plan, tries: 0, total: 0 })
  }

  const timer = globalThis.setInterval(evaluate, options.pollMs ?? DEFAULT_POLL_MS)
  return () => {
    globalThis.clearInterval(timer)
    for (const entry of mounted.values()) entry.mount.dispose()
    mounted.clear()
    pending.clear()
  }
}
