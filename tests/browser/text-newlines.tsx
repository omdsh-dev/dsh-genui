/** Synthetic real-renderer regression for #249 and #280. No host or model service. */
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { GenuiBlock } from '../../src/client/GenuiBlock.tsx'
import css from '../../src/client/GenuiBlock.module.css'
import { STANDALONE_THEME_CSS } from '../../src/client/artifact/standalone-theme.ts'
import type { GenuiNode } from '../../src/client/spec.ts'

const theme = document.createElement('style')
theme.textContent = STANDALONE_THEME_CSS
document.head.appendChild(theme)

/** The desktop shell renders message bodies inside `.markdown`. Two of that
 *  sheet's rules land on `dsh-ui` output, because the components render inside
 *  the same subtree:
 *    - `.markdown { overflow-wrap: anywhere }` is inherited by every cell, and
 *    - `.markdown :not(pre) > code` turns each inline chip into an atomic
 *      `inline-flex` box.
 *  A fixture that renders the table outside that cascade cannot reproduce the
 *  cross-column bleed at all, so the host context is part of the layout
 *  contract being tested here. */
const hostCascade = document.createElement('style')
hostCascade.textContent = `
.host-markdown { overflow-wrap: anywhere; min-width: 0; }
.host-markdown :not(pre) > code {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  padding: 0 5px;
}`
document.head.appendChild(hostCascade)

interface Case {
  name: string
  node: GenuiNode
  selector: string
  expected: string
  whiteSpace: string
  tableGeometry?: boolean
  detailWhitespace?: boolean
  hostTableGeometry?: boolean
}

const cases: Case[] = []
const sizes = ['body', 'muted', 'caption', 'h1', 'h2', 'h3'] as const
for (const newline of ['\n', '\r\n']) {
  for (const emphasis of [false, true]) {
    const suffix = `${newline === '\n' ? 'LF' : 'CRLF'} ${emphasis ? 'emphasis' : 'plain'}`
    const label = `${emphasis ? '**第一行**' : '第一行'}${newline}第二行`
    for (const size of sizes) {
      cases.push({
        name: `${size} ${suffix}`, node: { type: 'text', size, content: label },
        selector: `.${css.text}`, expected: '第一行\n第二行', whiteSpace: 'pre-line',
      })
    }
    const labels: Array<[string, GenuiNode, string]> = [
      ['radio', { type: 'radio', options: [label] }, `.${css.radio} > span`],
      ['checkbox', { type: 'checkbox', label }, `.${css.checkbox} > span`],
      ['tab', { type: 'tabs', tabs: [{ label, items: [] }, { label: 'Other', items: [] }] }, `.${css.tab}`],
      ['badge', { type: 'badge', label, icon: '★' }, `.${css.badgeLabel ?? css.badge}`],
      ['submit', { type: 'submit', label }, `.${css.submit}`],
    ]
    for (const [name, node, selector] of labels) {
      cases.push({ name: `${name} ${suffix}`, node, selector, expected: '第一行\n第二行', whiteSpace: 'pre-line' })
    }
    cases.push({
      name: `table prose ${suffix}`,
      node: { type: 'table', columns: ['A'], rows: [[`第一行${newline}第二行`]] },
      selector: 'td', expected: '第一行\n第二行', whiteSpace: 'pre-line',
    })
    cases.push({
      name: `table code ${suffix}`,
      node: { type: 'table', columns: ['A'], rows: [[`print(1)${newline}    print(2)`]] },
      selector: 'td', expected: 'print(1)\n    print(2)', whiteSpace: 'pre-wrap',
    })
  }
}
cases.push({
  name: 'table single line', node: { type: 'table', columns: ['A'], rows: [['one line']] },
  selector: 'td', expected: 'one line', whiteSpace: 'nowrap',
})
cases.push({
  name: 'inline code spacing', node: { type: 'text', content: '`a    b`' },
  selector: 'code', expected: 'a    b', whiteSpace: 'pre-wrap',
})
const mixedLengthRows = [
  ['Run `const  result = executeLongOperation(argumentOne, argumentTwo, argumentThree)` now', 'The operation completed after reconnecting to the service and checking each resource', 'Ready'],
  ['ok', 'Done', 'Yes'],
  ['Repeat `const  result = executeLongOperation(argumentOne, argumentTwo, argumentThree)` later', 'Pending', 'Waiting'],
  ['x', 'Queued', 'No'],
  ['Complete', 'Done', 'Yes'],
]
cases.push({
  name: 'single-line table inline code stays inside its column',
  node: {
    type: 'table', columns: ['Command', 'Result', 'Status'], rows: mixedLengthRows,
  },
  selector: 'td', expected: '', whiteSpace: '', tableGeometry: true,
})
cases.push({
  name: 'expanded table details preserve nested inline code whitespace',
  node: {
    type: 'table', columns: ['Item'], rows: [['Expandable']], details: [[
      { type: 'text', content: 'Detail `outerInlineCodeShouldWrap`' },
      { type: 'table', columns: ['Snippet'], rows: [['before `nestedInlineCodeShouldWrap`\n    after']] },
    ]],
  },
  selector: '', expected: '', whiteSpace: '', detailWhitespace: true,
})
/** #280 in the real host cascade. The chip is an atomic `inline-flex` box
 *  whose automatic minimum size collapses while its own line is still painted
 *  unbroken — so the column can be sized below its content and the text bleeds
 *  over the next column. Cells whose ink leaves the column are the failure. */
