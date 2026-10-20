/** 围栏开头的 `dsh-ui` 标签在书写时可能被带上标点（```dsh-ui> / ```dsh-ui` …）。
 * 这类标记在 mdast 里原样留在 `lang` 上，严格相等判断会让整条围栏静默退化成
 * 普通代码块——真实会话里同一个模型可以在一条消息里写出 182 个这样的围栏。
 * 这里只吸收**标签之后**的标点，`dsh-ui-something` 这样的真实语言名不受影响。 */
const GENUI_LABEL_PATTERN = /^dsh-ui$/
const GENUI_TRAILING_PUNCTUATION = /[>`"'.,;:)\]】」』]+$/

/**
 * 把宿主的围栏语言标记规范化成 GenUI 能识别的写法。
 *
 * @param lang - 宿主 markdown 里的原始 language（可能含尾部标点或大小写差异）
 * @returns 规范化后的语言名；无法规范化时返回输入本身
 */
export function normalizeFenceLanguage(lang: string): string {
  const trimmed = lang.trim()
  if (GENUI_LABEL_PATTERN.test(trimmed.toLowerCase())) return 'dsh-ui'
  const stripped = trimmed.replace(GENUI_TRAILING_PUNCTUATION, '').trim().toLowerCase()
  if (GENUI_LABEL_PATTERN.test(stripped)) return 'dsh-ui'
  return lang
}

/**
 * 判断语言标记是否指向 GenUI 围栏。
 *
 * @param lang - 宿主暴露的围栏语言（`null` = 围栏没有语言）
 * @returns 规范化为 `dsh-ui` 时返回 true
 */
export function isGenuiFenceLanguage(lang: string | null | undefined): boolean {
  return typeof lang === 'string' && normalizeFenceLanguage(lang) === 'dsh-ui'
}
