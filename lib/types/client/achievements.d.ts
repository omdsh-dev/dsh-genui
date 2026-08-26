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
import type { GenuiSpec } from './spec.ts';
/** 累积使用计数（成就的输入）。 */
export interface AchieveState {
    /** 渲染过的不重复 fence 数。 */
    fences: number;
    /** 面板（panel dock）出现过的会话数。 */
    panels: number;
    /** 交互组件动作回传次数（去抖后）。 */
    interactions: number;
    /** 模板试用次数。 */
    templates: number;
    /** 图表节点（chart/plot/echart）出现过的 fence 数。 */
    charts: number;
    /** 高级节点（scene3d/mermaid/diagram）出现过的 fence 数。 */
    advanced: number;
}
export declare function emptyState(): AchieveState;
export interface AchievementDef {
    id: string;
    name: string;
    description: string;
    /** 解锁前隐藏名称/描述（彩蛋）。 */
    hidden?: boolean;
    /** 稀有度。 */
    rarity: 'common' | 'rare' | 'legendary';
    check: (s: AchieveState) => boolean;
}
export declare const ACHIEVEMENTS: readonly AchievementDef[];
/** 统计一个 spec 里出现的相关节点类别（与 guard 同口径遍历）。 */
export declare function countSpecKinds(spec: GenuiSpec): {
    charts: number;
    advanced: number;
};
/** 生成成就页 spec（dsh-ui 渲染）：进度 stat + 解锁列表 + 稀有度徽标。 */
export declare function buildAchievementsSpec(state: AchieveState, unlocked: Record<string, number>): GenuiSpec;
/** 检查给定状态下的新解锁（不受 hidden 限制——规则只管阈值）。 */
export declare function checkAchievements(state: AchieveState, unlocked: Record<string, number>): AchievementDef[];
