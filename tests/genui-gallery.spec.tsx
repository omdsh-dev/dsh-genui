// @vitest-environment jsdom
// GenUI gallery: the full-vocabulary spec renders through the real fence
// path (parse → repair → GenuiBlock) and every component family appears.
// Regression net: if a future vocabulary addition breaks rendering of any
// existing type, this file catches it.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { hasFenceRegistry } from './setup'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { gallerySpec } from '../src/client/gallery.ts'
import { GENUI_LIMITS, repairGenuiSpec } from '../src/client/guard.ts'

afterEach(cleanup)

function fenced(spec: unknown): string {
  return `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
}

describe('gallery spec', () => {
  it('survives the guard unchanged', () => {
    const repaired = repairGenuiSpec(gallerySpec)
    expect(repaired).toEqual(gallerySpec)
  })

  it.skipIf(!hasFenceRegistry)('renders every component family through the fence path', () => {
    render(<MarkdownText text={fenced(gallerySpec)} />)
    const body = document.body.textContent ?? ''
    // Layout + text hierarchy
    expect(body).toContain('排版层级')
    expect(body).toContain('正文')
    // Display
    expect(body).toContain('成功')
    expect(body).toContain('CPU')
    expect(body).toContain('训练进度')
    expect(document.querySelector('audio[controls][preload="none"]')).not.toBeNull()
    expect(body).toContain('性能指标')
    expect(body).toContain('版本')
    expect(body).toContain('标题项')
    // Avatars render their initial: the two avatars sit adjacent in a row.
    expect(body).toContain('AB')
    expect(screenCount('tab', 'label')).toBeLessThanOrEqual(GENUI_LIMITS.maxTabs)
    // Charts
    expect(document.querySelector('svg')).not.toBeNull()
    // Interactive controls
    expect(document.querySelector('input[type="checkbox"]')).not.toBeNull()
    expect(document.querySelector('textarea')).not.toBeNull()
    expect(document.querySelector('select')).not.toBeNull()
    expect(screenAllByRole('switch').length).toBeGreaterThan(0)
    expect(document.querySelector('input[type="radio"]')).not.toBeNull()
    expect(body).toContain('复制令牌')
    expect(document.querySelector('img[src="/demo-image.png"]')).not.toBeNull()
    expect(document.querySelector('audio[controls][preload="metadata"]')).not.toBeNull()
    expect(document.querySelector('video[controls][preload="metadata"]')).not.toBeNull()
    // Advanced
    expect(document.querySelector('[data-genui-callout]')).not.toBeNull()
    expect(document.querySelector('[data-genui-quiz]')).not.toBeNull()
    expect(document.querySelector('[data-genui-scene3d]')).not.toBeNull()
    expect(document.querySelector('nav[aria-label="breadcrumb"]')).not.toBeNull()
    // Containers
    expect(document.querySelector('table')).not.toBeNull()
    expect(document.querySelector('ol')).not.toBeNull()
    expect(document.querySelector('dl')).not.toBeNull()
    expect(document.querySelector('pre')).not.toBeNull() // code / mermaid fallback
  })
})

/** Query helpers that survive the hashed css-module class names. */
function screenCount(role: string, label: string): number {
  return Array.from(document.querySelectorAll(`[role="${role}"]`)).filter(el => el.textContent?.includes(label)).length
}

function screenAllByRole(role: string, label?: string): Element[] {
  const els = Array.from(document.querySelectorAll(`[role="${role}"]`))
  return label === undefined ? els : els.filter(el => el.textContent?.includes(label))
}
