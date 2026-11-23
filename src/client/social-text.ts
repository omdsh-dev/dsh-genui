/**
 * Pure text measurement for the social post previews (`x-post`,
 * `linkedin-post`). Kept free of React so the counting rules are unit-tested
 * on their own and shared by the renderer and the native projection.
 * @module @changfenhuang/dsh-genui/client/social-text
 */

/** X's limit for a standard (non-Premium) post, in weighted characters. */
export const X_POST_LIMIT = 280
/** Every URL counts as this many characters, whatever its real length (t.co wrapping). */
export const X_URL_WEIGHT = 23
/** LinkedIn's hard limit for a post body. */
export const LINKEDIN_POST_LIMIT = 3000

/**
 * Code point ranges that weigh 1 in twitter-text v3 (`config/v3.json`):
 * Latin, Greek, Cyrillic, Hebrew, Arabic, Indic and the general punctuation
 * that sits next to them. Everything else (CJK, most symbols) weighs 2.
 */
const LIGHT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
]

/**
 * URLs as X auto-links them: an explicit http(s) scheme, or a bare host that
 * ends in a common TLD (`example.com/path`). Trailing sentence punctuation is
 * not part of the link. The TLD list is deliberately short: a false negative
 * only means a bare domain is counted by its letters.
 */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"]+|(?<![@\w.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|io|ai|co|dev|app|xyz|me|gg|so|ly|sh|tv|fm|to|info|biz|edu|gov|uk|de|fr|nl|jp|cn|th|sg|au|ca|us|eu|tech|news|blog|link|site|page|cloud)\b(?:\/[^\s<>"]*)?/giu
const TRAILING_PUNCTUATION = /[.,:;!?'")\]}…]+$/u

const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

function codePointWeight(codePoint: number): 1 | 2 {
  for (const [lo, hi] of LIGHT_RANGES) if (codePoint >= lo && codePoint <= hi) return 1
  return 2
}

let segmenter: Intl.Segmenter | undefined
function graphemes(text: string): Iterable<string> {
  if (typeof Intl === 'object' && typeof Intl.Segmenter === 'function') {
    segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(segmenter.segment(text), part => part.segment)
  }
  return Array.from(text)
}

/** Weighted length of plain text (no URL handling). */
function weighPlain(text: string): number {
  let total = 0
  for (const cluster of graphemes(text)) {
    // A whole emoji sequence (ZWJ family, skin tone, flag, keycap) counts as 2.
    if (PICTOGRAPHIC.test(cluster)) { total += 2; continue }
    for (const char of cluster) total += codePointWeight(char.codePointAt(0) ?? 0)
  }
  return total
}

/** One auto-linked URL inside a post, as UTF-16 offsets into the NFC text. */
export interface XUrlMatch { start: number; end: number; url: string }

/** Find the URLs X would shorten, with trailing punctuation removed. */
export function findXUrls(text: string): XUrlMatch[] {
  const found: XUrlMatch[] = []
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, '')
    if (url === '') continue
    const start = match.index ?? 0
    found.push({ start, end: start + url.length, url })
  }
  return found
}

/**
 * X's weighted character count (twitter-text v3 rules): NFC-normalised text,
 * every URL = 23, emoji sequences = 2, CJK and other heavy scripts = 2 per
 * character, Latin and friends = 1. Line breaks count as one character each.
 */
export function countXChars(text: string): number {
  const normalized = text.normalize('NFC')
  let total = 0
  let cursor = 0
  for (const { start, end } of findXUrls(normalized)) {
    total += weighPlain(normalized.slice(cursor, start)) + X_URL_WEIGHT
    cursor = end
  }
  return total + weighPlain(normalized.slice(cursor))
}

/** Counter state for one post: remaining characters and the warning tier X shows. */
export interface XCharStatus {
  count: number
  limit: number
  remaining: number
  /** `ok`; `near` in the last 20 characters (X turns the ring amber); `over` past the limit. */
  level: 'ok' | 'near' | 'over'
}

export function xCharStatus(text: string, limit = X_POST_LIMIT): XCharStatus {
  const count = countXChars(text)
  const remaining = limit - count
  return { count, limit, remaining, level: remaining < 0 ? 'over' : remaining <= 20 ? 'near' : 'ok' }
}

/* ---------------- LinkedIn "…see more" fold ---------------- */

/**
 * The feed clamps a post to about three rendered lines and also to a
 * character budget, whichever runs out first. LinkedIn publishes neither
 * number; these are the widely reproduced 2026 measurements (about 210
 * characters on desktop, 140 in the mobile app, 3 lines on both, blank lines
 * spend a whole line). Characters per line follow from the budget.
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
