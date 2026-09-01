// @vitest-environment jsdom
// Regression guard for the clipped-table bug: a GenUI `table` whose nowrap
// cells are wider than the message column used to be hard-clipped by
// `.tableWrap { overflow: hidden }` — the right side was unreachable and no
// scrollbar existed. The wrapper must be a horizontal scroll container
// (overflow-x: auto) so wide tables scroll instead of clipping.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { hasFenceRegistry } from './setup'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

function fenced(spec: unknown): string {
  return `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
}

describe('GenUI table overflow', () => {
  it.skipIf(!hasFenceRegistry)('wraps the table in a scroll container (DOM structure)', () => {
    const { container } = render(<MarkdownText text={fenced({
      title: 'AS vs Subagent Tree 对比',
      items: [
        {
          type: 'table',
          columns: ['Yet Another Subagent', 'Subagent Tree'],
          rows: [
            ['把官方 subagent 升级成可配置版', '要复制源码进 monorepo + git apply 补丁（5 个文件）'],
            ['实时显示子代理的 token 和工具调用', '只有运行/完成状态'],
          ],
        },
      ],
    })} />)

    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    const wrapper = table?.parentElement
    expect(wrapper).not.toBeNull()
    // The wrapper is the direct scroll container for the table; a clipped
    // wrapper with no scroll axis would reproduce the original bug.
    expect(wrapper?.tagName).toBe('DIV')
    expect(container.textContent).toContain('Subagent Tree')
  })

  it('tableWrap rule scrolls horizontally instead of clipping', () => {
    // jsdom cannot lay out, so the layout contract is pinned at the source
    // CSS level: the exact rule that regressed.
    const css = readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')
    const match = /\.tableWrap\s*\{([^}]*)\}/.exec(css)
    expect(match, 'tableWrap rule must exist').not.toBeNull()
    const rule = match![1]!
    expect(rule).toContain('overflow-x: auto')
    expect(rule).toContain('overscroll-behavior-x: contain')
    // The regression: overflow: hidden clipped the right side with no scroll.
    expect(rule).not.toContain('overflow: hidden')
    // In any layout mode the wrapper must be allowed to shrink to the
    // available width so the inner scrollbar is the one that appears.
    expect(rule).toContain('min-width: 0')
    expect(rule).toContain('max-width: 100%')
  })

  it('does not animate table-row hover repaints (issue #55)', () => {
    const css = readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')
    expect(css).toMatch(/\.table tbody tr:hover\s*\{[^}]*background:/)
    const restingRule = /\.table tbody tr\s*\{([^}]*)\}/.exec(css)
    expect(restingRule?.[1] ?? '').not.toMatch(/\btransition\s*:/)
  })

  it('releases the reveal transform after animation', () => {
    const css = readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')
    const match = /\.reveal\s*\{([^}]*)\}/.exec(css)
    expect(match, 'reveal rule must exist').not.toBeNull()
    expect(match![1]).toContain('backwards')
    expect(match![1]).not.toContain('both')
  })

  it('no animation pins a transform past its end', () => {
    // fill-mode both/forwards keeps the end keyframe (translateY(0)) applied
    // after completion. Every entrance/pop animation releases via
    // backwards/none so the natural styles take over after the animation.
    const css = readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')
    const animations = [...css.matchAll(/animation:\s*([^;]+);/g)].map(m => m[1]!)
    expect(animations.length).toBeGreaterThan(0)
    for (const value of animations) {
      expect(value, `animation "${value}" must not pin its end state`).not.toMatch(/\b(both|forwards)\b/)
    }
  })
})
