import { describe, expect, it } from 'vitest'
import { resolveViewedSessionId } from '../src/client/session-resolver.ts'

describe('resolveViewedSessionId', () => {
  it('resolves the listed session retained by the main view', () => {
    const retainInfo = (sessionId: string) => ({
      getSnapshot: () => ({ retainedBy: sessionId === 'main-session' ? { mainView: 1 } : { sidebar: 1 } }),
    })
    expect(resolveViewedSessionId({ ids: ['sidebar-session', 'main-session'] }, retainInfo)).toBe('main-session')
  })

  it('returns undefined when no listed session is retained by the main view', () => {
    expect(resolveViewedSessionId({ ids: [] }, () => ({ getSnapshot: () => ({ retainedBy: {} }) }))).toBeUndefined()
    expect(resolveViewedSessionId({ ids: ['sidebar-session'] }, () => ({
      getSnapshot: () => ({ retainedBy: { sidebar: 1 } }),
    }))).toBeUndefined()
  })
})
