/**
 * Pure text measurement for the social post previews (`x-post`,
 * `linkedin-post`). Kept free of React so the counting rules are unit-tested
 * on their own and shared by the renderer, the standalone HTML export (same
 * renderer) and the native projection. X counting and URL detection come from
 * the official `twitter-text` parser; LinkedIn's fold is an estimate.
 * @module @changfenhuang/dsh-genui/client/social-text
 */

/// <reference path="./twitter-text.d.ts" />
// ^ Types for the per-function entry points, reachable from every program that imports this module.
import extractUrlsWithIndices from 'twitter-text/dist/extractUrlsWithIndices.js'
import twitterTextConfigs from 'twitter-text/dist/configs.js'
import parseTweet from 'twitter-text/dist/parseTweet.js'

/** X's limit for a standard (non-Premium) post, in weighted characters (twitter-text v3). */
export const X_POST_LIMIT = twitterTextConfigs.defaults.maxWeightedTweetLength
/** Every URL counts as this many characters, whatever its real length (t.co wrapping). */
export const X_URL_WEIGHT = twitterTextConfigs.defaults.transformedURLLength
/** LinkedIn's hard limit for a post body. */
export const LINKEDIN_POST_LIMIT = 3000

/* ---------------- X: official twitter-text counting ---------------- */

/**
 * Text as X stores and counts it: NFC-normalised. `parseTweet` normalises
 * internally; the preview renders and links the same normalised string so the
 * highlighted URLs line up with the ones that were weighed.
 */
export function normalizeXText(text: string): string {
  return text.normalize('NFC')
}

/** One auto-linked URL inside a post, as UTF-16 offsets into the NFC text. */
export interface XUrlMatch { start: number; end: number; url: string }

/**
 * The URLs X auto-links (and wraps in t.co), found by twitter-text's own
 * extractor on the NFC text: scheme-less domains count too, trailing sentence
 * punctuation is excluded and balanced parentheses (`Foo_(bar)`) stay inside.
 */
export function findXUrls(text: string): XUrlMatch[] {
  return extractUrlsWithIndices(normalizeXText(text)).map(({ url, indices: [start, end] }) => ({ start, end, url }))
}

/**
 * How X displays a t.co-wrapped link in a post: scheme and `www.` dropped,
 * long links cut with an ellipsis. The full URL stays available as a tooltip.
 */
export function xDisplayUrl(url: string): string {
  const shown = url.replace(/^https?:\/\/(www\.)?/iu, '')
  return shown.length > 30 ? `${shown.slice(0, 29)}…` : shown
}

/** Counter state for one post, straight from twitter-text's `parseTweet`. */
export interface XCharStatus {
  /** Weighted length (URL = 23, emoji sequence = 2, CJK = 2, Latin = 1). */
  weightedLength: number
  limit: number
  remaining: number
  /** `parseTweet().valid`: non-empty, within the limit and free of characters X rejects. */
  valid: boolean
  /** `parseTweet().permillage`: how full the ring is, in thousandths of the limit (can exceed 1000). */
  permillage: number
  /** `ok`; `near` in the last 20 characters (X turns the ring amber); `over` past the limit (red, negative). */
  level: 'ok' | 'near' | 'over'
}

/**
 * X's counter for one post, computed by the official parser with the default
 * v3 config (emoji parsing on). A custom `limit` (Premium long posts) only
 * changes `maxWeightedTweetLength`; every weight stays X's.
 */
export function xCharStatus(text: string, limit: number = X_POST_LIMIT): XCharStatus {
  const options = limit === X_POST_LIMIT ? twitterTextConfigs.defaults : { ...twitterTextConfigs.defaults, maxWeightedTweetLength: limit }
  const { weightedLength, valid, permillage } = parseTweet(text, options)
  const remaining = limit - weightedLength
  return { weightedLength, limit, remaining, valid, permillage, level: remaining < 0 ? 'over' : remaining <= 20 ? 'near' : 'ok' }
}

