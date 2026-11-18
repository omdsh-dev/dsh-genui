// @vitest-environment jsdom
// The exported page keeps the URL in the spec and renders the embedded copy,
// so the fence media policy (http(s) / same-origin relative only) still governs
// what a model may write. These tests pin the render-time swap.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VideoNode } from '../src/client/blocks/basic.tsx'
import { CompareNode } from '../src/client/blocks/compare.tsx'
import { EntityCardNode } from '../src/client/blocks/entity-card.tsx'
import { ImageNode } from '../src/client/blocks/image.tsx'
import { ImageGroupNode } from '../src/client/blocks/image-group.tsx'
import { setGenuiMediaOverrides } from '../src/client/media-overrides.ts'
import { processGenuiSpec } from '../src/client/guard.ts'

const SOURCE = 'http://127.0.0.1:9/api/file?path=%2Ftmp%2Fa.png'
const EMBEDDED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

afterEach(() => {
  cleanup()
  setGenuiMediaOverrides(undefined)
})

/** One rendered <img> src list, in document order. */
function sources(container: HTMLElement): Array<string | null> {
  return Array.from(container.querySelectorAll('img')).map(image => image.getAttribute('src'))
}

describe('standalone media overrides', () => {
  it('renders the embedded copy for every image component', () => {
    setGenuiMediaOverrides(new Map([[SOURCE, EMBEDDED]]))

    expect(sources(render(<ImageNode node={{ type: 'image', src: SOURCE }} />).container)).toEqual([EMBEDDED])
    expect(sources(render(<ImageGroupNode node={{ type: 'image-group', items: [{ src: SOURCE }] }} />).container)).toEqual([EMBEDDED])
    expect(sources(render(<CompareNode node={{ type: 'compare', before: { src: SOURCE }, after: { src: SOURCE } }} />).container)).toEqual([EMBEDDED, EMBEDDED])
    expect(sources(render(<EntityCardNode node={{ type: 'entity-card', name: '报告', image: SOURCE }} />).container)).toEqual([EMBEDDED])
    const video = render(<VideoNode node={{ type: 'video', src: 'https://example.com/video.mp4', poster: SOURCE }} />)
    expect(video.container.querySelector('video')?.getAttribute('poster')).toBe(EMBEDDED)
  })

  it('leaves the source untouched when the page carries no media table', () => {
    expect(sources(render(<ImageNode node={{ type: 'image', src: SOURCE }} />).container)).toEqual([SOURCE])
  })

  it('keeps gallery identity on the spec source, so two entries stay distinct', () => {
    setGenuiMediaOverrides(new Map([[SOURCE, EMBEDDED]]))
    const { container } = render(<ImageGroupNode node={{ type: 'image-group', items: [{ src: SOURCE }, { src: SOURCE }] }} />)
    expect(sources(container)).toEqual([EMBEDDED, EMBEDDED])
    expect(container.querySelectorAll('figure')).toHaveLength(2)
  })

  it('still rejects an inline data URL written in a fence', () => {
    const processed = processGenuiSpec({ items: [{ type: 'image', src: EMBEDDED }] })
    expect(JSON.stringify(processed.repaired)).not.toContain('data:image')
  })
})
