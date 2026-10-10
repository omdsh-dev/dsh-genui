import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import type { Key, ReactNode } from 'react'

const registry = vi.hoisted(() => new Map<string, (raw: string, key: Key, context?: { sessionId?: string; source?: { id: string; order: readonly [number, number, number] } }) => ReactNode>())
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => ({
  ...await vi.importActual('@deepseek-ai/dsh-client-ui-primitives'),
  GenuiActionContext: undefined,
  getGenuiComponent: undefined,
  registerFenceRenderer: (lang: string, renderer: (raw: string, key: Key, context?: { sessionId?: string; source?: { id: string; order: readonly [number, number, number] } }) => ReactNode) => {
    registry.set(lang, renderer)
    return () => { registry.delete(lang) }
  },
}))
vi.mock('../src/client/achievement-toast.tsx', () => ({ mountAchievementToasts: () => () => {} }))
vi.mock('../src/client/i18n/index.ts', async () => ({
  ...await vi.importActual('../src/client/i18n/index.ts'),
  bridgeHostLocale: () => () => {},
}))
import { apply } from '../src/client/index.tsx'

afterEach(() => { cleanup(); registry.clear() })

describe('SVG registry integration', () => {
  it('registers SVG alongside dsh-ui and disposes both', () => {
    const openResource = vi.fn()
    let sidebarCleanup: (() => void) | undefined
    const ctx = {
      slots: { inject: () => () => {} },
      get: () => ({ openResource }),
      sessions: { list: { getSnapshot: () => ({ current: 'registry-session', byId: {
        'registry-session': { id: 'registry-session', cwd: '/workspace/app', retainedBy: { mainView: 1 } },
      } }) } },
      inject: (names: string[], callback: (scope: unknown) => void) => {
        if (names[0] === 'sidebarRight') callback({
          get: () => ({ openResource }),
          effect: (effect: () => void | (() => void)) => { sidebarCleanup = effect() ?? undefined },
        })
      },
    } as unknown as Context
    const dispose = apply(ctx)
    try {
      expect([...registry.keys()].sort()).toEqual(['dsh-ui', 'svg'])
      const fenceRenderer = registry.get('dsh-ui')!
      render(<>{fenceRenderer(
        JSON.stringify({ items: [{ type: 'text', content: '[Registry](src/registry.ts#L22)' }] }),
        'registry',
        { sessionId: 'registry-session', source: { id: 'registry', order: [1, 0, 0] } },
      )}</>)
      fireEvent.click(document.querySelector('button[aria-label="Registry (src/registry.ts)"]')!)
      expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/registry-session/src/registry.ts', { params: { line: 22 } })
      const renderer = registry.get('svg')!
      const { getByRole } = render(<>{renderer('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"/>', 'svg')}</>)
      expect(getByRole('img')).not.toBeNull()
      expect(getByRole('button', { name: '源码', exact: true })).not.toBeNull()
    } finally { dispose(); sidebarCleanup?.() }
    expect(registry.size).toBe(0)
  })
})