cases.push({
  name: 'host markdown cascade keeps single-line table inside its columns',
  node: {
    type: 'table',
    columns: ['层', '落点', '为什么'],
    rows: [
      [
        '配置定义（实验级）',
        '`connection_pool`：每个实例一行 —— `host`（A 列主机名）/ `port`（B 列端口号）/ `timeout`（C 列超时）/ `retries`（D 列重试次数）',
        '字段顺序固定（E 列值数组固定），逐次解析结果必须完全一致才能跨版本对照',
      ],
      [
        '运行值（实例×配置）',
        '`runtime_value`：一格一条记录 —— `instance_id` / `key` / `value` / `updated_at`',
        '值要与声明值对比，出现差异需要人工确认后才能入库，否则整批回滚',
      ],
      [
        '整块快照（JSON）',
        '`snapshot.payload` = 整个 `ParseResult` 的 JSON，逐次导入留存',
        '重放、跨版本对照、审计举证 —— 只保留最后一次解析的完整 JSON',
      ],
    ],
  },
  selector: '', expected: '', whiteSpace: '', hostTableGeometry: true,
})

const tableLayout: GenuiNode = {
  type: 'table', columns: ['Group', 'Description'], types: ['group', 'text'],
  rows: [['Section', ''], ['Detail', 'Description']],
  details: [null, [{ type: 'text', content: 'Detail content' }]],
}

const root = createRoot(document.getElementById('root')!)

flushSync(() => {
  root.render(
    <>
      <div id="fixtures">
        {cases.map((item, index) => (
          <section
            className={`case${item.tableGeometry ? ' table-geometry' : ''}${item.hostTableGeometry ? ' host-table-geometry host-markdown' : ''}`}
            key={index}
            data-case={index}
          >
            <header>{item.name}</header>
            <GenuiBlock spec={{ items: [item.node] }} />
          </section>
        ))}
      </div>
      <div id="table-layout"><GenuiBlock spec={{ items: [tableLayout] }} /></div>
    </>,
  )
})

const mountedFixtures =
  document.querySelectorAll('#fixtures > .case').length

if (mountedFixtures !== cases.length) {
  throw new Error(
    `React fixture mount incomplete: expected ${cases.length}, got ${mountedFixtures}`,
  )
}

setTimeout(() => {
  for (const [index, item] of cases.entries()) {
    if (item.detailWhitespace) {
      document.querySelector<HTMLElement>(`[data-case="${index}"] [class*="detailToggle"]`)?.click()
    }
  }
  setTimeout(() => {
    const results: Array<Record<string, unknown>> = [...measure('initial'), ...measureTableControlLayout('initial')]
    // Repeated local controls/rerenders must leave label formatting intact.
    for (const checkbox of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      checkbox.click()
      checkbox.click()
    }
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[type="radio"]')) radio.click()
    for (const tabs of document.querySelectorAll('[role="tablist"]')) {
      const buttons = tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      buttons[1]!.click()
      buttons[0]!.click()
    }
    setTimeout(() => {
      results.push(...measure('after-controls'))
      results.push(...measureTableControlLayout('after-controls'))
      window.getSelection()!.removeAllRanges()
      document.getElementById('results')!.textContent = JSON.stringify(results)
      document.body.dataset.qa = results.every(result => result.pass) ? 'PASS' : 'FAIL'
    }, 100)
  }, 100)
}, 600)

/** Painted ink extent of a cell, measured per character so chips and rich text
 *  are judged by what is actually drawn rather than by their box. */
function textRightOf(cell: Element): number {
  let max = Number.NEGATIVE_INFINITY
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
  for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
    const content = text.textContent ?? ''
    for (let position = 0; position < content.length; position++) {
      if (/\s/.test(content[position]!)) continue
      const range = document.createRange()
      range.setStart(text, position)
      range.setEnd(text, position + 1)
      for (const rect of range.getClientRects()) max = Math.max(max, rect.right)
    }
  }
  return max
}

