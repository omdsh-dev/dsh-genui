import { describe, expect, it } from 'vitest'
import { resolveViewedSessionId } from '../src/client/session-resolver.ts'

describe('resolveViewedSessionId', () => {
  it('prefers the legacy current field', () => {
    expect(resolveViewedSessionId({
      current: 'legacy-session',
      byId: { modern: { id: 'modern', retainedBy: { mainView: 1 } } },
    })).toBe('legacy-session')
  })

  it('resolves the session retained by the main view', () => {
    expect(resolveViewedSessionId({
      ids: ['sidebar-session', 'main-session'],
      byId: {
        'sidebar-session': { id: 'sidebar-session', retainedBy: { sidebar: 1 } },
        'main-session': { id: 'main-session', retainedBy: { mainView: 1 } },
      },
    })).toBe('main-session')
  })

  it('returns undefined when no session is retained by the main view', () => {
    expect(resolveViewedSessionId({ byId: { session: { id: 'session', retainedBy: { mainView: 0 } } } })).toBeUndefined()
    expect(resolveViewedSessionId({ byId: { session: { id: 'session' } } })).toBeUndefined()
    expect(resolveViewedSessionId({ ids: [] })).toBeUndefined()
  })

  it('returns undefined for unknown snapshot shapes', () => {
    expect(resolveViewedSessionId(null)).toBeUndefined()
    expect(resolveViewedSessionId({ byId: [] })).toBeUndefined()
    expect(resolveViewedSessionId({ byId: { session: { id: 1, retainedBy: { mainView: 1 } } } })).toBeUndefined()
  })
})
