/**
 * Types for the per-function entry points of the official `twitter-text`
 * package. `@types/twitter-text` only describes the package root, which pulls
 * in every autolink/extract helper; the social previews import just the two
 * functions they need plus the shipped config table.
 */
declare module 'twitter-text/dist/parseTweet.js' {
  import type { parseTweet } from 'twitter-text'
  const parse: typeof parseTweet
  export default parse
}

declare module 'twitter-text/dist/extractUrlsWithIndices.js' {
  import type { extractUrlsWithIndices } from 'twitter-text'
  const extract: typeof extractUrlsWithIndices
  export default extract
}

declare module 'twitter-text/dist/configs.js' {
  import type { ParseTweetOptions } from 'twitter-text'
  /** One shipped weighting config (every field present). */
  interface TwitterTextConfig extends ParseTweetOptions {
    version: number
    maxWeightedTweetLength: number
    scale: number
    defaultWeight: number
    transformedURLLength: number
    ranges: Array<{ start: number; end: number; weight: number }>
  }
  /** The weighting configs shipped with twitter-text; `defaults` is v3 (280, emoji parsing on). */
  const configs: { defaults: TwitterTextConfig & { emojiParsingEnabled: true } } & Record<string, TwitterTextConfig>
  export default configs
}
