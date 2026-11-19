// @vitest-environment jsdom
// v12 figure primitives: `icon` (bundled glyph + tinted plate) and `blocks`
// (row × cell block diagram). Both exist so a model can draw a figure without
// hand-writing SVG coordinates, so the tests pin the *contract* the guard and
// the SKILL promise: unknown icon names degrade instead of dropping the block,
// cells are data (not nodes), and null cells stay aligned lanes.
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { processGenuiSpec, repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'
import { readableOn } from '../src/client/blocks/blocks.tsx'
import { GENUI_LIMITS } from '../src/client/genui-runtime/index.ts'

afterEach(cleanup)

describe('icon node', () => {
  it('renders a bundled glyph with an accessible name', () => {
    const spec = repairGenuiSpec({
      items: [{ type: 'icon', name: 'Nodes', tone: 'success', label: '汇聚' }],
    })!
    const { container } = render(<GenuiBlock spec={spec} />)
    const icon = container.querySelector('[data-tone="success"]')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('role')).toBe('img')
    expect(icon?.getAttribute('aria-label')).toBe('汇聚')
    expect(icon?.querySelector('svg path')).not.toBeNull()
  })

  it('hides a decorative glyph from assistive tech', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'icon', name: 'Clock' }] })!
    const { container } = render(<GenuiBlock spec={spec} />)
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
  })

  it('fetches the full catalogue only for a real name outside the inline set', async () => {
    document.querySelectorAll('script[src*="icons.js"]').forEach(node => node.remove())
    const spec = repairGenuiSpec({ items: [{ type: 'icon', name: 'TrophyTop' }] })!
    const { container } = render(<GenuiBlock spec={spec} />)
    // The glyph is not inlined, so the plate starts on the neutral dot and the
    // catalogue script is requested exactly once.
    expect(container.querySelector('svg')).toBeNull()
    await waitFor(() => {
      expect(document.querySelector('script[src*="assets/icons.js"]')).not.toBeNull()
    })
    expect(document.querySelectorAll('script[src*="assets/icons.js"]')).toHaveLength(1)
  })

  it('does not download anything for a misspelled name', () => {
    document.querySelectorAll('script[src*="assets/icons.js"]').forEach(node => node.remove())
    const spec = repairGenuiSpec({ items: [{ type: 'icon', name: 'DefinitelyNotAGlyph' }] })!
    render(<GenuiBlock spec={spec} />)
    expect(document.querySelector('script[src*="assets/icons.js"]')).toBeNull()
  })

  it('degrades an unknown name to a neutral dot instead of dropping the fence', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'icon', name: 'NoSuchGlyph' }] })!
    expect(spec.items).toHaveLength(1)
    const { container } = render(<GenuiBlock spec={spec} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('[data-tone="default"]')).not.toBeNull()
  })
})

describe('blocks node', () => {
  it('paints each cell with its row colour and readable ink', () => {
    const spec = repairGenuiSpec({
      items: [{
        type: 'blocks',
        rows: [
          { label: '初始', cells: ['0', '1', '2'], color: '#e2e8f0' },
          { label: '轮 1', cells: ['01', '2'], color: '#1f6f7a' },
        ],
        caption: '每格代表一个小组',
      }],
    })!
    const { container } = render(<GenuiBlock spec={spec} />)
    // Only filled cells carry an inline background; row labels and gap pads
    // deliberately do not.
    const cells = [...container.querySelectorAll('[data-genui-blocks] span')]
      .filter(node => (node as HTMLElement).style.background !== '')
    expect(cells.map(node => node.textContent)).toEqual(['0', '1', '2', '01', '2'])
    // A pale slate needs ink; a deep teal needs white.
    expect((cells[0] as HTMLElement).style.color).toBe('rgb(13, 13, 13)')
    expect((cells[3] as HTMLElement).style.color).toBe('rgb(255, 255, 255)')
    expect(container.textContent).toContain('每格代表一个小组')
  })

  it.each(['rgb(255, 255, 255)', 'rgb(255 255 255)', 'rgba(255,255,255,1)', 'hsl(0, 0%, 100%)', 'hsl(0deg 0% 100%)', '#ffffffff'])('keeps text readable on the accepted literal fill %s', fill => {
    const processed = processGenuiSpec({ items: [{ type: 'blocks', rows: [{ color: fill, cells: ['正文', { text: '单格', color: fill }] }] }] })
    expect(processed.errors).toEqual([])
    const { container } = render(<GenuiBlock spec={processed.repaired!} />)
    const cells = [...container.querySelectorAll('[data-genui-blocks] span')]
      .filter(element => (element as HTMLElement).style.background !== '') as HTMLElement[]
    expect(cells).toHaveLength(2)
    expect(cells.map(cell => cell.style.color)).toEqual(['rgb(13, 13, 13)', 'rgb(13, 13, 13)'])
  })

  it('keeps `columns` lanes aligned and null cells as gaps', () => {
    const spec = repairGenuiSpec({
      items: [{
        type: 'blocks',
        columns: 4,
        rows: [
          { cells: ['A', null, 'B', null] },
          { cells: [null, 'C', null, 'D'] },
        ],
      }],
    })!
    const { container } = render(<GenuiBlock spec={spec} />)
    const grids = [...container.querySelectorAll('[data-genui-blocks] [style*="grid-template-columns"]')]
    expect(grids).toHaveLength(2)
    for (const grid of grids) {
      expect((grid as HTMLElement).style.gridTemplateColumns).toContain('repeat(4')
    }
    // null → visible gap placeholder, not a filled cell.
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(2)
  })

  it('costs one node against the budget no matter how many cells', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ cells: Array.from({ length: 8 }, (_, j) => `${i}${j}`) }))
    const spec = repairGenuiSpec({ items: [{ type: 'blocks', rows }] })!
    expect(spec.items).toHaveLength(1)
    // A 64-cell figure renders 64 cells through a single node.
    const { container } = render(<GenuiBlock spec={spec} />)
    expect(container.querySelectorAll('[data-genui-blocks] span').length).toBeGreaterThanOrEqual(64)
  })
})

