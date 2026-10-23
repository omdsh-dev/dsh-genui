import { describe, expect, it } from 'vitest'
import { countDeclaredGenuiNodes, countGenuiNodes, processGenuiSpec, repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'

import { walkGenuiNodes } from '../src/client/walk-spec.ts'
import { compileSubmissionRegistry } from '../src/client/submission-registry.ts'
import { GENUI_LIMITS } from '../src/client/genui-runtime/limits.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

describe('issue #358 gallery contract', () => {
  it('preserves a carousel with existing card actions', () => {
    const spec = { items: [{ type: 'carousel', title: 'Synthetic choices', items: [
      { type: 'card', title: 'A', items: [{ type: 'button', label: 'Choose A', action: 'choose-a' }] },
    ] }] }
    expect(validateGenuiSpec(spec).ok).toBe(true)
    expect(repairGenuiSpec(spec)).toEqual(spec)
  })
  it('preserves a multi-image group for in-place viewing', () => {
    const spec = { items: [{ type: 'image-group', title: 'Synthetic images', items: [
      { src: '/synthetic-a.png', alt: 'A', caption: 'First' },
      { src: '/synthetic-b.png', alt: 'B' },
    ] }] }
    expect(validateGenuiSpec(spec).ok).toBe(true)
    expect(repairGenuiSpec(spec)).toEqual(spec)
  })
})


describe('gallery repair and state boundaries', () => {
  it('normalizes nested native nodes and image-record URL aliases without mutation', () => {
    const raw = { items: [
      { type: 'carousel', children: [{ type: 'card', content: [{ type: 'text', text: 'Keep me' }] }] },
      { type: 'image-group', items: [{ url: '/first.png', alt: 'First' }, { link: 'https://example.test/second.png' }] },
    ] }
    const original = JSON.stringify(raw)
    const result = processGenuiSpec(raw)
    expect(result.errors).toEqual([])
    expect(result.repaired).toEqual({ items: [
      { type: 'carousel', items: [{ type: 'card', items: [{ type: 'text', content: 'Keep me' }] }] },
      { type: 'image-group', items: [{ src: '/first.png', alt: 'First' }, { src: 'https://example.test/second.png' }] },
    ] })
    expect(repairGenuiSpec(result.repaired)).toEqual(result.repaired)
    expect(JSON.stringify(raw)).toBe(original)
  })

  it.each(['url', 'link'])('ignores the %s alias when canonical src is present', alias => {
    const raw = { items: [{ type: 'image-group', items: [{ src: '/canonical.png', [alias]: '/legacy.png' }] }] }
    const result = processGenuiSpec(raw)
    expect(result.errors).toEqual([])
    expect(result.value).toEqual({ items: [{ type: 'image-group', items: [{ src: '/canonical.png' }] }] })
    expect(result.repaired).toEqual({ items: [{ type: 'image-group', items: [{ src: '/canonical.png' }] }] })
    expect(result.warnings).toContainEqual(expect.objectContaining({
      kind: 'alias', path: `items[0].items[0].${alias}`, field: alias, canonical: 'src',
      message: expect.stringContaining("is ignored because canonical field 'src' is present"),
    }))
  })

  it.each(['url', 'link'])('normalizes the %s alias when canonical src is missing', alias => {
    const result = processGenuiSpec({ items: [{ type: 'image-group', items: [{ [alias]: '/legacy.png' }] }] })
    expect(result.errors).toEqual([])
    expect(result.value).toEqual({ items: [{ type: 'image-group', items: [{ src: '/legacy.png' }] }] })
    expect(result.repaired).toEqual({ items: [{ type: 'image-group', items: [{ src: '/legacy.png' }] }] })
    expect(result.warnings).toContainEqual(expect.objectContaining({
      kind: 'alias', path: `items[0].items[0].${alias}`, field: alias, canonical: 'src',
      message: expect.stringContaining('normalized/adopted as'),
    }))
  })

  it.each(['file:///tmp/a.png', 'data:image/svg+xml,<svg/>', 'javascript:alert(1)', '//example.test/a.png', 'mailto:a@example.test'])('rejects unsafe gallery source %s', src => {
    const raw = { items: [{ type: 'image-group', items: [{ src }, { src: '/safe.png' }] }] }
    expect(validateGenuiSpec(raw).ok).toBe(false)
    expect(repairGenuiSpec(raw)?.items[0]).toEqual({ type: 'image-group', items: [{ src: '/safe.png' }] })
  })

  it.each(['/images/a.png', './a.png', '../a.png', 'a.png', 'http://example.test/a.png', 'https://example.test/a.png'])('keeps an existing safe media source %s', src => {
    const spec = { items: [{ type: 'image-group', items: [{ src }] }] }
    expect(validateGenuiSpec(spec).ok).toBe(true)
    expect(repairGenuiSpec(spec)).toEqual(spec)
  })

  it('diagnoses malformed records and wrong optional values', () => {
    const errors = validateGenuiSpec({ items: [
      { type: 'image-group', title: 12, items: [null, { src: 42 }, { alt: 'Missing src' }, { src: '/a.png', caption: false }] },
      { type: 'carousel', items: [], itemWidth: Number.POSITIVE_INFINITY, gap: 'wide' },
    ] }).errors
    expect(errors).toEqual(expect.arrayContaining([
      'items[0].title must be a string', 'items[0].items[0] must be an object',
      'items[0].items[1].src must be a string', 'items[0].items[3].caption must be a string',
      'items[1].itemWidth must be a finite number', 'items[1].gap must be a finite number',
    ]))
    expect(errors.some(e => e.startsWith('items[0].items[2]: requires src'))).toBe(true)
  })

  it('retains explicit empty groups for the empty-state renderer', () => {
    const spec = { items: [{ type: 'carousel', items: [] }, { type: 'image-group', items: [] }] }
    expect(validateGenuiSpec(spec).ok).toBe(true)
    expect(repairGenuiSpec(spec)).toEqual(spec)
  })

  it('clamps slide dimensions and strings; caps image records', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'carousel', items: [], itemWidth: 5000, gap: -10, title: 'x'.repeat(3000) },
      { type: 'image-group', items: Array.from({ length: 40 }, (_, i) => ({ src: `/image-${i}.png`, caption: 'y'.repeat(3000) })) },
    ] })!
    expect(spec.items[0]).toEqual({ type: 'carousel', items: [], itemWidth: 640, gap: 0, title: 'x'.repeat(GENUI_LIMITS.maxString) })
    const group = spec.items[1]!
    if (group.type !== 'image-group') throw new Error('Wrong type')
    expect(group.items).toHaveLength(GENUI_LIMITS.maxImageGroupItems)
    expect(group.items[0]?.caption).toHaveLength(GENUI_LIMITS.maxString)
    expect(repairGenuiSpec({ type: 'carousel', items: [], itemWidth: -20, gap: 500 })?.items[0]).toMatchObject({ itemWidth: 80, gap: 500 })
    expect(repairGenuiSpec({ type: 'carousel', items: [], gap: Number.MAX_VALUE })?.items[0]).toMatchObject({ gap: Number.MAX_SAFE_INTEGER / 4 })
  })

  it('keeps declared/rendered accounting aligned at the carousel cap', () => {
    const raw = { items: [{ type: 'carousel', items: Array.from({ length: 30 }, (_, i) => ({ type: 'text', content: String(i) })) }] }
    const result = processGenuiSpec(raw)
    expect(result.errors).toEqual([])
    expect(countGenuiNodes(raw)).toBe(31)
    expect(countDeclaredGenuiNodes(raw)).toBe(25)
    expect(countDeclaredGenuiNodes(raw, Infinity, { familyCaps: false })).toBe(31)
    expect(result.declaredNativeCount).toBe(25)
    expect(result.renderedNativeCount).toBe(25)
    expect(result.warnings.some(w => w.kind === 'truncated')).toBe(true)
  })

  it('validates and diagnoses only the 24 rendered carousel slides', () => {
    const items = [
      ...Array.from({ length: GENUI_LIMITS.maxCarouselItems }, (_, index) => ({ type: 'text', content: `Slide ${index}` })),
      { type: 'text', content: 123, typo: true },
    ]
    const result = processGenuiSpec({ items: [{ type: 'carousel', items }] })
    expect(result.errors).toEqual([])
    expect((result.repaired?.items[0] as { items: unknown[] }).items).toHaveLength(GENUI_LIMITS.maxCarouselItems)
    expect(result.warnings.some(warning => warning.path.includes('.items[24]'))).toBe(false)
    expect(result.warnings.some(warning => warning.kind === 'truncated')).toBe(true)
    expect(result.warnings.find(warning => warning.kind === 'truncated')?.message).not.toContain('声明节点超出 tabs')
  })

  it.each([{ type: 'custom-widget' }, { content: 'untyped item' }, null])('warns from the raw Carousel item count when a capped entry is not a native node', hiddenItem => {
    const items = [
      ...Array.from({ length: GENUI_LIMITS.maxCarouselItems }, (_, index) => ({ type: 'text', content: `Slide ${index}` })),
      hiddenItem,
    ]
    const result = processGenuiSpec({ items: [{ type: 'carousel', items }] })
    expect(result.errors).toEqual([])
    expect(result.warnings).toContainEqual(expect.objectContaining({
      kind: 'truncated',
      message: expect.stringContaining('1 个 carousel 项超出'),
    }))
  })

  it('validates and diagnoses only the 24 rendered image records', () => {
    const items = [
      ...Array.from({ length: GENUI_LIMITS.maxImageGroupItems }, (_, index) => ({ src: `/image-${index}.png` })),
      { src: '/hidden.png', caption: 123, url: '/legacy.png', typo: true },
    ]
    const result = processGenuiSpec({ items: [{ type: 'image-group', items }] })
    expect(result.errors).toEqual([])
    expect((result.repaired?.items[0] as { items: unknown[] }).items).toHaveLength(GENUI_LIMITS.maxImageGroupItems)
    expect(result.warnings.some(warning => warning.path.includes('.items[24]'))).toBe(false)
    expect(result.warnings.some(warning => warning.kind === 'truncated' && warning.message.includes('1 张图片'))).toBe(true)
  })

  it('discovers nested fields at their renderer paths, never capped ghost fields', () => {
    const spec: GenuiSpec = { items: [{ type: 'carousel', items: [
      { type: 'card', items: [{ type: 'input', id: 'caption', label: 'Caption' }] },
      ...Array.from({ length: 23 }, () => ({ type: 'text' as const, content: 'Visible' })),
      { type: 'input', id: 'unrendered' },
    ] }, { type: 'submit', label: 'Send', action: 'send', groups: ['caption'] }] }
    const paths: string[] = []
    walkGenuiNodes(spec, (node, path) => { if (node.type === 'input') paths.push(path) })
    expect(paths).toEqual(['items[0].items[0].items[0]'])
    expect([...compileSubmissionRegistry(spec).members.keys()]).toEqual(['caption'])
    expect(validateGenuiSpec(spec).ok).toBe(true)
  })

  it('rejects secret fields and duplicate ids across a carousel boundary', () => {
    const result = validateGenuiSpec({ items: [
      { type: 'carousel', items: [{ type: 'input', id: 'secret', inputType: 'password' }] },
      { type: 'submit', label: 'Send', action: 'send', groups: ['secret'] },
    ] })
    expect(result.errors.some(e => e.includes('cannot require secret field'))).toBe(true)
    expect(validateGenuiSpec({ items: [
      { type: 'input', id: 'same' }, { type: 'carousel', items: [{ type: 'input', id: 'same' }] },
    ] }).ok).toBe(false)
  })

  it('traverses child diagnostics and preserves the existing total node budget', () => {
    const result = processGenuiSpec({ items: [{ type: 'carousel', items: [{ type: 'text', content: 'A', typo: true }] }] })
    expect(result.warnings).toContainEqual(expect.objectContaining({ path: 'items[0].items[0].typo' }))
    const many = repairGenuiSpec({ items: Array.from({ length: 24 }, () => ({ type: 'carousel', items: Array.from({ length: 24 }, () => ({ type: 'text', content: 'A' })) })) })!
    expect(countGenuiNodes(many)).toBe(GENUI_LIMITS.maxNodes)
  })
})

