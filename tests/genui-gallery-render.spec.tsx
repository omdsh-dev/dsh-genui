import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { repairGenuiSpec } from '../src/client/guard.ts'
import { setLocale } from '../src/client/i18n/index.ts'
import type { GenuiSpec, GenuiImageGroup, GenuiCarousel } from '../src/client/spec.ts'

const group: GenuiImageGroup = { type: 'image-group', title: 'Synthetic gallery', items: [
  { src: '/synthetic-a.png', alt: 'Alpha', caption: 'First image' },
  { src: '/synthetic-b.png', alt: 'Beta', caption: 'Second image' },
] }
const carousel: GenuiCarousel = { type: 'carousel', title: 'Synthetic choices', items: [
  { type: 'card', title: 'A', items: [{ type: 'input', id: 'note', label: 'Note', value: 'Initial' }, { type: 'button', label: 'Choose A', action: 'choose-a' }] },
  { type: 'card', title: 'B', items: [{ type: 'text', content: 'Second option' }, { type: 'button', label: 'Choose B', action: 'choose-b' }] },
] }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setLocale('zh') })

function scrollable(track: HTMLElement, width = 300, total = 900) {
  Object.defineProperties(track, { clientWidth: { configurable: true, value: width }, scrollWidth: { configurable: true, value: total } })
  Object.defineProperty(track.firstElementChild!, 'offsetWidth', { configurable: true, value: 280 })
  const scroll = vi.fn(({ left }: ScrollToOptions) => { track.scrollLeft = left ?? 0; fireEvent.scroll(track) })
  Object.defineProperty(track, 'scrollTo', { configurable: true, value: scroll })
  fireEvent(window, new Event('resize'))
  return scroll
}

