/**
 * Minimal inline markup for text-bearing fields.
 *
 * Prose-heavy answers need emphasis INSIDE a sentence: a command, a term, a key
 * phrase, a link. Until now every field was a plain string, so emphasis meant
 * splitting one sentence into several nodes and the paragraph read as broken.
 *
 * Supported (deliberately tiny, no nesting):
 *   `code`            inline code chip
 *   **bold**          emphasis that does not wrap or become a block
 *   ==mark==          highlight
 *   [text](https://…) inline link (http/https/mailto only)
 *
 * Safety: this NEVER produces HTML. Each token becomes a React element, so the
 * host's HTML parser is never involved (the whole client builds elements, the
 * only innerHTML in the project is mermaid's sanitized SVG). An unterminated or
 * unknown marker is rendered literally rather than erroring, and a link whose
 * href fails {@link safeHref} degrades to its label text.
 * @module @changfenhuang/dsh-genui/client/inline
 */
import { createElement, type ReactNode } from 'react'
import css from './GenuiBlock.module.css'
import { safeHref } from './genui-runtime/value-utils.ts'

/** One pass, no nesting: each alternative is a self-contained token. */
// Links match ANY target here and are validated by safeHref afterwards, so a
// `javascript:` target degrades to its label text instead of showing as raw
// markup the reader has to parse themselves.
const INLINE = /`[^`\n]+`|\*\*[^*\n]+\*\*|==[^=\n]+==|\[[^\]\n]+\]\([^)\s]+\)/g

/** True when the string contains anything the parser understands. */
export function hasInlineMarkup(text: string): boolean {
  return typeof text === 'string' && /[`*=]|\[/.test(text)
}

/**
 * Render one string as React nodes with inline markup applied.
 * @param text - the raw field value.
 * @returns the original string when nothing matched, else the node list.
 */
export function renderInline(text: string): ReactNode {
  if (typeof text !== 'string' || text === '' || !hasInlineMarkup(text)) return text
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0
    const token = match[0]
    if (index > last) out.push(text.slice(last, index))
    if (token.startsWith('`')) {
      out.push(createElement('code', { key: key++, className: css.inlineCode }, token.slice(1, -1)))
    } else if (token.startsWith('**')) {
      out.push(createElement('strong', { key: key++, className: css.inlineStrong }, token.slice(2, -2)))
    } else if (token.startsWith('==')) {
      out.push(createElement('mark', { key: key++, className: css.inlineMark }, token.slice(2, -2)))
    } else {
      const parts = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/.exec(token)
      if (parts === null) {
        out.push(token)
      } else {
        const href = safeHref(parts[2])
        out.push(href === undefined
          ? parts[1]
          : createElement('a', {
            key: key++, className: css.inlineLink, href, target: '_blank', rel: 'noreferrer noopener',
          }, parts[1]))
      }
    }
    last = index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out.length === 0 ? text : out
}
