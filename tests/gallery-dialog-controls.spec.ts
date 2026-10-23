import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { assertGalleryDialogControls, readGalleryDialogControls } from '../scripts/gallery-browser-checks.mjs'

function controls() {
  return [
    { label: 'Close image viewer', left: 700, top: 40, right: 736, bottom: 76 },
    { label: 'Previous image', left: 660, top: 600, right: 696, bottom: 636 },
    { label: 'Next image', left: 700, top: 600, right: 736, bottom: 636 },
  ].map(box => ({ ...box, width: 36, height: 36, position: 'static', display: 'inline-flex', visibility: 'visible',
    inViewport: true, ownsCenterHit: true }))
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

describe('modal controls oracle (synthetic geometry, not Chromium acceptance)', () => {
  it('accepts three separate normal-flow hit targets', () => {
    expect(() => assertGalleryDialogControls(controls(), 'desktop/wide-light')).not.toThrow()
  })
  it.each([
    ['absolute overlay', { position: 'absolute' }, /normal flow/],
    ['touch-hidden', { display: 'none' }, /remain visible/],
    ['occluded center', { ownsCenterHit: false }, /center hit target/],
    ['zero-sized', { width: 0 }, /visible viewport box/],
    ['offscreen', { inViewport: false }, /visible viewport box/],
    ['non-finite', { left: NaN }, /geometry is finite/],
  ])('rejects %s controls rather than bypassing the click', (_name, invalid, message) => {
    const actual = controls()
    Object.assign(actual[1]!, invalid)
    expect(() => assertGalleryDialogControls(actual, 'touch/narrow-light')).toThrow(message as RegExp)
  })
  it('rejects overlapping rectangles even if a stale hit snapshot says each owns its center', () => {
    const actual = controls()
    actual[1] = { ...actual[2]!, label: 'Previous image' }
    expect(() => assertGalleryDialogControls(actual, 'desktop/wide-light')).toThrow('must not overlap')
  })
  it('requires every fixture control', () => {
    expect(() => assertGalleryDialogControls(controls().slice(1), 'touch/narrow-light')).toThrow('all be present')
  })
  it('reads descendant center hits and real styles without changing focus or DOM', () => {
    const dialog = document.createElement('dialog')
    document.body.append(dialog)
    const actual = controls()
    const buttons = actual.map(control => {
      const button = document.createElement('button')
      button.setAttribute('aria-label', control.label)
      button.style.cssText = 'position:static;display:inline-flex;visibility:visible'
      button.innerHTML = '<span aria-hidden="true">arrow</span>'
      button.getBoundingClientRect = () => ({ ...control, x: control.left, y: control.top, toJSON: () => ({}) }) as DOMRect
      dialog.append(button)
      return button
    })
    const originalHit = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
    const hit = vi.fn((x: number, y: number) => {
      const index = actual.findIndex(box => x > box.left && x < box.right && y > box.top && y < box.bottom)
      return buttons[index]?.firstElementChild ?? null
    })
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit })
    try {
      buttons[0]!.focus()
      const before = dialog.outerHTML
      expect(readGalleryDialogControls(dialog)).toEqual(actual)
      expect(hit).toHaveBeenCalledTimes(3)
      expect(document.activeElement).toBe(buttons[0])
      expect(dialog.outerHTML).toBe(before)
    } finally {
      if (originalHit) Object.defineProperty(document, 'elementFromPoint', originalHit)
      else Reflect.deleteProperty(document, 'elementFromPoint')
    }
  })
  it('retains ordinary modal clicks, keyboard/inert/focus checks, and fixed-context execution', () => {
    const source = readFileSync('scripts/gallery-browser-checks.mjs', 'utf8')
    for (const target of ['imageNext', 'imagePrevious', 'close']) expect(source).toContain(`await ${target}.click({ timeout: remaining() })`)
    expect(source).toContain('assertGalleryDialogControls(modalControls, `${inputProfile}/${state.name}`)')
    expect(source).toContain('Native modal blocks physical background click')
    expect(source).toContain('Full Tab cycle remains within modal')
    expect(source).toContain('Escape restores focus to the thumbnail opener')
    expect(source).not.toMatch(/force:\s*true|element\.click\(/)
  })
})
