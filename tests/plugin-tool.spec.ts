// The render_ui tool definition: schema shape, execute behavior (guard-backed
// repair + caps), and the presentation projections (call/result cards + meta
// spec for the browser toolview).
import { describe, expect, it, vi } from 'vitest'
import { createRenderUiTool, createValidateDshUiTool } from '../src/plugin/tool.ts'
import { GENUI_LIMITS } from '../src/client/genui-runtime/index.ts'
import { processGenuiSpec } from '../src/client/guard.ts'

const tool = createRenderUiTool()

const text = (content: string) => ({ type: 'text', content })

describe('render_ui tool definition', () => {
  it('registers under the render_ui name with an open spec argument', () => {
    expect(tool.name).toBe('render_ui')
    expect(typeof tool.description).toBe('string')
    expect(tool.description.length).toBeGreaterThan(50)
    const parameters = tool.parameters as { required?: string[]; properties?: Record<string, unknown> }
    expect(parameters.required).toContain('spec')
    const spec = parameters.properties?.spec as { type?: string } | undefined
    expect(spec).toBeDefined()
    // spec must be schema-typed as an object: a serialized JSON string (the
    // model's observed failure mode) fails argument validation early instead
    // of reaching the guard, which could not repair it anyway.
    expect(spec!.type).toBe('object')
    // The spec object carries structural hints for the tool-call bridge so it
    // can serialize the tree directly instead of falling back to an
    // OpenAI-style { arguments: "<JSON>" } wrapper (observed in the live
    // harness bridge for bare-object parameters).
    const specProps = (spec as { properties?: Record<string, unknown> }).properties
    expect(specProps).toBeDefined()
    for (const key of ['title', 'gap', 'panel', 'items']) {
      expect(specProps![key]).toBeDefined()
    }
  })

  it('declares a string output schema and a render projection', () => {
    const schema = tool.output.schema as { type?: string }
    expect(schema.type).toBe('string')
    const blocks = tool.output.render({ spec: {} }, 'ok')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('text')
  })
})

