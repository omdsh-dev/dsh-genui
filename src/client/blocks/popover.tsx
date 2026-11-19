import { useCallback, useLayoutEffect, useState, type ReactElement } from 'react'
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  size,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react'
import type { GenuiPopover } from '../spec.ts'
import { renderInline } from '../inline.ts'
import { useT } from '../i18n/index.ts'
import css from './popover.module.css'

/** 显示支持点击、悬停、键盘操作和关闭行为的浮层说明。 */
export function PopoverNode({ node }: { node: GenuiPopover }): ReactElement {
  const t = useT()
  const [open, setOpen] = useState(false)
  const trigger = node.trigger ?? 'click'
  const { refs, context, floatingStyles } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: node.placement ?? 'top',
    middleware: [
      offset(8),
      flip({ padding: 12 }),
      size({
        padding: 12,
        /** 限制长内容高度，使弹层在可用视口范围内滚动。 */
        apply({ availableHeight, availableWidth, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.min(420, Math.max(0, availableHeight))}px`,
            maxWidth: `${Math.min(360, Math.max(0, availableWidth))}px`,
          })
        },
      }),
      shift({ padding: 12 }),
    ],
    whileElementsMounted: autoUpdate,
  })
  // Portal 根节点无法自动继承 .block 中定义的自定义变量。
  // 浮层通过 ref 回调同步初始主题，并监听祖先属性变化以支持实时切换。
  const syncTheme = useCallback((floating: HTMLElement): void => {
    const reference = refs.domReference.current
    if (reference === null) return
    const source = getComputedStyle(reference)
    for (const name of ['--dsl-g-surface', '--dsl-g-border', '--dsl-g-accent', '--dsl-g-hover', '--dsl-g-link']) {
      const value = source.getPropertyValue(name).trim()
      if (value !== '') floating.style.setProperty(name, value)
      else floating.style.removeProperty(name)
    }
  }, [refs.domReference])
  const setFloating = useCallback((element: HTMLElement | null): void => {
    refs.setFloating(element)
    if (element !== null) syncTheme(element)
  }, [refs.setFloating, syncTheme])
  useLayoutEffect(() => {
    if (!open) return
    const reference = refs.domReference.current
    if (reference === null) return
    const refresh = (): void => {
      const floating = refs.floating.current
      if (floating !== null) syncTheme(floating)
    }
    refresh()
    const observer = new MutationObserver(refresh)
    for (let element: Element | null = reference; element !== null; element = element.parentElement) {
      observer.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-ds-dark-theme'] })
    }
    return () => observer.disconnect()
  }, [open, refs, syncTheme])

  const click = useClick(context, { enabled: trigger === 'click' })
  const hover = useHover(context, { enabled: trigger === 'hover', handleClose: safePolygon() })
  const focus = useFocus(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'dialog' })
  const { getReferenceProps, getFloatingProps } = useInteractions([click, hover, focus, dismiss, role])

  return (
    <span className={css.root} data-genui-popover>
      <button ref={refs.setReference} className={css.trigger} type="button" {...getReferenceProps({ 'aria-label': node.label })}>
        {renderInline(node.label, false)}
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={trigger === 'hover' ? -1 : 0} returnFocus>
            <div ref={setFloating} className={css.panel} style={floatingStyles} {...getFloatingProps({ 'aria-label': node.label })}>
              <div className={css.content}>{renderInline(node.content)}</div>
              <button className={css.close} type="button" aria-label={t('block.popoverClose')} onClick={() => setOpen(false)}>×</button>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </span>
  )
}
