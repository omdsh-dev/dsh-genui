/**
 * Social post previews: an X post/thread and a LinkedIn feed post, drawn
 * close to the real platforms so a draft can be reviewed before publishing.
 * Post text is shown exactly as typed (line breaks and blank lines kept, no
 * Markdown); links, mentions and hashtags are coloured the way the platforms
 * colour them. Nothing is fetched except the image URLs the spec provides.
 * @module @changfenhuang/dsh-genui/client/blocks/social-post
 */
import { useId, useState, type ReactElement, type ReactNode } from 'react'
import { GENUI_LIMITS } from '../genui-runtime/index.ts'
import { safeMediaSrc } from '../genui-runtime/value-utils.ts'
import { useT } from '../i18n/index.ts'
import { genuiMediaSrc } from '../media-overrides.ts'
import type { GenuiLinkedInPost, GenuiSocialAuthor, GenuiXPost } from '../spec.ts'
import {
  LINKEDIN_FOLD, LINKEDIN_POST_LIMIT, X_POST_LIMIT, countLinkedInChars, findXUrls, linkedInFold, xCharStatus,
  type LinkedInDevice,
} from '../social-text.ts'
import { avatarColor } from './basic.tsx'
import css from './social-post.module.css'

/** Validated, host-routed image source, or undefined. */
function mediaSrc(value: string | undefined): string | undefined {
  const safe = safeMediaSrc(value)
  return safe === undefined ? undefined : genuiMediaSrc(safe)
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean)
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!].map(word => Array.from(word)[0] ?? '') : Array.from(words[0] ?? '?').slice(0, 1)
  return letters.join('').toUpperCase()
}

function Avatar({ author, size }: { author: GenuiSocialAuthor; size: number }): ReactElement {
  const src = mediaSrc(author.avatar)
  const [failed, setFailed] = useState<string | undefined>()
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) }
  if (src !== undefined && failed !== src) {
    return <img className={css.avatar} style={style} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
  }
  return <span className={css.avatar} aria-hidden="true" style={{ ...style, backgroundColor: avatarColor(author.name) }}>{initials(author.name)}</span>
}

/** Colour URLs, @mentions and #hashtags like the platforms; everything else is verbatim text. */
function PostText({ text, className }: { text: string; className: string | undefined }): ReactElement {
  const parts: ReactNode[] = []
  const urls = findXUrls(text)
  let cursor = 0
  const pushPlain = (chunk: string): void => {
    const pattern = /(^|[^\p{L}\p{N}_])([@#][\p{L}\p{N}_]+)/gu
    let last = 0
    for (const match of chunk.matchAll(pattern)) {
      const start = (match.index ?? 0) + match[1]!.length
      if (start > last) parts.push(chunk.slice(last, start))
      parts.push(<span className={css.entity} key={`${cursor}:${start}`}>{match[2]}</span>)
      last = start + match[2]!.length
    }
    if (last < chunk.length) parts.push(chunk.slice(last))
  }
  for (const url of urls) {
    pushPlain(text.slice(cursor, url.start))
    const shown = url.url.replace(/^https?:\/\/(www\.)?/iu, '')
    parts.push(<span className={css.entity} key={`u${url.start}`} title={url.url}>{shown.length > 30 ? `${shown.slice(0, 29)}…` : shown}</span>)
    cursor = url.end
  }
  pushPlain(text.slice(cursor))
  return <div className={className} dir="auto">{parts}</div>
}

function MediaGrid({ images, className }: { images: string[] | undefined; className?: string | undefined }): ReactElement | null {
  const t = useT()
  const sources = (images ?? []).slice(0, GENUI_LIMITS.maxSocialImages).flatMap(image => {
    const src = mediaSrc(image)
    return src === undefined ? [] : [src]
  })
  if (sources.length === 0) return null
  return (
    <div className={`${css.media} ${className ?? ''}`} data-count={sources.length} role="group" aria-label={t('social.images')}>
      {sources.map((src, index) => <img key={`${index}:${src}`} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />)}
    </div>
  )
}

function VerifiedBadge({ label }: { label: string }): ReactElement {
  return (
    <svg className={css.verified} viewBox="0 0 22 22" role="img" aria-label={label}>
      <path fill="currentColor" d="M20.4 11c0-1.3-.8-2.5-2-3 .4-1.2.1-2.6-.8-3.5-.9-.9-2.3-1.2-3.5-.8-.5-1.2-1.7-2-3.1-2s-2.5.8-3 2c-1.2-.4-2.6-.1-3.5.8-.9.9-1.2 2.3-.8 3.5-1.2.5-2 1.7-2 3s.8 2.5 2 3c-.4 1.2-.1 2.6.8 3.5.9.9 2.3 1.2 3.5.8.5 1.2 1.7 2 3 2s2.6-.8 3.1-2c1.2.4 2.6.1 3.5-.8.9-.9 1.2-2.3.8-3.5 1.2-.5 2-1.7 2-3z" />
      <path fill="#fff" d="m9.6 14.9-3.3-3.3 1.3-1.3 2 2 4.7-5.1 1.3 1.2z" />
    </svg>
  )
}

function handleOf(author: { handle?: string }): string | undefined {
  const handle = author.handle?.trim().replace(/^@+/u, '')
  return handle === undefined || handle === '' ? undefined : `@${handle}`
}

/** X's circular counter: fills toward the limit, amber in the last 20, red and negative past it. */
function CharCounter({ text, limit }: { text: string; limit: number }): ReactElement {
  const t = useT()
  const status = xCharStatus(text, limit)
  const radius = 9
  const circumference = 2 * Math.PI * radius
  const fraction = Math.min(1, status.count / limit)
  const label = status.level === 'over'
    ? t('social.charOver', { over: -status.remaining, limit })
    : t('social.charCount', { count: status.count, limit })
  return (
    <div className={css.counter} data-level={status.level} title={label} aria-label={label} role="status">
      <svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true">
        <circle cx="11" cy="11" r={radius} className={css.counterTrack} />
        <circle
          cx="11" cy="11" r={radius} className={css.counterFill}
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - fraction)}
          transform="rotate(-90 11 11)"
        />
      </svg>
      <span className={css.counterText}>{status.level === 'over' ? status.remaining : `${status.count}/${limit}`}</span>
    </div>
  )
}

