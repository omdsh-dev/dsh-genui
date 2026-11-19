import { describe, expect, it } from 'vitest'
import { createGenuiArtifact } from '../src/client/artifact/create.ts'
import { parseGenuiArtifact } from '../src/client/artifact/parse.ts'
import { sanitizeArtifactFilename } from '../src/client/artifact/download.ts'
import { serializeGenuiArtifact } from '../src/client/artifact/json.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

describe('GenUI artifact format', () => {
  it('normalizes, removes DSH routing fields, and round-trips durable presentation state', () => {
    const source = {
      title: '销售数据中心', panel: true, append: true,
      items: [{ type: 'input', id: 'keyword', value: 'phone' }],
    } as GenuiSpec
    const artifact = createGenuiArtifact(source, { fields: { keyword: 'iPhone' }, locked: false }, { locale: 'zh', theme: 'dark' })
    expect(artifact.spec).not.toHaveProperty('panel')
    expect(artifact.spec).not.toHaveProperty('append')
    expect(parseGenuiArtifact(JSON.parse(serializeGenuiArtifact(artifact)))).toEqual(artifact)
  })

  it('removes password defaults and saved password fields throughout nested content', () => {
    const artifact = createGenuiArtifact({
      items: [{ type: 'tabs', tabs: [{ label: 'Account', items: [{ type: 'card', items: [
        { type: 'input', inputType: 'password', id: 'secret', value: 'DO_NOT_EXPORT' },
      ] }] }] }],
    } as unknown as GenuiSpec, { fields: { secret: 'DO_NOT_EXPORT', name: 'Ada' } })
    expect(serializeGenuiArtifact(artifact)).not.toContain('DO_NOT_EXPORT')
    expect(artifact.state?.fields).toEqual({ name: 'Ada' })
  })

  it('removes password values in every supported child collection', () => {
    const password = (id: string) => ({ type: 'input', inputType: 'password', id, value: `SECRET_${id}` })
    const artifact = createGenuiArtifact({ items: [
      { type: 'row', items: [password('row'), { type: 'col', items: [password('col')] }, { type: 'grid', items: [password('grid')] }, { type: 'card', items: [password('card')] }] },
      { type: 'list', items: [password('list')] },
      { type: 'tabs', tabs: [{ label: 'Tab', items: [password('tab')] }] },
      { type: 'accordion', items: [{ title: 'Details', items: [password('accordion')] }] },
      { type: 'table', columns: ['Details'], rows: [['row']], details: [[password('table')]] },
    ] } as unknown as GenuiSpec, { fields: Object.fromEntries(['row', 'col', 'grid', 'card', 'list', 'tab', 'accordion', 'table'].map(id => [id, `SECRET_${id}`])) })
    const serialized = serializeGenuiArtifact(artifact)
    for (const id of ['row', 'col', 'grid', 'card', 'list', 'tab', 'accordion', 'table']) expect(serialized).not.toContain(`SECRET_${id}`)
  })

  it('rejects unsupported component data while retaining supported model actions in JSON', () => {
    expect(() => createGenuiArtifact({ items: [{ type: 'weather', temp: 20 }] } as unknown as GenuiSpec)).toThrow('invalid GenUI spec')
    const artifact = createGenuiArtifact({ items: [{ type: 'button', label: 'Refresh', action: 'refresh' }] })
    expect(artifact.spec.items[0]).toMatchObject({ action: 'refresh' })
  })

  it('rejects invalid envelope values and sanitizes download names', () => {
    expect(parseGenuiArtifact({ format: 'dsh-genui', version: 2 })).toBeNull()
    expect(parseGenuiArtifact({ format: 'dsh-genui', version: 1, presentation: { locale: 'fr', theme: 'light' }, spec: { items: [] } })).toBeNull()
    expect(sanitizeArtifactFilename('  Sales:/ Report?  ', '.html')).toBe('Sales Report.html')
    expect(sanitizeArtifactFilename(undefined, '.genui.json')).toBe('genui.genui.json')
  })
})
