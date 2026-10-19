/**
 * `icon` node: one glyph from the bundled OpenAI Apps SDK UI catalogue,
 * optionally sitting on a tinted rounded-square plate.
 *
 * The plate is the "figure" form — the tinted tile that marks a stage, a
 * semantic role, or a card face in a diagram. Without `tile` the glyph is a
 * plain inline icon that follows the surrounding text colour, so a title can
 * read `icon + text` in a `row` without a second wrapper.
 *
 * Lookup is two-tier (see icon-lazy): 61 common glyphs render synchronously,
 * the remaining ~692 arrive from `lib/assets/icons.js` after a one-shot load.
 * An unknown name never breaks the block — it renders a neutral dot.
 * @module @changfenhuang/dsh-genui/client/blocks/icon
 */
import { memo, useEffect, useState, type ReactNode } from 'react'
import css from '../GenuiBlock.module.css'
import type { GenuiIcon } from '../spec.ts'
import type { BundledIcon, IconShape } from '../icons/icon-data.ts'
import { ensureIcons, isKnownIcon, onIconsLoaded, resolveIcon } from '../icons/icon-lazy.ts'

/**
 * 画一个 shape。
 *
 * `fill` 只在 shape 自己没有指定 fill/stroke 时兜底成 currentColor：上游有
 * 一批字形用 `stroke` 而不是 `fill`，无条件写 fill="currentColor" 会把它们
 * 涂成实心。fill-rule / clip-rule / opacity 直接透传——丢掉它们会让带镂空的
 * 字形（File、Folders、Trash…）画错。
 */
function renderShape(shape: IconShape, index: number): ReactNode {
  const common: Record<string, unknown> = {
    key: index,
    fillRule: shape['fill-rule'],
    clipRule: shape['clip-rule'],
    opacity: shape.opacity,
  }
  // 自带 fill/stroke 的字形保持原样；否则按 tag 给合理兜底。
  // stroke 形态只在上游确实声明了 stroke 时使用；cap/join 收窄成 SVG 接受的
  // 字面量，避免把任意字符串透传给 DOM 属性。
  const painted = shape.stroke !== undefined
    ? {
        stroke: shape.stroke,
        strokeWidth: shape['stroke-width'] ?? 1.5,
        ...(shape['stroke-linecap'] !== undefined ? { strokeLinecap: shape['stroke-linecap'] } : {}),
        ...(shape['stroke-linejoin'] !== undefined ? { strokeLinejoin: shape['stroke-linejoin'] } : {}),
      }
    : { fill: 'currentColor' }
  const shared = { ...common, ...painted }

  switch (shape.tag) {
    case 'rect':
      return <rect {...shared} rx={shape.rx} width="100%" height="100%" />
    case 'circle':
      return <circle {...shared} cx="12" cy="12" r="10" />
    case 'ellipse':
      return <ellipse {...shared} cx="12" cy="12" rx="10" ry="10" />
    case 'line':
      return <line {...shared} x1="4" y1="12" x2="20" y2="12" />
    case 'polyline':
      return <polyline {...shared} points="4 14 10 8 20 8" />
    case 'polygon':
      return <polygon {...shared} points="12 3 21 20 3 20" />
    default:
      return <path {...shared} d={shape.d ?? ''} />
  }
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
    // A typo must not download 870 KB: only real names reach the loader.
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
          <svg viewBox={icon.viewBox} width={size} height={size} focusable="false">
            {icon.shapes.map((shape, i) => renderShape(shape, i))}
          </svg>
        )}
    </span>
  )
})
