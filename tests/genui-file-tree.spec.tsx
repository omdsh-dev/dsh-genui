// @vitest-environment jsdom
// Regression guard for the file-tree layout bug (issue #28): a `file-tree`
// in a narrow host message column used to render as a vertical list — long
// names wrapped one character per line, and the tree rows appeared to lose
// their indentation and glyphs. jsdom cannot lay out, so two contracts are
// pinned:
//   1. DOM structure: every row keeps the inline `padding-left` indentation
//      and the inline ▾/▸/· glyphs survive regardless of CSS.
//   2. CSS source: `.ftName` must never wrap; `.ftNameBtn` must shrink but
//      never exceed the row; `.fileTree` must provide a horizontal scroll
//      path (the same `.tableWrap` pattern) instead of hard-clipping.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownText } from './markdown-labels.tsx'
import { hasFenceRegistry } from './helpers/fence-host'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'

afterEach(cleanup)

const fileTree = {
  type: 'file-tree',
  items: [
    { name: '~/.dsh/', type: 'dir', children: [
      { name: 'profiles/web/', type: 'dir', children: [
        { name: 'package.json', type: 'file' },
        { name: 'plugins/', type: 'dir', children: [
          { name: 'dsh-terminal-hotkey/', type: 'dir', children: [
            { name: 'lib/', type: 'dir', children: [
              { name: 'client.js', type: 'file' },
              { name: 'index.js', type: 'file' },
            ] },
            { name: 'package.json', type: 'file' },
            { name: 'README.md', type: 'file' },
          ] },
        ] },
        { name: 'node_modules/', type: 'dir' },
      ] },
    ] },
  ],
}