/** Character ranges measure actual painted line boxes, including rich text. */
function measure(phase: string) {
  return cases.flatMap((item, index) => {
    if (item.hostTableGeometry) {
      const fixture = document.querySelector<HTMLElement>(`[data-case="${index}"]`)
      const table = fixture?.querySelector<HTMLTableElement>('table')
      const rows = [...(table?.querySelectorAll<HTMLTableRowElement>('tbody tr') ?? [])]
      if (fixture === null || table === null || rows.length === 0) {
        return { name: item.name, phase, pass: false, error: 'Missing host cascade fixture' }
      }
      const overlaps: Array<{ row: number; col: number; overPx: number }> = []
      const selfOverflows: Array<{ row: number; col: number; overPx: number }> = []
      rows.forEach((row, rowIndex) => {
        const cells = [...row.children]
          .filter(cell => cell.tagName === 'TD' && (cell as HTMLTableCellElement).colSpan === 1) as HTMLElement[]
        cells.forEach((cell, col) => {
          const right = textRightOf(cell)
          if (!Number.isFinite(right)) return
          const rect = cell.getBoundingClientRect()
          const contentRight = rect.right - parseFloat(getComputedStyle(cell).paddingRight)
          if (right - contentRight > 1) {
            selfOverflows.push({ row: rowIndex, col, overPx: Math.round(right - contentRight) })
          }
          const next = cells[col + 1]
          if (next !== undefined && right - next.getBoundingClientRect().left > 1) {
            overlaps.push({ row: rowIndex, col, overPx: Math.round(right - next.getBoundingClientRect().left) })
          }
        })
      })
      const chips = [...table.querySelectorAll<HTMLElement>('tbody td code')]
      const chipWhiteSpaces = chips.map(chip => getComputedStyle(chip).whiteSpace)
      return [
        { name: `${item.name}: text crosses a column edge`, phase, overlaps, pass: overlaps.length === 0 },
        { name: `${item.name}: text leaves its own cell`, phase, selfOverflows, pass: selfOverflows.length === 0 },
        {
          name: `${item.name}: inline code keeps single-line whitespace`, phase, chipWhiteSpaces,
          pass: chipWhiteSpaces.length > 0 && chipWhiteSpaces.every(value => value === 'pre'),
        },
      ]
    }
    if (item.detailWhitespace) {
      const fixture = document.querySelector<HTMLElement>(`[data-case="${index}"]`)
      const detailRow = fixture?.querySelector<HTMLElement>('[class*="detailRow"]')
      const textCode = detailRow?.querySelector<HTMLElement>('[class*="text"] code')
      const nestedCode = detailRow?.querySelector<HTMLElement>('table td[class*="tdCode"] code')
      const textWhiteSpace = textCode == null ? null : getComputedStyle(textCode).whiteSpace
      const nestedWhiteSpace = nestedCode == null ? null : getComputedStyle(nestedCode).whiteSpace
      return [
        { name: 'expanded detail text inline code keeps pre-wrap', phase, whiteSpace: textWhiteSpace, pass: textWhiteSpace === 'pre-wrap' },
        { name: 'nested detail table code keeps pre-wrap', phase, whiteSpace: nestedWhiteSpace, pass: nestedWhiteSpace === 'pre-wrap' },
      ]
    }
    if (item.tableGeometry) {
      const fixture = document.querySelector<HTMLElement>(`[data-case="${index}"]`)
      const wrapper = fixture?.querySelector<HTMLElement>('[class*="tableWrap"]')
      const rows = wrapper?.querySelectorAll<HTMLTableRowElement>('tbody tr')
      if (fixture === null || wrapper == null || rows === undefined) {
        return { name: item.name, phase, pass: false, error: 'Missing table geometry fixture' }
      }
      const inlineCodes = [...wrapper.querySelectorAll<HTMLElement>('tbody td code')]
      const expectedWhiteSpace = 'pre'
      const spacingPreserved = inlineCodes.length === 2 && inlineCodes.every(code =>
        code.textContent?.includes('  ') === true && getComputedStyle(code).whiteSpace === expectedWhiteSpace,
      )
      const overlaps: Array<{ row: number; maxTextRight: number; nextCellLeft: number }> = []
      rows.forEach((row, rowIndex) => {
        const firstCell = row.cells[0]
        const nextCell = row.cells[1]
        if (firstCell === undefined || nextCell === undefined) return
        let maxTextRight = Number.NEGATIVE_INFINITY
        const walker = document.createTreeWalker(firstCell, NodeFilter.SHOW_TEXT)
        for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
          const content = text.textContent ?? ''
          for (let position = 0; position < content.length; position++) {
            if (/\s/.test(content[position]!)) continue
            const range = document.createRange()
            range.setStart(text, position)
            range.setEnd(text, position + 1)
            for (const rect of range.getClientRects()) maxTextRight = Math.max(maxTextRight, rect.right)
          }
        }
        const nextCellLeft = nextCell.getBoundingClientRect().left
        if (maxTextRight > nextCellLeft + 1) overlaps.push({ row: rowIndex, maxTextRight, nextCellLeft })
      })
      return [
        { name: `${item.name} adjacent-column overlap`, phase, overlaps, pass: overlaps.length === 0 },
        {
          name: `${item.name} horizontal scrolling`, phase,
          scrollWidth: wrapper.scrollWidth, clientWidth: wrapper.clientWidth,
          pass: wrapper.scrollWidth > wrapper.clientWidth,
        },
        { name: `${item.name} inline code whitespace`, phase, spacingPreserved, expectedWhiteSpace, pass: spacingPreserved },
      ]
    }
    const owner = document.querySelector(`[data-case="${index}"] ${item.selector}`)
    if (owner === null) return { name: item.name, phase, pass: false, error: 'Missing label owner' }
    const lineTops: number[] = []
    const fontSize = parseFloat(getComputedStyle(owner).fontSize)
    const walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT)
    for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
      const content = text.textContent ?? ''
      for (let position = 0; position < content.length; position++) {
        if (/\s/.test(content[position]!)) continue
        const character = document.createRange()
        character.setStart(text, position)
        character.setEnd(text, position + 1)
        const rect = character.getBoundingClientRect()
        // Font-weight can change glyph bounds slightly on the same line.
        if (rect.width > 0 && !lineTops.some(top => Math.abs(top - rect.top) < fontSize / 2)) {
          lineTops.push(rect.top)
        }
      }
    }
    const range = document.createRange()
    range.selectNodeContents(owner)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const selected = selection.toString()
    const whiteSpace = getComputedStyle(owner).whiteSpace
    return {
      name: item.name, phase, text: owner.textContent, selected, whiteSpace, lineTops,
      expected: item.expected,
      pass: owner.textContent === item.expected && selected === item.expected
        && whiteSpace === item.whiteSpace
        && lineTops.length === (item.expected.includes('\n') ? 2 : 1)
        && owner.querySelector('br') === null,
    }
  })
}

