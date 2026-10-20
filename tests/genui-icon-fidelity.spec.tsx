// @vitest-environment jsdom
import { render, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { IconNode } from '../src/client/blocks/icon.tsx'
import { ICONS_FULL } from '../src/client/icons/icon-data-full.ts'

beforeAll(() => {
  Object.assign(window, { __GenuiAssets__: { icons: ICONS_FULL } })
})
afterEach(cleanup)

async function glyph(name: string): Promise<SVGSVGElement> {
  const { container } = render(<IconNode node={{ type: 'icon', name }} />)
  await waitFor(() => expect(container.querySelector('svg')).not.toBeNull())
  return container.querySelector('svg')!
}

describe('pinned upstream SVG geometry and paint', () => {
  it.each(['Timer', 'Flash'])('%s keeps an unfilled stroke', async name => {
    const path = (await glyph(name)).querySelector('path')!
    expect(path.getAttribute('fill')).toBe('none')
    expect(path.getAttribute('stroke')).toBe('currentColor')
    expect(path.getAttribute('stroke-width')).toBe('1.5')
  })

  it.each(['Bills', 'Scales', 'Graduate'])('%s inherits its root stroke', async name => {
    const svg = await glyph(name)
    expect(svg.getAttribute('fill')).toBe('currentColor')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.querySelector('path')!.getAttribute('stroke-width')).toBe('1.25')
  })

  it('keeps the settings status badge in its original corner', async () => {
    const rect = (await glyph('SettingsCircle')).querySelector('rect')!
    expect(['x', 'y', 'width', 'height', 'rx', 'fill'].map(key => rect.getAttribute(key)))
      .toEqual(['12', '12', '6', '6', '3', 'var(--green-500)'])
  })

  it('keeps the dot small, including its inherited stroke', async () => {
    const svg = await glyph('Dot')
    expect(svg.getAttribute('stroke-width')).toBe('2')
    expect(['cx', 'cy', 'r'].map(key => svg.querySelector('circle')!.getAttribute(key)))
      .toEqual(['12.1', '12.1', '1'])
  })

  it('keeps the mobile menu badge position, radius and explicit blue', async () => {
    const circle = (await glyph('SidebarMenuMobileBadgeCutout')).querySelector('circle')!
    expect(['cx', 'cy', 'r', 'fill'].map(key => circle.getAttribute(key)))
      .toEqual(['19', '7', '4', '#0285FF'])
  })

  it('lets a stroke shape inherit fill and SVG default stroke width', async () => {
    const svg = await glyph('PencilSparkle')
    expect(svg.getAttribute('fill')).toBe('currentColor')
    const first = svg.querySelector('path')!
    expect(first.getAttribute('stroke')).toBe('currentColor')
    expect(first.hasAttribute('stroke-width')).toBe(false)
    expect(first.hasAttribute('fill')).toBe(false)
  })
})
