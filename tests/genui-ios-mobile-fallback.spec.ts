import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * iOS Safari / WKWebView 在 container-type 尺寸容器内会把 overflow 滚动层
 * 和带 transform 的包装层提升为合成层；离屏或滚动时这些层可能保留布局高度
 * 却不绘制（issue #442 的 table 空白）。这里在源码层钉住移动端兜底：
 * 不再让消息块成为尺寸容器，也不让 table 依赖横向滚动层。
 */
const css = (): string => readFileSync(join(process.cwd(), 'src/client/GenuiBlock.module.css'), 'utf8')

describe('iOS mobile container fallback (issue #442)', () => {
  it('drops the size container and entrance transform on iOS', () => {
    const source = css()
    expect(source).toMatch(/@supports \(-webkit-touch-callout: none\) \{[\s\S]*?\.block \{ container-type: normal; \}[\s\S]*?\.reveal \{ animation: none; \}/)
  })

  it('limits the viewport-based container fallback to narrow touch devices', () => {
    const source = css()
    const touch = /@media \(max-width: 760px\) and \(hover: none\) and \(pointer: coarse\) \{([^]*?)\n\}/.exec(source)
    expect(touch?.[1]).toContain('.block { container-type: normal; }')
    expect(touch?.[1]).toContain('.reveal { animation: none; }')
    expect(source).not.toMatch(/@media \(max-width: 760px\) \{\s*\.block\s*\{\s*container-type: normal;/)
  })

  it('keeps the grid/row collapse rules without container queries', () => {
    const source = css()
    const narrow = /@media \(max-width: 560px\) \{([\s\S]*?)\n\}/.exec(source)
    expect(narrow, 'narrow media block must exist').not.toBeNull()
    expect(narrow![1]).toContain('.grid { grid-template-columns: 1fr !important; }')
    expect(narrow![1]).toContain('.grid > [class*="gridSpan"] { grid-column: auto !important; }')
    expect(narrow![1]).toContain('.row { flex-wrap: wrap; }')
    expect(narrow![1]).toContain('.row > * { flex: 1 1 100% !important; }')
  })

  it('avoids a mobile horizontal scroll layer for tables on iOS touch devices', () => {
    const source = css()
    expect(source).toMatch(/@media \(max-width: 760px\) and \(hover: none\) and \(pointer: coarse\) \{[\s\S]*?\.tableWrap \{ overflow-x: visible; \}[\s\S]*?\.table \{ width: 100%; min-width: 0; table-layout: fixed;/)
  })
})
