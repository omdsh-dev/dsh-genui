import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import css from '../src/client/blocks/gallery.module.css'

const source = readFileSync('src/client/blocks/gallery.module.css', 'utf8')
// jsdom does not evaluate media queries/layout. Parse the real source rules,
// apply only the tested media branch, and match them against real component markup.
const style = document.createElement('style')
style.textContent = source
document.head.append(style)
const rules = [...style.sheet!.cssRules]
style.remove()
afterEach(cleanup)

function declarations(element: Element, hoverNone = false, reducedMotion = false): Record<string, string> {
  const result: Record<string, string> = {}
  const visit = (items: CSSRule[]) => {
    for (const rule of items) {
      if (rule instanceof CSSMediaRule) {
        if ((rule.conditionText === '(hover: none)' && hoverNone)
          || (rule.conditionText === '(prefers-reduced-motion: reduce)' && reducedMotion)) visit([...rule.cssRules])
      } else if (rule instanceof CSSStyleRule) {
        if (rule.selectorText.includes('::')) continue // Pseudo-elements do not style the button itself.
        const selector = rule.selectorText.replace(/\.([a-zA-Z][\w-]*)/g, (_, name: string) => `.${css[name] ?? name}`)
        if (!element.matches(selector)) continue
        for (let index = 0; index < rule.style.length; index++) {
          const property = rule.style[index]!
          result[property] = rule.style.getPropertyValue(property)
        }
      }
    }
  }
  visit(rules)
  return result
}

function fixture() {
  const view = render(<GenuiBlock spec={{ items: [
    { type: 'carousel', title: 'Cards', items: [{ type: 'text', content: 'One' }, { type: 'text', content: 'Two' }] },
    { type: 'image-group', title: 'Images', items: [{ src: '/one.svg', alt: 'One' }, { src: '/two.svg', alt: 'Two' }] },
  ] }} />)
  const track = view.getByRole('group', { name: 'Cards' })
  Object.defineProperties(track, { clientWidth: { configurable: true, value: 300 }, scrollWidth: { configurable: true, value: 700 } })
  fireEvent(window, new Event('resize'))
  fireEvent.click(view.getByRole('button', { name: '放大 One' }))
  return { view, track, dialog: view.getByRole('dialog') }
}

describe('gallery control CSS scope (source/DOM contract, not browser layout)', () => {
  it.each([false, true])('keeps lightbox controls in normal flow and visible when hover:none=%s', hoverNone => {
    const { dialog } = fixture()
    const buttons = within(dialog).getAllByRole('button')
    expect(buttons).toHaveLength(3)
    for (const button of buttons) {
      const actual = declarations(button, hoverNone)
      expect(actual.display).toBe('inline-flex')
      expect(actual.position).not.toBe('absolute')
      expect(actual.position).not.toBe('fixed')
      expect(actual.top).toBeUndefined()
      expect(actual.transform).toBeUndefined()
      expect(button.classList.contains(css.control!)).toBe(true)
      expect(button.classList.contains(css.carouselControl!)).toBe(false)
    }
  })

  it.each([false, true])('keeps the lightbox navigation row visible when hover:none=%s', hoverNone => {
    const { dialog } = fixture()
    const controls = within(dialog).getByRole('button', { name: '下一张图片' }).parentElement!
    expect(declarations(controls, hoverNone)).toMatchObject({ display: 'flex', 'flex-shrink': '0', gap: 'var(--dsl-g-gap-xs, 4px)' })
    expect(declarations(controls, hoverNone).position).not.toBe('absolute')
    expect(declarations(controls, hoverNone)['pointer-events']).not.toBe('none')
  })

  it('limits positioning, pointer overlay, and hover hiding to carousel-only classes', () => {
    const { view, track } = fixture()
    const next = view.getByRole('button', { name: '下一组卡片' })
    const controls = next.parentElement!
    expect(controls.classList.contains(css.carouselControls!)).toBe(true)
    expect(next.classList.contains(css.control!)).toBe(true)
    expect(next.classList.contains(css.carouselControl!)).toBe(true)
    expect(declarations(controls)).toMatchObject({ position: 'absolute', inset: '0', 'pointer-events': 'none' })
    expect(declarations(next)).toMatchObject({ position: 'absolute', top: '50%', transform: 'translateY(-50%)', 'pointer-events': 'auto', right: '8px' })
    expect(declarations(controls, true).display).toBe('none')
    expect(declarations(track)['scroll-snap-type']).toBe('x mandatory')
    expect(declarations(track.firstElementChild!).flex).toBe('0 0 min(var(--gallery-item-width, 240px), 85%)')
  })

  it('keeps shared visual/focus/reduced-motion styling for both control families', () => {
    const { view, dialog } = fixture()
    const carouselNext = view.getByRole('button', { name: '下一组卡片' })
    const imageNext = within(dialog).getByRole('button', { name: '下一张图片' })
    for (const button of [carouselNext, imageNext]) {
      expect(declarations(button)).toMatchObject({ 'min-width': '36px', 'min-height': '36px', cursor: 'pointer' })
      expect(declarations(button, false, true).transition).toBe('none')
    }
    const focusRule = rules.find(rule => rule instanceof CSSStyleRule && rule.selectorText.includes('.control:focus-visible')) as CSSStyleRule
    expect(focusRule.style.getPropertyValue('outline')).toBe('2px solid var(--dsl-g-accent)')
    expect(focusRule.style.getPropertyValue('outline-offset')).toBe('3px')
  })
})
