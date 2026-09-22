/**
 * 使用浏览器 renderer 与 Node 侧最终回复反馈守卫共用的流程解析 dsh-ui 围栏正文。
 * @module @changfenhuang/dsh-genui/shared/fence-resolve
 */

import { partialRepairGenuiSpec, processGenuiSpec } from '../client/guard.ts'
import { parsePartialGenuiSpec } from '../client/parse-partial.ts'
import type { GenuiSpec } from '../client/spec.ts'
import { completeFenceJson, repairFenceJson } from './fence-repair.ts'

/** 控制是否允许采用结构化 JSON 修复的选项。 */
export interface FenceResolveOptions {
  /** 回合结束后的回复允许使用 tier-2 补全修复。 */
  readonly settled: boolean
}

/**
 * 对已经解析的值执行规格守卫和坏节点清理。
 *
 * @param value - 已解析或部分解析的围栏值。
 * @returns 可渲染的 spec；没有可用组件树时返回 null。
 */
function resolveParsedFence(value: unknown): GenuiSpec | null {
  return partialRepairGenuiSpec(processGenuiSpec(value))
}

/**
 * 使用 renderer 的统一流程解析原始 dsh-ui 正文。
 *
 * 流式生成期间可以使用 tier-1 修复。tier-2 补全修复只允许用于回合结束后的回复，
 * 防止未完成的正文提前渲染。
 *
 * @param raw - dsh-ui 围栏标记之间的原始正文。
 * @param options - 流式或回合结束后的解析策略。
 * @returns 通过规格守卫的渲染 spec；正文无法渲染时返回 null。
 */
export function resolveFenceSpec(raw: string, options: FenceResolveOptions): GenuiSpec | null {
  const parsed = parsePartialGenuiSpec(raw)
  let spec = parsed === null ? null : resolveParsedFence(parsed)
  if (spec !== null) return spec

  const repaired = repairFenceJson(raw)
  if (repaired !== null) {
    const reparsed = parsePartialGenuiSpec(repaired.text)
    spec = reparsed === null ? null : resolveParsedFence(reparsed)
  }
  if (spec !== null || !options.settled) return spec

  const completed = completeFenceJson(raw)
  if (completed === null) return null
  const reparsed = parsePartialGenuiSpec(completed.text)
  return reparsed === null ? null : resolveParsedFence(reparsed)
}
