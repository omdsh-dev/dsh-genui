/**
 * achievements.ts — GenUI 探索成就（0.9.5）。
 *
 * 轻量本地成就：只统计「使用事件计数」（渲染过的 fence、面板出现、
 * 交互回传、模板试用），绝不读消息/内容；状态存 localStorage，跨会话
 * 保留。解锁时进 toast 队列（achievement-toast 消费），面板「成就」
 * tab 用 dsh-ui 渲染自己的成就页（dogfooding）。
 *
 * 设计与 dsh-achievements 的分层快照思路一致，但零宿主改动：埋点全部
 * 在本包的渲染/交互路径上（GenuiBlock/TemplateDrawer/GenuiPanel）。
 */
import type { GenuiSpec, GenuiNode } from './spec.ts'

/** 累积使用计数（成就的输入）。 */
export interface AchieveState {
  /** 渲染过的不重复 fence 数。 */
  fences: number
  /** 面板（panel dock）出现过的会话数。 */
  panels: number
  /** 交互组件动作回传次数（去抖后）。 */
  interactions: number
  /** 模板试用次数。 */
  templates: number
  /** 图表节点（chart/plot/echart）出现过的 fence 数。 */
  charts: number
  /** 高级节点（scene3d/mermaid/diagram）出现过的 fence 数。 */
  advanced: number
}

export function emptyState(): AchieveState {
  return { fences: 0, panels: 0, interactions: 0, templates: 0, charts: 0, advanced: 0 }
}

export interface AchievementDef {
  id: string
  name: string
  description: string
  /** 解锁前隐藏名称/描述（彩蛋）。 */
  hidden?: boolean
  /** 稀有度。 */
  rarity: 'common' | 'rare' | 'legendary'
  check: (s: AchieveState) => boolean
}

const fences = (n: number) => (s: AchieveState): boolean => s.fences >= n

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-fence', name: '初次相见', description: '渲染了第一块 GenUI 界面。', rarity: 'common', check: fences(1) },
  { id: 'fence-5', name: '渐入佳境', description: '累计渲染 5 个界面。', rarity: 'common', check: fences(5) },
  { id: 'fence-25', name: '界面编织者', description: '累计渲染 25 个界面。', rarity: 'rare', check: fences(25) },
  { id: 'fence-50', name: '蓝图之魂', description: '累计渲染 50 个界面——你是 GenUI 的老朋友了。', rarity: 'legendary', hidden: true, check: fences(50) },
  { id: 'first-interaction', name: '按钮按得动', description: '触发了一次组件交互（动作回传）。', rarity: 'common', check: s => s.interactions >= 1 },
  { id: 'interaction-10', name: '小小操纵者', description: '累计触发 10 次组件交互。', rarity: 'rare', check: s => s.interactions >= 10 },
  { id: 'first-panel', name: '钉在墙上', description: '第一次把内容钉进了会话面板。', rarity: 'common', check: s => s.panels >= 1 },
  { id: 'panel-5', name: '面板管家', description: '5 个会话都用过面板。', rarity: 'rare', check: s => s.panels >= 5 },
  { id: 'first-chart', name: '图表爱好者', description: '渲染了第一张图表（chart/plot/echart）。', rarity: 'common', check: s => s.charts >= 1 },
  { id: 'chart-10', name: '数据可视化人', description: '10 个界面里出现过图表。', rarity: 'rare', check: s => s.charts >= 10 },
  { id: 'first-advanced', name: '高级玩家', description: '用上了 3D/图表引擎/架构图之一。', rarity: 'rare', check: s => s.advanced >= 1 },
  { id: 'template-1', name: '模板学员', description: '从模板中心试用了一个模板。', rarity: 'common', check: s => s.templates >= 1 },
]

/** 统计一个 spec 里出现的相关节点类别（与 guard 同口径遍历）。 */
export function countSpecKinds(spec: GenuiSpec): { charts: number, advanced: number } {
  let charts = 0
  let advanced = 0
  const walk = (list: unknown): void => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (typeof item !== 'object' || item === null) continue
      const v = item as Record<string, unknown>
      const type = v.type
      if (type === 'chart' || type === 'plot' || type === 'echart') charts += 1
      if (type === 'scene3d' || type === 'mermaid' || type === 'diagram') advanced += 1
      // 容器与列表项递归
      if (Array.isArray(v.items)) walk(v.items as unknown[])
      if (Array.isArray((v as { tabs?: unknown }).tabs)) {
        for (const tab of (v as { tabs: Array<{ items?: unknown }> }).tabs) walk(tab.items)
      }
    }
  }
  walk(spec.items)
  return { charts, advanced }
}

/** 生成成就页 spec（dsh-ui 渲染）：进度 stat + 解锁列表 + 稀有度徽标。 */
export function buildAchievementsSpec(state: AchieveState, unlocked: Record<string, number>): GenuiSpec {
  const total = ACHIEVEMENTS.length
  const unlockedCount = ACHIEVEMENTS.filter(a => unlocked[a.id] !== undefined).length
  const items: GenuiNode[] = [
    { type: 'grid', cols: 3, items: [
      { type: 'stat', label: '已解锁', value: `${unlockedCount} / ${total}` },
      { type: 'stat', label: '渲染界面', value: String(state.fences) },
      { type: 'stat', label: '组件交互', value: String(state.interactions) },
    ] },
    { type: 'progress', label: '探索进度', value: Math.round(unlockedCount / total * 100), valueLabel: `${Math.round(unlockedCount / total * 100)}%` },
    { type: 'list', items: ACHIEVEMENTS.map(a => ({
      type: 'row',
      items: [
        { type: 'badge', label: a.rarity === 'legendary' ? '传说' : a.rarity === 'rare' ? '稀有' : '普通', tone: unlocked[a.id] !== undefined ? 'success' : 'warn' },
        { type: 'text', size: 'body', content: a.hidden && unlocked[a.id] === undefined ? '？' : a.name },
        { type: 'text', size: 'muted', content: a.hidden && unlocked[a.id] === undefined ? '继续探索以揭示' : a.description },
      ],
    })) },
  ]
  return { title: 'GenUI 探索成就', items }
}

/** 检查给定状态下的新解锁（不受 hidden 限制——规则只管阈值）。 */
export function checkAchievements(state: AchieveState, unlocked: Record<string, number>): AchievementDef[] {
  return ACHIEVEMENTS.filter(a => unlocked[a.id] === undefined && a.check(state))
}
