// Contract tests with a mocked engine, not a WebGL/browser acceptance claim.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { GenuiMapContext } from '../src/client/map-config.ts'
import { setLocale } from '../src/client/i18n/index.ts'
import type { GenuiMap, GenuiSpec } from '../src/client/spec.ts'
import type { MapMountOptions } from '../src/client/map-lazy.ts'

const mocks = vi.hoisted(() => ({ load: vi.fn(), mount: vi.fn(), update: vi.fn(), select: vi.fn(), destroy: vi.fn(), reset: vi.fn(), zoom: vi.fn(), resize: vi.fn() }))
vi.mock('../src/client/map-lazy.ts', () => ({ loadMapEngine: mocks.load }))
const a = { id: 'a', label: 'Alpha', coordinates: [10, 20] as [number, number] }
const b = { id: 'b', label: 'Beta', coordinates: [11, 21] as [number, number] }
const map: GenuiMap = { type: 'map', id: 'place', locations: [a, b] }
const spec: GenuiSpec = { items: [map, { type: 'submit', label: 'Confirm', action: 'choose', groups: ['place'] }] }
beforeEach(() => {
  vi.clearAllMocks()
  setLocale('en')
  mocks.mount.mockImplementation((_container, _node, _selected, options) => { options.onReady(); return { update: mocks.update, select: mocks.select, destroy: mocks.destroy, reset: mocks.reset, zoom: mocks.zoom, resize: mocks.resize } })
  mocks.load.mockResolvedValue({ mountMap: mocks.mount })
})
afterEach(() => { cleanup(); setLocale('zh') })
async function ready() { await screen.findByText(/Offline coordinate map/) }
const button = (name: string) => screen.getByRole('button', { name: new RegExp(name) })
describe('map location workflow', () => {
  it('keeps keyboard-native list usable while loading and failed; never calls an action on select', async () => {
    mocks.load.mockRejectedValue(new Error('CSP unavailable'))
    const onAction = vi.fn()
    render(<GenuiActionContext.Provider value={onAction}><GenuiBlock spec={spec} /></GenuiActionContext.Provider>)
    fireEvent.click(button('Alpha'))
    expect(button('Alpha').getAttribute('aria-pressed')).toBe('true')
    await screen.findByText(/Map unavailable/)
    expect(button('Alpha').tagName).toBe('BUTTON')
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(button('Confirm'))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('choose', { type: 'submit', answers: {}, fields: { place: 'a' }, total: 1, answered: 1 })
  })
  it('synchronizes list and marker selection; controls stay local', async () => {
    const onAction = vi.fn()
    render(<GenuiActionContext.Provider value={onAction}><GenuiBlock spec={spec} /></GenuiActionContext.Provider>)
    await ready()
    fireEvent.click(button('Alpha'))
    expect(mocks.select).toHaveBeenLastCalledWith('a')
    const options = mocks.mount.mock.calls[0]![3] as MapMountOptions
    act(() => options.onSelect('b'))
    expect(button('Beta').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button('Zoom in')); fireEvent.click(button('Zoom out')); fireEvent.click(button('Reset view'))
    expect(mocks.zoom.mock.calls).toEqual([[1], [-1]])
    expect(mocks.reset).toHaveBeenCalledOnce()
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(button('Clear selection'))
    expect(button('Beta').getAttribute('aria-pressed')).toBe('false')
    expect((button('Confirm') as HTMLButtonElement).disabled).toBe(true)
  })
  it('persists IDs, restores valid state and clears an obsolete choice across streaming updates', async () => {
    const snapshot = vi.fn()
    const view = render(<GenuiBlock spec={spec} initialState={{ fields: { place: 'b' } }} onStateSnapshot={snapshot} />)
    await ready()
    expect(button('Beta').getAttribute('aria-pressed')).toBe('true')
    const renamed: GenuiSpec = { items: [{ ...map, locations: [a, { ...b, label: 'Renamed' }] }, spec.items[1]!] }
    view.rerender(<GenuiBlock spec={renamed} onStateSnapshot={snapshot} />)
    expect(button('Renamed').getAttribute('aria-pressed')).toBe('true')
    expect(mocks.mount).toHaveBeenCalledOnce()
    view.rerender(<GenuiBlock spec={{ items: [{ ...map, locations: [a] }, spec.items[1]!] }} onStateSnapshot={snapshot} />)
    await waitFor(() => expect(snapshot.mock.calls.at(-1)?.[0].fields.place).toBe(''))
    expect((button('Confirm') as HTMLButtonElement).disabled).toBe(true)
    view.rerender(<GenuiBlock spec={spec} onStateSnapshot={snapshot} />)
    expect(button('Beta').getAttribute('aria-pressed')).toBe('false')
  })
  it('adopts the first durable state key without losing selection and cleans up on unmount', async () => {
    const view = render(<GenuiBlock spec={spec} />)
    await ready(); fireEvent.click(button('Alpha'))
    view.rerender(<GenuiBlock spec={spec} stateKey="map-stream-settled" />)
    expect(button('Alpha').getAttribute('aria-pressed')).toBe('true')
    expect(mocks.mount).toHaveBeenCalledOnce()
    view.unmount()
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })
  it('does not mount after unmount during a pending load', async () => {
    let resolve!: (value: unknown) => void
    mocks.load.mockReturnValue(new Promise(r => { resolve = r }))
    const view = render(<GenuiBlock spec={spec} />)
    view.unmount()
    await act(async () => resolve({ mountMap: mocks.mount }))
    expect(mocks.mount).not.toHaveBeenCalled()
  })
  it('recreates only for a trusted host style change and preserves local selection', async () => {
    const config = { style: { version: 8 as const, sources: {}, layers: [] } }
    const view = render(<GenuiMapContext.Provider value={config}><GenuiBlock spec={spec} /></GenuiMapContext.Provider>)
    await screen.findByText(/Basemap provided/)
    fireEvent.click(button('Beta'))
    view.rerender(<GenuiMapContext.Provider value={{ style: { ...config.style } }}><GenuiBlock spec={spec} /></GenuiMapContext.Provider>)
    await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(2))
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(mocks.mount.mock.calls[1]![2]).toBe('b')
  })
})

