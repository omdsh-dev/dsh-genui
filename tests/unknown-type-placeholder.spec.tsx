// Unknown component types must degrade to a muted placeholder that names the
// type, not to a red role="alert" error strip: a typo in one component should
// not read as a page-level failure. Covers both the markup shape and the
// non-throwing contract for arbitrary junk node shapes.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderNode } from '../src/client/blocks/render-node.tsx'
import type { GenuiNode } from '../src/client/spec.ts'

function renderJunk(node: unknown): string {
  return renderToStaticMarkup(
    renderNode(node as GenuiNode, 0, undefined) as Parameters<typeof renderToStaticMarkup>[0],
  )
}

describe('unknown component type placeholder', () => {
  it('names the offending type in a muted placeholder', () => {
    const html = renderJunk({ type: 'not-a-real-component' })
    expect(html).toContain('not-a-real-component')
    expect(html).toContain('data-genui-unknown')
  })

  it('is not an alert / error strip', () => {
    const html = renderJunk({ type: 'not-a-real-component' })
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('data-genui-error')
  })

  it('does not throw or leak child content', () => {
    const html = renderJunk({
      type: 'totally-unknown',
      items: [{ type: 'text', content: 'SECRET-CHILD-CONTENT' }],
    })
    expect(html).toContain('totally-unknown')
    expect(html).not.toContain('SECRET-CHILD-CONTENT')
  })

  it('falls back to a readable label when type is not a string', () => {
    const html = renderJunk({ type: 42 })
    expect(html).toContain('data-genui-unknown')
    expect(html).toContain('42')
  })
})