// @vitest-environment jsdom
// `enableWhen`: the control stays on screen but inert, with a reason. Different
// job from `when` (which removes the branch): a step that applies but is not yet
// reachable must stay discoverable, and must not silently accept input.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { processGenuiSpec } from '../src/client/guard.ts'
import { t } from '../src/client/i18n/index.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

afterEach(cleanup)

const spec: GenuiSpec = {
  items: [
    { type: 'select', id: 'entity', label: '主体', options: ['请选择', '公司', '个人'] },
    {
      type: 'input',
      id: 'taxId',
      label: '税号',
      enableWhen: { field: 'entity', op: 'eq', value: '公司' },
      disabledReason: '先选「公司」主体。',
    },
    { type: 'input', id: 'noReason', label: '金额', enableWhen: { field: 'entity', op: 'not-empty' } },
  ],
} as GenuiSpec

const gateFor = (label: string): HTMLElement | null => screen.getByLabelText(label).closest('[data-genui-gated]')

describe('enableWhen', () => {
  it('keeps the control visible but inert until the condition holds', () => {
    render(<GenuiBlock spec={spec} />)
    // The control is on screen — the requirement stays discoverable.
    expect(screen.getByLabelText('税号')).not.toBeNull()
    const gate = gateFor('税号')
    expect(gate).not.toBeNull()
    expect(gate?.getAttribute('aria-disabled')).toBe('true')
    expect(gate?.hasAttribute('inert')).toBe(true)
    expect(gate?.textContent).toContain('先选「公司」主体。')
  })

  it('falls back to the dictionary reason when the spec gives none', () => {
    render(<GenuiBlock spec={spec} />)
    expect(gateFor('金额')?.textContent).toContain(t('block.gateReason'))
  })

  it('unlocks when the condition holds', () => {
    render(<GenuiBlock spec={spec} />)
    const select = document.querySelector('select')!
    fireEvent.change(select, { target: { value: '公司' } })
    expect(gateFor('税号')).toBeNull()
    // Still not hidden: `enableWhen` never removes the node.
    expect(screen.getByLabelText('税号')).not.toBeNull()
  })

  it('re-gates when the condition stops holding, keeping the typed value', () => {
    render(<GenuiBlock spec={spec} />)
    const select = document.querySelector('select')!
    fireEvent.change(select, { target: { value: '公司' } })
    fireEvent.change(screen.getByLabelText('税号'), { target: { value: '9133' } })
    fireEvent.change(select, { target: { value: '个人' } })
    expect(gateFor('税号')).not.toBeNull()
    // The value is still there (the reader can see it) — `when` is the primitive
    // that removes a value from scope, `enableWhen` only gates interaction.
    expect((screen.getByLabelText('税号') as HTMLInputElement).value).toBe('9133')
  })

  it('is a validation error when malformed, and repair drops it (node stays usable)', () => {
    const bad = processGenuiSpec({ items: [{ type: 'text', content: 'a', enableWhen: { field: '', op: 'nope' } }] })
    expect(bad.errors.join(' ')).toContain('enableWhen')

    const repaired = processGenuiSpec({ items: [{ type: 'text', content: 'a', enableWhen: { field: 'x', op: 'nope' } }] })
    expect(repaired.spec?.items[0]).not.toHaveProperty('enableWhen')
  })

  it('keeps a well-formed gate and its reason', () => {
    const ok = processGenuiSpec({ items: [{ type: 'text', content: 'a', enableWhen: { field: 'x', op: 'empty' }, disabledReason: '先填 X' }] })
    expect(ok.errors).toHaveLength(0)
    expect(ok.spec?.items[0]).toMatchObject({ enableWhen: { field: 'x', op: 'empty' }, disabledReason: '先填 X' })
  })
})
