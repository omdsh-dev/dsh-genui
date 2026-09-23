import { describe, expect, it } from 'vitest'
import type { AssistantBlock, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { hostFenceIndexOf } from '../src/client/dom-fence.tsx'
import { sourceFencesOf, sourceFencesOfAssistant, sourceLanguageAt } from '../src/client/source-fence.ts'

describe('sourceFencesOf', () => {
  it('reads one dsh-ui fence surrounded by Markdown and ignores inline code', () => {
    expect(sourceFencesOf('before `inline` text\n\n```dsh-ui\n{"items":[]}\n```\n\nafter')).toEqual([
      { lang: 'dsh-ui', value: '{"items":[]}' },
    ])
  })

  it('preserves language and order for multiple and unlabelled fences', () => {
    expect(sourceFencesOf('```ts\na()\n```\n```\nplain\n```\n```foobar\nx\n```')).toEqual([
      { lang: 'ts', value: 'a()' },
      { lang: null, value: 'plain' },
      { lang: 'foobar', value: 'x' },
    ])
  })

  it('recognizes an unclosed streaming dsh-ui fence', () => {
    expect(sourceFencesOf('```dsh-ui\n{"items":[{')).toEqual([
      { lang: 'dsh-ui', value: '{"items":[{' },
    ])
  })

  it('reads fences nested inside Markdown containers', () => {
    expect(sourceFencesOf('> ```foobar\n> nested\n> ```')).toEqual([
      { lang: 'foobar', value: 'nested' },
    ])
  })

  it('reads only text blocks and preserves order across multiple text blocks', () => {
    const blocks: AssistantBlock[] = [
      { kind: 'reasoning', text: '```dsh-ui\nignored\n```' },
      { kind: 'text', text: '```ts\nfirst\n```' },
      { kind: 'tool-call', callId: 'call', name: 'tool', argsRaw: '{}' },
      { kind: 'text', text: '```dsh-ui\nsecond\n```' },
    ]
    expect(sourceFencesOfAssistant(blocks)).toEqual([
      { lang: 'ts', value: 'first' },
      { lang: 'dsh-ui', value: 'second' },
    ])
  })
})

describe('sourceLanguageAt', () => {
  const chatOf = (node: unknown): ChatSnapshot => ({
    nodes: { get: () => node },
  } as unknown as ChatSnapshot)

  it.each([
    ['dsh-ui', '```dsh-ui\n{}\n```'],
    ['json', '```json\n{}\n```'],
    ['foobar', '```foobar\n{}\n```'],
    [null, '```\n{}\n```'],
  ] as const)('returns the source language %s from the public assistant node', (language, markdown) => {
    const chat = chatOf({
      kind: 'assistant-step',
      data: { blocks: [{ kind: 'text', text: markdown }] },
    })
    expect(sourceLanguageAt(chat, 'node-1', 0)).toBe(language)
  })

  it('returns undefined when the node or assistant row is unavailable', () => {
    expect(sourceLanguageAt(undefined, 'node-1', 0)).toBeUndefined()
    expect(sourceLanguageAt(chatOf(undefined), 'node-1', 0)).toBeUndefined()
    expect(sourceLanguageAt(chatOf({ kind: 'user' }), 'node-1', 0)).toBeUndefined()
  })

  it('maps each host code block to its source fence ordinal', () => {
    document.body.innerHTML = '<div data-chat-flow-kind="assistant-step"><div class="md-code-block"><pre></pre></div><div class="md-code-block"><pre></pre></div><div class="md-code-block"><pre></pre></div></div>'
    const row = document.body.firstElementChild!
    const blocks = [...row.querySelectorAll('.md-code-block')]
    expect(blocks.map(block => hostFenceIndexOf(row, block))).toEqual([0, 1, 2])
    const internal = document.createElement('div')
    internal.className = 'genui-dom-fence'
    internal.innerHTML = '<div class="md-code-block"><pre></pre></div>'
    row.children[1].after(internal)
    for (const [attribute, value] of [
      ['data-tool', 'render_ui'],
      ['data-sidebar-chat', ''],
      ['data-panel-conversation', ''],
      ['data-chat-group-part', 'reasoning'],
    ]) {
      const surface = document.createElement('div')
      surface.setAttribute(attribute, value)
      surface.innerHTML = '<div class="md-code-block"><pre></pre></div>'
      row.append(surface)
    }
    expect(hostFenceIndexOf(row, blocks[2])).toBe(2)
  })
})
