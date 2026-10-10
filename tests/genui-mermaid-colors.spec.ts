import { afterEach, describe, expect, it, vi } from 'vitest'
import { readMermaidThemeColor } from '../src/client/mermaid-colors.ts'

const TOKEN = '--genui-test-color'
const FALLBACK = '#123456'

afterEach(() => {
  document.body.style.removeProperty(TOKEN)
  document.body.style.removeProperty('color')
  vi.restoreAllMocks()
})

describe('Mermaid theme colors', () => {
  it.each([
    ['#2255aa', 'rgb(34, 85, 170)'],
    ['red', 'rgb(255, 0, 0)'],
    ['rgba(20, 40, 60, .4)', 'rgba(20, 40, 60, 0.4)'],
    ['rgb(20 40 60 / 40%)', 'rgba(20, 40, 60, 0.4)'],
    ['transparent', 'rgba(0, 0, 0, 0)'],
  ])('normalizes %s without changing its color or opacity', (value, expected) => {
    document.body.style.setProperty(TOKEN, value)
    expect(readMermaidThemeColor(TOKEN, FALLBACK)).toBe(expected)
  })

  it('resolves calc() in a skin token instead of passing the raw custom property to Mermaid', () => {
    const value = 'rgba(235, 242, 250, calc(.4 + .75 * .4))'
    document.body.style.setProperty(TOKEN, value)
    expect(getComputedStyle(document.body).getPropertyValue(TOKEN)).toContain('calc(')
    expect(readMermaidThemeColor(TOKEN, FALLBACK)).toBe('rgba(235, 242, 250, 0.7)')
  })

  it('resolves currentColor from the host body', () => {
    document.body.style.color = 'rgb(12, 34, 56)'
    document.body.style.setProperty(TOKEN, 'currentColor')
    expect(readMermaidThemeColor(TOKEN, FALLBACK)).toBe('rgb(12, 34, 56)')
  })

  it.each(['', 'not-a-color'])('keeps the fallback for a missing or invalid token (%s)', value => {
    document.body.style.setProperty(TOKEN, value)
    expect(readMermaidThemeColor(TOKEN, FALLBACK)).toBe(FALLBACK)
  })

  it('removes its temporary element after resolving a color', () => {
    document.body.style.setProperty(TOKEN, '#2255aa')
    const before = [...document.body.children]
    readMermaidThemeColor(TOKEN, FALLBACK)
    expect([...document.body.children]).toEqual(before)
  })

  it('removes its temporary element when computed style fails', () => {
    document.body.style.setProperty(TOKEN, '#2255aa')
    const before = [...document.body.children]
    const getStyle = getComputedStyle
    vi.spyOn(globalThis, 'getComputedStyle').mockImplementation(element => {
      if (element !== document.body) throw new Error('style resolution failed')
      return getStyle(element)
    })
    expect(() => readMermaidThemeColor(TOKEN, FALLBACK)).toThrow('style resolution failed')
    expect([...document.body.children]).toEqual(before)
  })

  it('converts modern colors through sRGB pixels while retaining alpha', () => {
    // jsdom can parse oklch(), but has no Canvas renderer. Supply just that
    // browser primitive; the token and computed-style path remain real.
    document.body.style.setProperty(TOKEN, 'oklch(40% .1 210 / .4)')
    const context = {
      fillStyle: '',
      fillRect: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray([12, 34, 56, 102]) }),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    expect(readMermaidThemeColor(TOKEN, FALLBACK)).toBe('rgba(12, 34, 56, 0.4)')
    expect(context.fillStyle).toMatch(/^oklch\(/)
  })

  it('keeps the fallback if a modern color needs an unavailable Canvas context', () => {
    document.body.style.setProperty(TOKEN, 'oklch(40% .1 210)')
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(readMermaidThemeColor(TOKEN, FALLBACK)).toBe(FALLBACK)
  })
})