describe('carousel full component workflow', () => {
  it('retains edited form state after a streaming append and routes only the chosen action', () => {
    const action = vi.fn()
    const view = (spec: GenuiSpec) => <GenuiActionContext.Provider value={action}><GenuiBlock spec={spec} /></GenuiActionContext.Provider>
    const result = render(view({ items: [carousel] }))
    const input = result.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'User edit' } })
    result.rerender(view({ items: [{ ...carousel, items: [...carousel.items, { type: 'text', content: 'New streamed card' }] }] }))
    expect(result.getByRole('textbox')).toBe(input)
    expect(input.value).toBe('User edit')
    expect(action).not.toHaveBeenCalled()
    fireEvent.click(result.getByRole('button', { name: 'Choose B' }))
    expect(action).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledWith('choose-b', expect.objectContaining({ type: 'button', label: 'Choose B' }))
  })

  it('keeps local slide navigation separate from model actions and returns to scroll boundaries', () => {
    const action = vi.fn()
    const result = render(<GenuiActionContext.Provider value={action}><GenuiBlock spec={{ items: [carousel] }} /></GenuiActionContext.Provider>)
    const track = result.getByRole('group', { name: 'Synthetic choices' })
    const scroll = scrollable(track)
    expect(result.queryByRole('button', { name: '上一组卡片' })).toBeNull()
    const next = result.getByRole('button', { name: '下一组卡片' })
    next.focus()
    fireEvent.click(next)
    expect(track.scrollLeft).toBe(255)
    expect(document.activeElement).toBe(next)
    fireEvent.keyDown(track, { key: 'End' })
    expect(track.scrollLeft).toBe(600)
    expect(result.queryByRole('button', { name: '下一组卡片' })).toBeNull()
    fireEvent.keyDown(track, { key: 'Home' })
    expect(track.scrollLeft).toBe(0)
    const calls = scroll.mock.calls.length
    fireEvent.keyDown(result.getByRole('textbox'), { key: 'ArrowRight' })
    fireEvent.keyDown(track, { key: 'ArrowRight', ctrlKey: true })
    expect(scroll).toHaveBeenCalledTimes(calls)
    expect(action).not.toHaveBeenCalled()
  })

  it('uses Open Intelligent UI sizing and page navigation semantics', () => {
    const view = render(<GenuiBlock spec={{ items: [{ ...carousel, gap: 3 }] }} />)
    const track = view.getByRole('group', { name: 'Synthetic choices' })
    expect(track.style.getPropertyValue('--gallery-item-width')).toBe('240px')
    expect(track.style.getPropertyValue('--gallery-gap')).toBe('12px')
    const scroll = scrollable(track)
    fireEvent.click(view.getByRole('button', { name: '下一组卡片' }))
    expect(scroll).toHaveBeenCalledWith({ left: 255, behavior: 'smooth' })
    view.rerender(<GenuiBlock spec={{ items: [{ ...carousel, gap: Number.MAX_VALUE }] }} />)
    const maximumGapTrack = view.getByRole('group', { name: 'Synthetic choices' })
    expect(maximumGapTrack.style.getPropertyValue('--gallery-gap')).toBe(`${Number.MAX_SAFE_INTEGER}px`)
  })

  it('honors reduced motion and preserves scroll position on append', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const result = render(<GenuiBlock spec={{ items: [carousel] }} />)
    const track = result.getByRole('group', { name: 'Synthetic choices' })
    const scroll = scrollable(track)
    fireEvent.keyDown(track, { key: 'ArrowRight' })
    expect(scroll).toHaveBeenCalledWith({ left: 292, behavior: 'auto' })
    result.rerender(<GenuiBlock spec={{ items: [{ ...carousel, items: [...carousel.items, { type: 'text', content: 'Appended' }] }] }} />)
    expect(result.getByRole('group', { name: 'Synthetic choices' })).toBe(track)
    expect(track.scrollLeft).toBe(292)
  })

  it('supports field collection through the same submission registry', () => {
    const action = vi.fn()
    const result = render(<GenuiActionContext.Provider value={action}><GenuiBlock spec={{ items: [carousel, { type: 'submit', label: 'Send note', action: 'send-note', groups: ['note'] }] }} /></GenuiActionContext.Provider>)
    fireEvent.change(result.getByRole('textbox'), { target: { value: 'Chosen' } })
    fireEvent.click(result.getByRole('button', { name: 'Send note' }))
    expect(action).toHaveBeenCalledWith('send-note', expect.objectContaining({ fields: { note: 'Chosen' } }))
  })

  it('shows empty state, no useless navigation for one slide, and localized names', () => {
    setLocale('en')
    const result = render(<GenuiBlock spec={{ items: [{ type: 'carousel', items: [] }, { type: 'carousel', items: [{ type: 'text', content: 'One' }] }] }} />)
    expect(result.getByText('No items to display')).toBeDefined()
    expect(result.queryByRole('button', { name: 'Next cards' })).toBeNull()
    expect(result.getByRole('group', { name: 'Card 1 of 1' })).toBeDefined()
  })

  it('hides navigation when every slide fits in the visible track', () => {
    const result = render(<GenuiBlock spec={{ items: [{ type: 'carousel', title: 'Fit carousel', itemWidth: 80, gap: 0, items: [
      { type: 'text', content: 'One' }, { type: 'text', content: 'Two' },
    ] }] }} />)
    const track = result.getByRole('group', { name: 'Fit carousel' })
    scrollable(track, 300, 300)
    expect(result.queryByRole('button', { name: '下一组卡片' })).toBeNull()
    expect(result.queryByRole('button', { name: '上一组卡片' })).toBeNull()
  })

  it('renders the first 24 carousel slides when the 25th slide has an invalid field', () => {
    const items = [
      ...Array.from({ length: 24 }, (_, index) => ({ type: 'text', content: `Slide ${index + 1}` })),
      { type: 'text', content: 123 },
    ]
    const result = render(<GenuiBlock spec={{ items: [{ type: 'carousel', title: 'Capped carousel', items }] } as unknown as GenuiSpec} />)

    expect(result.getByText('Slide 24')).toBeDefined()
    expect(result.queryByText('123')).toBeNull()
    expect(result.getByRole('group', { name: 'Capped carousel' })).toBeDefined()
  })
})

