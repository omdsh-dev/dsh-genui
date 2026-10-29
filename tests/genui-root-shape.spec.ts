// Issue #172: two legal-JSON, common-model-intent fence bodies were rejected
// wholesale by the guard (silently, in the DOM channel).
//
//   A. `{type:'stat', items:[{label,value},…]}` — a stat group; repair wanted
//      `label`/`value` on the node itself, dropped the node, and the whole
//      fence degraded to a raw code block (the legal `callout` sibling was
//      rejected with it).
//   B. `{type:'steps', items:[{title,desc},…]}` — the documented bare
//      single-component root; `isGenuiSpec` read the step records as spec
//      children because they live under `items`.
import { describe, expect, it } from 'vitest'
import { isComponentRoot, isGenuiSpec, parseGenuiSpec, wrapSingleComponentRoot } from '../src/client/spec.ts'
import { normalizeGenuiSpec } from '../src/client/genui-runtime/normalize.ts'
import { countDeclaredGenuiNodes, isRenderableProcess, processGenuiSpec, repairGenuiSpec } from '../src/client/guard.ts'

/** Case A from the issue: a stat group plus a legal sibling node. */
const statGroupFence = {
  gap: 12,
  items: [
    { items: [{ label: '质量门进度', value: '1/5 施工中' }, { label: '阻塞项', value: '0' }], type: 'stat' },
    { content: '内容', title: '进度说明', tone: 'info', type: 'callout' },
  ],
  title: '进度快照',
}

/** Case B from the issue: a bare steps root whose data field is `items`. */
const bareStepsFence = {
  items: [
    { title: '第一层', desc: 'a' }, { title: '第二层', desc: 'b' }, { title: '第三层', desc: 'c' },
  ],
  title: '修复策略',
  type: 'steps',
}

describe('issue #172 case A: stat groups normalize into a row of stats', () => {
  it('renders the fence instead of rejecting it (callout sibling survives)', () => {
    const processed = processGenuiSpec(statGroupFence)
    expect(processed.errors).toEqual([])
    expect(isRenderableProcess(processed)).toBe(true)
    expect(processed.spec?.items.map(node => node.type)).toEqual(['row', 'callout'])
    expect(processed.spec?.title).toBe('进度快照')
    expect(processed.spec?.gap).toBe(12)
  })

  it('keeps every metric as its own stat node', () => {
    const processed = processGenuiSpec(statGroupFence)
    const row = processed.spec?.items[0] as { items: Array<Record<string, unknown>> }
    expect(row.items.map(metric => [metric.label, metric.value])).toEqual([
      ['质量门进度', '1/5 施工中'],
      ['阻塞项', '0'],
    ])
  })

  it('reports the structural alias as a warning, not an error', () => {
    const processed = processGenuiSpec(statGroupFence)
    expect(processed.warnings.map(warning => warning.message)).toContain('items[0].items normalized into a row of \'stat\' nodes')
  })

  it('is idempotent under repeated normalization and repair', () => {
    const once = processGenuiSpec(statGroupFence).normalized
    const twice = normalizeGenuiSpec(once).value
    expect(twice).toEqual(once)
    const repaired = repairGenuiSpec(statGroupFence)
    expect(repairGenuiSpec(repaired)).toEqual(repaired)
  })

  it('keeps the layout hint and per-metric fields', () => {
    const spec = repairGenuiSpec({ items: [
      { type: 'stat', span: 6, items: [
        { label: 'A', value: '1', delta: '+2', spark: [1, 2, 3] },
        { label: 'B', value: '2', size: 'hero' },
      ] },
    ] })
    const row = spec?.items[0] as { type: string; span?: number; items: Array<Record<string, unknown>> }
    expect(row.type).toBe('row')
    expect(row.span).toBe(6)
    expect(row.items[1]).toMatchObject({ type: 'stat', label: 'B', value: '2', size: 'hero' })
    expect(row.items[0]).toMatchObject({ delta: '+2', spark: [1, 2, 3] })
  })

  it('leaves a single stat with a stray items field to the normal repair path', () => {
    // `label`/`value` present ⇒ this is a single stat, not a metric list; the
    // alias must not silently rewrite it.
    const processed = processGenuiSpec({ items: [{ type: 'stat', label: 'L', value: '1', items: [{ label: 'x', value: 'y' }] }] })
    expect(processed.normalized).toEqual({ items: [{ type: 'stat', label: 'L', value: '1', items: [{ label: 'x', value: 'y' }] }] })
    expect(isRenderableProcess(processed)).toBe(true)
  })

  it('does not rewrite a stat whose items are not metrics', () => {
    const processed = processGenuiSpec({ items: [{ type: 'stat', items: [{ foo: 1 }] }] })
    expect(processed.normalized).toEqual({ items: [{ type: 'stat', items: [{ foo: 1 }] }] })
    expect(isRenderableProcess(processed)).toBe(false)
  })
})