describe('render_ui execute', () => {
  it('returns a render summary for a valid spec', async () => {
    const value = await tool.execute({ spec: { title: '监控面板', items: [text('a'), { type: 'stat', label: 'CPU', value: '42%' }] } })
    expect(String(value)).toContain('监控面板')
    expect(String(value)).toContain('rendered=2')
    expect(String(value)).toContain('reply_language=conversation')
  })

  it('repairs oversized specs before summarizing (caps apply)', async () => {
    const value = await tool.execute({ spec: { items: Array.from({ length: 500 }, (_, i) => text(`n${i}`)) } })
    expect(String(value)).toContain(`rendered=${GENUI_LIMITS.maxNodes}`)
  })

  it('returns a corrective message for an unusable spec', async () => {
    const value = await tool.execute({ spec: 'not a tree' })
    expect(String(value)).toContain('error=invalid_spec')
  })

  it('unwraps bridge-wrapped spec shapes (transport compatibility)', async () => {
    const spec = { title: '桥接兼容', items: [text('a')] }
    // Observed live: the bridge nests the authored `spec` object inside a
    // wrapper — the serialized text carried by { arguments: "..." } is itself
    // `{ spec: { title, gap, items } }` — so test both with and without the
    // inner `spec` key at every wrapper level.
    const nested = { spec }
    const expectOk = async (args: unknown) => {
      const value = await tool.execute(args as never)
      expect(String(value)).toContain('桥接兼容')
    }
    // Authored shape
    await expectOk({ spec })
    // Spec serialized to text
    await expectOk({ spec: JSON.stringify(spec) })
    await expectOk({ spec: JSON.stringify(nested) })
    // {arguments} wrapper with a serialized or object spec
    await expectOk({ arguments: JSON.stringify(spec) })
    await expectOk({ arguments: JSON.stringify(nested) })
    await expectOk({ arguments: spec })
    await expectOk({ arguments: nested })
    // Bare double-encoded strings
    await expectOk(JSON.stringify(spec))
    await expectOk(JSON.stringify(nested))
  })

  it('reports broken wrapped JSON as unusable instead of misparsing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // Corrupted mid-stream JSON (observed with large specs): the bridge
      // passed the raw broken text through; it must not crash and must not
      // pretend the spec is valid.
      const value = await tool.execute({ arguments: '{"spec": {"items": [' } as never)
      expect(String(value)).toContain('error=invalid_spec')
      expect(spy).toHaveBeenCalledOnce()
      expect(String(spy.mock.calls[0]![0])).toContain('[genui-tool] spec wrapped as arguments-string')
    } finally {
      spy.mockRestore()
    }
  })

  it('rejects chart aliases and invalid data instead of silently rendering bars', async () => {
    await expect(tool.execute({
      spec: {
        items: [{
          type: 'chart',
          variant: 'line',
          data: [{ label: 1, value: '128' }],
        }],
      },
    })).rejects.toThrow(
      'items[0].variant is unsupported; use kind; items[0].data[0].label must be a string; items[0].data[0].value must be a finite number',
    )
  })

  it('accepts multi-series line charts (v3) and rejects donut series', async () => {
    const rendered = String(await tool.execute({
      spec: {
        items: [{
          type: 'chart',
          kind: 'line',
          series: [
            { label: '本月', data: [{ label: '周一', value: 128 }] },
            { label: '上月', data: [{ label: '周一', value: 96 }] },
          ],
        }],
      },
    }))
    expect(rendered).toContain('status=rendered')
    await expect(tool.execute({
      spec: {
        items: [{ type: 'chart', kind: 'donut', series: [{ label: 'A', data: [{ label: 'X', value: 1 }] }] }],
      },
    })).rejects.toThrow('items[0].series is only supported for bars and line')
  })

  it('does not green-light a dropped native image beside an opaque custom node', async () => {
    const spec = { items: [{ type: 'image' }, { type: 'custom-widget', payload: { owner: 'plugin' } }] }
    await expect(tool.execute({ spec })).rejects.toThrow('repair dropped')

    const value = String(await createValidateDshUiTool().execute({ spec }))
    expect(value).toContain('status=invalid')
    expect(value).not.toContain('status=valid')
  })

  it('includes native-field warnings in a successful render summary', async () => {
    const value = String(await tool.execute({ spec: { items: [{ type: 'text', content: '好', extension: true }] } }))
    expect(value).toContain('status=rendered')
    expect(value).toContain('items[0].extension')
    expect(value).toContain('unknown field')
  })

  it('distinguishes an ignored canonical alias in model-facing warnings', async () => {
    const value = String(await tool.execute({
      spec: { items: [{ type: 'text', text: 'legacy', content: 'canonical' }] },
    }))
    expect(value).toContain('warning=alias_ignored')
    expect(value).toContain('canonical=items[0].content')
  })
})

describe('render_ui projections', () => {
  it('projects the repaired spec into result meta for the toolview', () => {
    const meta = tool.output.presentationMeta!({ spec: { items: [text('x'), { type: 'progress', value: 80 }] } })
    const spec = meta as { items: Array<{ type: string }> }
    expect(spec.items).toHaveLength(2)
    expect((spec.items[1] as { value: number }).value).toBe(80)
  })

  it('does not project an invalid repaired spec into result meta', () => {
    expect(tool.output.presentationMeta!({ spec: { items: [{ type: 'progress', value: 150 }] } })).toBeNull()
  })

  it('presents pending and completed cards with the spec title', () => {
    const args = { spec: { title: '订单', items: [text('a')] } }
    const call = tool.presentCall!(args)
    expect(call).not.toBeUndefined()
    expect(call!.card).toBe('generic')
    expect((call as { title: string }).title).toContain('订单')
    const result = tool.presentResult!(args, { isError: false } as never)
    expect(result).not.toBeUndefined()
    expect((result as { title: string }).title).toContain('订单')
  })

  it('falls back to generic presentation for invalid args (replay safety)', () => {
    expect(tool.presentCall!({ spec: 42 })).toBeUndefined()
    expect(tool.presentResult!({ spec: null }, { isError: false } as never)).toBeUndefined()
  })
})


