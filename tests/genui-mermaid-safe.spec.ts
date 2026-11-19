/**
 * mermaid sanitization gate: the rendered SVG is the only GenUI output that
 * reaches the DOM via dangerouslySetInnerHTML, so the last line of defense is
 * assertSafeSvg, not mermaid's own sanitizer. These cases pin that gate:
 * legitimate strict-mode mermaid output must pass; anything with script tags,
 * event-handler attributes, or javascript: URIs must throw.
 */
import { describe, expect, it } from 'vitest'
import { assertSafeSvg, ensureFlowchartKind, repairMermaidSource } from '../src/client/mermaid-lazy.ts'

const LEGIT = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><style>#a{fill:red}</style><path d="M0 0L1 1" fill="none" stroke="#333"/><text>graph TD</text></svg>`

describe('assertSafeSvg', () => {
  it('passes legitimate strict-mode mermaid output (style, path, text)', () => {
    expect(() => assertSafeSvg(LEGIT)).not.toThrow()
  })

  it('rejects an inline <script> tag', () => {
    expect(() => assertSafeSvg('<svg><script>alert(1)</script></svg>')).toThrow(/sanitization/)
  })

  it('rejects a case-variant <SCRIPT> tag', () => {
    expect(() => assertSafeSvg('<svg><SCRIPT>alert(1)</SCRIPT></svg>')).toThrow(/sanitization/)
  })

  it('rejects event-handler attributes (onload, onerror, onClick)', () => {
    expect(() => assertSafeSvg('<svg onload="alert(1)"></svg>')).toThrow(/sanitization/)
    expect(() => assertSafeSvg('<svg><path onerror="alert(1)"/></svg>')).toThrow(/sanitization/)
    expect(() => assertSafeSvg('<svg onclick="alert(1)"></svg>')).toThrow(/sanitization/)
  })

  it('rejects javascript: URIs', () => {
    expect(() => assertSafeSvg('<svg><a href="javascript:alert(1)">x</a></svg>')).toThrow(/sanitization/)
  })
})

