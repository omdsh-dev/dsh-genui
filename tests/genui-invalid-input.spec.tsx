import { afterEach, describe, expect, it } from 'vitest'
import { isRenderableProcess, processGenuiSpec, repairGenuiSpec } from '../src/client/guard.ts'
import { createRenderUiTool, createValidateDshUiTool } from '../src/plugin/tool.ts'
import { applyPanelOperation, clearSessionPanel, getPanelOperationError, getPanelSpec, getPanelStateKey, setLocalPanel } from '../src/client/panel-store.ts'
import type { GenuiSpec } from '../src/client/spec.ts'
import { cleanup, render } from '@testing-library/react'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { evaluateComputed } from '../src/client/computed.ts'
import { resolveFence } from '../src/shared/fence-resolve.ts'
import { GenuiToolView } from '../src/client/toolview.tsx'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'

const session = 'invalid-input-390'
const good: GenuiSpec = { items: [{ type: 'text', content: 'Keep this' }] }
const missingItems = { items: [{ type: 'tabs', tabs: [{ label: 'A' }] }] }
const storageKey = 'dsh.genui.panel'
const operation = (spec: unknown, seq: number, mode: 'replace' | 'append' = 'replace') => ({
  sourceId: String(seq), order: [seq, 0, 0] as const, mode, spec: spec as GenuiSpec,
})
function restore(entry: Record<string, unknown>) {
  clearSessionPanel(session)
  localStorage.setItem(storageKey, JSON.stringify({ order: [session, 'other'], sessions: {
    [session]: { local: null, localBarrier: -1, maxSeenSeq: 1, ...entry },
    other: { snapshot: good, local: null, localBarrier: -1, maxSeenSeq: 10 },
  } }))
}
afterEach(() => { cleanup(); clearSessionPanel(session); localStorage.clear() })