describe('gallery artifact consumption', () => {
  it('reports image URLs and nested actions without misclassifying image records as nodes', async () => {
    const { analyzeGenuiPortability } = await import('../src/client/artifact/portability.ts')
    const report = analyzeGenuiPortability({ items: [
      { type: 'carousel', items: [{ type: 'button', label: 'Choose', action: 'choose' }, { type: 'image-group', items: [{ src: '/one.png' }, { src: 'https://example.test/two.png' }] }] },
    ] })
    expect(report).toMatchObject({ hasModelActions: true, customTypes: [], requiredAssets: [], externalMedia: ['/one.png', 'https://example.test/two.png'] })
  })

  it('round-trips normalized gallery content and durable nested fields', async () => {
    const { createGenuiArtifact } = await import('../src/client/artifact/create.ts')
    const { parseGenuiArtifact } = await import('../src/client/artifact/parse.ts')
    const source: GenuiSpec = { items: [{ type: 'carousel', items: [{ type: 'input', id: 'note', value: 'Original' }] }, { type: 'image-group', items: [{ src: '/one.png', alt: 'One' }] }] }
    const artifact = createGenuiArtifact(source, { fields: { note: 'Edited' } }, { locale: 'en', theme: 'dark' })
    expect(parseGenuiArtifact(JSON.parse(JSON.stringify(artifact)))).toEqual(artifact)
    expect(artifact.spec).toEqual(repairGenuiSpec(source))
    expect(artifact.state?.fields).toEqual({ note: 'Edited' })
  })
})


describe('gallery URL canonicalization boundary', () => {
  it.each(['java\nscript:alert(1)', 'da\tta:image/svg+xml,<svg/>', '/\n/example.test/a.svg', '\\\n\\example.test/a.svg'])('rejects control-obfuscated media URL %j', src => {
    expect(validateGenuiSpec({ items: [{ type: 'image-group', items: [{ src }] }] }).ok).toBe(false)
    expect(repairGenuiSpec({ items: [{ type: 'image-group', items: [{ src }] }] })?.items).toEqual([{ type: 'image-group', items: [] }])
  })
})