describe('repairMermaidSource', () => {
  it.each(['@ 本机成员', '提@本机', '@ members'])('quotes bare mentions in actual pipe edge labels: %s', label => {
    const src = `flowchart LR\nA -->|${label}| B`
    expect(repairMermaidSource(src)).toBe(`flowchart LR\nA -->|"${label}"| B`)
  })

  it.each(['-->', '==>', '-.->', '---', '<-->', '---->'])('recognizes the %s link before a pipe label', arrow => {
    const src = `flowchart LR\nA ${arrow}|@ members| B`
    expect(repairMermaidSource(src)).toBe(`flowchart LR\nA ${arrow}|"@ members"| B`)
  })

  it('does not mistake a node label for an edge label', () => {
    const src = 'flowchart LR\nA[a | @ b | c] --> B[plain]'
    expect(repairMermaidSource(src)).toBe('flowchart LR\nA["a | @ b | c"] --> B[plain]')
  })

  it('preserves quoted node contents even when they contain arrow-like text', () => {
    const src = 'flowchart LR\nA["a -->|@ b| c"]\nA -->|[tag]| B[plain]'
    expect(repairMermaidSource(src)).toBe('flowchart LR\nA["a -->|@ b| c"]\nA -->|"[tag]"| B[plain]')
  })

  it('preserves comments and already-quoted edge labels during another repair', () => {
    const src = 'flowchart LR\n%% A -->|@ comment| B\nA -->|"@ existing [tag]"| B\nB -->|@ next| C'
    expect(repairMermaidSource(src)).toBe('flowchart LR\n%% A -->|@ comment| B\nA -->|"@ existing [tag]"| B\nB -->|"@ next"| C')
  })

  it('restores nested edge placeholders inside an already-quoted pipe label', () => {
    const src = 'flowchart LR\nA -->|"-- status -->"| B\nB -->|@ members| C'
    expect(repairMermaidSource(src)).toBe('flowchart LR\nA -->|"-- status -->"| B\nB -->|"@ members"| C')
  })

  it('parses repaired labels and the reported node counterexamples with the real engine', async () => {
    const { default: mermaid } = await import('mermaid')
    const sources = [
      ...['-->', '==>', '-.->', '---', '<-->', '---->'].map(arrow => `flowchart LR\nA ${arrow}|@ members| B`),
      'flowchart LR\nA -->|@ 本机成员| B',
      'flowchart LR\nA[a | @ b | c] --> B[plain]',
      'flowchart LR\nA["a | @ b | c"]\nA -->|[tag]| B[plain]',
      'flowchart LR\nA["a -->|@ b| c"]\nA -->|[tag]| B[plain]',
      'flowchart LR\nA -->|"-- status -->"| B\nB -->|@ members| C',
    ]
    for (const source of sources) {
      await expect(mermaid.parse(repairMermaidSource(source))).resolves.toMatchObject({ diagramType: 'flowchart-v2' })
    }
  })

  it('quotes unquoted CJK and space labels in graph sources', () => {
    const repaired = repairMermaidSource('graph LR\nA[模型生成 spec] --> B[fence 通道]\nB --> C[plain]')
    expect(repaired).toContain('A["模型生成 spec"]')
    expect(repaired).toContain('B["fence 通道"]')
    expect(repaired).toContain('C[plain]') // ASCII, no space: untouched
  })

  it('leaves already-quoted labels alone', () => {
    const src = 'graph LR\nA["模型生成 spec"] --> B["x"]'
    expect(repairMermaidSource(src)).toBe(src)
  })

  it('strips <br/> tags', () => {
    const repaired = repairMermaidSource('graph LR\nA[面板<br/>dock] --> B[x]')
    expect(repaired).not.toContain('<br')
    expect(repaired).toContain('A["面板 dock"]')
  })

  it('drops backticks even inside quoted labels (the live fence failure)', () => {
    const repaired = repairMermaidSource('graph LR\nA["```dsh-ui fence 通道"] --> B[x]')
    expect(repaired).toContain('A["dsh-ui fence 通道"]')
  })

  it('leaves non-flowchart kinds untouched', () => {
    const src = 'sequenceDiagram\nAlice->>Bob: 你好'
    expect(repairMermaidSource(src)).toBe(src)
  })

  it('never quotes labeled-edge spans (-- label -->)', () => {
    const src = 'graph TD\nH -- 否(流式中) --> J'
    expect(repairMermaidSource(src)).toBe(src)
  })

  it('quotes unquoted CJK node labels but not the edge label on the same line', () => {
    const src = 'graph TD\nA[模型生成 spec] -- 否(流式中) --> B[修复完成]'
    const repaired = repairMermaidSource(src)
    expect(repaired).toContain('A["模型生成 spec"]')
    expect(repaired).toContain('B["修复完成"]')
    expect(repaired).toContain('-- 否(流式中) -->')
    expect(repaired).not.toContain('("流式中")')
  })

  it('leaves thick and dotted edge labels alone', () => {
    const src = 'graph LR\nA == 重连(已恢复) ==> B\nA -. 斜线(带括号) .-> C'
    expect(repairMermaidSource(src)).toBe(src)
  })

  it('does not swallow the destination node of an unlabeled edge', () => {
    const src = 'graph LR\nA --> B[模型] -- 下一步(确认) --> C'
    const repaired = repairMermaidSource(src)
    expect(repaired).toContain('B["模型"]')
    expect(repaired).toContain('-- 下一步(确认) -->')
  })

  it('preserves edge labels when nothing else needs repair', () => {
    const src = 'graph TD\nA -- 能 --> B -- 不能 --> C'
    expect(repairMermaidSource(src)).toBe(src)
  })

  it('quotes pipe edge labels containing brackets (the [genui-action] live failure)', () => {
    const src = 'flowchart LR\nUI -->|6. 用户交互 → [genui-action]| M'
    const repaired = repairMermaidSource(src)
    expect(repaired).toContain('|"6. 用户交互 → [genui-action]"|')
    expect(repaired).not.toContain('→ ["genui-action"]')
  })

  it('never double-quotes a bracket inside a pipe label', () => {
    const src = 'flowchart LR\nA -->|步骤 [第 2 步] 完成| B'
    const repaired = repairMermaidSource(src)
    expect(repaired).toContain('|"步骤 [第 2 步] 完成"|')
    expect(repaired).not.toContain('["第 2 步"]')
  })

  it('leaves bracket-free pipe labels alone', () => {
    const src = 'flowchart LR\nA -->|1. 输出 fence 文本| B'
    expect(repairMermaidSource(src)).toBe(src)
  })

  it('leaves already-quoted pipe labels alone', () => {
    const src = 'flowchart LR\nUI -->|"6. 用户交互 → [genui-action]"| M'
    expect(repairMermaidSource(src)).toBe(src)
  })

  it('does not touch pipe characters inside node labels', () => {
    const src = 'graph LR\nA[a | b | c] --> B[plain]'
    const repaired = repairMermaidSource(src)
    expect(repaired).toContain('A["a | b | c"]')
    expect(repaired).toContain('B[plain]')
  })

  it('quotes pipe labels with brackets while CJK node labels on the same line are quoted too', () => {
    const src = 'flowchart LR\nA[模型] -->|输出 [spec]| B[渲染]'
    const repaired = repairMermaidSource(src)
    expect(repaired).toContain('A["模型"]')
    expect(repaired).toContain('|"输出 [spec]"|')
    expect(repaired).toContain('B["渲染"]')
  })
})

describe('ensureFlowchartKind', () => {
  it('prepends graph TD to an undeclared flowchart body (the live AI-output failure)', () => {
    const src = 'A[高帧率摄像头 120-240fps] --> B[人脸检测+关键点追踪]\nB --> C[ROI 区域: 额头/面颊/颈部/咬肌]'
    expect(ensureFlowchartKind(src)).toBe('graph TD\n' + src)
  })

  it('handles a multi-line body with thick and dotted edges', () => {
    const src = 'A ==> B\nB -.-> C\nC --> D'
    expect(ensureFlowchartKind(src)).toBe('graph TD\n' + src)
  })

  it('leaves an already-declared graph source unchanged', () => {
    const src = 'graph LR\nA --> B'
    expect(ensureFlowchartKind(src)).toBe(src)
  })

  it('leaves an already-declared flowchart source unchanged', () => {
    const src = 'flowchart TD\nA --> B'
    expect(ensureFlowchartKind(src)).toBe(src)
  })

  it('does not guess at a sequence-diagram body (-->> messages are not flowchart edges)', () => {
    const src = 'Alice->>Bob: 你好\nBob-->>Alice: 收到'
    expect(ensureFlowchartKind(src)).toBe(src)
  })

  it('leaves other declared diagram kinds alone', () => {
    const src = 'pie\n  "A" : 1\n  "B" : 2'
    expect(ensureFlowchartKind(src)).toBe(src)
  })

  it('leaves plain text alone', () => {
    const src = 'hello world 随便写的文字'
    expect(ensureFlowchartKind(src)).toBe(src)
  })

  it('trims surrounding whitespace before prepending', () => {
    const src = '\n  A --> B\n'
    expect(ensureFlowchartKind(src)).toBe('graph TD\nA --> B')
  })
})