/** Check that table controls follow their cell padding and align with labels. */
function measureTableControlLayout(phase: string) {
  const groupCell = document.querySelector<HTMLElement>(`#table-layout .${css.groupRow} td`)
  const groupToggle = groupCell?.querySelector<HTMLElement>(`.${css.groupToggle}`)
  const groupLabel = groupCell?.querySelector<HTMLElement>(`.${css.groupLabel}`)
  const detailCell = document.querySelector<HTMLElement>(`#table-layout .${css.detailCell}`)
  const detailToggle = detailCell?.querySelector<HTMLElement>(`.${css.detailToggle}`)
  const detailContent = detailCell?.querySelector<HTMLElement>(`.${css.detailContent}`)
  if (!groupCell || !groupToggle || !groupLabel || !detailCell || !detailToggle || !detailContent) {
    return [{ name: 'table control layout', phase, pass: false, error: 'Missing table control' }]
  }

  const groupToggleBox = groupToggle.getBoundingClientRect()
  const groupLabelBox = groupLabel.getBoundingClientRect()
  const detailToggleBox = detailToggle.getBoundingClientRect()
  const detailContentBox = detailContent.getBoundingClientRect()
  const groupPadding = parseFloat(getComputedStyle(groupCell).paddingLeft)
  const detailPadding = parseFloat(getComputedStyle(detailCell).paddingLeft)
  return [
    {
      name: 'group arrow and label layout', phase,
      pass: Math.abs(groupToggleBox.left - (groupCell.getBoundingClientRect().left + groupPadding)) < 2
        && groupLabelBox.left >= groupToggleBox.right
        && Math.abs(groupToggleBox.top + groupToggleBox.height / 2 - (groupLabelBox.top + groupLabelBox.height / 2)) < 2,
      groupToggle: groupToggleBox.toJSON(), groupLabel: groupLabelBox.toJSON(),
    },
    {
      name: 'detail arrow and label layout', phase,
      pass: Math.abs(detailToggleBox.left - (detailCell.getBoundingClientRect().left + detailPadding)) < 2
        && detailContentBox.left >= detailToggleBox.right
        && Math.abs(detailToggleBox.top + detailToggleBox.height / 2 - (detailContentBox.top + detailContentBox.height / 2)) < 2,
      detailToggle: detailToggleBox.toJSON(), detailContent: detailContentBox.toJSON(),
    },
  ]
}
