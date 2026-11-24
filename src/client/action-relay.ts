/**
 * action-relay.ts — bounded retry for the [genui-action] relay.
 *
 * A component click becomes a queued conversation message through
 * `conversation.send()`. That send rejects for reasons the renderer cannot
 * fix (session closed, agent busy, transport hiccup) and the click used to
 * disappear with only a console.warn — the reader saw a button that silently
 * did nothing. This module owns the retry budget and the final failure signal
 * so both the inline-fence and the panel paths behave identically.
 *
 * Deliberately dependency-free (no React, no host ctx): the caller injects
 * `send`, the abort predicate, and the failure sink, which keeps the policy
 * testable in isolation.
 * @module @changfenhuang/dsh-genui/client/action-relay
 */

export interface RelayActionOptions {
  /** Extra attempts after the first failure. Default 2 → three tries total. */
  maxRetries?: number
  /** Base delay before the first retry; doubled per attempt. Default 400 ms. */
  retryDelayMs?: number
  /** Called once, after the last attempt failed. */
  onFailure?: (action: string, error: unknown, attempts: number) => void
  /** Stop retrying as soon as this reports true (e.g. the session disposed). */
  shouldAbort?: () => boolean
}

const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 400

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/**
 * Send once, retrying with exponential backoff. Resolves true on success and
 * false after the budget is exhausted (never rejects: a click must not throw
 * into a render path).
 */
export async function relayAction(
  send: () => Promise<void>,
  action: string,
  options: RelayActionOptions = {},
): Promise<boolean> {
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES)
  const baseDelay = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)
  let lastError: unknown
  let attempts = 0

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      // Checked before each retry: a disposed session can never succeed, so
      // retrying would only burn the budget and delay the failure notice.
      if (options.shouldAbort?.() === true) break
      await wait(baseDelay * 2 ** (attempt - 1))
    }
    attempts += 1
    try {
      await send()
      return true
    } catch (error) {
      lastError = error
    }
  }

  options.onFailure?.(action, lastError, attempts)
  return false
}