import { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { GENUI_LIMITS } from '../genui-runtime/limits.ts'
import { num } from '../genui-runtime/value-utils.ts'
import { useT } from '../i18n/index.ts'
import { renderInline } from '../inline.ts'
import type { GenuiCarousel } from '../spec.ts'
import css from './gallery.module.css'

/** Local navigation only: children retain their renderer-owned state and actions. */
export function CarouselNode({ node, children }: { node: GenuiCarousel; children: ReactNode[] }): ReactNode {
  const t = useT()
  const id = useId()
  const trackRef = useRef<HTMLDivElement>(null)
  const previousRef = useRef<HTMLButtonElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const [edges, setEdges] = useState({ previous: false, next: false })
  const [hasOverflow, setHasOverflow] = useState(false)
  const slides = children.slice(0, GENUI_LIMITS.maxCarouselItems)
  const itemWidth = num(node.itemWidth, 80, 640) ?? 240
  const rawGap = num(node.gap, 0, Number.MAX_SAFE_INTEGER / 4)
  const gap = rawGap === undefined ? 12 : rawGap * 4

  const measure = useCallback(() => {
    const track = trackRef.current
    if (track === null) return
    const maximum = Math.max(0, track.scrollWidth - track.clientWidth)
    const next = { previous: track.scrollLeft > 1, next: track.scrollLeft < maximum - 1 }
    // Edge controls disappear; preserve keyboard context before React removes the focused one.
    const active = document.activeElement
    if (((maximum <= 1 || !next.previous) && active === previousRef.current)
      || ((maximum <= 1 || !next.next) && active === nextRef.current)) track.focus({ preventScroll: true })
    setHasOverflow(current => current === (maximum > 1) ? current : maximum > 1)
    setEdges(current => current.previous === next.previous && current.next === next.next ? current : next)
  }, [])

  useLayoutEffect(() => {
    const track = trackRef.current
    if (track === null) return
    measure()
    // Streaming updates never reset scrollLeft or replace existing slides.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(track)
    for (const slide of track.children) observer?.observe(slide)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [slides.length, itemWidth, gap, measure])

  const scrollTo = (left: number): void => {
    const track = trackRef.current
    if (track === null) return
    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const target = Math.max(0, Math.min(left, track.scrollWidth - track.clientWidth))
    if (typeof track.scrollTo === 'function') track.scrollTo({ left: target, behavior: reducedMotion ? 'auto' : 'smooth' })
    else track.scrollLeft = target
    measure()
  }

  const move = (direction: -1 | 1): void => {
    const track = trackRef.current
    if (track === null) return
    const first = track.firstElementChild as HTMLElement | null
    const step = (first?.offsetWidth ?? Math.min(itemWidth, track.clientWidth)) + gap
    scrollTo(track.scrollLeft + direction * step)
  }

  /** 让导航按钮按可视轨道宽度的比例切换内容。 */
  const page = (direction: -1 | 1): void => {
    const track = trackRef.current
    if (track === null) return
    scrollTo(track.scrollLeft + direction * track.clientWidth * 0.85)
  }

  return (
    <section className={css.gallery} aria-labelledby={`${id}-title`}>
      <div className={css.header}>
        <h3 className={css.title} id={`${id}-title`}>{renderInline(node.title ?? t('block.carousel'))}</h3>
      </div>
      {slides.length === 0
        ? <p className={css.empty}>{t('block.galleryEmpty')}</p>
        : <div className={css.trackWrap}>
          {hasOverflow && <div className={css.carouselControls}>
          {edges.previous && <button
            ref={previousRef}
            type="button"
            className={`${css.control} ${css.carouselControl} ${css.previous}`}
            aria-label={t('block.carouselPrevious')}
            aria-controls={`${id}-track`}
            onClick={() => page(-1)}
          ><span aria-hidden="true">←</span></button>
          }
          {edges.next && <button
            ref={nextRef}
            type="button"
            className={`${css.control} ${css.carouselControl} ${css.next}`}
            aria-label={t('block.carouselNext')}
            aria-controls={`${id}-track`}
            onClick={() => page(1)}
          ><span aria-hidden="true">→</span></button>
          }
          </div>}
          <div
            ref={trackRef}
            id={`${id}-track`}
            className={css.track}
            role="group"
            aria-labelledby={`${id}-title`}
            tabIndex={0}
            style={{ '--gallery-item-width': `${itemWidth}px`, '--gallery-gap': `${gap}px` } as CSSProperties}
            onScroll={measure}
            onKeyDown={event => {
              // Nested forms, sliders, and child carousels own their keys.
              if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return
              if (event.key === 'ArrowLeft') move(-1)
              else if (event.key === 'ArrowRight') move(1)
              else if (event.key === 'Home') scrollTo(0)
              else if (event.key === 'End') scrollTo(event.currentTarget.scrollWidth)
              else return
              event.preventDefault()
            }}
          >
            {slides.map((child, index) => (
              // The runtime identifies children by path/index. Do not key by
              // streamed content: that would remount inputs on every token.
              <div className={css.slide} key={index} role="group" aria-label={t('block.carouselPosition', { current: index + 1, total: slides.length })}>
                {child}
              </div>
            ))}
          </div>
        </div>}
    </section>
  )
}
