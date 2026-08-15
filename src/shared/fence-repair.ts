/**
 * Shared fence-body JSON repair — pure string functions, no DOM, no I/O.
 * Used by BOTH the client fence renderer (tier-1/tier-2 auto-repair before
 * rendering) and the node-side validate_dsh_ui tool (which returns the
 * repaired JSON to the model instead of making it re-author the fix).
 *
 * Two tiers, deliberately gated differently by the callers:
 * - Tier-1 (`repairFenceJson`): heals the most common model JSON typos that
 *   do NOT change the body's structure — unescaped half-width quotes inside
 *   string values and trailing commas. Safe at any time (streaming included),
 *   adopted only when the WHOLE body parses afterwards.
 * - Tier-2 (`completeFenceJson`): heals structural incompleteness — missing
 *   closing quotes/brackets — by appending the missing terminators, and
 *   skips mismatched closers (a `]` mistyped as `}`, duplicated terminators).
 *   SETTLED MESSAGES ONLY: a streaming half must never be adopted as a
 *   finished prefix.
 * @module @omdsh-dev/dsh-genui/shared/fence-repair
 */

/** A fence body counts as complete when it parses as a whole JSON value. */
export function isCompleteJson(raw: string): boolean {
  try {
    JSON.parse(raw)
    return true
  } catch {
    return false
  }
}

/** Short human-readable reason for a body that fails whole-JSON parsing, or
 * null when it parses. Positions come from the host's JSON.parse error. */
export function describeJsonFailure(raw: string): string | null {
  try {
    JSON.parse(raw)
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const pos = msg.match(/position (\d+)/i)
    const where = pos !== null ? ` (near character ${pos[1]})` : ''
    return `${where}${msg.slice(0, 140)}`
  }
}

/**
 * Tier-1 repair — SAFE AT ANY TIME (streaming included): heals the most
 * common model JSON typos that do NOT change the body's structure, and only
 * when the whole body parses afterwards (so a still-growing streaming half
 * can never be adopted):
 *
 * 1. Unescaped half-width `"` inside a string value — Chinese text quoted
 *    with ASCII quotes (e.g. `对"别名路径"判定失败`), which makes JSON.parse
 *    fail near that quote with "Expected ',' or ']'...".
 * 2. Trailing commas before `}` / `]` or at end of input.
 *
 * The state-machine scan walks the raw body tracking string-open state:
 * - inside a string, a quote whose next non-space char is NOT one of `, ] } :`
 *   (or end of input) cannot legally close the string → escape it as `\"`;
 * - a `,` whose next non-space char is `}` / `]` / end of input is a trailing
 *   comma → drop it.
 *
 * Returns `{ text, repairs }` on success, or null when nothing needed fixing
 * or the body still does not parse (callers fall through to tier-2 / banner).
 */
export function repairFenceJson(raw: string): { text: string; repairs: number } | null {
  try {
    JSON.parse(raw)
    return null
  } catch {
    // fall through to the repair scan
  }
  let out = ''
  let inString = false
  let escaped = false
  let repairs = 0
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (inString && ch === '\\') {
      out += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      if (!inString) {
        inString = true
        out += ch
        continue
      }
      // Inside a string: is this quote the terminator? Look past whitespace.
      let j = i + 1
      while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\n' || raw[j] === '\r')) j++
      const next = j < raw.length ? raw[j] : ''
      if (next === ',' || next === ']' || next === '}' || next === ':' || next === '') {
        inString = false
        out += ch
      } else {
        // Free-standing quote inside a value → escape it.
        out += '\\"'
        repairs++
      }
      continue
    }
    if (ch === ',') {
      // Trailing comma before `}` / `]` / end of input → drop it.
      let j = i + 1
      while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\n' || raw[j] === '\r')) j++
      const next = j < raw.length ? raw[j] : ''
      if (next === '}' || next === ']' || next === '') {
        repairs++
        continue
      }
    }
    out += ch
  }
  if (repairs === 0) return null
  try {
    JSON.parse(out)
    return { text: out, repairs }
  } catch {
    return null
  }
}

/**
 * Tier-2 repair — SETTLED MESSAGES ONLY (never while streaming): heals
 * structural incompleteness — missing closing quotes/brackets — by appending
 * the missing terminators, and heals stray closers — a `]` mistyped as `}` or
 * a duplicated terminator — by skipping closers that do not match the open
 * stack (they cannot be legal JSON). Callers gate it on settled messages (the
 * client uses the host-provided fence source; the validate tool is by
 * definition pre-emission), so a streaming half can never flash premature UI.
 *
 * ONE unified scan: the tier-1 fixes (quote escaping + trailing-comma drops)
 * are folded into the same pass, so bodies that combine BOTH defect classes
 * (a trailing comma AND a missing closer) heal in one shot — the old
 * two-phase chain lost tier-1's partial work when its whole-body parse
 * failed, and re-scanning the raw text could not compose the repairs.
 * Adopted only when the completed body parses as whole JSON.
 */
export function completeFenceJson(raw: string): { text: string; repairs: number } | null {
  try {
    JSON.parse(raw)
    return null
  } catch {
    // fall through to the unified repair scan
  }
  let out = ''
  const stack: Array<'}' | ']'> = []
  let inString = false
  let escaped = false
  let repairs = 0
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') {
        out += ch
        escaped = true
        continue
      }
      if (ch !== '"') {
        out += ch
        continue
      }
      // Inside a string: is this quote the terminator? Look past whitespace.
      let j = i + 1
      while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\n' || raw[j] === '\r')) j++
      const next = j < raw.length ? raw[j] : ''
      if (next === ',' || next === ']' || next === '}' || next === ':' || next === '') {
        inString = false
        out += ch
      } else {
        // Free-standing quote inside a value → escape it (tier-1 fix).
        out += '\\"'
        repairs++
      }
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '{') {
      stack.push('}')
      out += ch
      continue
    }
    if (ch === '[') {
      stack.push(']')
      out += ch
      continue
    }
    if (ch === '}' || ch === ']') {
      if (stack[stack.length - 1] === ch) {
        stack.pop()
        out += ch
      } else {
        // Mismatched closer (e.g. a `]` mistyped as `}`, or a duplicated
        // terminator): no legal JSON can contain it here, so skip it and let
        // the remaining closers pair up again. The whole-body parse below is
        // the final arbiter — if skipping made things worse, nothing is
        // adopted and the diagnostic banner stays.
        repairs++
      }
      continue
    }
    if (ch === ',') {
      // Trailing comma before `}` / `]` / end of input → drop it (tier-1 fix).
      let j = i + 1
      while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\n' || raw[j] === '\r')) j++
      const next = j < raw.length ? raw[j] : ''
      if (next === '}' || next === ']' || next === '') {
        repairs++
        continue
      }
    }
    out += ch
  }
  if (inString) {
    // Unterminated string value → close it.
    out += '"'
    repairs++
  }
  while (stack.length > 0) {
    out += stack.pop()
    repairs++
  }
  if (repairs === 0) return null
  try {
    JSON.parse(out)
    return { text: out, repairs }
  } catch {
    return null
  }
}
