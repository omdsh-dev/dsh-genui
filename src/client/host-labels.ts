/**
 * Localized chrome for the host primitives this plugin renders through, plus
 * the compatibility casts that let the plugin type-check against its older
 * dev dependency while satisfying the host that is actually running.
 *
 * WHY THIS FILE EXISTS: the host contracts drifted. The plugin's dev
 * dependency (`@deepseek-ai/dsh-client-ui-primitives` 0.1.0-rc.8) declares
 * every label here optional or absent, while the primitives the running host
 * serves (0.1.3-alpha.1 and later) REQUIRE them. A DiffBlock rendered without
 * `labels` throws `Cannot read properties of undefined (reading 'copy')` in
 * the browser, and JsonTree/CodeBlock lose their copy affordances. Passing the
 * labels unconditionally is correct on every supported host; the casts below
 * only widen the rc.8 prop types, they do not change runtime behavior.
 * @module @changfenhuang/dsh-genui/client/host-labels
 */
import type { ComponentType } from 'react'
import { CodeBlock, DiffBlock, JsonTree } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DiffHunk, JsonTreeLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** DiffBlock chrome (structurally the host's `DiffBlockLabels`). */
export interface HostDiffLabels {
  copy: string
  copied: string
  collapseAria: string
  expandAria: (hidden: number) => string
  collapse: string
  expand: (hidden: number) => string
  files: (count: number) => string
}

export const DIFF_LABELS: HostDiffLabels = {
  copy: '复制',
  copied: '已复制',
  collapseAria: '收起未变更行',
  expandAria: (hidden: number) => `展开其余 ${hidden} 行`,
  collapse: '收起',
  expand: (hidden: number) => `展开其余 ${hidden} 行`,
  files: (count: number) => `${count} 个文件`,
}

export const JSON_TREE_LABELS: JsonTreeLabels = {
  copyValue: '复制值',
  copyJson: '复制 JSON',
  copyPath: '复制路径',
  copyPrettyJson: '复制格式化 JSON',
  copyCompactJson: '复制紧凑 JSON',
  copied: '已复制',
  copyFailed: '复制失败',
  collapseNode: '收起节点',
  expandNode: '展开节点',
  copyButtonTitle: (action: string) => `复制：${action}`,
}

export const CODE_LABELS = { copyLabel: '复制', copiedLabel: '已复制' } as const

/** Host DiffBlock widened to the label-bearing runtime contract. */
export const HostDiffBlock = DiffBlock as unknown as ComponentType<{
  diffs: DiffHunk[]
  labels: HostDiffLabels
  maxLines?: number | undefined
  className?: string | undefined
}>

/** Host JsonTree widened to the required label/labels contract. */
export const HostJsonTree = JsonTree as unknown as ComponentType<{
  data: object | unknown[]
  label: string
  labels: JsonTreeLabels
  copyable?: boolean | undefined
  expandTopLevel?: boolean | undefined
  className?: string | undefined
}>

/** Host CodeBlock widened to the required copy-label contract. */
export const HostCodeBlock = CodeBlock as unknown as ComponentType<{
  code: string
  lang?: string | undefined
  streaming?: boolean | undefined
  className?: string | undefined
  copyLabel: string
  copiedLabel: string
}>