describe('issue #172 case B: bare data-component roots', () => {
  it('parses a bare steps root whose data field is `items`', () => {
    const spec = parseGenuiSpec(JSON.stringify(bareStepsFence))
    expect(spec?.items).toHaveLength(1)
    expect(spec?.items[0]).toMatchObject({ type: 'steps' })
    // parseGenuiSpec returns the raw (un-normalized) node: the `items` → `steps`
    // alias is applied by the guard pipeline, not by the parser.
    expect((spec?.items[0] as { items: unknown[] }).items).toHaveLength(3)
    // The model's root `title` is a block title, not a steps field.
    expect(spec?.title).toBe('修复策略')
    expect((spec?.items[0] as { title?: unknown }).title).toBeUndefined()
  })

  it('renders the whole fence without errors', () => {
    const processed = processGenuiSpec(bareStepsFence)
    expect(processed.errors).toEqual([])
    expect(isRenderableProcess(processed)).toBe(true)
    const steps = processed.spec?.items[0] as { type: string; steps: Array<{ title: string }> }
    expect(steps.type).toBe('steps')
    expect(steps.steps.map(step => step.title)).toEqual(['第一层', '第二层', '第三层'])
  })

  it('counts the bare root as one declared node (no phantom drop)', () => {
    const processed = processGenuiSpec(bareStepsFence)
    expect(processed.declaredNativeCount).toBe(1)
    expect(processed.renderedNativeCount).toBe(1)
    expect(processed.errors.filter(error => error.startsWith('repair dropped'))).toEqual([])
  })

  it('renders bare container/data roots for every affected component', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ type: 'steps', items: [{ title: 'a' }, { title: 'b' }] }, 'steps'],
      [{ type: 'accordion', items: [{ title: 'a', items: [{ type: 'text', content: 'x' }] }] }, 'accordion'],
      [{ type: 'timeline', items: [{ title: 'a', desc: 'x' }] }, 'timeline'],
      [{ type: 'list', items: ['a', 'b'] }, 'list'],
      [{ type: 'file-tree', items: [{ name: 'src', type: 'dir' }] }, 'file-tree'],
      [{ type: 'breadcrumb', items: [{ label: 'a' }] }, 'breadcrumb'],
      [{ type: 'card', title: 'T', items: [{ type: 'text', content: 'x' }] }, 'card'],
      [{ type: 'col', items: [{ type: 'text', content: 'x' }] }, 'col'],
    ]
    for (const [body, type] of cases) {
      const processed = processGenuiSpec(body)
      expect(processed.errors, `${type}: ${JSON.stringify(processed.errors)}`).toEqual([])
      expect(isRenderableProcess(processed), type).toBe(true)
      expect(processed.spec?.items[0]?.type, type).toBe(type)
    }
  })

  it('wraps exactly once — a parsed bare root is not nested again by the guard', () => {
    const parsed = parseGenuiSpec(JSON.stringify({ type: 'callout', tone: 'info', title: 't', content: 'c' }))
    const processed = processGenuiSpec(parsed)
    expect(processed.errors).toEqual([])
    // One root item, and no `col` wrapper around it.
    expect(processed.spec?.items).toHaveLength(1)
    expect(processed.spec?.items[0]?.type).toBe('callout')
    expect(processed.spec?.items.some(node => node.type === 'col')).toBe(false)
  })

  it('still reads the explicit genui envelope marker as a spec', () => {
    const processed = processGenuiSpec({ type: 'genui', items: [{ type: 'text', content: 'x' }] })
    expect(processed.errors).toEqual([])
    expect(processed.spec?.items[0]?.type).toBe('text')
  })

  it('never wraps a spec root into a col node', () => {
    expect(wrapSingleComponentRoot({ type: 'steps', items: [{ title: 'a' }] })?.type).toBeUndefined()
    const wrapped = wrapSingleComponentRoot({ type: 'text', content: 'x' })
    expect(isGenuiSpec(wrapped)).toBe(true)
  })
})

