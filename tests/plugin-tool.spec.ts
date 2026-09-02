// The render_ui tool definition: schema shape, execute behavior (guard-backed
// repair + caps), and the presentation projections (call/result cards + meta
// spec for the browser toolview).
import { describe, expect, it, vi } from 'vitest'
import { createRenderUiTool, createValidateDshUiTool } from '../src/plugin/tool.ts'
import { GENUI_LIMITS } from '../src/client/guard.ts'

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
    expect(String(value)).toContain('2 个组件')
  })

  it('repairs oversized specs before summarizing (caps apply)', async () => {
    const value = await tool.execute({ spec: { items: Array.from({ length: 500 }, (_, i) => text(`n${i}`)) } })
    expect(String(value)).toContain(`${GENUI_LIMITS.maxNodes} 个组件`)
  })

  it('returns a corrective message for an unusable spec', async () => {
    const value = await tool.execute({ spec: 'not a tree' })
    expect(String(value)).toContain('spec 无效')
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
      expect(String(value)).toContain('spec 无效')
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

  it('rejects series-only line charts instead of rendering an empty plot', async () => {
    await expect(tool.execute({
      spec: {
        items: [{
          type: 'chart',
          kind: 'line',
          series: [{ label: 'A', data: [{ label: '周一', value: 128 }] }],
        }],
      },
    })).rejects.toThrow(
      'items[0].series is only supported for bars; items[0].data is required for line',
    )
  })
})

