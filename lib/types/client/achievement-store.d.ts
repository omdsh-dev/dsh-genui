/**
 * achievement-store.ts — 成就状态存储与埋点入口（模块级单例）。
 *
 * 只存计数与解锁时间戳；绝不含消息/内容。localStorage 持久化，
 * 订阅接口供 toast 与成就页消费。埋点入口：
 *  - recordFence(spec)：一次「内容不重复」的界面渲染（按 spec 指纹去重，
 *    LRU 指纹表跨刷新防重放重复计数）
 *  - recordPanel()：面板 dock 出现
 *  - recordInteraction()：组件动作回传（去抖后）
 *  - recordTemplateUse()：模板中心试用
 */
import type { GenuiSpec } from './spec.ts';
import { type AchieveState, type AchievementDef } from './achievements.ts';
/** 记录一次「内容不重复」的 fence 渲染。 */
export declare function recordFence(spec: GenuiSpec): void;
/** 记录一次面板 dock 出现（仅会话从无到有时）。 */
export declare function recordPanel(): void;
/** 记录一次组件交互动作回传。 */
export declare function recordInteraction(): void;
/** 记录一次模板试用。 */
export declare function recordTemplateUse(): void;
/** 当前状态快照（订阅者读取）。 */
export declare function getAchievementSnapshot(): {
    state: AchieveState;
    unlocked: Record<string, number>;
};
/** 取走新解锁（toast 消费；一次性）。 */
export declare function consumeUnlocks(): AchievementDef[];
/** 订阅状态变化（toast 与成就页）。 */
export declare function subscribeAchievements(listener: () => void): () => void;
/** 成就页 spec 数据源（面板内渲染用）。 */
export declare function achievementCount(): {
    total: number;
    unlocked: number;
};