describe('image group local viewing workflow', () => {
  it('renders the first 24 images when the 25th image has an invalid field', () => {
    const items = [
      ...Array.from({ length: 24 }, (_, index) => ({ src: `/image-${index + 1}.png`, alt: `Image ${index + 1}` })),
      { src: '/hidden.png', alt: 'Hidden image', caption: 123 },
    ]
    const result = render(<GenuiBlock spec={{ items: [{ type: 'image-group', title: 'Capped gallery', items }] } as unknown as GenuiSpec} />)

    expect(result.getByRole('button', { name: '放大 Image 24' })).toBeDefined()
    expect(result.queryByRole('button', { name: '放大 Hidden image' })).toBeNull()
    expect(result.getAllByRole('button', { name: /^放大 Image / })).toHaveLength(24)
  })

  it('opens, switches with keys/buttons, closes and restores focus without actions', () => {
    const action = vi.fn()
    const result = render(<GenuiActionContext.Provider value={action}><GenuiBlock spec={{ items: [group] }} /></GenuiActionContext.Provider>)
    const opener = result.getByRole('button', { name: '放大 Alpha' })
    expect(opener.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer')
    opener.focus(); fireEvent.click(opener)
    const dialog = result.getByRole('dialog')
    expect(within(dialog).getByRole('img').getAttribute('src')).toBe('/synthetic-a.png')
    expect(within(dialog).getByRole('img').getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '关闭图片查看器' }))
    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(within(dialog).getByRole('img').getAttribute('src')).toBe('/synthetic-b.png')
    expect(within(dialog).getByRole('status').textContent).toBe('第 2 张，共 2 张图片')
    fireEvent.click(within(dialog).getByRole('button', { name: '上一张图片' }))
    expect(within(dialog).getByRole('img').getAttribute('src')).toBe('/synthetic-a.png')
    fireEvent.keyDown(dialog, { key: 'End' }); fireEvent.keyDown(dialog, { key: 'Home' })
    expect(within(dialog).getByRole('img').getAttribute('src')).toBe('/synthetic-a.png')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(result.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(action).not.toHaveBeenCalled()
  })

  it('preserves the viewed source across append and reorder, then closes on removal', () => {
    const result = render(<GenuiBlock spec={{ items: [group] }} />)
    const opener = result.getByRole('button', { name: '放大 Beta' })
    fireEvent.click(opener)
    const revised = { ...group, items: [group.items[1]!, group.items[0]!, { src: '/synthetic-c.png', alt: 'Gamma' }] }
    result.rerender(<GenuiBlock spec={{ items: [revised] }} />)
    const dialog = result.getByRole('dialog')
    expect(within(dialog).getByRole('img').getAttribute('src')).toBe('/synthetic-b.png')
    expect(within(dialog).getByRole('status').textContent).toBe('第 1 张，共 3 张图片')
    result.rerender(<GenuiBlock spec={{ items: [{ ...group, items: [group.items[0]!] }] }} />)
    expect(result.queryByRole('dialog')).toBeNull()
    expect(document.activeElement?.tagName).toBe('SECTION')
  })

  it('keeps duplicate-source entries separately navigable', () => {
    const result = render(<GenuiBlock spec={{ items: [{ ...group, items: [{ src: '/same.png', alt: 'First copy' }, { src: '/same.png', alt: 'Second copy' }] }] }} />)
    fireEvent.click(result.getByRole('button', { name: '放大 Second copy' }))
    const dialog = result.getByRole('dialog')
    expect(within(dialog).getByRole('img').getAttribute('alt')).toBe('Second copy')
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
    expect(within(dialog).getByRole('img').getAttribute('alt')).toBe('First copy')
  })

  it('does not expose active URLs from direct typed consumers', () => {
    const result = render(<GenuiBlock spec={{ items: [{ type: 'image-group', items: [{ src: 'javascript:alert(1)', alt: 'Unsafe' }] }] }} />)
    expect(result.container.querySelector('img')).toBeNull()
    expect(result.getByText('图片无法加载')).toBeDefined()
    fireEvent.click(result.getByRole('button', { name: '放大 Unsafe' }))
    expect(result.container.querySelector('img')).toBeNull()
  })

  it('rejects obfuscated active URLs before creating an img element', () => {
    const result = render(<GenuiBlock spec={{ items: [{ type: 'image-group', items: [{ src: 'java\nscript:alert(1)', alt: 'Obfuscated' }] }] }} />)
    expect(result.container.querySelector('img')).toBeNull()
  })

  it('shows failed image fallback and recovers when the source changes', () => {
    const result = render(<GenuiBlock spec={{ items: [group] }} />)
    fireEvent.error(result.getByRole('img', { name: 'Alpha' }))
    expect(result.getByText('图片无法加载')).toBeDefined()
    result.rerender(<GenuiBlock spec={{ items: [{ ...group, items: [{ src: '/recovered.png', alt: 'Recovered' }] }] }} />)
    expect(result.getByRole('img', { name: 'Recovered' }).getAttribute('src')).toBe('/recovered.png')
    fireEvent.click(result.getByRole('button', { name: '放大 Recovered' }))
    const dialog = result.getByRole('dialog')
    fireEvent.error(within(dialog).getByRole('img'))
    expect(within(dialog).getByRole('alert').textContent).toBe('图片无法加载')
  })

  it('keeps links outside thumbnail buttons and rejects unsafe caption destinations', () => {
    const spec = repairGenuiSpec({ items: [{ ...group, items: [{ src: '/a.png', caption: '[Source](https://example.test/source) [unsafe](javascript:alert(1))' }] }] })!
    const result = render(<GenuiBlock spec={spec} />)
    const opener = result.getByRole('button', { name: /^放大 / })
    expect(opener.querySelector('a')).toBeNull()
    expect(result.container.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(result.getByRole('link', { name: 'Source' }).getAttribute('href')).toBe('https://example.test/source')
  })

  it('uses natural aspect ratio and exposes English empty state', () => {
    setLocale('en')
    const result = render(<GenuiBlock spec={{ items: [group, { type: 'image-group', items: [] }] }} />)
    const img = result.getByRole('img', { name: 'Alpha' })
    Object.defineProperties(img, { naturalWidth: { value: 400 }, naturalHeight: { value: 800 } })
    fireEvent.load(img)
    expect(img.closest('figure')?.getAttribute('style')).toContain('--gallery-image-ratio: 0.6')
    expect(result.getByText('No items to display')).toBeDefined()
    expect(result.getByRole('button', { name: 'Enlarge Alpha' })).toBeDefined()
  })

  it('keeps focus traversal within the dialog and restores on cancel', () => {
    const result = render(<GenuiBlock spec={{ items: [group] }} />)
    const opener = result.getByRole('button', { name: '放大 Alpha' })
    fireEvent.click(opener)
    const dialog = result.getByRole('dialog')
    const close = within(dialog).getByRole('button', { name: '关闭图片查看器' })
    const next = within(dialog).getByRole('button', { name: '下一张图片' })
    close.focus(); fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(next)
    fireEvent.keyDown(next, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }))
    expect(result.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})


describe('carousel disappearing navigation focus', () => {
  it.each(['next', 'previous'] as const)('hands focused %s to the track at its edge', direction => {
    const result = render(<GenuiBlock spec={{ items: [carousel] }} />)
    const track = result.getByRole('group', { name: 'Synthetic choices' })
    scrollable(track, 300, 500)
    if (direction === 'previous') { track.scrollLeft = 200; fireEvent.scroll(track) }
    const control = result.getByRole('button', { name: direction === 'next' ? '下一组卡片' : '上一组卡片' })
    control.focus()
    fireEvent.click(control)
    expect(control.isConnected).toBe(false)
    expect(document.activeElement).toBe(track)
    // Continue from the actual active element, rather than directly dispatching to an unfocused track.
    fireEvent.keyDown(document.activeElement!, { key: direction === 'next' ? 'Home' : 'End' })
    expect(track.scrollLeft).toBe(direction === 'next' ? 0 : 200)
  })

  it('hands a focused navigation control to the track when overflow disappears', () => {
    const result = render(<GenuiBlock spec={{ items: [carousel] }} />)
    const track = result.getByRole('group', { name: 'Synthetic choices' })
    scrollable(track, 300, 500)
    result.getByRole('button', { name: '下一组卡片' }).focus()
    scrollable(track, 600, 500)
    expect(result.queryByRole('button', { name: '下一组卡片' })).toBeNull()
    expect(document.activeElement).toBe(track)
  })

  it('does not steal focus from nested input on scroll or resize', () => {
    const result = render(<GenuiBlock spec={{ items: [carousel] }} />)
    const track = result.getByRole('group', { name: 'Synthetic choices' })
    scrollable(track, 300, 500)
    const input = result.getByRole('textbox')
    input.focus()
    track.scrollLeft = 200; fireEvent.scroll(track)
    expect(document.activeElement).toBe(input)
    scrollable(track, 600, 500)
    expect(document.activeElement).toBe(input)
  })
})
