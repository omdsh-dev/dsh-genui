/** Synthetic real-renderer regression for #249. No host or model service. */
import { createRoot } from 'react-dom/client'
import { GenuiBlock } from '../../src/client/GenuiBlock.tsx'
import css from '../../src/client/GenuiBlock.module.css'
import { STANDALONE_THEME_CSS } from '../../src/client/artifact/standalone-theme.ts'
import type { GenuiNode } from '../../src/client/spec.ts'

const theme = document.createElement('style')
theme.textContent = STANDALONE_THEME_CSS
document.head.appendChild(theme)

interface Case {
  name: string
  node: GenuiNode
  selector: string
  expected: string
  whiteSpace: string
  tableGeometry?: boolean
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

createRoot(document.getElementById('root')!).render(
  <div id="fixtures">
    {cases.map((item, index) => (
      <section className={`case${item.tableGeometry ? ' table-geometry' : ''}`} key={index} data-case={index}>
        <header>{item.name}</header>
        <GenuiBlock spec={{ items: [item.node] }} />
      </section>
    ))}
  </div>,
)

/** Character ranges measure actual painted line boxes, including rich text. */
function measure(phase: string) {
  return cases.flatMap((item, index) => {
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

setTimeout(() => {
  const results = measure('initial')
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
    window.getSelection()!.removeAllRanges()
    document.getElementById('results')!.textContent = JSON.stringify(results)
    document.body.dataset.qa = results.every(result => result.pass) ? 'PASS' : 'FAIL'
  }, 100)
}, 600)