/** One card per post, joined by X's thread line, each with its own counter. */
export function XPostNode({ node }: { node: GenuiXPost }): ReactElement {
  const t = useT()
  const handle = handleOf(node.author)
  const limit = node.limit ?? X_POST_LIMIT
  const posts = node.posts.slice(0, GENUI_LIMITS.maxXThreadPosts)
  const overCount = posts.filter(post => xCharStatus(post.text, limit).level === 'over').length
  const label = posts.length > 1 ? t('social.xThread', { count: posts.length }) : t('social.xPost')
  return (
    <article className={`${css.social} ${css.x}`} data-genui-x-post aria-label={label}>
      {posts.map((post, index) => {
        const quoteHandle = post.quote === undefined ? undefined : handleOf(post.quote)
        return (
          <div
            className={css.xPost}
            key={index}
            role="group"
            aria-label={posts.length > 1 ? t('social.postPosition', { current: index + 1, total: posts.length }) : undefined}
            data-thread={index < posts.length - 1 ? 'continues' : undefined}
          >
            <div className={css.xGutter}>
              <Avatar author={node.author} size={40} />
              {index < posts.length - 1 && <span className={css.threadLine} aria-hidden="true" />}
            </div>
            <div className={css.xBody}>
              <div className={css.xHeader}>
                <span className={css.xName}>{node.author.name}</span>
                {node.author.verified === true && <VerifiedBadge label={t('social.verified')} />}
                {handle !== undefined && <span className={css.xMeta}>{handle}</span>}
                {node.timestamp !== undefined && <span className={css.xMeta} aria-hidden={handle === undefined ? undefined : true}>·</span>}
                {node.timestamp !== undefined && <span className={css.xMeta}>{node.timestamp}</span>}
              </div>
              <PostText text={post.text} className={css.xText} />
              <MediaGrid images={post.images} className={css.xMedia} />
              {post.quote !== undefined && (
                <div className={css.xQuote} role="group" aria-label={t('social.quote')}>
                  {(post.quote.name !== undefined || quoteHandle !== undefined) && (
                    <div className={css.xHeader}>
                      {post.quote.name !== undefined && <span className={css.xName}>{post.quote.name}</span>}
                      {quoteHandle !== undefined && <span className={css.xMeta}>{quoteHandle}</span>}
                    </div>
                  )}
                  <PostText text={post.quote.text} className={css.xQuoteText} />
                </div>
              )}
              <div className={css.xFooter}><CharCounter text={post.text} limit={limit} /></div>
            </div>
          </div>
        )
      })}
      {posts.length > 1 && overCount > 0 && (
        <div className={css.summary} data-level="over">{t('social.threadTotal', { count: posts.length, over: overCount })}</div>
      )}
    </article>
  )
}

