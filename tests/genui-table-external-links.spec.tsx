// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { repairGenuiSpec } from '../src/client/guard.ts'
import { renderInline } from '../src/client/inline.ts'
import { tableToCsv, tableToMarkdown } from '../src/client/blocks/charts.tsx'

const { writeClipboard } = vi.hoisted(() => ({ writeClipboard: vi.fn(async () => true) }))
vi.mock('../src/client/primitive-adapter.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/primitive-adapter.ts')>(),
  writeClipboard,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

function mount(table: Record<string, unknown>, before: unknown[] = []) {
  const action = vi.fn()
  const spec = repairGenuiSpec({ items: [...before, { type: 'table', ...table }] })!
  const view = render(<GenuiActionContext.Provider value={action}><GenuiBlock spec={spec} /></GenuiActionContext.Provider>)
  return { ...view, action }
}

describe('table external source links', () => {
  it.each(['http://example.com/source', 'https://example.com/source?q=1#section', 'mailto:editor@example.com'])
    ('renders the existing safe target %s in text, badge and delta cells', href => {
      const view = mount({ columns: ['Text', 'Badge', 'Delta'], types: ['text', 'badge', 'delta'],
        rows: [[`[Text](<href>)`.replace('<href>', href), `[Badge](${href})`, `+2 [Delta](${href})`]] })
      const links = view.container.querySelectorAll('tbody a')
      expect(links).toHaveLength(3)
      for (const link of links) {
        expect(link.getAttribute('href')).toBe(href)
        expect(link.getAttribute('target')).toBe('_blank')
        expect(link.getAttribute('rel')).toBe('noreferrer noopener')
      }
      expect(view.action).not.toHaveBeenCalled()
    })

  it('renders implicit text and automatically styled delta links', () => {
    const view = mount({ columns: ['Source', 'Change'], rows: [
      ['[Article](https://example.com/article)', '-2 [Evidence](https://example.com/evidence)'],
    ] })
    expect(view.getByRole('link', { name: 'Article' }).getAttribute('href')).toBe('https://example.com/article')
    expect(view.getByRole('link', { name: 'Evidence' }).closest('[class*="tdDeltaDown"]')).not.toBeNull()
  })

  it.each(['javascript:alert(1)', 'data:text/html,unsafe', 'vbscript:msgbox(1)', 'file:///tmp/a',
    '//example.com/path', 'ftp://example.com/path', 'dsh-resource://file/session/s/a', 'https:bad', 'src/%ZZ.ts'])
    ('keeps unsafe or invalid target %s non-navigable in every newly enabled location', href => {
      const value = `[Blocked](${href})`
      const view = mount({ columns: ['Source', 'Badge', 'Delta'], types: ['group', 'badge', 'delta'],
        rows: [[value, '', ''], [value, value, value], [value, value, value]],
        details: [null, [{ type: 'text', content: 'Detail' }], null] })
      expect(view.container.querySelector('a')).toBeNull()
      expect(view.container.textContent).toContain('Blocked')
    })

  it.each(['anchor', 'descendant'])('does not collapse a group when its %s is clicked', target => {
    const view = mount({ columns: ['Source', 'Count'], types: ['group', 'num'], rows: [
      ['[**Group**](https://example.com/group)', ''], ['Article', 2],
    ] })
    const link = view.getByRole('link', { name: 'Group' })
    const control = view.getByRole('button', { name: /分组/ })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(target === 'anchor' ? link : link.querySelector('strong')!, event)
    expect(event.defaultPrevented).toBe(false)
    expect(control.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText('Article')).toBeTruthy()
    expect(view.action).not.toHaveBeenCalled()
    fireEvent.click(control)
    expect(view.queryByText('Article')).toBeNull()
    fireEvent.click(control)
    expect(view.getByText('Article')).toBeTruthy()
    fireEvent.click(view.container.querySelector('[class*="groupCount"]')!)
    expect(view.queryByText('Article')).toBeNull()
  })

  it.each(['anchor', 'descendant'])('does not toggle details when their first-cell %s is clicked', target => {
    const view = mount({ columns: ['Source', 'Count'], rows: [
      ['[**Article**](https://example.com/article)', 2],
    ], details: [[{ type: 'text', content: 'Actual detail' }]] })
    const link = view.getByRole('link', { name: 'Article' })
    const control = view.getByRole('button', { name: /明细/ })
    const clickLink = () => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      fireEvent(target === 'anchor' ? link : link.querySelector('strong')!, event)
      expect(event.defaultPrevented).toBe(false)
    }
    clickLink()
    expect(control.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByText('Actual detail')).toBeNull()
    fireEvent.click(control)
    expect(view.getByText('Actual detail')).toBeTruthy()
    clickLink()
    expect(control.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText('Actual detail')).toBeTruthy()
    fireEvent.click(view.container.querySelector('[class*="detailContent"]')!)
    expect(view.queryByText('Actual detail')).toBeNull()
    expect(view.action).not.toHaveBeenCalled()
  })

  it('leaves headers and specialized numeric cells link-free', () => {
    const value = '[Source](https://example.com/source)'
    const view = mount({ columns: [value, value, value, value], types: ['bar', 'spark', 'ring', 'index'],
      rows: [[value, value, value, value]] })
    expect(view.container.querySelector('a')).toBeNull()
    expect(view.container.querySelector('[class*="cellIndex"]')?.textContent).toBe('1')
    fireEvent.click(view.container.querySelector('thead button')!)
    expect(view.container.querySelector('th')?.getAttribute('aria-sort')).toBe('ascending')
  })

  it('does not expand the global false or file-only inline modes', () => {
    const value = '[External](https://example.com/source) [File](src/main.ts)'
    const view = render(<>{renderInline(value, false)}{renderInline(value, 'file')}</>)
    expect(view.container.querySelector('a')).toBeNull()
    expect(view.container.textContent).toBe('External FileExternal File')
  })

  it('preserves source URLs, numeric sorting, filtering, totals and the original export data', async () => {
    const columns = ['Story', 'Count', 'Source']
    const rows = [
      ['Alpha', 30, '[Alpha source](https://example.com/alpha)'],
      ['Beta', 10, '[Beta source](https://example.com/beta)'],
      ['Gamma', 20, '[Gamma source](https://example.com/gamma)'],
    ]
    const original = JSON.stringify(rows)
    const view = mount({ columns, rows, total: true, export: true, filter: 'q',
      details: rows.map(([name]) => [{ type: 'text', content: `Detail for ${name}` }]) },
    [{ type: 'input', id: 'q', label: 'Find source' }])
    const names = () => [...view.container.querySelectorAll('tbody tr')]
      .filter(row => !row.querySelector('[class*="detailBody"]'))
      .map(row => row.querySelector('td')?.textContent?.replace('▸', ''))
    expect(names()).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(view.container.querySelector('tfoot')?.textContent).toContain('60')
    fireEvent.click(view.getByRole('button', { name: 'Count' }))
    expect(names()).toEqual(['Beta', 'Gamma', 'Alpha'])
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'example.com/beta' } })
    expect(names()).toEqual(['Beta'])
    expect(view.getByRole('link', { name: 'Beta source' }).getAttribute('href')).toBe('https://example.com/beta')
    expect([...view.container.querySelectorAll('tfoot')].at(-1)?.textContent).toContain('10')
    fireEvent.click(view.getByRole('button', { name: '展开 Beta 的明细' }))
    expect(view.getByText('Detail for Beta')).toBeTruthy()
    await act(async () => { fireEvent.click(view.getByRole('button', { name: '复制 CSV' })) })
    expect(writeClipboard).toHaveBeenLastCalledWith(tableToCsv(rows))
    await act(async () => { fireEvent.click(view.getByRole('button', { name: '复制 Markdown' })) })
    expect(writeClipboard).toHaveBeenLastCalledWith(tableToMarkdown(columns, rows))
    expect(JSON.stringify(rows)).toBe(original)
    expect(view.action).not.toHaveBeenCalled()
  })
})