describe('validate_dsh_ui tool', () => {
  const vtool = createValidateDshUiTool()

  it('registers under the validate_dsh_ui name with a spec argument', () => {
    expect(vtool.name).toBe('validate_dsh_ui')
    expect(vtool.description).toContain('dsh-ui fence')
    const parameters = vtool.parameters as { required?: string[] }
    expect(parameters.required).toContain('spec')
  })

  it('approves a valid fence body (string or object)', async () => {
    const good = '{"title":"x","items":[{"type":"text","content":"好"}]}'
    expect(String(await vtool.execute({ spec: good }))).toContain('status=valid')
    expect(String(await vtool.execute({ spec: JSON.parse(good) }))).toContain('status=valid')
    expect(String(await vtool.execute(good))).toContain('status=valid')
  })

  it('warns when declared components were silently dropped (issue #42)', async () => {
    // The table has no recognizable rows/columns at all: repair drops it and
    // the tool must not green-light a half-empty tree.
    const dropping = '{"items":[{"type":"table","columns":{},"rows":42},{"type":"text","content":"好"}]}'
    const value = String(await vtool.execute({ spec: dropping }))
    expect(value).toContain('status=invalid')
    expect(value).toContain('declared=2')
    expect(value).toContain('rendered=1')
    // #163 follow-up: the dropped node is named with its position and type
    // instead of only the aggregate count.
    expect(value).toContain('node=items[0]')
    expect(value).toContain('type=table')
  })

  it.each([
    // Real-session samples (2 sessions, 62 fences): the model names the field
    // by intent and the alias registry adopts it. Asserting the whole
    // validate verdict — not just the warning — pins the load-bearing claim:
    // these bodies now RENDER, so the fence cannot degrade to raw JSON.
    [{ type: 'keyvalue', items: [{ key: 'a', value: 'b' }] }, { type: 'keyvalue', pairs: [{ key: 'a', value: 'b' }] }],
    [{ type: 'callout', text: 'hello' }, { type: 'callout', content: 'hello' }],
    [{ type: 'callout', body: 'hello' }, { type: 'callout', content: 'hello' }],
    [{ type: 'code', content: 'x = 1' }, { type: 'code', code: 'x = 1' }],
    [{ type: 'copy', content: 'x = 1' }, { type: 'copy', text: 'x = 1' }],
    [{ type: 'image', url: 'https://example.com/a.png' }, { type: 'image', src: 'https://example.com/a.png' }],
  ])('adopts the model field name for %j instead of dropping the node', async (node, canonical) => {
    const value = String(await vtool.execute({ spec: { items: [node] } }))
    expect(value).toContain('status=valid')
    expect(value).toContain('warning=alias_normalized')
    expect(value).toContain('next=emit_fence')
    expect(processGenuiSpec({ items: [node] }).repaired?.items).toEqual([canonical])
  })

  it('adopts quiz title/choices and still grades against string options', async () => {
    const node = { type: 'quiz', title: '问题', choices: ['甲', '乙'] }
    const value = String(await vtool.execute({ spec: { items: [node] } }))
    expect(value).toContain('status=valid')
    // quiz repair canonicalizes options into `{label}` records (correctness
    // lives per option), so the claim under test is the adopted field names.
    expect(processGenuiSpec({ items: [node] }).repaired?.items).toEqual([
      { type: 'quiz', question: '问题', options: [{ label: '甲' }, { label: '乙' }] },
    ])
  })

  it('drops malformed tables but explains the columns/rows contract', async () => {
    // Filtering still matters: a non-2D body is not a table we can rescue.
    const value = String(await vtool.execute({ spec: '{"items":[{"type":"table","rows":42}]}' }))
    expect(value).toContain('status=invalid')
    expect(value).toContain("items[0]: type 'table' requires rows (array)")
  })

  it.each([
    [{ type: 'keyvalue', pairs: 'k=v' }, 'items[0]: type \'keyvalue\' requires pairs (array)'],
    [{ type: 'diff', items: [{ text: 'x' }] }, 'items[0].diffs[0]: requires path (a string)'],
    [{ type: 'table', columns: {}, rows: 42 }, "items[0]: type 'table' requires columns (array)"],
  ])('keeps field errors when invalid components are dropped: %j', async (node, field) => {
    const value = String(await vtool.execute({ spec: { items: [node] } }))
    expect(value).toContain('status=invalid')
    expect(value).toContain(field)
  })

  it('reports native drop counts without counting opaque custom nodes', async () => {
    const value = String(await vtool.execute({ spec: {
      items: [{ type: 'image', src: 'javascript:blocked' }, { type: 'custom-widget' }],
    } }))
    expect(value).toContain('declared=1')
    expect(value).toContain('rendered=0')
    expect(value).toContain('dropped=1')
  })

  it('names each dropped node, its type, what it wrote, and what is missing', async () => {
    // A healthy sibling must NOT be reported as dropped, and the dropped node
    // must be named with the field it actually wrote — the aggregate count
    // alone left the model guessing which component was broken.
    const value = String(await vtool.execute({ spec: {
      items: [{ type: 'callout', title: '只有标题' }, { type: 'text', content: '好' }],
    } }))
    expect(value).toContain('[genui-validation]')
    expect(value).toContain('next=fix_and_revalidate')
    expect(value).toContain('node=items[0]')
    expect(value).toContain('type=callout')
    expect(value).toContain('error=missing_required_field')
    expect(value).toContain('field=content')
    expect(value).toContain('written=title')
    expect(value).toContain('reply_language=conversation')
    expect(value).not.toContain('验证未通过')
    expect(value).not.toContain('请修正')
    expect(value).not.toContain('node=items[1]')

    // A node nested in a container keeps its full path.
    const nested = String(await vtool.execute({ spec: {
      items: [{ type: 'grid', cols: 2, items: [{ type: 'table', rows: 42 }] }],
    } }))
    expect(nested).toContain('node=items[0].items[0]')
    expect(nested).toContain('type=table')
    expect(nested).toContain('field=columns')
  })

  it('reports the chart kind contract and field-level data errors', async () => {
    const value = String(await vtool.execute({
      spec: {
        items: [{
          type: 'chart',
          variant: 'line',
          kind: 'area',
          data: [{ label: 1, value: Number.NaN }],
        }],
      },
    }))
    expect(value).toContain('error=invalid_chart_fields')
    expect(value).toContain('items[0].variant is unsupported; use kind')
    expect(value).toContain('items[0].kind must be bars, line, or donut')
    expect(value).toContain('items[0].data[0].label must be a string')
    expect(value).toContain('items[0].data[0].value must be a finite number')
  })

  it('rejects line/donut series and empty chart collections before rendering', async () => {
    // v3: line charts accept series; donut does not.
    const line = String(await vtool.execute({
      spec: {
        items: [{
          type: 'chart',
          kind: 'line',
          series: [{ label: 'A', data: [{ label: '周一', value: 128 }] }],
        }],
      },
    }))
    expect(line).toContain('status=valid')
    const donut = String(await vtool.execute({
      spec: {
        items: [{ type: 'chart', kind: 'donut', series: [{ label: 'A', data: [{ label: 'X', value: 1 }] }] }],
      },
    }))
    expect(donut).toContain('items[0].series is only supported for bars and line')

    const empty = String(await vtool.execute({
      spec: {
        items: [{
          type: 'chart',
          data: [],
          series: [{ label: 'A', data: [] }],
        }],
      },
    }))
    // `data: []` is legal for grouped bars (points live in series), so only
    // the truly empty series is reported — the chart is still rejected.
    expect(empty).toContain('items[0].series[0].data must not be empty')
    expect(empty).not.toContain('items[0].data must not be empty')

    const emptyPlain = String(await vtool.execute({
      spec: { items: [{ type: 'chart', data: [] }] },
    }))
    expect(emptyPlain).toContain('items[0].data must not be empty')

    const emptySeries = String(await vtool.execute({
      spec: { items: [{ type: 'chart', series: [] }] },
    }))
    expect(emptySeries).toContain('items[0].series must not be empty')
  })

  it('keeps chart field validation after repairing fence JSON syntax', async () => {
    const value = String(await vtool.execute({
      spec: '{"items":[{"type":"chart","variant":"line","data":[{"label":"周一","value":128}],}],}',
    }))
    expect(value).toContain('error=invalid_chart_fields')
    expect(value).toContain('items[0].variant is unsupported; use kind')
    expect(value).not.toContain('next=emit_repaired_fence')
  })

  it('allows unknown chart extension fields but native repair ignores them', async () => {
    const raw = {
      items: [{
        type: 'chart',
        kind: 'line',
        data: [{ label: '周一', value: 128, extension: true }],
        extension: { owner: 'another-plugin' },
      }],
    }
    const value = String(await vtool.execute({ spec: raw }))
    expect(value).toContain('status=valid')
    const meta = tool.output.presentationMeta!({ spec: raw }) as {
      items: Array<Record<string, unknown> & { data?: Array<Record<string, unknown>> }>
    }
    expect(meta.items[0]).not.toHaveProperty('extension')
    expect(meta.items[0]!.data?.[0]).not.toHaveProperty('extension')
  })

  it('stays green when object-shaped tables heal instead of dropping', async () => {
    const healed = '{"items":[{"type":"table","columns":[{"title":"a","key":"k"}],"data":[{"k":"v"}]}]}'
    const value = String(await vtool.execute({ spec: healed }))
    expect(value).toContain('status=valid')
  })

  it('does not mistake file-tree children for dropped components', async () => {
    const tree = '{"items":[{"type":"file-tree","items":[{"name":"src","type":"dir","children":[{"name":"a.ts","type":"file"}]}]}]}'
    const value = String(await vtool.execute({ spec: tree }))
    expect(value).toContain('status=valid')
  })

  it('reports parse failures with position and bracket counts', async () => {
    // The real-world failure: rows-array `]` emitted as `}` (stray closer).
    const bad = '{"title":"x","items":[{"type":"table","columns":["a"],"rows":[["1"]}]}]}]}'
    const value = String(await vtool.execute({ spec: bad }))
    expect(value).toContain('status=invalid')
    expect(value).toContain('error=invalid_json')
    // Bracket-count diagnostic points at the stray `}`.
    expect(value).toContain('brackets_open=')
    expect(value).toContain('braces_close=')
    // Repairable: the reply hands the model the fixed JSON instead of
    // asking it to re-author the fix by hand.
    expect(value).toContain('repair=applied')
    const match = /```\n([\s\S]*)\n```/.exec(value)
    expect(match).not.toBeNull()
    expect(() => JSON.parse(match![1]!)).not.toThrow()
  })

  it('rejects JSON that parses but is not a GenUI spec', async () => {
    const value = String(await vtool.execute({ spec: '{"a":1}' }))
    expect(value).toContain('status=invalid')
    expect(value).toContain('items')
  })

  it('rejects a missing spec argument', async () => {
    const value = String(await vtool.execute({}))
    expect(value).toContain('status=invalid')
    expect(value).toContain('error=missing_spec')
  })

  it('reports MISSING closers in the right direction (缺 not 多)', async () => {
    const value = String(await vtool.execute({ spec: '{"items": [{"type": "text"' }))
    expect(value).toContain('brace_delta=2')
    expect(value).toContain('brace_action=add:2')
  })

  it('reports EXTRA closers in the right direction (多 not 缺)', async () => {
    const value = String(await vtool.execute({ spec: '{"items": []}}' }))
    expect(value).toContain('brace_delta=-1')
    expect(value).toContain('brace_action=remove:1')
  })

  it('counts nodes inside tabs like the panel fold does', async () => {
    const spec = {
      items: [{ type: 'tabs', tabs: [
        { label: 'A', items: [text('a1'), text('a2')] },
        { label: 'B', items: [text('b1')] },
      ] }],
    }
    // 1 tabs node + 3 inner nodes = 4 (the old local counter said 1).
    const value = String(await tool.execute({ spec }))
    expect(value).toContain('rendered=4')
    const vv = String(await vtool.execute({ spec: JSON.stringify(spec) }))
    expect(vv).toContain('rendered=4')
  })

  it('returns the AUTO-REPAIRED JSON when the body is repairable', async () => {
    // trailing comma + missing closing brackets — tier-1/tier-2 heal it.
    const bad = '{"items":[{"type":"text","content":"你好"},],'
    const value = String(await vtool.execute({ spec: bad }))
    expect(value).toContain('repair=applied')
    expect(value).toContain('next=emit_repaired_fence')
    // the repaired body appears verbatim and parses
    const match = /```\n([\s\S]*)\n```/.exec(value)
    expect(match).not.toBeNull()
    const repaired = match![1]!
    expect(() => JSON.parse(repaired)).not.toThrow()
    expect(repaired).toContain('"content":"你好"')
    expect(repaired).not.toMatch(/,\]/)
  })

  it('keeps process warnings when repaired JSON becomes valid', async () => {
    const value = String(await vtool.execute({
      spec: '{"items":[{"type":"text","text":"legacy","content":"canonical","extension":true},],}',
    }))
    expect(value).toContain('repair=applied')
    expect(value).toContain('items[0].text')
    expect(value).toContain('warning=alias_ignored')
    expect(value).toContain('items[0].extension')
  })

  it('keeps the diagnostics-only reply when the body cannot be repaired', async () => {
    const value = String(await vtool.execute({ spec: '{"items": [{"type": "tex' }))
    // repairable in theory, but the result is not a valid spec (missing content) — wait:
    // this one IS completable but the spec has no valid nodes; assert the no-auto-repair path:
    const bad = '{"title": "x", garbage'
    const v2 = String(await vtool.execute({ spec: bad }))
    expect(v2).toContain('repair=failed')
  })
})
