import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'

afterEach(cleanup)

describe('GenUI image', () => {
  it('renders a browser-reachable image lazily', () => {
    const spec = repairGenuiSpec({
      items: [{
        type: 'image',
        src: '/mmx-files/result.png',
        alt: '生成结果',
      }],
    })!

    const { container } = render(<GenuiBlock spec={spec} />)
    const image = container.querySelector('img')

    expect(image).not.toBeNull()
    expect(image?.getAttribute('src')).toBe('/mmx-files/result.png')
    expect(image?.getAttribute('alt')).toBe('生成结果')
    expect(image?.getAttribute('loading')).toBe('lazy')
    expect(image?.getAttribute('decoding')).toBe('async')
  })

  it('accepts http(s) sources and rejects local or active schemes', () => {
    const safe = repairGenuiSpec({
      items: [{ type: 'image', src: 'https://cdn.example.com/result.png' }],
    })!
    const unsafe = repairGenuiSpec({
      items: [
        { type: 'image', src: 'file:///tmp/result.png' },
        { type: 'image', src: 'data:image/png;base64,AAAA' },
        { type: 'image', src: 'javascript:alert(1)' },
        { type: 'image', src: '//evil.example.com/result.png' },
      ],
    })!

    expect(validateGenuiSpec({ items: [{ type: 'image', src: '/mmx-files/result.png' }] })).toEqual({ ok: true, errors: [] })
    expect(unsafe.items).toEqual([])

    const { container: safeContainer, unmount } = render(<GenuiBlock spec={safe} />)
    expect(safeContainer.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/result.png')
    unmount()

    const { container: unsafeContainer } = render(<GenuiBlock spec={unsafe} />)
    expect(unsafeContainer.querySelector('img')).toBeNull()
  })

  it('shows an honest fallback when the image cannot be loaded', () => {
    const spec = repairGenuiSpec({
      items: [{ type: 'image', src: '/mmx-files/missing.png', alt: '预览' }],
    })!

    const { container, getByText } = render(<GenuiBlock spec={spec} />)
    fireEvent.error(container.querySelector('img')!)

    expect(getByText('图片无法加载')).not.toBeNull()
  })
})
