// @vitest-environment jsdom
// Empty containers must paint NOTHING. Before this, a `card` with no children
// drew its border + title with a blank body, a table drew a header row over no
// body, and an empty `diagram`/`file-tree` drew a framed rectangle — all of
// which read as "failed to load" rather than "nothing to show".
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { processGenuiSpec } from '../src/client/guard.ts'

afterEach(cleanup)

/** Empty shapes a model actually emits when its data came back empty. */
const EMPTY: Array<[string, unknown]> = [
  ['grid', { type: 'grid', cols: 3, items: [] }],
  ['row', { type: 'row', items: [] }],
  ['col', { type: 'col', items: [] }],
  ['list', { type: 'list', items: [] }],
  ['file-tree', { type: 'file-tree', items: [] }],
  ['table', { type: 'table', columns: ['a', 'b'], rows: [] }],
  ['steps', { type: 'steps', steps: [] }],
  ['keyvalue', { type: 'keyvalue', pairs: [] }],
  ['mermaid', { type: 'mermaid', code: '   ' }],
  ['diagram', { type: 'diagram', kind: 'architecture', nodes: [] }],
]

describe('empty containers paint nothing', () => {
  for (const [name, node] of EMPTY) {
    it(`${name} with no content is suppressed`, () => {
      const spec = processGenuiSpec({ items: [node] }).spec
      expect(spec).not.toBeNull()
      const { container } = render(<GenuiBlock spec={spec!} />)
      // The block root stays (it is the conversation anchor); nothing inside it
      // may be a shell.
      expect(container.textContent?.trim()).toBe('')
      expect(container.querySelector('table')).toBeNull()
      expect(container.querySelector('svg')).toBeNull()
      expect(container.querySelector('[class*="card"]')).toBeNull()
      expect(container.querySelector('[class*="fileTree"]')).toBeNull()
    })
  }

  it('keeps a childless card\'s title as flat text, without the shell', () => {
    const spec = processGenuiSpec({ items: [{ type: 'card', title: '性能指标', items: [] }] }).spec
    const { container } = render(<GenuiBlock spec={spec!} />)
    expect(container.textContent).toBe('性能指标')
    // The shell is the bordered `card` block; a flat title is not one.
    expect(container.innerHTML).not.toMatch(/class="[^"]*\b_card_[^"]*"/)
  })

  it('suppresses a card that has neither children nor a title', () => {
    const spec = processGenuiSpec({ items: [{ type: 'card', items: [] }] }).spec
    const { container } = render(<GenuiBlock spec={spec!} />)
    expect(container.textContent?.trim()).toBe('')
  })

  it('still renders a container that has content', () => {
    const spec = processGenuiSpec({ items: [{ type: 'card', title: 'k', items: [{ type: 'text', content: '有内容' }] }] }).spec
    const { container } = render(<GenuiBlock spec={spec!} />)
    expect(container.textContent).toContain('有内容')
  })
})
