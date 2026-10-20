import { describe, expect, it } from 'vitest'
import type { AssistantBlock, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { hostFenceIndexOf } from '../src/client/dom-fence.tsx'
import { sourceFencesOf, sourceFencesOfAssistant, sourceLanguageAt } from '../src/client/source-fence.ts'
import { isGenuiFenceLanguage, normalizeFenceLanguage } from '../src/shared/fence-language.ts'

describe('sourceFencesOf', () => {
  it('reads one dsh-ui fence surrounded by Markdown and ignores inline code', () => {
    expect(sourceFencesOf('before `inline` text\n\n```dsh-ui\n{"items":[]}\n```\n\nafter')).toEqual([
      { lang: 'dsh-ui', value: '{"items":[]}', openingLineComplete: true },
    ])
  })

  it('preserves language and order for multiple and unlabelled fences', () => {
    expect(sourceFencesOf('```ts\na()\n```\n```\nplain\n```\n```foobar\nx\n```')).toEqual([
      { lang: 'ts', value: 'a()', openingLineComplete: true },
      { lang: null, value: 'plain', openingLineComplete: true },
      { lang: 'foobar', value: 'x', openingLineComplete: true },
    ])
  })

  it('recognizes an unclosed streaming dsh-ui fence', () => {
    expect(sourceFencesOf('```dsh-ui\n{"items":[{')).toEqual([
      { lang: 'dsh-ui', value: '{"items":[{', openingLineComplete: true },
    ])
  })

  it('keeps an unfinished opening line provisional', () => {
    expect(sourceFencesOf('```dsh-ui')).toEqual([
      { lang: 'dsh-ui', value: '', openingLineComplete: false },
    ])
  })

  it('reads fences nested inside Markdown containers', () => {
    expect(sourceFencesOf('> ```foobar\n> nested\n> ```')).toEqual([
      { lang: 'foobar', value: 'nested', openingLineComplete: true },
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
      { lang: 'ts', value: 'first', openingLineComplete: true },
      { lang: 'dsh-ui', value: 'second', openingLineComplete: true },
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

describe('normalizeFenceLanguage', () => {
  it('absorbs the trailing punctuation a model leaves on the fence label', () => {
    // 真实会话：同一模型在一条消息里写出 182 个 ```dsh-ui> 围栏，全部静默退化成
    // 普通代码块，因为宿主的 mdast lang 原样保留了那个 `>`。
    for (const raw of ['dsh-ui>', 'dsh-ui`', 'dsh-ui"', 'dsh-ui.', 'dsh-ui)', 'dsh-ui】', 'dsh-ui」']) {
      expect(normalizeFenceLanguage(raw)).toBe('dsh-ui')
    }
  })

  it('absorbs case and surrounding whitespace', () => {
    expect(normalizeFenceLanguage('DSH-UI')).toBe('dsh-ui')
    expect(normalizeFenceLanguage('  dsh-ui  ')).toBe('dsh-ui')
  })

  it('leaves a genuinely different language untouched', () => {
    expect(normalizeFenceLanguage('dsh-ui-special')).toBe('dsh-ui-special')
    expect(normalizeFenceLanguage('json')).toBe('json')
    expect(normalizeFenceLanguage('svg')).toBe('svg')
    expect(normalizeFenceLanguage('')).toBe('')
  })
})

describe('isGenuiFenceLanguage', () => {
  it('treats noisy variants as GenUI and other languages as not', () => {
    expect(isGenuiFenceLanguage('dsh-ui')).toBe(true)
    expect(isGenuiFenceLanguage('dsh-ui>')).toBe(true)
    expect(isGenuiFenceLanguage('json')).toBe(false)
    expect(isGenuiFenceLanguage(null)).toBe(false)
    expect(isGenuiFenceLanguage(undefined)).toBe(false)
  })
})

describe('sourceFencesOf language normalization', () => {
  it('normalizes a noisy dsh-ui label so takeover no longer skips the fence', () => {
    expect(sourceFencesOf('```dsh-ui>\n{"items":[]}\n```')).toEqual([
      { lang: 'dsh-ui', value: '{"items":[]}', openingLineComplete: true },
    ])
  })

  it('keeps unrelated labels and unlabelled fences as they are', () => {
    expect(sourceFencesOf('```ts\na()\n```\n```\nplain\n```')).toEqual([
      { lang: 'ts', value: 'a()', openingLineComplete: true },
      { lang: null, value: 'plain', openingLineComplete: true },
    ])
  })
})
