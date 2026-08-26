/**
 * achievement-toast.tsx — 解锁 toast 栈（右下角，3.6s 自动消退）。
 *
 * 独立 React root（document.body 级）：面板/inline fence 任一解锁都会
 * 弹——不依赖面板存在。消费 achievement-store 的新解锁队列。
 */
import { createElement, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { consumeUnlocks, subscribeAchievements } from './achievement-store.ts'
import type { AchievementDef } from './achievements.ts'
import css from './GenuiBlock.module.css'

interface ToastItem {
  key: number
  ach: AchievementDef
}

let toastKey = 0

/** 底部固定栈：显示队列中的最后一个（FIFO 展开为纵向栈）。 */
function AchievementToasts() {
  const [, force] = useSyncExternalStore(subscribeAchievements, () => '')
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef<Map<number, number>>(new Map())

  useEffect(() => {
    const queue = consumeUnlocks()
    if (queue.length === 0) return
    const next: ToastItem[] = queue.map(ach => ({ key: ++toastKey, ach }))
    setItems(prev => [...prev, ...next])
    for (const item of next) {
      const t = window.setTimeout(() => {
        setItems(prev => prev.filter(i => i.key !== item.key))
        timers.current.delete(item.key)
      }, 3600)
      timers.current.set(item.key, t)
    }
  }, [force])

  useEffect(() => () => {
    for (const t of timers.current.values()) window.clearTimeout(t)
  }, [])

  if (items.length === 0) return null
  return createElement('div', { className: css.achToasts, 'data-genui-achievement-toasts': true },
    items.map(item => createElement('div', { key: item.key, className: css.achToast },
      createElement('span', { className: css.achToastBadge, 'aria-hidden': true }, '🏆'),
      createElement('div', { className: css.achToastBody },
        createElement('div', { className: css.achToastName }, `成就解锁：${item.ach.name}`),
        createElement('div', { className: css.achToastDesc }, item.ach.description),
      ),
    )),
  )
}

/** 挂载 toast 栈（apply 调用；返回卸载函数）。 */
export function mountAchievementToasts(): () => void {
  if (typeof document === 'undefined') return () => {}
  const host = document.createElement('div')
  host.dataset.dshGenuiAchievements = '1'
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(createElement(AchievementToasts))
  return () => {
    root.unmount()
    host.remove()
  }
}
