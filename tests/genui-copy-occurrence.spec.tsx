import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { processGenuiSpec } from '../src/client/guard.ts'
import type { GenuiCopy, GenuiNode, GenuiSpec } from '../src/client/spec.ts'

afterEach(cleanup)

const sharedCopy = (): GenuiCopy => ({ type: 'copy', text: 'synthetic shared text', expandable: true })
const previews = (container: HTMLElement) => Array.from(container.querySelectorAll('pre'))
const toggle = (container: HTMLElement) => within(container).getByRole('button', { name: /查看文本|收起文本/ })

describe.each(['direct typed API', 'canonical JSON'] as const)('copy occurrence identity: %s', mode => {
  const specOf = (items: GenuiNode[]): GenuiSpec => {
    const spec: GenuiSpec = { items }
    // The direct API intentionally preserves aliases, unlike a JSON round trip.
    if (mode === 'direct typed API') return spec
    const result = processGenuiSpec(JSON.parse(JSON.stringify(spec)))
    expect(result.errors).toEqual([])
    return result.spec!
  }

  it.each(['root', 'row', 'col', 'grid', 'card', 'list'] as const)('isolates a shared copy at two %s positions', kind => {
    const shared = sharedCopy()
    const items = [shared, shared]
    const spec = specOf(kind === 'root' ? items
      : kind === 'grid' ? [{ type: kind, cols: 2, items }]
        : [{ type: kind, items }])
    const out = render(<GenuiBlock spec={spec} />)
    const toggles = out.getAllByRole('button', { name: '查看文本' })
    fireEvent.click(toggles[0]!)
    expect(previews(out.container).map(preview => preview.hidden)).toEqual([false, true])
    fireEvent.click(toggles[1]!)
    fireEvent.click(toggles[0]!)
    expect(previews(out.container).map(preview => preview.hidden)).toEqual([true, false])
  })

  it.each(['tabs', 'accordion'] as const)('restores each shared copy independently across %s panels', kind => {
    const shared = sharedCopy()
    const spec = specOf(kind === 'tabs'
      ? [{ type: 'tabs', tabs: [{ label: 'A', items: [shared] }, { label: 'B', items: [shared] }] }]
      : [{ type: 'accordion', items: [{ title: 'A', items: [shared] }, { title: 'B', items: [shared] }] }])
    const out = render(<GenuiBlock spec={spec} />)
    const panel = (name: string) => out.getByRole(kind === 'tabs' ? 'tab' : 'button', { name })
    fireEvent.click(toggle(out.container))
    fireEvent.click(panel('B'))
    expect(previews(out.container)[0]!.hidden).toBe(true)
    fireEvent.click(toggle(out.container))
    fireEvent.click(panel('A'))
    expect(previews(out.container)[0]!.hidden).toBe(false)
    fireEvent.click(toggle(out.container))
    fireEvent.click(panel('B'))
    expect(previews(out.container)[0]!.hidden).toBe(false)
  })

  it('isolates a shared container and its descendants across nested panels', () => {
    const shared: GenuiNode = { type: 'accordion', items: [{ title: 'Inner', items: [
      { type: 'card', items: [{ type: 'list', items: [sharedCopy()] }] },
    ] }] }
    const spec = specOf([{ type: 'tabs', tabs: [
      { label: 'A', items: [shared] }, { label: 'B', items: [shared] },
    ] }])
    const out = render(<GenuiBlock spec={spec} />)
    fireEvent.click(toggle(out.container))
    fireEvent.click(out.getByRole('tab', { name: 'B' }))
    expect(previews(out.container)[0]!.hidden).toBe(true)
    fireEvent.click(out.getByRole('tab', { name: 'A' }))
    expect(previews(out.container)[0]!.hidden).toBe(false)
    fireEvent.click(out.getByRole('button', { name: 'Inner' }))
    fireEvent.click(out.getByRole('button', { name: 'Inner' }))
    expect(previews(out.container)[0]!.hidden).toBe(false)
  })

  it('isolates shared table details through sorting and close/reopen', () => {
    const shared = [sharedCopy()]
    const spec = specOf([{ type: 'table', columns: ['Name'], rows: [['Beta'], ['Alpha']], details: [shared, shared] }])
    const out = render(<GenuiBlock spec={spec} />)
    fireEvent.click(out.getByRole('button', { name: '展开 Beta 的明细' }))
    fireEvent.click(toggle(out.container))
    fireEvent.click(out.getByRole('button', { name: '展开 Alpha 的明细' }))
    expect(previews(out.container).map(preview => preview.hidden)).toEqual([false, true])
    fireEvent.click(out.getByRole('button', { name: 'Name' }))
    expect(previews(out.container).map(preview => preview.hidden)).toEqual([true, false])
    fireEvent.click(out.getByRole('button', { name: '收起 Beta 的明细' }))
    fireEvent.click(out.getByRole('button', { name: '展开 Beta 的明细' }))
    expect(previews(out.container).map(preview => preview.hidden)).toEqual([true, false])
  })

  it('retains per-occurrence streaming state and prunes only removed or disabled paths', () => {
    const shared = sharedCopy()
    const out = render(<GenuiBlock spec={specOf([shared, shared])} />)
    fireEvent.click(out.getAllByRole('button', { name: '查看文本' })[0]!)
    const updated = { ...shared, text: shared.text + '\nstreamed' }
    out.rerender(<GenuiBlock spec={specOf([updated, updated])} stateKey="copy-occurrence-settled" />)
    expect(previews(out.container).map(preview => preview.hidden)).toEqual([false, true])
    out.rerender(<GenuiBlock spec={specOf([{ ...updated, expandable: false }, updated])} stateKey="copy-occurrence-settled" />)
    out.rerender(<GenuiBlock spec={specOf([updated, updated])} stateKey="copy-occurrence-settled" />)
    expect(previews(out.container).map(preview => preview.hidden)).toEqual([true, true])
    fireEvent.click(out.getAllByRole('button', { name: '查看文本' })[1]!)
    out.rerender(<GenuiBlock spec={specOf([updated])} stateKey="copy-occurrence-settled" />)
    out.rerender(<GenuiBlock spec={specOf([updated, updated])} stateKey="copy-occurrence-settled" />)
    expect(previews(out.container).map(preview => preview.hidden)).toEqual([true, true])
  })

  it('keeps separate blocks independent even when they share the entire spec', () => {
    const shared = sharedCopy()
    const spec = specOf([shared, shared])
    const out = render(<><GenuiBlock spec={spec} stateKey="same" /><GenuiBlock spec={spec} stateKey="same" /></>)
    fireEvent.click(out.getAllByRole('button', { name: '查看文本' })[0]!)
    expect(previews(out.container).map(preview => preview.hidden)).toEqual([false, true, true, true])
  })
})