describe('readableOn', () => {
  it('picks ink for light fills and white for dark fills', () => {
    expect(readableOn('#ffffff')).toBe('#0d0d0d')
    expect(readableOn('#000000')).toBe('#ffffff')
    expect(readableOn('#e2e8f0')).toBe('#0d0d0d')
    expect(readableOn('#1f6f7a')).toBe('#ffffff')
    expect(readableOn(undefined)).toBe('var(--dsw-alias-label-primary)')
  })
})

describe('blocks cell emphasis (v12.1)', () => {
  it('renders a bit grid: outline row with one highlighted cell and a sub caption', () => {
    const spec = repairGenuiSpec({
      items: [{
        type: 'blocks',
        columns: 8,
        rows: [{ variant: 'outline', cells: [{ text: '1', tone: 'danger', sub: 'SF' }, '0', '1', '1', '0', '0', '1', '0', '0'] }],
        caption: '最高位为 1，所以 SF=1。',
      }],
    })!
    const { container } = render(<GenuiBlock spec={spec} />)
    // Outline row: every cell keeps the hairline variant class.
    expect(container.querySelectorAll('[class*="blocksCellOutline"]')).toHaveLength(8)
    // Only the sign bit carries a semantic tone, and it names itself.
    expect(container.querySelectorAll('[data-tone="danger"]')).toHaveLength(1)
    expect(container.textContent).toContain('SF')
    expect(container.textContent).toContain('最高位为 1')
  })

  it('keeps an explicit hex above the row colour', () => {
    const spec = repairGenuiSpec({
      items: [{ type: 'blocks', rows: [{ cells: [{ text: 'A', color: '#1f6f7a' }, 'B'], color: '#e2e8f0' }] }],
    })!
    const { container } = render(<GenuiBlock spec={spec} />)
    const filled = [...container.querySelectorAll('[data-genui-blocks] span')]
      .filter(node => (node as HTMLElement).style.background !== '')
    expect((filled[0] as HTMLElement).style.color).toBe('rgb(255, 255, 255)')
    expect((filled[1] as HTMLElement).style.color).toBe('rgb(13, 13, 13)')
  })
})

describe('figure layout additions (v12.2)', () => {
  it('keeps arrow, flat card, col width and text tone/mono through repair', () => {
    const spec = {
      items: [{
        type: 'row',
        justify: 'center',
        items: [
          { type: 'card', flat: true, items: [{ type: 'text', size: 'caption', content: 'A', mono: true, tone: 'danger' }] },
          { type: 'arrow', dir: 'down', length: 30, label: '下一步' },
          { type: 'col', width: 40, items: [{ type: 'text', content: 'B' }] },
        ],
      }],
    }
    expect(repairGenuiSpec(spec)).toEqual(spec)
  })

  it('renders the arrow as a hairline path, not a text glyph', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'arrow', length: 24 }] })!
    const { container } = render(<GenuiBlock spec={spec} />)
    const arrow = container.querySelector('[data-genui-arrow]')
    expect(arrow).not.toBeNull()
    expect(arrow?.getAttribute('data-dir')).toBe('down')
    expect(arrow?.querySelector('path')?.getAttribute('d')).toContain('M7 1 V')
  })

  it('drops the paragraph glyph from flows but keeps explicit tones', () => {
    const spec = repairGenuiSpec({
      items: [{ type: 'blocks', columns: 4, rows: [{ variant: 'plain', cells: [{ text: '1', tone: 'danger' }, '0', '1', '0'] }] }],
    })!
    const { container } = render(<GenuiBlock spec={spec} />)
    expect(container.querySelectorAll('[class*="blocksCellPlain"]')).toHaveLength(4)
    expect(container.querySelectorAll('[data-tone="danger"]')).toHaveLength(1)
  })
})

