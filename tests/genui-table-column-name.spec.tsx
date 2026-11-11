import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { processGenuiSpec, repairGenuiSpec } from '../src/client/guard.ts'
import { isGenuiSpec } from '../src/client/spec.ts'
import { GENUI_LIMITS } from '../src/client/genui-runtime/index.ts'
import { prepareTableRows } from '../src/client/table-details.ts'

afterEach(cleanup)

describe('table column name alias (issue #315)', () => {
  it('repairs and renders the reporter’s array-row example with text headers', () => {
    const rows = [['分子字段', 'tcpinputoctets']]
    const spec = repairGenuiSpec({
      type: 'table',
      columns: [{ name: '字段', type: 'text' }, { name: '取值', type: 'text' }],
      rows,
    })
    expect(spec?.items[0]).toEqual({ type: 'table', columns: ['字段', '取值'], rows })
    expect(isGenuiSpec(spec)).toBe(true)
    expect(repairGenuiSpec(spec)).toEqual(spec)
    if (spec === null) throw new Error('Expected a repaired table')
    const { container } = render(<GenuiBlock spec={spec} />)
    expect([...container.querySelectorAll('th')].map(th => th.textContent)).toEqual(['字段', '取值'])
    expect([...container.querySelectorAll('td')].map(td => td.textContent)).toEqual(rows[0])
  })

  it.each(['rows', 'data'])('maps name-only columns to object %s in declared order', field => {
    const spec = repairGenuiSpec({
      type: 'table',
      columns: [{ name: '字段' }, { name: '取值' }, { name: '数量' }],
      [field]: [{ 数量: 3, 取值: 'tcpinputoctets', 字段: '分子字段', extra: 'ignored' }, { 字段: '分母字段', 数量: 0 }],
    })
    expect(spec?.items[0]).toEqual({
      type: 'table', columns: ['字段', '取值', '数量'],
      rows: [['分子字段', 'tcpinputoctets', 3], ['分母字段', '', 0]],
    })
  })

  it.each([
    [{ title: '标题', label: '标签', key: '键', dataIndex: '索引', name: '名称' }, '标题', 'key cell'],
    [{ label: '标签', key: '键', dataIndex: '索引', name: '名称' }, '标签', 'key cell'],
    [{ key: '键', dataIndex: '索引', name: '名称' }, '键', 'key cell'],
    [{ dataIndex: '索引', name: '名称' }, '索引', 'dataIndex cell'],
    [{ title: '标题', label: '标签', name: '名称' }, '标题', 'title cell'],
    [{ label: '标签', name: '名称' }, '标签', 'label cell'],
  ])('preserves existing header and object-key priorities for %j', (column, header, cell) => {
    const objectRow = { 标题: 'title cell', 标签: 'label cell', 键: 'key cell', 索引: 'dataIndex cell', 名称: 'name cell' }
    expect(prepareTableRows({ columns: [column], rows: [objectRow] })).toEqual({
      columns: [header], rows: [[cell]],
    })
    expect(prepareTableRows({ columns: [column], rows: [['array cell']] })).toEqual({
      columns: [header], rows: [['array cell']],
    })
  })

  it.each(['', null, 42])('does not use an empty or non-string name: %j', name => {
    const column = { name, type: 'text' }
    expect(prepareTableRows({ columns: [column], rows: [['value']] })).toEqual({
      columns: [JSON.stringify(column)], rows: [['value']],
    })
  })

  it('handles a deeply nested object-row cell without throwing', () => {
    let nested: unknown = 1
    for (let i = 0; i < 5000; i++) nested = { child: nested }
    const input = { items: [{ type: 'table', columns: ['payload', 'name'], rows: [{ payload: nested, name: 'kept' }] }] }
    expect(() => processGenuiSpec(input)).not.toThrow()
    const processed = processGenuiSpec(input)
    expect(processed.errors).toEqual([])
    expect(processed.spec?.items[0]).toEqual({
      type: 'table', columns: ['payload', 'name'], rows: [['', 'kept']],
    })
  })

  it('preserves column positions for deeply nested fallback headers', () => {
    let nested: unknown = 1
    for (let i = 0; i < 5000; i++) nested = { child: nested }
    expect(prepareTableRows({ columns: [nested, 'name'], rows: [['value', 'kept']] })).toEqual({
      columns: ['', 'name'], rows: [['value', 'kept']],
    })
    expect(prepareTableRows({ columns: ['name', nested], rows: [['kept', 'value']] })).toEqual({
      columns: ['name', ''], rows: [['kept', 'value']],
    })
  })

  it('bounds JSON fallback text for wide table cells and headers', () => {
    const oversized = Array(GENUI_LIMITS.maxJsonNodes).fill(0)
    expect(prepareTableRows({
      columns: ['payload'], rows: [{ payload: { entries: oversized } }],
    })).toEqual({ columns: ['payload'], rows: [['']] })
    expect(prepareTableRows({
      columns: [{ entries: oversized }], rows: [['kept']],
    })).toEqual({ columns: [''], rows: [['kept']] })
  })

  it('uses name only after empty or invalid existing aliases and keeps the header limit', () => {
    expect(prepareTableRows({
      columns: [{ title: '', label: null, key: 42, dataIndex: '', name: '字段' }],
      rows: [{ 字段: 'value' }],
    })).toEqual({ columns: ['字段'], rows: [['value']] })
    expect(prepareTableRows({ columns: [{ name: '名'.repeat(129) }], rows: [['value']] })?.columns)
      .toEqual(['名'.repeat(128)])
  })

  it.each([
    [{ label: '标签', value: '值', title: '标题', name: '名称' }, '标签'],
    [{ value: '值', title: '标题', name: '名称' }, '值'],
    [{ title: '标题', name: '名称' }, '标题'],
    [{ name: '名称' }, '名称'],
  ])('repairs mixed string/object columns without changing legacy priorities: %j', (column, header) => {
    expect(prepareTableRows({ columns: ['首列', column], rows: [['a', 'b']] })).toEqual({
      columns: ['首列', header], rows: [['a', 'b']],
    })
  })
})
