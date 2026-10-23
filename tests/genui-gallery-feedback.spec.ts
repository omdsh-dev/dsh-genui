import { describe, expect, it } from 'vitest'
import { createGenuiArtifact } from '../src/client/artifact/create.ts'
import { createStandaloneHtmlDocument } from '../src/client/artifact/html.ts'
import { GENUI_LIMITS } from '../src/client/genui-runtime/limits.ts'
import { createValidateDshUiTool } from '../src/plugin/tool.ts'
import { artifactFromDocument, parseHtml } from './helpers/standalone.ts'

const bundles = new Map([['standalone-runtime.js', new TextEncoder().encode('runtime')]])
const tool = createValidateDshUiTool()

describe('gallery standalone media URLs', () => {
  it.each([
    ['/mmx-files/a.png', 'https://example.test/mmx-files/a.png'],
    ['./a.png', 'https://example.test/reports/a.png'],
    ['../a.png', 'https://example.test/a.png'],
    ['a.png?size=2#image', 'https://example.test/reports/a.png?size=2#image'],
    ['http://cdn.example.test/a.png', 'http://cdn.example.test/a.png'],
    ['https://cdn.example.test/a.png', 'https://cdn.example.test/a.png'],
  ])('resolves nested gallery source %s without changing JSON or unrelated data', (src, expected) => {
    const artifact = createGenuiArtifact({ items: [
      { type: 'carousel', items: [{ type: 'card', items: [{ type: 'image-group', items: [{ src, alt: 'A', caption: 'Caption' }] }] }] },
      { type: 'json', value: { src: '/keep-data.png' } },
      { type: 'image', src: '/existing.png' },
    ] })
    const original = JSON.stringify(artifact)
    const exported = artifactFromDocument(parseHtml(createStandaloneHtmlDocument(artifact, bundles, 'https://example.test/reports/page')))
    expect(exported).toMatchObject({ spec: { items: [
      { type: 'carousel', items: [{ type: 'card', items: [{ type: 'image-group', items: [{ src: expected, alt: 'A', caption: 'Caption' }] }] }] },
      { type: 'json', value: { src: '/keep-data.png' } },
      { type: 'image', src: 'https://example.test/existing.png' },
    ] } })
    expect(JSON.stringify(artifact)).toBe(original)
  })

  it.each(['/literal.png', 'file:///documentation/example.png'])('preserves gallery-shaped raw JSON with source %s', src => {
    const value = { type: 'image-group', items: [{ src }] }
    const artifact = createGenuiArtifact({ items: [
      { type: 'json', value },
      { type: 'image-group', items: [{ src: '/actual.png' }] },
    ] })
    const original = JSON.stringify(artifact)
    const exported = artifactFromDocument(parseHtml(createStandaloneHtmlDocument(artifact, bundles, 'https://example.test/page')))
    expect(exported).toMatchObject({ spec: { items: [
      { type: 'json', value },
      { type: 'image-group', items: [{ src: 'https://example.test/actual.png' }] },
    ] } })
    expect(JSON.stringify(artifact)).toBe(original)
  })

  it.each(['file:///tmp/a.png', 'data:image/png;base64,AA==', 'javascript:alert(1)'])('retains the existing non-HTTP export guard for %s', src => {
    const artifact = createGenuiArtifact({ items: [{ type: 'image-group', items: [{ src: '/safe.png' }] }] })
    const group = artifact.spec.items[0]!
    if (group.type !== 'image-group') throw new Error('wrong fixture type')
    // Exercise the serializer boundary directly; normal parsing also rejects these.
    group.items[0]!.src = src
    expect(() => createStandaloneHtmlDocument(artifact, bundles, 'https://example.test/page')).toThrow('media URL cannot be exported')
  })
})

describe('gallery validation feedback', () => {
  it('reports rendered gallery titles, captions and nested card/text paths through validate_dsh_ui', async () => {
    const result = String(await tool.execute({ spec: { items: [{
      type: 'carousel', title: '~~~title~~~', items: [
        { type: 'card', title: '~~~card~~~', items: [{ type: 'text', content: 'A | B\n---|---' }] },
        { type: 'image-group', title: '~~~images~~~', items: [{ src: '/a.png', caption: 'A | B\n---|---', alt: '~~~plain alt~~~' }] },
      ],
    }] } }))
    for (const [path, kind, replacement] of [
      ['items[0].title', 'fenced_code', 'code'],
      ['items[0].items[0].title', 'fenced_code', 'code'],
      ['items[0].items[0].items[0].content', 'markdown_table', 'table'],
      ['items[0].items[1].title', 'fenced_code', 'code'],
      ['items[0].items[1].items[0].caption', 'markdown_table', 'table'],
    ]) expect(result).toContain(`warning=block_markdown path=${path} kind=${kind} replacement=${replacement}`)
    expect(result.match(/warning=block_markdown/g)).toHaveLength(5)
    expect(result).toContain('next=fix_and_revalidate')
  })

  it('does not diagnose raw gallery alt/src, input data or proper block replacements', async () => {
    const result = String(await tool.execute({ spec: { items: [{
      type: 'carousel', title: '**Gallery**', items: [
        { type: 'code', code: '~~~raw~~~' },
        { type: 'input', id: 'note', value: '~~~raw~~~' },
        { type: 'image-group', items: [{ src: '/~~~image~~~.png', alt: '~~~plain alt~~~', caption: '*Caption*' }] },
      ],
    }] } }))
    expect(result).toContain('status=valid')
    expect(result).toContain('next=emit_fence')
    expect(result).not.toContain('warning=block_markdown')
  })

  it('names the carousel cap in policy feedback without diagnosing omitted slides', async () => {
    const result = String(await tool.execute({ spec: { items: [{
      type: 'carousel', items: [
        ...Array.from({ length: GENUI_LIMITS.maxCarouselItems }, () => ({ type: 'text', content: 'Visible' })),
        { type: 'text', content: '~~~not rendered~~~' },
      ],
    }] } }))
    expect(result).toContain('warning=policy_truncated')
    expect(result).toContain(`carousel ≤ ${GENUI_LIMITS.maxCarouselItems}`)
    expect(result).toContain(`tabs ≤ ${GENUI_LIMITS.maxTabs}`)
    expect(result).toContain(`accordion ≤ ${GENUI_LIMITS.maxAccordionItems}`)
    expect(result).not.toContain('warning=block_markdown')
  })

  it('does not diagnose captions beyond the image-group cap', async () => {
    const result = String(await tool.execute({ spec: { items: [{
      type: 'image-group', items: [
        ...Array.from({ length: GENUI_LIMITS.maxImageGroupItems }, (_, i) => ({ src: `/image-${i}.png` })),
        { src: '/omitted.png', caption: '~~~not rendered~~~' },
      ],
    }] } }))
    expect(result).not.toContain('warning=block_markdown')
  })

  it('does not report truncation at the exact carousel boundary', async () => {
    const result = String(await tool.execute({ spec: { items: [{
      type: 'carousel', items: Array.from({ length: GENUI_LIMITS.maxCarouselItems }, () => ({ type: 'text', content: 'Visible' })),
    }] } }))
    expect(result).not.toContain('warning=policy_truncated')
    expect(result).toContain('next=emit_fence')
  })
})

