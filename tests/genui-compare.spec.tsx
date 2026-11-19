// @vitest-environment jsdom
// `compare` node: an ordered image pair. These tests pin the two behaviours
// that make it different from image-group — both sides are required, and the
// slider exposes a real range control — plus the media policy it shares.
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { CompareNode } from '../src/client/blocks/compare.tsx'
import { processGenuiSpec } from '../src/client/guard.ts'
import { t } from '../src/client/i18n/index.ts'
import type { GenuiCompare } from '../src/client/spec.ts'

afterEach(cleanup)

const base: GenuiCompare = {
  type: 'compare',
  title: '数据卡修复前后',
  before: { src: 'https://example.com/before.png', label: '改动前', caption: '清单卡被拉到等高' },
  after: { src: 'https://example.com/after.png', label: '改动后' },
}

describe('CompareNode', () => {
  it('renders both sides with their labels, never hover-only', () => {
    const { container } = render(<CompareNode node={base} />)
    const chips = Array.from(container.querySelectorAll('button[aria-haspopup="dialog"] span'))
      .map(node => node.textContent)
    expect(chips).toContain('改动前')
    expect(chips).toContain('改动后')
    expect(container.textContent).toContain('数据卡修复前后')
    expect(container.textContent).toContain('清单卡被拉到等高')
    expect(container.querySelectorAll('img')).toHaveLength(2)
  })

  it('falls back to the dictionary labels when the spec omits them', () => {
    const { container } = render(<CompareNode node={{
      type: 'compare',
      before: { src: 'https://example.com/a.png' },
      after: { src: 'https://example.com/b.png' },
    }} />)
    expect(container.textContent).toContain(t('block.compareBefore'))
    expect(container.textContent).toContain(t('block.compareAfter'))
  })

  it('slider mode drives a range input and clips the after image', () => {
    const { container } = render(<CompareNode node={{ ...base, mode: 'slider' }} />)
    const range = container.querySelector<HTMLInputElement>('input[type="range"]')
    expect(range).not.toBeNull()
    expect(range?.value).toBe('50')
    expect(range?.getAttribute('aria-label')).toContain(t('block.compareHint'))

    const after = Array.from(container.querySelectorAll('img'))[1]
    expect(after?.style.clipPath).toBe('inset(0 0 0 50%)')

    fireEvent.change(range!, { target: { value: '18' } })
    expect(Array.from(container.querySelectorAll('img'))[1]?.style.clipPath).toBe('inset(0 0 0 18%)')
  })

  it('stacks instead of splitting columns when the spec says so', () => {
    const { container } = render(<CompareNode node={{ ...base, mode: 'stack' }} />)
    const grid = container.querySelector('[data-genui-compare] > div')
    expect(grid?.className).toContain('stack')
  })

  it('shows the shared media error for an unusable src', () => {
    const { container } = render(<CompareNode node={{
      type: 'compare',
      before: { src: 'javascript:alert(1)' },
      after: { src: 'https://example.com/b.png' },
    }} />)
    expect(container.textContent).toContain(t('block.imageError'))
  })
})

describe('compare guard', () => {
  const wrap = (node: unknown): unknown => ({ title: 'T', items: [node] })

  it('keeps a well-formed pair', () => {
    const result = processGenuiSpec(wrap({
      type: 'compare',
      before: { src: 'https://example.com/a.png', label: 'A' },
      after: { src: 'https://example.com/b.png', label: 'B', caption: 'c' },
      mode: 'slider',
      height: 320,
    }))
    expect(result.errors).toHaveLength(0)
    expect(result.spec?.items[0]).toMatchObject({ type: 'compare', mode: 'slider', height: 320 })
  })

  it('drops the node when one side is missing instead of shipping a lone image', () => {
    const result = processGenuiSpec(wrap({
      type: 'compare',
      before: { src: 'https://example.com/a.png' },
    }))
    expect(result.errors.join(' ')).toContain('after')
    expect(result.spec?.items ?? []).not.toContainEqual(expect.objectContaining({ type: 'compare' }))
  })

  it('clamps height and rejects unknown modes', () => {
    const result = processGenuiSpec(wrap({
      type: 'compare',
      before: { src: 'https://example.com/a.png' },
      after: { src: 'https://example.com/b.png' },
      mode: 'flipbook',
      height: 4000,
    }))
    const node = result.spec?.items[0] as GenuiCompare | undefined
    expect(node?.type).toBe('compare')
    expect(node?.mode).toBeUndefined()
    expect(node?.height).toBe(640)
  })
})
