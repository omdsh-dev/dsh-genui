/**
 * Streaming placeholder: shown while a fence body is still arriving and no
 * component has finished. It carries the shape of the component that is coming
 * (table rows, chart bars, …) and the real title as soon as it has arrived, so
 * the swap to real content reads as completion rather than as a different
 * component appearing.
 *
 * Kept in its own module so it can be rendered in isolation (design review,
 * preview builds) without pulling the whole DOM channel dependency graph.
 */
import css from '../GenuiBlock.module.css'
import type { SkeletonShape } from '../streaming-shape.ts'

/** Shapes that are an object, not a block: they get no elevated surface, because
 *  a lone button or a divider does not become a card when it finishes. */
const INLINE_SHAPES: ReadonlySet<SkeletonShape> = new Set<SkeletonShape>(['control', 'rule'])

/** Replace a half-written spec with a placeholder of the same shape. */
export function GenuiSkeleton({ shape, title }: { shape: SkeletonShape; title?: string }) {
  return (
    // The skeleton replaces the code block OUTSIDE the block root, so it has to
    // carry `.block` itself: that is where the `--dsl-g-*` tokens are declared.
    // Without it every gap/padding/radius resolved to nothing and the
    // placeholder painted as a hard-edged rectangle — the "毛坯" look.
    <div className={css.block}>
      <div className={`${css.skeleton} ${INLINE_SHAPES.has(shape) ? css.skeletonInline : ''}`}
        data-genui-skeleton={shape} role="status"
        aria-label={title === undefined ? '正在生成界面' : `正在生成界面：${title}`}>
        {title !== undefined ? <span className={css.skeletonHeading}>{title}</span> : null}
        <SkeletonBody shape={shape} />
      </div>
    </div>
  )
}

/** Placeholder body per shape: it should read as "a table is arriving", not as
 *  "something is loading". Widths are fixed so nothing reflows on swap. */
export function SkeletonBody({ shape }: { shape: SkeletonShape }) {
  switch (shape) {
    case 'table':
      return (
        <span className={css.skeletonTable}>
          <span className={css.skeletonRowHead}>
            <span style={{ width: '22%' }} /><span style={{ width: '34%' }} /><span style={{ width: '18%' }} />
          </span>
          {[0, 1, 2, 3].map(i => (
            <span className={css.skeletonRow} key={i}>
              <span style={{ width: '22%' }} /><span style={{ width: '34%' }} /><span style={{ width: '18%' }} />
            </span>
          ))}
        </span>
      )
    case 'chart':
      return (
        <span className={css.skeletonChart}>
          <span className={css.skeletonAxis} />
          <span className={css.skeletonBars}>
            <span style={{ height: '46%' }} /><span style={{ height: '72%' }} /><span style={{ height: '38%' }} />
            <span style={{ height: '88%' }} /><span style={{ height: '58%' }} />
          </span>
        </span>
      )
    case 'list':
    case 'keyvalue':
      return (
        <span className={css.skeletonRows}>
          {[0, 1, 2].map(i => (
            <span className={css.skeletonRow} key={i}>
              <span style={{ width: '16%' }} /><span style={{ width: `${[58, 44, 66][i]}%` }} />
            </span>
          ))}
        </span>
      )
    case 'stat':
      return (
        <span className={css.skeletonStat}>
          <span style={{ width: '38%', height: 22 }} />
          <span style={{ width: '20%', height: 8 }} />
        </span>
      )
    case 'text':
      return (
        <span className={css.skeletonRows}>
          <span style={{ width: '92%', height: 10 }} />
          <span style={{ width: '78%', height: 10 }} />
          <span style={{ width: '54%', height: 10 }} />
        </span>
      )
    case 'diagram':
      return (
        <span className={css.skeletonDiagram}>
          <span style={{ width: '34%', height: 44 }} />
          <span className={css.skeletonLink} />
          <span style={{ width: '34%', height: 44 }} />
        </span>
      )
    case 'code':
      return (
        <span className={css.skeletonRows}>
          <span style={{ width: '64%', height: 9 }} />
          <span style={{ width: '82%', height: 9 }} />
          <span style={{ width: '48%', height: 9 }} />
        </span>
      )
    case 'media':
      return <span className={css.skeletonMedia} />
    case 'control':
      return <span className={css.skeletonControl} />
    case 'rule':
      return <span className={css.skeletonRule} />
    case 'card':
    case 'generic':
    default:
      // A card's children are unknown from the prefix alone, so the placeholder
      // promises a heading + a couple of lines + one detail block, which is what
      // most cards turn out to be. Three equal pills read as a toolbar instead.
      return (
        <>
          <span className={css.skeletonRows}>
            <span style={{ width: '68%', height: 10 }} />
            <span style={{ width: '44%', height: 10 }} />
          </span>
          <span className={css.skeletonBlock} />
        </>
      )
  }
}