/** X's weighted character count for one post (see {@link xCharStatus}). */
export function countXChars(text: string): number {
  return xCharStatus(text).weightedLength
}

/* ---------------- LinkedIn "…see more" fold ---------------- */

/**
 * An ESTIMATE of the feed fold: the feed clamps a post to about three
 * rendered lines and also to a character budget, whichever runs out first.
 * LinkedIn publishes neither number; these are the widely reproduced 2026
 * measurements (about 210 characters on desktop, 140 in the mobile app,
 * 3 lines on both, blank lines spend a whole line). Characters per line follow
 * from the budget. Every surface that shows the result labels it an estimate.
 */
export const LINKEDIN_FOLD = {
  desktop: { chars: 210, lines: 3, charsPerLine: 70 },
  mobile: { chars: 140, lines: 3, charsPerLine: 47 },
} as const

export type LinkedInDevice = keyof typeof LINKEDIN_FOLD

export interface LinkedInFold {
  /** Text shown above "…see more" (the whole text when nothing is hidden). */
  visible: string
  truncated: boolean
  /** Characters (code points) visible before the fold. */
  visibleChars: number
  totalChars: number
  /** Which budget cut the post, or null when it fits. */
  cutBy: 'chars' | 'lines' | null
}

/** Code point length, the unit LinkedIn's limits are quoted in. */
export function countLinkedInChars(text: string): number {
  let count = 0
  for (const _ of text) count += 1
  return count
}

/** Step back from a cut inside a word to the previous whitespace, keeping at least one word. */
function snapToWordBoundary(chars: string[], cut: number): number {
  if (cut >= chars.length || /\s/u.test(chars[cut] ?? '') || /\s/u.test(chars[cut - 1] ?? '')) return cut
  for (let i = cut - 1; i > 0; i--) if (/\s/u.test(chars[i]!)) return i
  return cut
}

/**
 * Where LinkedIn puts "…see more" for this text on this device. Each logical
 * line (split on `\n`) spends `ceil(length / charsPerLine)` rendered lines,
 * and an empty line spends one. A visible tail of blank lines is dropped
 * (LinkedIn shows a two-line preview when the third line is blank).
 */
export function linkedInFold(text: string, device: LinkedInDevice = 'desktop'): LinkedInFold {
  const budget = LINKEDIN_FOLD[device]
  const chars = Array.from(text.replace(/\r\n?/gu, '\n'))
  const totalChars = chars.length
  let linesLeft = budget.lines
  let index = 0
  let lineCut: number | undefined
  while (index < chars.length) {
    let end = chars.indexOf('\n', index)
    if (end === -1) end = chars.length
    const length = end - index
    const rendered = Math.max(1, Math.ceil(length / budget.charsPerLine))
    if (rendered > linesLeft) {
      lineCut = index + linesLeft * budget.charsPerLine
      break
    }
    linesLeft -= rendered
    index = end + 1
    if (linesLeft === 0) {
      if (index < chars.length) lineCut = end
      break
    }
  }
  const charCut = totalChars > budget.chars ? budget.chars : undefined
  const rawCut = Math.min(lineCut ?? Infinity, charCut ?? Infinity)
  const restIsBlank = (from: number) => chars.slice(from).every(char => /\s/u.test(char))
  if (rawCut === Infinity || restIsBlank(rawCut)) {
    return { visible: chars.join(''), truncated: false, visibleChars: totalChars, totalChars, cutBy: null }
  }
  const cutBy = lineCut !== undefined && lineCut < (charCut ?? Infinity) ? 'lines' : 'chars'
  const snapped = snapToWordBoundary(chars, rawCut)
  const visible = chars.slice(0, snapped).join('').replace(/\s+$/u, '')
  return { visible, truncated: true, visibleChars: countLinkedInChars(visible), totalChars, cutBy }
}
