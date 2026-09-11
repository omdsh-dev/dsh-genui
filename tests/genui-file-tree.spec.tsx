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

describe('component design contract (measured defects)', () => {
  const css = () => readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')

  it('keeps every control and marker visible in light mode', () => {
    const c = css()
    // Measured: the pending step marker had a 4%-black border and a page-coloured
    // fill (invisible ring); inputs sat on the page colour with the same 4% border.
    const step = /\.stepMarker \{([^}]*)\}/.exec(c)!
    expect(step[1]).toMatch(/background: var\(--dsl-g-surface\)/)
    expect(step[1]).toMatch(/border: 1px solid var\(--dsl-g-border-surface\)/)
    for (const rule of ['\.input, \.select', '\.textarea']) {
      const block = new RegExp(`${rule} \\{([^}]*)\\}`).exec(c)!
      expect(block[1]).toMatch(/background: var\(--dsl-g-surface\)/)
      expect(block[1]).toMatch(/border: 1px solid var\(--dsl-g-border-surface\)/)
    }
  })

  it('reserves the media box before the bytes arrive', () => {
    // Measured 213x0: an unloaded <img> collapsed and the card looked broken.
    expect(css()).toMatch(/img\.mediaPlayer \{[^}]*aspect-ratio: 16 \/ 9/)
    expect(css()).toMatch(/img\.mediaPlayer \{[^}]*object-fit: cover/)
  })

  it('gives quiz options a selection affordance from the start', () => {
    // Measured 16x0 (empty inline span): the options read as plain grey bars.
    const marker = /\.quizMarker \{([^}]*)\}/.exec(css())!
    expect(marker[1]).toMatch(/display: inline-block/)
    expect(marker[1]).toMatch(/width: 14px/)
  })

  it('resets box-sizing inside the block (select vs input grew 26px apart)', () => {
    expect(css()).toMatch(/\.block \*, \.block \*::before, \.block \*::after,[\s\S]{0,120}?box-sizing: border-box/)
  })

  it('themes mermaid from host tokens, not a stock palette', () => {
    const core = readFileSync(join(process.cwd(), 'src/client/mermaid-core.ts'), 'utf8')
    // Stock themes drew grey boxes with sharp corners next to rounded host UI.
    expect(core).toMatch(/theme: 'base'/)
    expect(core).toMatch(/themeVariables: \{/)
    expect(core).toMatch(/--dsw-alias-bg-layer-2/)
    expect(core).toMatch(/rx: 8px; ry: 8px/)
  })
})

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
    expect(css).toMatch(/--dsl-g-surface: color-mix\(in srgb, var\(--dsw-alias-label-primary\) 10%/)
    expect(css).toMatch(/--dsl-g-border-surface: color-mix\(in srgb, var\(--dsw-alias-label-primary\) 12%/)
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

describe('design-standard contract (research-driven)', () => {
  const css = () => readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')

  it('separates adjacent surfaces by the documented minimum', () => {
    // design-reference.md: light surfaces need a >=4% lightness step OR a
    // shadow of at least `0 1px 3px rgba(0,0,0,0.10)`. Our light step is a 10%
    // label tint (255 -> ~231 = 9.4%) and the shadow carries the documented
    // first layer.
    expect(css()).toMatch(/--dsl-g-surface: color-mix\(in srgb, var\(--dsw-alias-label-primary\) 10%/)
    expect(css()).toMatch(/--dsl-g-shadow-card: 0 1px 3px rgba\(0, 0, 0, 0\.10\)/)
  })

  it('keeps dark elevation as a small overlay, not a light-mode tint', () => {
    // Dark communicates elevation with the layer step plus a ~4% overlay;
    // drop shadows are nearly invisible on dark surfaces.
    const dark = /body\[data-ds-dark-theme\] \.block,[\s\S]{0,200}?--dsl-g-surface: color-mix\(in srgb, var\(--dsw-alias-label-primary\) 4%/.exec(css())
    expect(dark, 'dark override must use a 4% overlay').not.toBeNull()
  })

  it('makes a card title a heading, not a 12.5px uppercase label', () => {
    // The defect: the card title was SMALLER than the card body (12.5 vs
    // 14.5px) and uppercase, so every card read as a grey label block.
    const title = /\.cardTitle \{([^}]*)\}/.exec(css())
    expect(title).not.toBeNull()
    expect(title![1]).toMatch(/font-size: var\(--dsl-g-font-h3\)/)
    expect(title![1]).not.toMatch(/text-transform: uppercase/)
    expect(title![1]).toMatch(/text-transform: none/)
  })

  it('reserves uppercase tracking for eyebrows only', () => {
    const c = css()
    expect(c).toMatch(/\.heroLabel \{[^}]*text-transform: uppercase/)
    expect(c).toMatch(/\.heroLabel \{[^}]*letter-spacing: 0\.1em/)
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