describe('render_ui projections', () => {
  it('projects the repaired spec into result meta for the toolview', () => {
    const meta = tool.output.presentationMeta!({ spec: { items: [text('x'), { type: 'progress', value: 150 }] } })
    const spec = meta as { items: Array<{ type: string }> }
    expect(spec.items).toHaveLength(2)
    expect((spec.items[1] as { value: number }).value).toBe(100) // clamped
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
    expect(String(await vtool.execute({ spec: good }))).toContain('✅')
    expect(String(await vtool.execute({ spec: JSON.parse(good) }))).toContain('✅')
    expect(String(await vtool.execute(good))).toContain('✅')
  })

  it('warns when declared components were silently dropped (issue #42)', async () => {
    // The table has no recognizable rows/columns at all: repair drops it and
    // the tool must not green-light a half-empty tree.
    const dropping = '{"items":[{"type":"table","columns":{},"rows":42},{"type":"text","content":"好"}]}'
    const value = String(await vtool.execute({ spec: dropping }))
    expect(value).toContain('❌')
    expect(value).toContain('声明了 2 个组件')
    expect(value).toContain('仅成功解析出 1 个')
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
    expect(value).toContain('❌ chart 字段验证失败')
    expect(value).toContain('items[0].variant is unsupported; use kind')
    expect(value).toContain('items[0].kind must be bars, line, or donut')
    expect(value).toContain('items[0].data[0].label must be a string')
    expect(value).toContain('items[0].data[0].value must be a finite number')
  })

  it('rejects line/donut series and empty chart collections before rendering', async () => {
    const line = String(await vtool.execute({
      spec: {
        items: [{
          type: 'chart',
          kind: 'line',
          series: [{ label: 'A', data: [{ label: '周一', value: 128 }] }],
        }],
      },
    }))
    expect(line).toContain('items[0].series is only supported for bars')
    expect(line).toContain('items[0].data is required for line')

    const empty = String(await vtool.execute({
      spec: {
        items: [{
          type: 'chart',
          data: [],
          series: [{ label: 'A', data: [] }],
        }],
      },
    }))
    expect(empty).toContain('items[0].data must not be empty')
    expect(empty).toContain('items[0].series[0].data must not be empty')

    const emptySeries = String(await vtool.execute({
      spec: { items: [{ type: 'chart', series: [] }] },
    }))
    expect(emptySeries).toContain('items[0].series must not be empty')
  })

  it('keeps chart field validation after repairing fence JSON syntax', async () => {
    const value = String(await vtool.execute({
      spec: '{"items":[{"type":"chart","variant":"line","data":[{"label":"周一","value":128}],}],}',
    }))
    expect(value).toContain('❌ chart 字段验证失败')
    expect(value).toContain('items[0].variant is unsupported; use kind')
    expect(value).not.toContain('无需再验证')
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
    expect(value).toContain('✅')
    const meta = tool.output.presentationMeta!({ spec: raw }) as {
      items: Array<Record<string, unknown> & { data?: Array<Record<string, unknown>> }>
    }
    expect(meta.items[0]).not.toHaveProperty('extension')
    expect(meta.items[0]!.data?.[0]).not.toHaveProperty('extension')
  })

  it('stays green when object-shaped tables heal instead of dropping', async () => {
    const healed = '{"items":[{"type":"table","columns":[{"title":"a","key":"k"}],"data":[{"k":"v"}]}]}'
    const value = String(await vtool.execute({ spec: healed }))
    expect(value).toContain('✅')
  })

  it('does not mistake file-tree children for dropped components', async () => {
    const tree = '{"items":[{"type":"file-tree","items":[{"name":"src","type":"dir","children":[{"name":"a.ts","type":"file"}]}]}]}'
    const value = String(await vtool.execute({ spec: tree }))
    expect(value).toContain('✅')
  })

  it('reports parse failures with position and bracket counts', async () => {
    // The real-world failure: rows-array `]` emitted as `}` (stray closer).
    const bad = '{"title":"x","items":[{"type":"table","columns":["a"],"rows":[["1"]}]}]}]}'
    const value = String(await vtool.execute({ spec: bad }))
    expect(value).toContain('❌')
    expect(value).toContain('解析失败')
    // Bracket-count diagnostic points at the stray `}`.
    expect(value).toContain('括号计数')
    expect(value).toContain(']}')
    // Repairable: the reply hands the model the fixed JSON instead of
    // asking it to re-author the fix by hand.
    expect(value).toContain('已自动修复')
    const match = /```\n([\s\S]*)\n```/.exec(value)
    expect(match).not.toBeNull()
    expect(() => JSON.parse(match![1]!)).not.toThrow()
  })

  it('rejects JSON that parses but is not a GenUI spec', async () => {
    const value = String(await vtool.execute({ spec: '{"a":1}' }))
    expect(value).toContain('❌')
    expect(value).toContain('items')
  })

  it('rejects a missing spec argument', async () => {
    const value = String(await vtool.execute({}))
    expect(value).toContain('❌')
    expect(value).toContain('缺少 spec')
  })

  it('reports MISSING closers in the right direction (缺 not 多)', async () => {
    const value = String(await vtool.execute({ spec: '{"items": [{"type": "text"' }))
    expect(value).toContain('缺')
    // exactly two unclosed braces: {×2 vs }×0
    expect(value).toContain('缺 2 个 }')
  })

  it('reports EXTRA closers in the right direction (多 not 缺)', async () => {
    const value = String(await vtool.execute({ spec: '{"items": []}}' }))
    expect(value).toContain('多 1 个 }')
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
    expect(value).toContain('4 个组件')
    const vv = String(await vtool.execute({ spec: JSON.stringify(spec) }))
    expect(vv).toContain('4 个组件')
  })

  it('returns the AUTO-REPAIRED JSON when the body is repairable', async () => {
    // trailing comma + missing closing brackets — tier-1/tier-2 heal it.
    const bad = '{"items":[{"type":"text","content":"你好"},],'
    const value = String(await vtool.execute({ spec: bad }))
    expect(value).toContain('已自动修复')
    expect(value).toContain('直接作为围栏正文发出即可')
    // the repaired body appears verbatim and parses
    const match = /```\n([\s\S]*)\n```/.exec(value)
    expect(match).not.toBeNull()
    const repaired = match![1]!
    expect(() => JSON.parse(repaired)).not.toThrow()
    expect(repaired).toContain('"content":"你好"')
    expect(repaired).not.toMatch(/,\]/)
  })

  it('keeps the diagnostics-only reply when the body cannot be repaired', async () => {
    const value = String(await vtool.execute({ spec: '{"items": [{"type": "tex' }))
    // repairable in theory, but the result is not a valid spec (missing content) — wait:
    // this one IS completable but the spec has no valid nodes; assert the no-auto-repair path:
    const bad = '{"title": "x", garbage'
    const v2 = String(await vtool.execute({ spec: bad }))
    expect(v2).toContain('自动修复未能恢复')
  })
})
