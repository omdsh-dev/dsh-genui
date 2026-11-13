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
    const safeImage = safeContainer.querySelector('img')
    expect(safeImage?.getAttribute('src')).toBe('https://cdn.example.com/result.png')
    expect(safeImage?.getAttribute('referrerpolicy')).toBe('no-referrer')
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

describe('GenUI image zoom', () => {
  const spec = () => repairGenuiSpec({
    items: [{
      type: 'image',
      src: '/mmx-files/result.png',
      alt: '生成结果',
      caption: '来自 2026H1 回测',
    }],
  })!

  function open(container: HTMLElement) {
    const opener = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
    fireEvent.click(opener)
    return opener
  }

  it('wraps the picture in a zoom opener that announces the image name', () => {
    const { container } = render(<GenuiBlock spec={spec()} />)
    const opener = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')

    expect(opener).not.toBeNull()
    expect(opener?.getAttribute('aria-label')).toBe('放大 生成结果')
    expect(opener?.querySelector('img')?.getAttribute('src')).toBe('/mmx-files/result.png')
  })

  it('opens the full image in a dialog, focuses Close, and restores focus on close', () => {
    const { container } = render(<GenuiBlock spec={spec()} />)
    const opener = open(container)
    const dialog = container.querySelector('dialog')!

    expect(dialog.hasAttribute('open')).toBe(true)
    expect(dialog.textContent).toContain('来自 2026H1 回测')
    const expanded = dialog.querySelector('img')!
    expect(expanded.getAttribute('src')).toBe('/mmx-files/result.png')
    expect(expanded.getAttribute('loading')).toBe('eager')
    expect(expanded.getAttribute('referrerpolicy')).toBe('no-referrer')

    const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="关闭图片查看器"]')!
    expect(document.activeElement).toBe(close)

    fireEvent.click(close)
    expect(dialog.hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('closes on Escape and restores focus to the opener', () => {
    const { container } = render(<GenuiBlock spec={spec()} />)
    const opener = open(container)
    const dialog = container.querySelector('dialog')!

    fireEvent(dialog, new Event('cancel', { cancelable: true }))

    expect(dialog.hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('hides the zoom opener when the image fails to load', () => {
    const { container } = render(<GenuiBlock spec={spec()} />)
    fireEvent.error(container.querySelector('button[aria-haspopup="dialog"] img')!)

    expect(container.querySelector('button[aria-haspopup="dialog"]')).toBeNull()
    expect(container.querySelector('dialog')?.hasAttribute('open')).toBe(false)
  })
})
