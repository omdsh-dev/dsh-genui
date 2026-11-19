/**
 * `icon` node: one glyph from the bundled OpenAI Apps SDK UI catalogue,
 * optionally sitting on a tinted rounded-square plate.
 *
 * The plate is the "figure" form — the tinted tile that marks a stage, a
 * semantic role, or a card face in a diagram. Without `tile` the glyph is a
 * plain inline icon that follows the surrounding text colour, so a title can
 * read `icon + text` in a `row` without a second wrapper.
 *
 * Lookup is two-tier (see icon-lazy): 64 common glyphs render synchronously,
 * the remaining 685 arrive from `lib/assets/icons.js` after a one-shot load.
 * An unknown name never breaks the block — it renders a neutral dot.
 * @module @changfenhuang/dsh-genui/client/blocks/icon
 */
import { createElement, memo, useEffect, useState, type ReactNode } from 'react'
import css from '../GenuiBlock.module.css'
import type { GenuiIcon } from '../spec.ts'
import type { BundledIcon, IconShape } from '../icons/icon-data.ts'
import { ensureIcons, isKnownIcon, onIconsLoaded, resolveIcon } from '../icons/icon-lazy.ts'

/** Geometry and paint come from the same generated upstream SVG. */
function renderShape(shape: IconShape, index: number): ReactNode {
  return createElement(shape.tag, { ...shape.attrs, key: index })
}

/** Optical sizes the catalogue ships at; anything else clamps to the nearest. */
const SIZES = [16, 20, 24, 32] as const

function clampSize(size: number | undefined): number {
  if (size === undefined) return 20
  return SIZES.reduce((best, s) => (Math.abs(s - size) < Math.abs(best - size) ? s : best), 20)
}

/**
 * Resolve a glyph, triggering the catalogue load when the name is real but not
 * part of the inline set. Returns undefined until the paths are in.
 */
function useIcon(name: string): BundledIcon | undefined {
  const [glyph, setGlyph] = useState<BundledIcon | undefined>(() => resolveIcon(name))

  useEffect(() => {
    const immediate = resolveIcon(name)
    if (immediate !== undefined) {
      setGlyph(immediate)
      return
    }
    // A typo must not download the full catalogue: only real names reach the loader.
    if (!isKnownIcon(name)) {
      setGlyph(undefined)
      return
    }
    let live = true
    const unsubscribe = onIconsLoaded(() => {
      if (live) setGlyph(resolveIcon(name))
    })
    void ensureIcons().then(() => {
      if (live) setGlyph(resolveIcon(name))
    })
    return () => { live = false; unsubscribe() }
  }, [name])

  return glyph
}

export const IconNode = memo(function IconNode({ node }: { node: GenuiIcon }) {
  const icon = useIcon(node.name)
  const size = clampSize(node.size)
  const tone = node.tone ?? 'default'
  const tile = node.tile === true
  // A decorative glyph beside a visible label must not double-announce itself.
  const labelled = typeof node.label === 'string' && node.label.trim() !== ''
  return (
    <span
      className={css.iconNode}
      data-tone={tone}
      data-tile={tile ? 'true' : 'false'}
      // The plate is chrome, not content: size the box from the glyph so a
      // 16px icon in a tile still centres on a 34px plate.
      style={tile ? { width: size + 14, height: size + 14 } : undefined}
      {...(labelled
        ? { role: 'img', 'aria-label': node.label }
        : { 'aria-hidden': true })}
    >
      {icon === undefined
        ? <span className={css.iconDot} style={{ width: size * 0.4, height: size * 0.4 }} />
        : (
          <svg {...icon.attrs} viewBox={icon.viewBox} width={size} height={size} focusable="false">
            {icon.shapes.map((shape, i) => renderShape(shape, i))}
          </svg>
        )}
    </span>
  )
})
