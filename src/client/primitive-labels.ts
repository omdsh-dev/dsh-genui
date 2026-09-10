/** Localized labels required by the rc.1 DSH UI primitives. */
import type { DiffBlockLabels, JsonTreeLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Chrome labels for an inline GenUI diff block. */
export const DIFF_BLOCK_LABELS: DiffBlockLabels = {
  copy: '复制',
  copied: '复制成功',
  collapseAria: '收起差异',
  /** Accessible label for expanding a collapsed diff tail. */
  expandAria(hidden) { return `展开其余 ${hidden} 行差异` },
  collapse: '收起',
  /** Visible label for expanding a collapsed diff tail. */
  expand(hidden) { return `… 其余 ${hidden} 行` },
  /** Localized file-count summary in the diff footer. */
  files(count) { return `${count} 个文件` },
}

/** Copy labels for a code block rendered inside a GenUI fence or node. */
export const CODE_BLOCK_LABELS = {
  copyLabel: '复制',
  copiedLabel: '复制成功',
} as const

/** Chrome labels for an inline GenUI JSON tree. */
export const JSON_TREE_LABELS: JsonTreeLabels = {
  copyValue: '复制值',
  copyJson: '复制 JSON',
  copyPath: '复制属性路径',
  copyPrettyJson: '复制格式化 JSON',
  copyCompactJson: '复制紧凑 JSON',
  copied: '已复制',
  copyFailed: '复制失败',
  collapseNode: '收起 JSON 节点',
  expandNode: '展开 JSON 节点',
  /** Tooltip for a JSON tree copy action. */
  copyButtonTitle(action) { return `${action}；右键查看复制选项` },
}
