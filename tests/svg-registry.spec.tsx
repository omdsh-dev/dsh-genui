import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import { createElement, type ComponentType, type Key, type ReactNode } from 'react'

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
    const slots = new Map<string, { component: ComponentType<any>; config: Record<string, unknown> }>()
    let sidebarCleanup: (() => void) | undefined
    const ctx = {
      slots: {
        inject: (_name: string, callback: () => void) => { callback(); return () => {} },
        register: (config: Record<string, unknown>, component: ComponentType<any>) => {
          const key = String(config.key ?? config.id)
          slots.set(key, { component, config })
          return () => { slots.delete(key) }
        },
      },
      get: () => ({ openResource }),
      sessions: { scope: () => undefined, list: { getSnapshot: () => ({ current: 'registry-session', byId: {
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

      const toolView = slots.get('render_ui')!
      const toolCard = render(createElement(toolView.component, {
        toolName: 'render_ui',
        sessionId: 'registry-session',
        block: { callId: 'call-1', meta: { items: [{ type: 'text', content: '[Tool](src/tool.ts#L8)' }] } },
      }))
      fireEvent.click(toolCard.getByRole('button', { name: 'Tool (src/tool.ts)' }))
      expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/registry-session/src/tool.ts', { params: { line: 8 } })
      openResource.mockClear()

      const panel = slots.get('genui-panel')!
      const panelInject = panel.config.inject as (sessionId: string) => Record<string, unknown>
      const panelProps = panelInject('registry-session')
      expect(panelProps.sessionId).toBe('registry-session')
      expect((panelProps.fileLinkContext as { availability: { getSnapshot(): boolean } }).availability.getSnapshot()).toBe(true)

      const renderer = registry.get('svg')!
      const { getByRole } = render(<>{renderer('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"/>', 'svg')}</>)
      expect(getByRole('img')).not.toBeNull()
      expect(getByRole('button', { name: '源码', exact: true })).not.toBeNull()
    } finally { dispose(); sidebarCleanup?.() }
    expect(registry.size).toBe(0)
  })
})
