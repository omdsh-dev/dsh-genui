/** Synthetic real-renderer regression for #249. No host or model service. */
import { createRoot } from 'react-dom/client'
import { useEffect } from 'react'
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

const tableLayout: GenuiNode = {
  type: 'table', columns: ['Group', 'Description'], types: ['group', 'text'],
  rows: [['Section', ''], ['Detail', 'Description']],
  details: [null, [{ type: 'text', content: 'Detail content' }]],
}

/** Wait for the committed React tree before measuring browser text layout. */
function Fixtures() {
  useEffect(() => {
    requestAnimationFrame(() => {
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
      requestAnimationFrame(() => requestAnimationFrame(() => {
        results.push(...measure('after-controls'))
        results.push(...measureTableControlLayout('after-controls'))
        window.getSelection()!.removeAllRanges()
        document.getElementById('results')!.textContent = JSON.stringify(results)
        document.body.dataset.qa = results.every(result => result.pass) ? 'PASS' : 'FAIL'
      }))
    })
  }, [])

  return (
    <>
      <div id="fixtures">
        {cases.map((item, index) => (
          <section className="case" key={index} data-case={index}>
            <header>{item.name}</header>
            <GenuiBlock spec={{ items: [item.node] }} />
          </section>
        ))}
      </div>
      <div id="table-layout"><GenuiBlock spec={{ items: [tableLayout] }} /></div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Fixtures />)

/** Character ranges measure actual painted line boxes, including rich text. */
function measure(phase: string) {
  return cases.map((item, index) => {
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
