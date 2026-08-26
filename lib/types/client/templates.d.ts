/**
 * templates.ts — GenUI 模板中心数据（0.9.4）。
 *
 * 每个模板 = 一段自然语言 `instruction`（试用时插入输入框，模型按 genui
 * skill 生成对应界面）+ 一份**合法**的 `demo` spec（预览时由 GenuiBlock
 * 直接渲染，用户先看到效果再决定试用）。字段对齐 spec.ts / guard.ts 的
 * 实际 schema（tests/templates.spec.ts 用 validateGenuiSpec 逐条校验）。
 *
 * 模板即说明书：覆盖布局/数据/图表/交互/测验/高级各能力面。
 */
import type { GenuiSpec } from './spec.ts';
export interface GenuiTemplate {
    id: string;
    category: '仪表盘' | '数据' | '流程' | '图表' | '交互' | '测验' | '高级';
    name: string;
    description: string;
    /** 试用时插入输入框的自然语言指令。 */
    instruction: string;
    /** 预览用的合法 spec（≤200 节点、嵌套 ≤8 层）。 */
    demo: GenuiSpec;
}
export declare const GENUI_TEMPLATES: readonly GenuiTemplate[];
