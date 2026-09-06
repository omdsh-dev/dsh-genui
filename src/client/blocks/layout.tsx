/**
 * Structural GenUI layout family. Recursive children are injected by the
 * render dispatcher so layout components do not depend on render-node.
 * @module @changfenhuang/dsh-genui/client/blocks/layout
 */
import type { ReactNode } from 'react'
import css from '../GenuiBlock.module.css'
import { GENUI_LIMITS } from '../genui-runtime/index.ts'
import type { GenuiCard, GenuiCol, GenuiGrid, GenuiList, GenuiNode, GenuiRow } from '../spec.ts'

type RenderChild = (node: GenuiNode, key: number) => ReactNode

function isListItemNode(item: GenuiList['items'][number]): item is GenuiNode {
  return typeof item === 'object' && item !== null && 'type' in item
}

export function RowNode({ node, renderChild }: { node: GenuiRow; renderChild: RenderChild }): ReactNode {
  return (
    <div className={css.row + (node.wrap ? ` ${css.wrap}` : '')}>
      {node.items.map((child, i) => renderChild(child, i))}
      {node.spacer && <div className={css.spacer} />}
    </div>
  )
}

export function ColNode({ node, renderChild }: { node: GenuiCol; renderChild: RenderChild }): ReactNode {
  return (
    <div className={css.col} style={node.gap !== undefined ? { gap: `${node.gap}px` } : undefined}>
      {node.items.map((child, i) => renderChild(child, i))}
    </div>
  )
}

export function GridNode({ node, renderChild }: { node: GenuiGrid; renderChild: RenderChild }): ReactNode {
  return (
    <div className={css.grid} style={{ gridTemplateColumns: `repeat(${Math.max(1, node.cols)}, minmax(0, 1fr))` }}>
      {node.items.map((child, i) => renderChild(child, i))}
    </div>
  )
}

export function CardNode({ node, renderChild }: { node: GenuiCard; renderChild: RenderChild }): ReactNode {
  return (
    <div className={css.card}>
      {node.title !== undefined && <div className={css.cardTitle}>{node.title}</div>}
      {node.items.map((child, i) => renderChild(child, i))}
    </div>
  )
}

export function DividerNode(): ReactNode {
  return <hr className={css.divider} />
}

export function SpacerNode(): ReactNode {
  return <div className={css.spacer} />
}

export function ListNode({ node, renderChild }: { node: GenuiList; renderChild: RenderChild }): ReactNode {
  const items = node.items.slice(0, GENUI_LIMITS.maxListItems)
  return (
    <div className={css.list}>
      {items.map((item, i) => (
        <div key={i} className={css.li}>
{isListItemNode(item)
  ? renderChild(item, i)
  : <><span className={css.liTitle}>{typeof item === 'string' ? item : item.title}</span>{typeof item !== 'string' && item.desc !== undefined && <span className={css.liDesc}>{item.desc}</span>}</>}
        </div>
      ))}
    </div>
  )
}
