/**
 * Basic display family: avatar palette, and the local click-feedback button
 * (the actionable-button chip). Used by the render dispatcher.
 * @module @omdsh-dev/dsh-genui/client/blocks/basic
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import css from '../GenuiBlock.module.css'

/** Deterministic avatar color by name hash. Host static tokens ONLY —
 * design system v2: no off-brand hexes, the palette always matches the
 * theme's families (deepseek/blue/green/amber/red/neutral). */
const AVATAR_COLORS = [
  'var(--dsw-static-deepseek-400)',
  'var(--dsw-static-deepseek-450)',
  'var(--dsw-static-blue-450)',
  'var(--dsw-static-green-400)',
  'var(--dsw-static-amber-400)',
  'var(--dsw-static-red-400)',
  'var(--dsw-static-deepseek-300)',
  'var(--dsw-static-neutral-bluish-400)',
]

export function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  // The array is a literal with 8 entries; the index is always in range.
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!
}

/** Button with LOCAL click feedback: clicking an actionable button shows a
 * brief "✓ 已触发" chip so the user sees the click registered even while the
 * model round trip is in flight — no more "点了没反应" perception. The chip
 * is purely cosmetic; the action fires through `onClick` as before. */
export function ClickFeedbackButton({ className, disabled, onClick, children }: {
  className: string
  disabled?: boolean
  onClick?: (() => void) | undefined
  children: ReactNode
}) {
  const [sent, setSent] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={onClick === undefined ? undefined : () => {
        onClick()
        if (timer.current !== null) clearTimeout(timer.current)
        setSent(true)
        timer.current = setTimeout(() => setSent(false), 1400)
      }}
    >
      {children}
      {sent && <span className={css.btnSent}>✓ Triggered</span>}
    </button>
  )
}
