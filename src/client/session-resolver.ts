import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'

interface SessionRetainSnapshot {
  retainedBy: { mainView?: number }
}

interface SessionRetainInfo {
  getSnapshot(): SessionRetainSnapshot
}

/**
 * 从宿主会话列表快照中解析当前主视图会话。
 *
 * @param list - 宿主提供的会话列表快照
 * @param retainInfo - 按会话标识读取的引用来源快照
 * @returns 当前主视图会话标识；没有主视图引用时返回 undefined
 */
export function resolveViewedSessionId(
  list: Pick<SessionListState, 'ids'>,
  retainInfo: (sessionId: SessionId) => SessionRetainInfo,
): SessionId | undefined {
  return list.ids.find(sessionId => (retainInfo(sessionId).getSnapshot().retainedBy.mainView ?? 0) > 0)
}