it('retains exact polar coordinates and selection with an explicit projection notice', async () => {
  render(<GenuiBlock spec={{ items: [{ type: 'map', locations: [{ id: 'pole', label: 'North Pole', coordinates: [0, 90] }] }] }} />)
  await ready()
  expect(screen.getByText(/beyond ±85.051129/)).toBeTruthy()
  fireEvent.click(button('North Pole'))
  expect(button('North Pole').getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByText('0, 90')).toBeTruthy()
})

it('does not overwrite a synchronous engine error with ready', async () => {
  mocks.mount.mockImplementation((_container, _node, _selected, options) => {
    options.onError(); options.onReady()
    return { update: mocks.update, select: mocks.select, destroy: mocks.destroy, reset: mocks.reset, zoom: mocks.zoom, resize: mocks.resize }
  })
  render(<GenuiBlock spec={spec} />)
  await screen.findByText(/Map unavailable/)
  expect((button('Zoom in') as HTMLButtonElement).disabled).toBe(true)
})

it('discards a stale engine load after trusted configuration replacement', async () => {
  let resolveFirst!: (value: unknown) => void
  mocks.load.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))
  const config = { style: { version: 8 as const, sources: {}, layers: [] } }
  const view = render(<GenuiMapContext.Provider value={config}><GenuiBlock spec={spec} /></GenuiMapContext.Provider>)
  view.rerender(<GenuiMapContext.Provider value={{ style: { ...config.style } }}><GenuiBlock spec={spec} /></GenuiMapContext.Provider>)
  await screen.findByText(/Basemap provided/)
  await act(async () => resolveFirst({ mountMap: mocks.mount }))
  expect(mocks.mount).toHaveBeenCalledOnce()
})


