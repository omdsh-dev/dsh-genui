// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { renderGenuiFence } from '../src/client/fence-render.tsx'

/**
 * Test-double markdown renderer for the dsh-ui fence suites.
 *
 * Parses Markdown with the project dependency and delegates each dsh-ui code
 * block to {@link renderGenuiFence}. Host Markdown integration is covered by
 * `markdown-labels.tsx` and the DOM-channel suites.
 *
 * `streaming` wraps the output in `[data-streaming]`, the marker the fence
 * pipeline (and the host) uses to distinguish a still-growing reply from a
 * settled defect. Settled renders pass a stable synthetic source so tier-2
 * repair and the export affordance follow the same rules as production.
 */
export function MarkdownText(props: { text: string; streaming?: boolean }): ReactNode {
  const parts: ReactNode[] = []
  const tree = fromMarkdown(props.text)
  let cursor = 0
  let fenceIndex = 0
  let key = 0
  for (const node of tree.children) {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) continue
    if (start > cursor) parts.push(props.text.slice(cursor, start))
    if (node.type === 'code' && node.lang === 'dsh-ui') {
      parts.push(renderGenuiFence(node.value, `fence-${key++}`, props.streaming
        ? undefined
        : { source: { id: `genui-markdown:${fenceIndex}`, order: [0, fenceIndex, 0] } }))
      fenceIndex += 1
    } else {
      parts.push(props.text.slice(start, end))
    }
    cursor = end
  }
  if (cursor < props.text.length) parts.push(props.text.slice(cursor))
  const rendered = <>{parts}</>
  return props.streaming === true ? <div data-streaming="">{rendered}</div> : rendered
}