describe('isComponentRoot: root-shape discrimination', () => {
  it('accepts component roots with and without an items data field', () => {
    expect(isComponentRoot({ type: 'callout', content: 'c' })).toBe(true)
    expect(isComponentRoot({ type: 'steps', items: [{ title: 'a' }] })).toBe(true)
    expect(isComponentRoot({ type: 'list', items: ['a'] })).toBe(true)
    expect(isComponentRoot({ type: 'col', items: [] })).toBe(true)
  })

  it('rejects envelope specs and non-component junk', () => {
    expect(isComponentRoot({ items: [] })).toBe(false)
    expect(isComponentRoot({ title: 't', items: [{ type: 'text', content: 'x' }] })).toBe(false)
    expect(isComponentRoot({ type: 'genui', items: [{ type: 'text', content: 'x' }] })).toBe(false)
    expect(isComponentRoot({ type: '', items: [] })).toBe(false)
    expect(isComponentRoot('nope')).toBe(false)
    expect(isComponentRoot(null)).toBe(false)
    expect(isComponentRoot({ type: 'widget', items: [{ label: 'a' }] })).toBe(true)
    expect(isComponentRoot({ type: 'stack', children: [], items: [] })).toBe(false)
  })

  it('isGenuiSpec answers false for a bare component root', () => {
    expect(isGenuiSpec({ items: [{ type: 'text', content: 'x' }] })).toBe(true)
    expect(isGenuiSpec({ type: 'steps', items: [{ title: 'a' }] })).toBe(false)
    expect(isGenuiSpec({ type: 'callout', content: 'c' })).toBe(false)
  })

  it('countDeclaredGenuiNodes counts a bare data-component root once', () => {
    expect(countDeclaredGenuiNodes({ type: 'steps', items: [{ title: 'a' }] })).toBe(1)
    expect(countDeclaredGenuiNodes({ items: [{ type: 'steps', steps: [{ title: 'a' }] }] })).toBe(1)
  })
})

describe('sibling sweep: `items` as the data field of a non-container component', () => {
  const cases: Array<[Record<string, unknown>, string, string]> = [
    [{ type: 'keyvalue', items: [{ key: 'a', value: 'b' }] }, 'pairs', 'keyvalue'],
    [{ type: 'diff', items: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] }, 'diffs', 'diff'],
    [{ type: 'select', items: ['a', 'b'] }, 'options', 'select'],
    [{ type: 'radio', items: ['a', 'b'] }, 'options', 'radio'],
    [{ type: 'quiz', question: 'q', items: ['a', 'b'] }, 'options', 'quiz'],
  ]
  for (const [body, field, type] of cases) {
    it(`${type}.items is adopted as ${type}.${field}`, () => {
      const processed = processGenuiSpec({ items: [body] })
      expect(processed.errors, JSON.stringify(processed.errors)).toEqual([])
      expect(isRenderableProcess(processed)).toBe(true)
      expect(processed.spec?.items[0]?.type).toBe(type)
      expect((processed.spec?.items[0] as Record<string, unknown>)[field]).toBeDefined()
    })
  }

  it('keeps the canonical field when both spellings are present', () => {
    const processed = processGenuiSpec({ items: [{ type: 'keyvalue', pairs: [{ key: 'a', value: 'b' }], items: [{ key: 'z', value: 'z' }] }] })
    expect(processed.errors).toEqual([])
    expect((processed.spec?.items[0] as { pairs: Array<{ key: string }> }).pairs).toEqual([{ key: 'a', value: 'b' }])
  })
})