function fenced(spec: unknown): string {
  return `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
}

function renderBlock(spec: unknown) {
  return render(
    <GenuiActionContext.Provider value={undefined}>
      <GenuiBlock spec={repairGenuiSpec(spec)!} />
    </GenuiActionContext.Provider>,
  )
}

function assertFileTreeLayout(container: HTMLElement): void {
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[class*="ftRow"]'))
  // 1 root + 1 + 2 + 1 + 3 + 2 + 1 = 11 rows in the issue example.
  expect(rows).toHaveLength(11)

  // Indentation is an inline padding-left (4px + depth * 14px) on each row, so
  // it survives even a stylesheet failure and grows with nesting depth.
  const paddingLefts = rows.map(row => row.style.paddingLeft)
  expect(paddingLefts).toContain('4px')
  expect(paddingLefts).toContain('18px')
  expect(paddingLefts).toContain('32px')
  expect(paddingLefts).toContain('46px')
  expect(paddingLefts).toContain('60px')

  // Every row carries an inline glyph: an inline SVG folder/file (no CSS
  // dependency) plus a text chevron for directories.
  const icons = Array.from(container.querySelectorAll<HTMLElement>('[class*="ftGlyph"]'))
  expect(icons).toHaveLength(rows.length)
  expect(container.querySelectorAll('[class*="ftGlyph"] svg')).toHaveLength(rows.length)
  const chevrons = Array.from(container.querySelectorAll<HTMLElement>('[class*="ftChevron"]'))
    .map(node => node.textContent ?? '')
  expect(chevrons).toContain('▸')
  // Depth rails: one absolutely-positioned guide per nesting level.
  expect(container.querySelectorAll('[class*="ftGuide"]').length).toBeGreaterThan(0)

  // The issue's deepest path is present and collapsible, not clipped away.
  expect(container.textContent).toContain('client.js')
  expect(container.textContent).toContain('README.md')
}

describe('surface elevation contract', () => {
  it('puts cards on the elevated host layer, not the page layer', () => {
    const css = readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')
    // Dark theme: page 21,21,23 → layer-1 35,35,36 (only 14 units: "a black
    // box") → layer-2 44,44,46. Cards, stats and callouts must sit on layer-2.
    const card = /\.card \{([^}]*)\}/.exec(css)
    expect(card, '.card rule must exist').not.toBeNull()
    expect(card![1]).toMatch(/background: var\(--dsl-g-surface\)/)
    const stat = /\.stat \{([^}]*)\}/.exec(css)
    expect(stat![1]).toMatch(/background: var\(--dsl-g-surface\)/)
    const callout = /\.callout \{([^}]*)\}/.exec(css)
    expect(callout![1]).toMatch(/background: var\(--dsl-g-surface\)/)
  })

  it('gives surfaces a visible outline and a lift (light theme has no layers)', () => {
    const css = readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')
    // Light theme maps every bg layer to white and its border-l1 is 4% black —
    // a card there would be invisible without border-l2 + a shadow.
    expect(css).toMatch(/--dsl-g-shadow-card:/)
    expect(css).toMatch(/--dsl-g-surface: color-mix\(in srgb, var\(--dsw-alias-label-primary\) 4%/)
    expect(css).toMatch(/--dsl-g-border-surface: color-mix\(in srgb, var\(--dsw-alias-label-primary\) 14%/)
    for (const rule of ['card', 'stat', 'callout', 'hero', 'accordion']) {
      const block = new RegExp(`\\.${rule} \\{([^}]*)\\}`).exec(css)
      expect(block, `.${rule} must exist`).not.toBeNull()
      // Outline + surface tint are DERIVED from the theme's label colour: the
      // light theme maps every layer to white, so host layer/border tokens
      // alone cannot separate a card from the page.
      expect(block![1], `.${rule} needs a visible outline`).toMatch(/border: 1px solid var\(--dsl-g-border-surface\)/)
      expect(block![1], `.${rule} needs a lift`).toMatch(/box-shadow: var\(--dsl-g-shadow-card\)/)
    }
  })
})

describe('bento card layout contract', () => {
  it('lets a card absorb the row height and centre its graphic', () => {
    const css = readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')
    // A short card next to a tall one used to pin its content to the top and
    // leave a dead block underneath; the last child must absorb the slack and
    // the graphic shapes must centre inside it.
    expect(css).toMatch(/\.card > :last-child \{[^}]*flex: 1 1 auto/)
    const centring = /\.card > \.chart,[\s\S]{0,120}?justify-content: center/
    expect(css).toMatch(centring)
    expect(css).toMatch(/\.gridSpan \{[^}]*display: flex/)
  })
})

describe('GenUI file-tree layout (issue #28)', () => {
  it.skipIf(!hasFenceRegistry)('renders rows, indent and glyphs through the MarkdownText fence harness', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [fileTree] })} />)
    assertFileTreeLayout(container)
  })

  it('renders rows, indent and glyphs through the GenuiBlock harness (registry-less hosts)', () => {
    const { container } = renderBlock({ items: [fileTree] })
    assertFileTreeLayout(container)
  })

  it('pins the CSS contract that prevents per-character wrapping', () => {
    const css = readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')

    const ftName = /\.ftName\s*\{([^}]*)\}/.exec(css)
    expect(ftName, 'ftName rule must exist').not.toBeNull()
    const ftNameRule = ftName![1]!
    // The regression: long paths wrapped one character per line when the
    // container got narrow. The name must stay on one line and ellipsize.
    expect(ftNameRule).toContain('white-space: nowrap')
    expect(ftNameRule).toContain('overflow: hidden')
    expect(ftNameRule).toContain('text-overflow: ellipsis')
    // As a flex item the name must be allowed to shrink below its content
    // width, otherwise the nowrap text would overflow instead of ellipsizing.
    expect(ftNameRule).toContain('min-width: 0')

    const ftNameBtn = /\.ftNameBtn\s*\{([^}]*)\}/.exec(css)
    expect(ftNameBtn, 'ftNameBtn rule must exist').not.toBeNull()
    const ftNameBtnRule = ftNameBtn![1]!
    // The button may shrink to the row (min-width: 0) but must never force
    // the row wider than the message column.
    expect(ftNameBtnRule).toContain('min-width: 0')
    expect(ftNameBtnRule).toContain('max-width: 100%')

    const fileTree = /\.fileTree\s*\{([^}]*)\}/.exec(css)
    expect(fileTree, 'fileTree rule must exist').not.toBeNull()
    const fileTreeRule = fileTree![1]!
    // Same scroll-container contract as .tableWrap: deep indentation scrolls
    // horizontally instead of clipping or collapsing the column.
    expect(fileTreeRule).toContain('overflow-x: auto')
    expect(fileTreeRule).toContain('overscroll-behavior-x: contain')
    expect(fileTreeRule).toContain('min-width: 0')
    expect(fileTreeRule).toContain('max-width: 100%')
  })
})
