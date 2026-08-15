/**
 * Partial GenUI spec parsing: extract the components that are already
 * complete from a still-growing ```dsh-ui fence body, so the UI can render
 * top-down as the model writes — each finished component appears the moment
 * its JSON object closes, instead of the whole block waiting for the fence.
 *
 * Strategy (tolerant, white-list-agnostic, BOUNDED):
 * 1. Full parse first (the common settled case) — at most one.
 * 2. ONE left-to-right scan collects the repair candidates: every position
 *    where the prefix is bracket-balanced (trailing comma / fence tail) and
 *    every `}` object close within the depth budget (an unfinished trailing
 *    element, closed by appending the remaining brackets). The ring buffer
 *    keeps only the longest-direction candidates (≤ MAX_PARTIAL_REPAIR_ATTEMPTS),
 *    so the work is O(n) with a hard parse-attempt cap — a pathological
 *    input can never re-scan prefixes or burn seconds in JSON.parse.
 * 3. Candidates are tried longest first; the first that parses as a GenUI
 *    spec wins. Nothing parses → null (streaming partial, wait for more).
 *
 * The result is only ever a PREFIX of the intended spec, so it is always
 * safe to render: components already present are complete and valid.
 *
 * `ponytail:` the 32-candidate / 33-parse budget is the protection ceiling
 * for depth 8 / 200 nodes; only real streaming samples proving a recovery
 * shortfall justify switching to a tokenizing parser.
 */
import { GENUI_LIMITS } from './guard.ts'
import { isGenuiSpec, type GenuiSpec } from './spec.ts'
import { wrapSingleComponentRoot } from './spec.ts'

/** Default repair-candidate budget (adjustable; see the design doc). */
export const MAX_PARTIAL_REPAIR_ATTEMPTS = 32

let repairAttemptsLimit = MAX_PARTIAL_REPAIR_ATTEMPTS

/** Override the repair-candidate budget (tests / tuning). */
export function setMaxPartialRepairAttempts(n: number): void {
  repairAttemptsLimit = n
}

/** One repair candidate: a balanced prefix of the body ending at `end`,
 *  plus the closing brackets to append (empty when already balanced). */
export interface PartialCandidate {
  end: number
  closingSuffix: string
}

/** Single left-to-right pass over the raw body. Tracks the bracket stack
 *  (skipping strings/escapes correctly) and records:
 *  - every position where the prefix is fully balanced (trailing comma or
 *    fence tail) — candidate with an empty closing suffix;
 *  - every `}` object close whose remaining depth fits the spec budget —
 *    candidate with the remaining brackets closed (an unfinished trailing
 *    element).
 *  Candidates are ring-buffered to the attempts budget (the LAST pushes are
 *  the longest), then returned longest-first, deduplicated by end. The scan
 *  stops at the first unbalanced close — earlier balanced prefixes remain
 *  valid candidates.
 *
 * Exposed for tests (the `scannedChars` diagnostic); not exported from the
 * package entry. The parser calls this exactly once per parse.
 */
export function collectPartialCandidates(raw: string): { candidates: PartialCandidate[]; scannedChars: number } {
  const stack: string[] = []
  const candidates: PartialCandidate[] = []
  const push = (c: PartialCandidate): void => {
    if (candidates.length >= repairAttemptsLimit) candidates.shift()
    candidates.push(c)
  }
  let inString = false
  let escaped = false
  let scanned = 0
  for (; scanned < raw.length; scanned++) {
    const ch = raw[scanned]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch)
      continue
    }
    if (ch === '}' || ch === ']') {
      const open = stack.pop()
      const expects = ch === '}' ? '{' : '['
      if (open !== expects) {
        // Unbalanced (mismatched or stray close): the tail is unusable, but
        // balanced prefixes recorded earlier stay valid. Stop scanning.
        break
      }
      if (ch === '}' && stack.length <= GENUI_LIMITS.maxDepth) {
        // A finished object element: closing the remaining brackets yields
        // the longest legal prefix (an unfinished trailing element drops).
        push({ end: scanned + 1, closingSuffix: closeSuffix(stack) })
      }
      if (stack.length === 0) {
        // Whole prefix balanced: a complete-JSON candidate (trailing comma /
        // fence tail cases).
        push({ end: scanned + 1, closingSuffix: '' })
      }
      continue
    }
  }
  candidates.sort((a, b) => b.end - a.end)
  const deduped: PartialCandidate[] = []
  for (const c of candidates) {
    if (deduped.length === 0 || deduped[deduped.length - 1]!.end !== c.end) deduped.push(c)
  }
  return { candidates: deduped.slice(0, repairAttemptsLimit), scannedChars: scanned }
}

/** Closing brackets for the remaining open stack (top first). */
function closeSuffix(stack: string[]): string {
  let suffix = ''
  for (let i = stack.length - 1; i >= 0; i--) suffix += stack[i] === '{' ? '}' : ']'
  return suffix
}

/** Try to parse a candidate as a GenuiSpec. */
function trySpec(candidate: string): GenuiSpec | null {
  try {
    const value: unknown = JSON.parse(candidate)
    if (isGenuiSpec(value)) return value
    // Single-component roots are part of the documented fence vocabulary
    // (e.g. a bare {"type":"callout",…} body) — wrap into a col so the
    // items-gated pipeline renders them (panel/append hoisted).
    return wrapSingleComponentRoot(value)
  } catch {
    return null
  }
}

/**
 * Parse a possibly incomplete genui spec body.
 * @param raw - the fence body as accumulated so far.
 * @returns a spec containing only finished components, or null when nothing
 *   usable has been written yet.
 */
export function parsePartialGenuiSpec(raw: string): GenuiSpec | null {
  const text = raw.trim()
  if (text === '') return null

  // 1. Full parse (settled / already-complete body).
  const full = trySpec(text)
  if (full !== null) return full

  // 2. Bounded repair: ONE forward scan, at most `repairAttemptsLimit`
  //    candidates, longest first — never a re-scan per `}`.
  const { candidates } = collectPartialCandidates(text)
  for (const candidate of candidates) {
    const spec = trySpec(text.slice(0, candidate.end) + candidate.closingSuffix)
    if (spec !== null) return spec
  }

  // 3. Not even one complete element yet (e.g. `{"items":[{"type":"tex`).
  return null
}