it('keeps asynchronous worker failure sticky while list selection and explicit submission remain usable', async () => {
  mocks.mount.mockImplementation(() => ({ update: mocks.update, select: mocks.select, destroy: mocks.destroy, reset: mocks.reset, zoom: mocks.zoom, resize: mocks.resize }))
  const onAction = vi.fn()
  render(<GenuiActionContext.Provider value={onAction}><GenuiBlock spec={spec} /></GenuiActionContext.Provider>)
  await waitFor(() => expect(mocks.mount).toHaveBeenCalledOnce())
  const options = mocks.mount.mock.calls[0]![3] as MapMountOptions
  act(() => { options.onError(); options.onReady() })
  expect(screen.getByText(/Map unavailable/)).toBeTruthy()
  expect((button('Reset view') as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(button('Beta'))
  expect(button('Beta').getAttribute('aria-pressed')).toBe('true')
  expect(onAction).not.toHaveBeenCalled()
  fireEvent.click(button('Confirm'))
  expect(onAction).toHaveBeenCalledExactlyOnceWith('choose', { type: 'submit', answers: {}, fields: { place: 'b' }, total: 1, answered: 1 })
})


it('retains the usable selection when a known blocked worker also rejects a configuration remount', async () => {
  mocks.mount.mockImplementationOnce((_container, _node, _selected, options) => {
    options.onError()
    return { update: mocks.update, select: mocks.select, destroy: mocks.destroy, reset: mocks.reset, zoom: mocks.zoom, resize: mocks.resize }
  }).mockImplementation(() => { throw new Error('Map worker blocked by document policy') })
  const style = { version: 8 as const, sources: {}, layers: [] }
  const view = render(<GenuiMapContext.Provider value={{ style }}><GenuiBlock spec={spec} /></GenuiMapContext.Provider>)
  await screen.findByText(/Map unavailable/)
  fireEvent.click(button('Beta'))
  view.rerender(<GenuiMapContext.Provider value={{ style: { ...style } }}><GenuiBlock spec={spec} /></GenuiMapContext.Provider>)
  await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(2))
  await screen.findByText(/Map unavailable/)
  expect(button('Beta').getAttribute('aria-pressed')).toBe('true')
  expect((button('Reset view') as HTMLButtonElement).disabled).toBe(true)
  expect(mocks.destroy).toHaveBeenCalledOnce()
})


describe('map integration with declared-field and structural identity rules', () => {
  it('clears a removed choice while its map is hidden and does not revive it when locations return', async () => {
    const onAction = vi.fn()
    const snapshot = vi.fn()
    const tabbed = (locations: GenuiMap['locations']): GenuiSpec => ({ items: [
      { type: 'tabs', tabs: [
        { label: 'Map tab', items: [{ ...map, locations }] },
        { label: 'Other tab', items: [{ type: 'text', content: 'Other' }] },
      ] },
      spec.items[1]!,
    ] })
    const content = (locations: GenuiMap['locations']) => <GenuiActionContext.Provider value={onAction}>
      <GenuiBlock spec={tabbed(locations)} onStateSnapshot={snapshot} />
    </GenuiActionContext.Provider>
    const view = render(content([a, b]))
    await ready()
    fireEvent.click(button('Beta'))
    fireEvent.click(screen.getByRole('tab', { name: 'Other tab' }))
    view.rerender(content([a]))
    expect(button('Confirm')).toHaveProperty('disabled', true)
    expect(snapshot.mock.calls.at(-1)?.[0].fields).toEqual({ place: '' })
    fireEvent.click(button('Confirm'))
    expect(onAction).not.toHaveBeenCalled()
    view.rerender(content([a, b]))
    expect(button('Confirm')).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('tab', { name: 'Map tab' }))
    await ready()
    expect(button('Beta').getAttribute('aria-pressed')).toBe('false')
    expect(snapshot.mock.calls.at(-1)?.[0].fields).toEqual({ place: '' })
  })

  it('clears obsolete restored state in a hidden map without adopting its default selection', async () => {
    const snapshot = vi.fn()
    const hidden: GenuiSpec = { items: [
      { type: 'tabs', tabs: [
        { label: 'Other tab', items: [{ type: 'text', content: 'Other' }] },
        { label: 'Map tab', items: [{ ...map, locations: [a], selected: 'a' }] },
      ] },
      spec.items[1]!,
    ] }
    render(<GenuiBlock spec={hidden} initialState={{ fields: { place: 'b' } }} onStateSnapshot={snapshot} />)
    expect(button('Confirm')).toHaveProperty('disabled', true)
    expect(snapshot.mock.calls.at(-1)?.[0].fields).toEqual({ place: '' })
    fireEvent.click(screen.getByRole('tab', { name: 'Map tab' }))
    await ready()
    expect(button('Alpha').getAttribute('aria-pressed')).toBe('false')
  })

  it('includes Map fields in snapshots and removes them only when the field is removed', async () => {
    const snapshot = vi.fn()
    const view = render(<GenuiBlock spec={spec} onStateSnapshot={snapshot} />)
    await ready()
    fireEvent.click(button('Beta'))
    expect(snapshot.mock.calls.at(-1)?.[0].fields).toEqual({ place: 'b' })
    view.rerender(<GenuiBlock spec={{ items: [{ type: 'text', content: 'Map removed' }] }} onStateSnapshot={snapshot} />)
    await waitFor(() => expect(snapshot.mock.calls.at(-1)?.[0].fields).toBeUndefined())
    view.rerender(<GenuiBlock spec={spec} onStateSnapshot={snapshot} />)
    await ready()
    expect(button('Beta').getAttribute('aria-pressed')).toBe('false')
    expect(button('Confirm')).toHaveProperty('disabled', true)
  })

  it('isolates maps in different tabs while preserving each declared field on return', async () => {
    const onAction = vi.fn()
    const snapshot = vi.fn()
    const tabs: GenuiSpec = { items: [{ type: 'tabs', tabs: [
      { label: 'First map', items: [{ ...map, id: 'first' }] },
      { label: 'Second map', items: [{ ...map, id: 'second' }] },
    ] }] }
    render(<GenuiActionContext.Provider value={onAction}><GenuiBlock spec={tabs} onStateSnapshot={snapshot} /></GenuiActionContext.Provider>)
    await ready()
    fireEvent.click(button('Alpha'))
    fireEvent.click(screen.getByRole('tab', { name: 'Second map' }))
    await ready()
    expect(button('Alpha').getAttribute('aria-pressed')).toBe('false')
    expect(snapshot.mock.calls.at(-1)?.[0].fields).toEqual({ first: 'a' })
    fireEvent.click(button('Beta'))
    fireEvent.click(screen.getByRole('tab', { name: 'First map' }))
    await ready()
    expect(button('Alpha').getAttribute('aria-pressed')).toBe('true')
    expect(button('Beta').getAttribute('aria-pressed')).toBe('false')
    expect(snapshot.mock.calls.at(-1)?.[0].fields).toEqual({ first: 'a', second: 'b' })
    expect(onAction).not.toHaveBeenCalled()
  })

  it('does not seed a replacement field from the previous map at the same slot', async () => {
    const snapshot = vi.fn()
    const view = render(<GenuiBlock spec={{ items: [map] }} onStateSnapshot={snapshot} />)
    await ready()
    fireEvent.click(button('Alpha'))
    view.rerender(<GenuiBlock spec={{ items: [{ ...map, id: 'replacement' }] }} onStateSnapshot={snapshot} />)
    await ready()
    expect(button('Alpha').getAttribute('aria-pressed')).toBe('false')
    expect(snapshot.mock.calls.at(-1)?.[0].fields).toBeUndefined()
    fireEvent.click(button('Beta'))
    expect(snapshot.mock.calls.at(-1)?.[0].fields).toEqual({ replacement: 'b' })
  })

  it('does not carry local selection between anonymous maps in separate tab paths', async () => {
    const anonymous: GenuiMap = { type: 'map', locations: [a, b] }
    const tabs: GenuiSpec = { items: [{ type: 'tabs', tabs: [
      { label: 'First map', items: [anonymous] },
      { label: 'Second map', items: [anonymous] },
    ] }] }
    render(<GenuiBlock spec={tabs} />)
    await ready()
    fireEvent.click(button('Alpha'))
    fireEvent.click(screen.getByRole('tab', { name: 'Second map' }))
    await ready()
    expect(button('Alpha').getAttribute('aria-pressed')).toBe('false')
  })
})
