/** Synthetic real-renderer regression for #382 (`table.wrap`). No host or model
 *  service: just the real renderer, the real stylesheet, and a fixed column
 *  width standing in for the message area.
 *
 *  Two behaviours are pinned against each other:
 *  - the data-table voice (#326): `.table` sizes to `max-content`, cells stay
 *    `nowrap`, and `.tableWrap` scrolls when the table is wider than the
 *    message column. A grid of short values must keep exactly this shape.
 *  - the opt-in prose layout (`wrap: true`): the table tracks the container and
 *    cells wrap, so a column of sentences is readable without a scrollbar —
 *    while token wrapping + a `min-width` floor keep #326's column-collapse bug
 *    (a short column squeezed to one glyph per line) from coming back.
 */
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { GenuiBlock } from '../../src/client/GenuiBlock.tsx'
import { STANDALONE_THEME_CSS } from '../../src/client/artifact/standalone-theme.ts'
import type { GenuiNode } from '../../src/client/spec.ts'

const theme = document.createElement('style')
theme.textContent = STANDALONE_THEME_CSS
document.head.appendChild(theme)
const hostCascade = document.createElement('style')
hostCascade.textContent = '.case { overflow-wrap: anywhere } .case :not(pre) > code { display: inline-flex; padding: 0 5px; box-sizing: border-box }'
document.head.appendChild(hostCascade)

/** Keep #326's six-column incident, including its CJK product name and hard
 *  newline. The ASCII description makes the nowrap row exceed the container
 *  even on Linux runners whose CJK fallback glyphs are narrower. Both modes
 *  receive the same text, with ordinary word boundaries for prose wrapping. */
const ISSUE_326_ROWS = [[
  '某店',
  '洁柔粉Face悬挂抽纸280抽4层加厚柔韧可湿水不易烂可作洗脸巾可擦手面巾纸餐巾纸'
    + ' — Soft and durable four layer tissue for everyday cleaning and hand drying.'
    + ' The full product description stays readable when this comparison table wraps.',
  'SPU 10001035164766\nSKU 18506716626',
  '¥29.9',
  '1,234',
  '现货',
]]

/** Keep #382's comparison wording and extend the first measured row with
 *  ASCII prose. The original CJK-only row can fit without wrapping on Linux,
 *  so it cannot by itself prove the difference between the two layout modes. */
const PROSE_ROWS = [
  ['跨设备记忆同步评估 · 1.7k 字', '2 处，全部真命中（翻案腔、结论冒号）',
    '5 处顿号，约 3 处是技术枚举，其余是正常并列'
      + ' — Review each technical list in context before changing the sentence.'
      + ' The complete explanation should wrap inside its column without hiding the comparison.'],
  ['Reasonix 吸收评估 · 2.4k 字', '1 处，真命中', '23 处顿号，几乎全是技术名词枚举，需要逐条判断'],
]

interface Case {
  name: string
  width: number
  node: GenuiNode
  nested?: boolean
}

const cases: Case[] = [
  {
    name: 'issue326 data table, default',
    width: 818,
    node: {
      type: 'table',
      columns: ['店铺', '商品', '编码', '单价', '库存', '备注'],
      rows: ISSUE_326_ROWS,
    },
  },
  {
    name: 'issue326 data table, wrap',
    width: 818,
    node: {
      type: 'table',
      columns: ['店铺', '商品', '编码', '单价', '库存', '备注'],
      rows: ISSUE_326_ROWS,
      wrap: true,
    },
  },
  {
    name: 'prose table, default',
    width: 640,
    node: {
      type: 'table',
      columns: ['实测样本', 'A 级（机械改）', 'B 级（结构改）'],
      rows: PROSE_ROWS,
    },
  },
  {
    name: 'prose table, wrap',
    width: 640,
    node: {
      type: 'table',
      columns: ['实测样本', 'A 级（机械改）', 'B 级（结构改）'],
      rows: PROSE_ROWS,
      wrap: true,
    },
  },
  { name: 'long token, wrap', width: 400, node: {
    type: 'table', wrap: true, columns: ['Name', 'Description'], rows: [['A', 'a'.repeat(140)]],
  } },
  { name: 'inline code, wrap', width: 400, node: {
    type: 'table', wrap: true, columns: ['Name', 'Description'], rows: [['A', '`' + 'echo technical-value '.repeat(8) + '`']],
  } },
  { name: 'explicit newlines, wrap', width: 400, node: {
    type: 'table', wrap: true, columns: ['Text', 'Code'], rows: [['第一行\n第二行', 'print(1)\n    print(2)']],
  } },
  { name: 'narrow six columns, wrap', width: 320, node: {
    type: 'table', wrap: true, columns: ['店铺', '商品', '编码', '单价', '库存', '备注'], rows: ISSUE_326_ROWS,
  } },
  { name: 'nested default table', width: 400, nested: true, node: {
    type: 'table', wrap: true, columns: ['Name', 'Description'], rows: [['Inspect', 'Details']],
    details: [[{ type: 'table', wrap: false, columns: ['Nested', 'Data'], rows: [['A', '长文字'.repeat(35)]] }]],
  } },
]

const root = createRoot(document.getElementById('root')!)
flushSync(() => {
  root.render(
    <>
      {cases.map((testCase, index) => (
        <div
          key={index}
          className="case"
          data-case={testCase.name}
          style={{ width: `${testCase.width}px` }}
        >
          <header>{testCase.name} · {testCase.width}px column</header>
          <GenuiBlock spec={{ items: [testCase.node] }} />
        </div>
      ))}
    </>,
  )
})

flushSync(() => {
  document.querySelector<HTMLButtonElement>('[data-case="nested default table"] button[aria-expanded="false"]')!.click()
})

const measurements = cases.map(testCase => {
  const host = document.querySelector<HTMLElement>(`[data-case="${testCase.name}"]`)!
  const table = host.querySelector(testCase.nested ? 'table table' : 'table')!
  const wrap = table.parentElement as HTMLElement
  const row = table.querySelector(':scope > tbody > tr')!
  const cells = [...row.children] as HTMLElement[]
  const colWidths = cells.map(cell => Math.round(cell.getBoundingClientRect().width))
  return {
    name: testCase.name,
    wrapWidth: Math.round(wrap.getBoundingClientRect().width),
    tableWidth: Math.round(table.getBoundingClientRect().width),
    overflows: wrap.scrollWidth > wrap.clientWidth + 1,
    colWidths,
    minColWidth: Math.min(...colWidths),
    rowHeight: Math.round(row.getBoundingClientRect().height),
    cellWhiteSpace: getComputedStyle(cells[0]!).whiteSpace,
    cellWhiteSpaces: cells.map(cell => getComputedStyle(cell).whiteSpace),
    cellText: cells.map(cell => cell.textContent),
    codeWhiteSpace: table.querySelector('code') ? getComputedStyle(table.querySelector('code')!).whiteSpace : null,
    tableLayout: getComputedStyle(table).tableLayout,
  }
})

document.getElementById('results')!.textContent = JSON.stringify(measurements)
