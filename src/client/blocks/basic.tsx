/**
 * Basic display family: simple leaf renderers, media, avatar palette,
 * and the local click-feedback button. Used by the render dispatcher.
 * @module @changfenhuang/dsh-genui/client/blocks/basic
 */
import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import css from '../GenuiBlock.module.css'
import type {
  GenuiAudio, GenuiAvatar, GenuiBadge, GenuiButton, GenuiLink,
  GenuiProgress, GenuiStat, GenuiText, GenuiVideo,
} from '../spec.ts'
import type { GenuiBlockProps } from './state.ts'

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
    <>
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
        {sent && <span className={css.btnSent} aria-hidden>✓ 已触发</span>}
      </button>
      {/* Live-region sibling: button content is atomic to screen readers, so
       * the "已触发" confirmation announces from a hidden status region. */}
      <span className={css.visuallyHidden} role="status">{sent ? '已触发' : ''}</span>
    </>
  )
}

export function TextNode({ node }: { node: GenuiText }): ReactNode {
  const size = node.size ?? 'body'
  return (
    <div className={`${css.text} ${css[size]}` + (node.center ? ` ${css.center}` : '')}>
      {node.content}
    </div>
  )
}

export function ButtonNode({ node, onAction }: {
  node: GenuiButton
  onAction?: GenuiBlockProps['onAction']
}): ReactNode {
  const tone = node.tone ?? ''
  const cls = `${css.button} ${css[tone] || ''}` + (node.full ? ` ${css.full}` : '') + (node.small ? ` ${css.small}` : '')
  const action = node.action
  // A button without an action (or without an action provider) is a
  // display-only control: render it DISABLED so the affordance is honest
  // — clickable-looking dead buttons were the top complaint in the field.
  const interactive = action !== undefined && onAction !== undefined
  return (
    <ClickFeedbackButton
      className={cls}
      disabled={!interactive}
      onClick={interactive ? () => onAction(action, { type: 'button', label: node.label }) : undefined}
    >
      {node.icon !== undefined && <span aria-hidden>{node.icon} </span>}
      {node.label}
    </ClickFeedbackButton>
  )
}

export function LinkNode({ node }: { node: GenuiLink }): ReactNode {
  // Honest affordance: with a whitelisted href this is a REAL anchor;
  // without one it is plain styled text (a dead clickable-looking button
  // was the same complaint class as the disabled-button fix).
  const href = node.href
  return href !== undefined
    ? <a className={css.link} href={href} target="_blank" rel="noopener noreferrer">{node.label}</a>
    : <span className={css.linkText}>{node.label}</span>
}

export function BadgeNode({ node }: { node: GenuiBadge }): ReactNode {
  const tone = node.tone ?? ''
  return (
    <span className={`${css.badge} ${css[tone] || ''}`}>
      {node.icon !== undefined && <span aria-hidden>{node.icon} </span>}
      {node.label}
    </span>
  )
}

export function StatNode({ node }: { node: GenuiStat }): ReactNode {
  const down = node.delta !== undefined && node.delta.startsWith('-')
  return (
    <div className={css.stat}>
      <span className={css.statLabel}>{node.label}</span>
      <span className={css.statValue}>{node.value}</span>
      {node.delta !== undefined && <span className={`${css.statDelta} ${down ? css.down : css.up}`}>{node.delta}</span>}
    </div>
  )
}

export function ProgressNode({ node }: { node: GenuiProgress }): ReactNode {
  const v = Math.max(0, Math.min(100, Number(node.value) || 0))
  return (
    <div
      className={css.progress}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-label={node.label ?? node.valueLabel ?? undefined}
    >
      {(node.label !== undefined || node.valueLabel !== undefined) && (
        <div className={css.progressRow}>
<span>{node.label}</span>
{node.valueLabel !== undefined && <span>{node.valueLabel}</span>}
        </div>
      )}
      <div className={css.track}><div className={css.fill} style={{ width: `${v}%` }} /></div>
    </div>
  )
}

export function AvatarNode({ node }: { node: GenuiAvatar }): ReactNode {
  return (
    <div className={css.avatar} style={{ background: node.color ?? avatarColor(node.name) }}>
      {node.name.slice(0, 1).toUpperCase()}
    </div>
  )
}

/** Native controls intentionally own play/pause/seek/volume. Model-authored
 * autoplay and controls hints are ignored: media starts only after the user
 * asks for it. */
export const AudioNode = memo(function AudioNode({ node }: { node: GenuiAudio }): ReactNode {
  const [failed, setFailed] = useState(false)
  return (
    <figure className={css.media}>
      {node.alt !== undefined && <figcaption className={css.mediaLabel}>{node.alt}</figcaption>}
      {failed
        ? <div className={css.mediaError} role="alert">音频无法播放</div>
        : <audio
  className={css.mediaPlayer}
  src={node.src}
  aria-label={node.alt ?? '音频'}
  controls
  preload="metadata"
  loop={node.loop === true}
  onError={() => setFailed(true)}
/>}
    </figure>
  )
})

export const VideoNode = memo(function VideoNode({ node }: { node: GenuiVideo }): ReactNode {
  const [failed, setFailed] = useState(false)
  return (
    <figure className={css.media}>
      {node.alt !== undefined && <figcaption className={css.mediaLabel}>{node.alt}</figcaption>}
      {failed
        ? <div className={css.mediaError} role="alert">视频无法播放</div>
        : <video
  className={`${css.mediaPlayer} ${css.videoPlayer}`}
  src={node.src}
  poster={node.poster}
  aria-label={node.alt ?? '视频'}
  controls
  preload="metadata"
  playsInline
  loop={node.loop === true}
  muted={node.muted === true}
  style={node.aspectRatio === undefined ? undefined : { aspectRatio: node.aspectRatio.replace(':', ' / ') }}
  onError={() => setFailed(true)}
/>}
    </figure>
  )
})