describe('invalid GenUI input (#390)', () => {
  it('shows a visible unsupported-type message even for direct renderer callers', () => {
    const view = render(<GenuiBlock spec={{ items: [{ type: 'Card' }] } as unknown as GenuiSpec} />)
    expect(view.getByRole('alert').textContent).toContain('Card')
  })

  it('normalizes documented card/grid aliases and warns instead of losing content', () => {
    const result = processGenuiSpec({ items: [{ type: 'grid', columns: 2, items: [
      { type: 'card', body: [{ type: 'text', content: 'Body' }] },
    ] }] })
    expect(result.errors).toEqual([])
    expect(result.spec?.items).toEqual([{ type: 'grid', cols: 2, items: [{ type: 'card', items: [{ type: 'text', content: 'Body' }] }] }])
    expect(result.warnings.filter(w => w.kind === 'alias').map(w => w.field)).toEqual(['columns', 'body'])
  })
  it.each(['Card', 'Text', 'custom-widget', 'constructor', '__proto__', 'toString'])('rejects unsupported type %s without throwing or reporting a rendered node', async type => {
    const spec = { items: [{ type, title: 't', items: [{ type: 'Text', content: 'x' }] }] }
    const processed = processGenuiSpec(spec)
    expect(isRenderableProcess(processed)).toBe(false)
    expect(processed.renderedCount).toBe(0)
    expect(processed.errors.join(' ')).toContain(`unknown type '${type}'`)
    const validation = String(await createValidateDshUiTool().execute({ spec }))
    expect(validation).toContain('status=invalid')
    expect(validation).not.toContain('next=emit_fence')
    await expect(createRenderUiTool().execute({ spec })).rejects.toThrow()
  })

  it.each(['Card', 'Tabs', 'custom-widget', 'constructor', '__proto__'])('rejects bare unsupported root %s even when it has valid children', async type => {
    const spec = { type, items: [{ type: 'text', content: 'child' }] }
    const result = processGenuiSpec(spec)
    expect(isRenderableProcess(result)).toBe(false)
    expect(result.errors.join(' ')).toContain(`unknown type '${type}'`)
    expect(resolveFence(JSON.stringify(spec), { settled: true }).spec).toBeNull()
    expect(String(await createValidateDshUiTool().execute({ spec }))).toContain('status=invalid')
  })

  it('distinguishes missing tab items from an explicit empty array and a supported alias', async () => {
    expect(processGenuiSpec(missingItems).errors.join(' ')).toContain('items')
    expect(isRenderableProcess(processGenuiSpec(missingItems))).toBe(false)
    expect(String(await createValidateDshUiTool().execute({ spec: missingItems }))).toContain('status=invalid')
    await expect(createRenderUiTool().execute({ spec: missingItems })).rejects.toThrow()
    expect(isRenderableProcess(processGenuiSpec({ items: [{ type: 'tabs', tabs: [{ label: 'A', items: [] }] }] }))).toBe(true)
    expect(processGenuiSpec({ items: [{ type: 'tabs', tabs: [{ label: 'A', content: { type: 'text', content: 'x' } }] }] }).errors).toEqual([])
  })

  it('drops unsupported nodes from repair without losing valid siblings', () => {
    expect(repairGenuiSpec({ items: [{ type: 'Card' }, ...good.items] })?.items).toEqual(good.items)
  })

  it.each(['replace', 'append'] as const)('rejects a malformed %s without poisoning the valid panel or its persisted snapshot', mode => {
    applyPanelOperation(session, operation(good, 1))
    const stateKey = getPanelStateKey(session)
    expect(applyPanelOperation(session, operation(missingItems, 2, mode))).toBe('invalid')
    expect(getPanelOperationError(session, '2')).toBeTruthy()
    expect(getPanelSpec(session)).toEqual(good)
    expect(getPanelStateKey(session)).toBe(stateKey)
    expect(JSON.parse(localStorage.getItem(storageKey)!).sessions[session].snapshot).toEqual(good)
    clearSessionPanel(session)
    expect(getPanelSpec(session)).toEqual(good)
    expect(applyPanelOperation(session, operation({ items: [{ type: 'text', content: 'Next' }] }, 3, 'append'))).toBe('accepted')
    expect(getPanelSpec(session)?.items).toHaveLength(2)
  })

  it('normalizes accepted panel data before saving it', () => {
    expect(applyPanelOperation(session, operation({ items: [{ type: 'text', text: 'Alias' }] }, 1))).toBe('accepted')
    expect(getPanelSpec(session)?.items).toEqual([{ type: 'text', content: 'Alias' }])
  })

  it('rejects a malformed local override without replacing the current panel', () => {
    setLocalPanel(session, good)
    setLocalPanel(session, missingItems as unknown as GenuiSpec)
    expect(getPanelSpec(session)).toEqual(good)
  })

  it('does not republish invalid metadata from an old tool result', () => {
    applyPanelOperation(session, operation(good, 1))
    const props = { toolName: 'render_ui', sessionId: session, block: {
      kind: 'tool-result', seq: 2, callId: 'old-invalid-tool', meta: missingItems,
    } } as unknown as ToolCallViewProps
    const view = render(<GenuiToolView {...props} />)
    expect(getPanelSpec(session)).toEqual(good)
    expect(view.container.textContent).toContain('render_ui')
    expect(view.container.querySelector('[data-genui]')).toBeNull()
  })

  it('preserves a valid local override when a corrupt saved snapshot cannot be restored', () => {
    restore({ snapshot: missingItems, local: good, localBarrier: 1, maxSeenSeq: 100 })
    expect(getPanelSpec(session)).toEqual(good)
    expect(applyPanelOperation(session, operation({ items: [{ type: 'text', content: 'Next' }] }, 2, 'append'))).toBe('accepted')
    expect(getPanelSpec(session)?.items).toHaveLength(2)
  })

  it.each([missingItems, { title: 'missing root items' }, { items: [{ type: 'Card' }] }])('recovers from an invalid persisted snapshot and permits valid history to replace it', snapshot => {
    restore({ snapshot, maxSeenSeq: 100 })
    expect(getPanelSpec(session)).toBeNull()
    expect(applyPanelOperation(session, operation(good, 1))).toBe('accepted')
    expect(getPanelSpec(session)).toEqual(good)
    expect(JSON.parse(localStorage.getItem(storageKey)!).sessions.other.snapshot).toEqual(good)
  })

  it.each([
    { ops: 'bad' },
    { ops: [], overflow: null, replayBarrier: -1, baseIdentity: null },
    { ops: [operation({ items: [{ type: 'text', content: 'Incomplete' }] }, 1)], overflow: null, replayBarrier: -1, baseIdentity: null },
    { ops: [{ sourceId: 'bad', mode: 'append', spec: good }] },
    { ops: [operation(missingItems, 2, 'append')], overflow: null, replayBarrier: -1, baseIdentity: null },
  ])('keeps a valid snapshot when pending state is malformed', pending => {
    restore({ snapshot: good, pending })
    expect(getPanelSpec(session)).toEqual(good)
    expect(applyPanelOperation(session, operation({ items: [{ type: 'text', content: 'Next' }] }, 3, 'append'))).toBe('accepted')
    expect(getPanelSpec(session)?.items).toEqual([...good.items, { type: 'text', content: 'Next' }])
  })

  it('preserves an explicit persisted clear and its replay barrier', () => {
    restore({ snapshot: null, local: null, localBarrier: 100, maxSeenSeq: 100 })
    expect(getPanelSpec(session)).toBeNull()
    expect(applyPanelOperation(session, operation(good, 1))).toBe('blocked')
  })

  it('uses operation mode to defer references in a delta without fence routing fields', () => {
    const delta = { computed: [{ id: 'total', expr: 'amount*2' }], items: [{ type: 'text', content: '{{total}}' }] }
    expect(applyPanelOperation(session, operation(delta, 2, 'append'))).toBe('invalid')
    clearSessionPanel(session)
    expect(getPanelOperationError(session, '2')).toBeTruthy()
    expect(applyPanelOperation(session, operation({ items: [{ type: 'input', id: 'amount', inputType: 'number', value: '3' }] }, 1))).toBe('accepted')
    expect(evaluateComputed(getPanelSpec(session)!, {}).values.total).toBe(6)
  })

  it('retains deferred references when partial repair removes an unsupported sibling', () => {
    const spec = resolveFence(JSON.stringify({ panel: true, append: true, items: [
      { type: 'Card' }, { type: 'text', content: '{{total}}' },
    ], computed: [{ id: 'total', expr: 'amount*2' }] }), { settled: true }).spec
    expect(spec?.items).toEqual([{ type: 'text', content: '{{total}}' }])
  })
})