function GlobeIcon(): ReactElement {
  return (
    <svg className={css.globe} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm4.9 6h-2a11 11 0 0 0-.9-4 5 5 0 0 1 2.9 4zM8 13c-.6 0-1.6-1.7-1.9-5h3.8c-.3 3.3-1.3 5-1.9 5zM6.1 7C6.4 3.7 7.4 3 8 3s1.6.7 1.9 4H6.1zM6 3a11 11 0 0 0-.9 4h-2A5 5 0 0 1 6 3zM3.1 9h2a11 11 0 0 0 .9 4 5 5 0 0 1-2.9-4zM10 13a11 11 0 0 0 .9-4h2a5 5 0 0 1-2.9 4z" />
    </svg>
  )
}

/** LinkedIn feed card with the "…see more" fold, expandable locally, and a device switch. */
export function LinkedInPostNode({ node }: { node: GenuiLinkedInPost }): ReactElement {
  const t = useT()
  const id = useId()
  const [device, setDevice] = useState<LinkedInDevice>(node.device ?? 'desktop')
  const [expanded, setExpanded] = useState(false)
  const fold = linkedInFold(node.text, device)
  const total = countLinkedInChars(node.text)
  const deviceName = t(device === 'mobile' ? 'social.mobile' : 'social.desktop').toLowerCase()
  const note = fold.truncated
    ? t('social.foldCut', {
      visible: fold.visibleChars, total, device: deviceName, budget: LINKEDIN_FOLD[device].chars,
      reason: t(fold.cutBy === 'lines' ? 'social.foldByLines' : 'social.foldByChars'),
    })
    : t('social.foldFits', { device: deviceName, total })
  const textId = `${id}-text`
  return (
    <div className={css.linkedinWrap} data-device={device}>
      <article className={`${css.social} ${css.linkedin}`} data-genui-linkedin-post aria-label={t('social.linkedinPost')}>
        <header className={css.liHeader}>
          <Avatar author={node.author} size={48} />
          <div className={css.liAuthor}>
            <span className={css.liName}>{node.author.name}</span>
            {node.author.headline !== undefined && <span className={css.liHeadline}>{node.author.headline}</span>}
            <span className={css.liMeta}>{node.timestamp ?? '1h'} • <GlobeIcon /></span>
          </div>
        </header>
        <div className={css.liText} id={textId} dir="auto">
          {fold.truncated && !expanded
            ? <>
                <PostText text={fold.visible} className={css.liInline} />
                <button type="button" className={css.seeMore} aria-expanded={false} aria-controls={textId} onClick={() => setExpanded(true)}>{t('social.seeMore')}</button>
              </>
            : <>
                <PostText text={node.text} className={css.liInline} />
                {fold.truncated && <>{' '}<button type="button" className={css.seeMore} aria-expanded aria-controls={textId} onClick={() => setExpanded(false)}>{t('social.seeLess')}</button></>}
              </>}
        </div>
        <MediaGrid images={node.images} className={css.liMedia} />
        <div className={css.liActions} aria-hidden="true">
          <span>{t('social.like')}</span><span>{t('social.comment')}</span><span>{t('social.repost')}</span><span>{t('social.send')}</span>
        </div>
      </article>
      <div className={css.foldBar}>
        <span className={css.foldNote} data-truncated={fold.truncated ? 'true' : undefined}>{note}</span>
        <span className={css.deviceSwitch} role="group" aria-label={t('social.device')}>
          {(['desktop', 'mobile'] as const).map(option => (
            <button key={option} type="button" aria-pressed={device === option} onClick={() => { setDevice(option); setExpanded(false) }}>
              {t(option === 'mobile' ? 'social.mobile' : 'social.desktop')}
            </button>
          ))}
        </span>
        {total > LINKEDIN_POST_LIMIT && <span className={css.foldNote} data-level="over">{t('social.linkedinOver', { total, limit: LINKEDIN_POST_LIMIT })}</span>}
      </div>
    </div>
  )
}