describe('icon robustness (review #1 #2)', () => {
  const hostile = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']

  it('never throws for prototype-chain names', () => {
    for (const name of hostile) {
      const spec = repairGenuiSpec({ items: [{ type: 'icon', name }] })!
      const { container } = render(<GenuiBlock spec={spec} />)
      // 退化成一个中性圆点，而不是 ErrorBoundary 兜住的错误卡。
      expect(container.querySelector('svg')).toBeNull()
      expect(container.querySelector('[data-tone="default"]')).not.toBeNull()
      expect(container.textContent).toBe('')
    }
  })

  it('rejects prototype names before the lazy loader is asked', () => {
    document.querySelectorAll('script[src*="assets/icons.js"]').forEach(node => node.remove())
    for (const name of hostile) {
      render(<GenuiBlock spec={repairGenuiSpec({ items: [{ type: 'icon', name }] })!} />)
    }
    expect(document.querySelector('script[src*="assets/icons.js"]')).toBeNull()
  })

  it('keeps fill-rule and stroke glyphs faithful to upstream', () => {
    // File 在上游是 fill-rule=evenodd + clip-rule=evenodd 的复合形状。
    const spec = repairGenuiSpec({ items: [{ type: 'icon', name: 'File' }] })!
    const { container } = render(<GenuiBlock spec={spec} />)
    const path = container.querySelector('svg path')
    expect(path).not.toBeNull()
    expect(path?.getAttribute('fill-rule')).toBe('evenodd')
    expect(path?.getAttribute('clip-rule')).toBe('evenodd')
  })
})

describe('blocks sanitisation (review #5)', () => {
  it('drops a non-literal colour instead of passing it to inline style', () => {
    const spec = repairGenuiSpec({
      items: [{ type: 'blocks', rows: [{ color: 'url(https://evil.example/x)', cells: ['A', 'B'] }] }],
    })!
    const { container } = render(<GenuiBlock spec={spec} />)
    const filled = [...container.querySelectorAll('[data-genui-blocks] span')]
      .filter(node => (node as HTMLElement).style.background !== '')
    expect(filled).toHaveLength(0)
    expect(container.textContent).toContain('A')
  })

  it('rejects a var() colour that is not a host token', () => {
    const spec = repairGenuiSpec({
      items: [{ type: 'blocks', rows: [{ color: 'var(--attacker)', cells: ['A'] }] }],
    })!
    const { container } = render(<GenuiBlock spec={spec} />)
    const cell = container.querySelector('[data-genui-blocks] span[style*="background"]')
    expect(cell).toBeNull()
  })

  it('keeps a host-token colour and truncates oversized strings', () => {
    const spec = repairGenuiSpec({
      items: [{
        type: 'blocks',
        rows: [{ color: 'var(--dsw-static-blue-450)', cells: [{ text: 'x'.repeat(9000), color: '#1f6f7a', tone: 'danger', sub: 'y'.repeat(500) }] }],
      }],
    })!
    const row = spec.items[0]!.rows[0]!
    expect(row.color).toBe('var(--dsw-static-blue-450)')
    expect(row.cells[0]!.text!.length).toBe(2000)
    expect((row.cells[0] as { sub?: string }).sub!.length).toBe(128)
    const { container } = render(<GenuiBlock spec={spec} />)
    expect(container.querySelector('[data-tone="danger"]')).not.toBeNull()
  })

  it('caps rows and cells by the limits', () => {
    const rows = Array.from({ length: 40 }, () => ({ cells: Array.from({ length: 30 }, () => 'x') }))
    const spec = repairGenuiSpec({ items: [{ type: 'blocks', rows }] })!
    const node = spec.items[0] as Extract<GenuiNode, { type: 'blocks' }>
    expect(node.rows).toHaveLength(GENUI_LIMITS.maxBlocksRows)
    expect(node.rows[0]!.cells).toHaveLength(GENUI_LIMITS.maxBlocksCells)
  })
})

describe('validateGenuiSpec sees the new nodes (review #4)', () => {
  it('does not report the registered figure types as unknown', () => {
    const spec = { items: [
      { type: 'icon', name: 'Nodes' },
      { type: 'blocks', rows: [{ cells: ['A', 'B'] }] },
      { type: 'arrow' },
    ] }
    expect(validateGenuiSpec(spec)).toEqual({ ok: true, errors: [] })
  })

  it('still reports a genuinely unregistered type', () => {
    const spec = { items: [{ type: 'totally-made-up' }] }
    const result = validateGenuiSpec(spec)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('unknown type')
  })
})
