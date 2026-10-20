/**
 * `blocks` node: a grid of filled cells grouped into labelled rows — the
 * declarative form of the block diagrams models used to hand-write as SVG
 * (recursion ladders, "4 equal parts", pipeline lane grids).
 *
 * Three shapes, one data structure:
 *   · ladder     each row divides its own width (`cells` counts differ)
 *   · parts      4 equal cells in one row
 *   · lanes      `columns` fixes a shared column count; `null` cells are gaps
 *
 * Why this exists instead of `svg`: coordinates are the model's weakest
 * subject. A 15-rect figure with hand-computed x/y aligns by luck; the same
 * figure as rows × cells aligns by construction, and costs ONE node against
 * the 200-node budget instead of ~30.
 * @module @changfenhuang/dsh-genui/client/blocks/blocks
 */
import { memo } from 'react'
import css from '../GenuiBlock.module.css'
import { renderInline } from '../inline.ts'
import { GENUI_LIMITS } from '../genui-runtime/index.ts'
import type { GenuiBlocks } from '../spec.ts'

/**
 * Contrast-aware ink for opaque literal fills; theme ink for contextual fills.
 *
 * Uses WCAG relative luminance, not a naive RGB average: the average reads
 * mid-tone blues (#339cff) as "dark" and prints white on a surface that
 * actually needs ink on it.
 */
export function readableOn(color: string | undefined): string {
  const fill = (color ?? '').trim()
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(fill)
  let channels: number[]
  if (hexMatch !== null) {
    let hex = hexMatch[1]!
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
    channels = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16))
  } else {
    // Let the browser's CSS parser normalize RGB/HSL and their modern syntax.
    // This detached style needs no layout or global theme mutation. Host
    // tokens and translucent fills retain the host ink because their final
    // contrast depends on the surrounding theme/backdrop.
    if (typeof document === 'undefined') return 'var(--dsw-alias-label-primary)'
    const style = document.createElement('span').style
    style.color = fill
    const rgb = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(style.color)
    if (rgb === null || (rgb[4] !== undefined && Number(rgb[4]) !== 1)) return 'var(--dsw-alias-label-primary)'
    channels = rgb.slice(1, 4).map(Number)
  }
  const channel = (value: number): number => {
    const v = value / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(channels[0]!)
    + 0.7152 * channel(channels[1]!)
    + 0.0722 * channel(channels[2]!)
  // 0.179 is the exact crossover where white and near-black score the same
  // contrast ratio, so anything above it is better with ink than with white.
  return luminance > 0.179 ? '#0d0d0d' : '#ffffff'
}

export const BlocksNode = memo(function BlocksNode({ node }: { node: GenuiBlocks }) {
  const rows = node.rows.slice(0, GENUI_LIMITS.maxBlocksRows)
  // `columns` aligns every row to one lane grid; without it each row divides
  // its own width (the ladder shape).
  const columns = node.columns === undefined
    ? undefined
    : Math.max(1, Math.min(GENUI_LIMITS.maxBlocksCells, Math.trunc(node.columns)))
  const caption = node.caption?.trim()
  return (
    <figure className={css.blocksFigure} data-genui-blocks>
      {node.title !== undefined && <div className={css.blocksTitle}>{renderInline(node.title)}</div>}
      <div className={css.blocksRows}>
        {rows.map((row, i) => {
          const count = columns ?? Math.max(1, Math.min(GENUI_LIMITS.maxBlocksCells, row.cells.length))
          const cells = row.cells.slice(0, count)
          const fill = row.color
          const ink = readableOn(fill)
          const variant = row.variant ?? 'fill'
          const outline = variant === 'outline'
          const plain = variant === 'plain'
          return (
            <div key={i} className={css.blocksRow}>
              {row.label !== undefined && (
                <span className={css.blocksRowLabel}>{renderInline(row.label)}</span>
              )}
              <div
                className={css.blocksCells}
                style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
              >
                {cells.map((cell, j) => {
                  // `null` is a blank lane slot: no dash, no fill. Write the
                  // string "—" when a visible placeholder is wanted.
                  if (cell === null) return <span key={j} className={css.blocksGap} aria-hidden />
                  // Object form: one cell carries the emphasis (sign bit, active
                  // lane) and/or a caption hanging under it.
                  const spec = typeof cell === 'string' ? { text: cell } : cell
                  const cellInk = spec.color !== undefined ? readableOn(spec.color) : ink
                  // `plain` rows paint nothing unless the cell itself asks
                  // for a tone/colour — that is what makes a bit string read
                  // as digits instead of a table.
                  // Precedence: explicit hex > semantic tone (painted by CSS
                  // from [data-tone]) > the row's own paint mode.
                  const paint = spec.color !== undefined
                    ? { background: spec.color, color: cellInk }
                    : spec.tone !== undefined
                      ? undefined
                      : plain || outline
                        ? undefined
                        : fill !== undefined
                          ? { background: fill, color: ink }
                          : undefined
                  return (
                    <span key={j} className={css.blocksCellWrap}>
                      <span
                        className={`${css.blocksCell} ${outline ? css.blocksCellOutline : ''}${plain ? ` ${css.blocksCellPlain}` : ''}`}
                        data-tone={spec.tone}
                        style={paint}
                      >
                        {renderInline(spec.text)}
                      </span>
                      {spec.sub !== undefined && (
                        <span className={css.blocksSub}>{renderInline(spec.sub)}</span>
                      )}
                    </span>
                  )
                })}
                {/* `columns` wider than the row: pad the tail so every row's
                    cells keep their lane instead of stretching to fill. */}
                {Array.from({ length: Math.max(0, count - cells.length) }, (_, k) => (
                  <span key={`pad-${k}`} className={css.blocksGapPad} aria-hidden />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {caption !== undefined && caption !== '' && (
        <figcaption className={css.blocksCaption}>{renderInline(caption)}</figcaption>
      )}
    </figure>
  )
})
