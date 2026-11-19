/**
 * Pure mermaid source utilities — no mermaid import, so this module can ship
 * in the main client bundle while the heavy mermaid engine lives in a lazy
 * asset bundle (`lib/assets/mermaid.js`, loaded on demand by mermaid-lazy).
 * @module @changfenhuang/dsh-genui/client/mermaid-safe
 */

/** Reject any rendered SVG that carries script, event-handler attributes, or
 * `javascript:` URIs. Under mermaid's strict security level a legitimate
 * diagram never contains these, so a hit means the sanitizer failed (a
 * mermaid regression or a bypass): throw and let the caller show the plain
 * source fallback instead of injecting the markup. Cheap linear scan over
 * the SVG string; happens once per diagram.
 */
const SVG_INJECTION = /<script|[\s"']on[a-z]+\s*=|javascript:/i

/** Throws when `svg` carries script, event-handler attributes, or
 * `javascript:` URIs. Exported for tests; `renderMermaid` is the only caller
 * in production. */
export function assertSafeSvg(svg: string): void {
  if (SVG_INJECTION.test(svg)) {
    throw new Error('mermaid output failed the sanitization check; refusing to render')
  }
}

/**
 * Best-effort repair of common model-authored label mistakes in graph /
 * flowchart sources, used only when the original fails to render:
 * - drop backticks — lexically illegal in mermaid labels (models embed
 *   ```dsh-ui style fences, which break the parser with "Lexical error");
 * - strip `<br/>` tags, which require htmlLabels (never enabled here);
 * - quote unquoted node labels containing CJK, spaces, or other characters
 *   mermaid's bare-label grammar rejects (observed live: `A[模型生成 spec]`).
 * Conservative by design: already-quoted labels, plain ASCII labels without
 * spaces, and non-flowchart kinds are left untouched (apart from the
 * backtick/`<br/>` sanitation above, which is harmless everywhere in a
 * flowchart).
 *
 * Labeled-edge spans (`-- 文本 -->`, `== 文本 ==>`, `-. 文本 .->`) are free
 * text and must never be quoted: wrapping them breaks the parser
 * ("Expecting 'LINK' … got 'STR'"), observed live with
 * `H -- 否(流式中) --> J`. Each span is swapped for a bracket-free
 * placeholder before quoting and restored verbatim afterwards, so the quote
 * pass can neither corrupt it nor be thrown off by inserted quotes
 * elsewhere on the line.
 *
 * Pipe-style edge labels (`-->|文本|`) are the opposite: an UNQUOTED pipe
 * label containing `@`, `[` or `]` breaks the parser ("Parse error", observed
 * live with `-->|6. 用户交互 → [genui-action]|`) because the brackets are
 * node grammar. Quoting the label text is display-neutral (mermaid renders
 * `-->|"文本"|` without the quotes) and parses. These spans are masked too,
 * so the node-label quote pass below cannot reach inside them and produce
 * nested quotes, and restored last.
 */
export function repairMermaidSource(code: string): string {
  const kind = /^([A-Za-z]+)/.exec(code.trim())?.[1] ?? ''
  if (kind !== 'graph' && kind !== 'flowchart') return code
  const cleaned = code.replace(/`/g, '').replace(/<br\s*\/?>/gi, ' ')
  // A labeled edge is `--`/`==`/`-.` (not immediately `-->`/`==>`), a label
  // made of non-dash chars or single dashes (never `--`, which would start a
  // new edge), then the arrow. `[ \t]*` — never newlines — keeps the span on
  // one line.
  const EDGE = /(--|==|-\.)(?!>)[ \t]*([^-\n]|-(?!--))*?[ \t]*(-->|==>|\.->)/g
  const spans: string[] = []
  const masked = cleaned.replace(EDGE, (span) => {
    // Extra-length arrows are operator-only links, not free-text labels.
    if (/^[-=.<>]+$/.test(span)) return span
    spans.push(span)
    return `\uE000${spans.length - 1}\uE001`
  })
  // Only a link outside node shapes, quoted text and comments can introduce
  // a pipe edge label. Mask every such label before the node-quoting pass,
  // including already-quoted labels and labels containing parentheses.
  const PIPE_LINK = /(?:<|[ox])?(?:-{2,}[>ox]?|={2,}[>ox]?|-\.+-[>ox]?)[ \t]*\|/y
  const pipeSpans: string[] = []
  const closers: string[] = []
  let inQuote = false
  let copied = 0
  let maskedPipes = ''
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i]!
    if (inQuote) {
      if (ch === '\\') i++
      else if (ch === '"') inQuote = false
      continue
    }
    if (ch === '"') { inQuote = true; continue }
    if (ch === '%' && masked[i + 1] === '%') {
      const end = masked.indexOf('\n', i)
      if (end === -1) break
      i = end
      continue
    }
    if ('[({'.includes(ch)) { closers.push(ch === '[' ? ']' : ch === '(' ? ')' : '}'); continue }
    if (ch === closers[closers.length - 1]) { closers.pop(); continue }
    if (closers.length > 0 || !'<ox-='.includes(ch)) continue
    // Do not retry suffixes of a long operator run when no pipe follows it.
    if (i > 0 && '-=.'.includes(masked[i - 1]!)) continue
    PIPE_LINK.lastIndex = i
    const link = PIPE_LINK.exec(masked)
    if (link === null) continue
    const start = PIPE_LINK.lastIndex
    let end = start
    let labelQuote = false
    for (; end < masked.length && masked[end] !== '\n'; end++) {
      if (masked[end] === '\\' && labelQuote) { end++; continue }
      if (masked[end] === '"') labelQuote = !labelQuote
      if (masked[end] === '|' && !labelQuote) break
    }
    if (masked[end] !== '|') continue
    const text = masked.slice(start, end)
    const trimmed = text.trim()
    const label = /[@\[\]]/.test(trimmed) && !trimmed.includes('"') ? `"${trimmed}"` : text
    pipeSpans.push(`${link[0]}${label}|`)
    maskedPipes += masked.slice(copied, i) + `\uE002${pipeSpans.length - 1}\uE003`
    copied = end + 1
    i = end
  }
  maskedPipes += masked.slice(copied)
  const quoted = maskedPipes.replace(
    /([\[\(])([^\[\]\(\)\{\}"'\n]*)([\]\)])/g,
    (whole, open: string, label: string, close: string) => {
      const trimmed = label.trim()
      if (trimmed === '') return whole
      if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(trimmed) || /\s/.test(trimmed)) {
        return `${open}"${trimmed}"${close}`
      }
      return whole
    },
  )
  // PIPE spans can contain an earlier EDGE placeholder: restore inside-out.
  return quoted
    .replace(/\uE002(\d+)\uE003/g, (whole, i: string) => pipeSpans[Number(i)] ?? whole)
    .replace(/\uE000(\d+)\uE001/g, (whole, i: string) => spans[Number(i)] ?? whole)
}

/** Flowchart edge arrows. The negative lookahead on `-->(?!>)` keeps
 * sequence-diagram message arrows (`-->>`) from matching. */
const FLOWCHART_EDGE = /-->(?!>)|==>|-\.->/

/**
 * Lenient repair for sources that omit the mandatory diagram-type
 * declaration line — the #1 failure mode of model-generated mermaid (chat
 * assistants routinely emit `A --> B` without the leading `graph TD`).
 *
 * When the first token is not an already-declared `graph`/`flowchart` kind
 * but the body contains flowchart edge arrows, prepend `graph TD` so the
 * diagram renders instead of tripping the kind gate. Anything else — an
 * explicitly declared kind, a sequence/gantt/pie body (no flowchart edges),
 * or plain text — is returned unchanged: we never guess at the diagram type.
 */
export function ensureFlowchartKind(code: string): string {
  const trimmed = code.trim()
  const kind = /^([A-Za-z]+)/.exec(trimmed)?.[1] ?? ''
  if (kind === 'graph' || kind === 'flowchart') return code
  if (!FLOWCHART_EDGE.test(trimmed)) return code
  return `graph TD\n${trimmed}`
}
