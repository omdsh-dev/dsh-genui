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

  // Indentation is an inline padding-left (depth * 16px) on each row, so it
  // survives even a stylesheet failure and grows with nesting depth.
  const paddingLefts = rows.map(row => row.style.paddingLeft)
  expect(paddingLefts).toContain('0px')
  expect(paddingLefts).toContain('16px')
  expect(paddingLefts).toContain('32px')
  expect(paddingLefts).toContain('48px')
  expect(paddingLefts).toContain('64px')

  // Glyphs are inline text content (▾/▸ for dirs, · for files), so they too
  // survive a stylesheet failure.
  const icons = Array.from(container.querySelectorAll<HTMLElement>('[class*="ftIcon"]'))
  expect(icons).toHaveLength(rows.length)
  const glyphs = icons.map(icon => icon.textContent ?? '')
  expect(glyphs).toContain('▾')
  expect(glyphs).toContain('·')

  // The issue's deepest path is present and collapsible, not clipped away.
  expect(container.textContent).toContain('client.js')
  expect(container.textContent).toContain('README.md')
}

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
