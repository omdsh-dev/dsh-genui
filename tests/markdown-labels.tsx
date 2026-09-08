import { MarkdownText as PrimitiveMarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComponentProps } from 'react'

const MARKDOWN_LABELS = {
  code: { copyLabel: '复制', copiedLabel: '复制成功' },
  footnotes: '脚注',
} satisfies NonNullable<ComponentProps<typeof PrimitiveMarkdownText>['labels']>

/** Render MarkdownText with the rc.1 labels required by the host primitive. */
export function MarkdownText(props: Omit<ComponentProps<typeof PrimitiveMarkdownText>, 'labels'>): ReturnType<typeof PrimitiveMarkdownText> {
  return <PrimitiveMarkdownText {...props} labels={MARKDOWN_LABELS} />
}
