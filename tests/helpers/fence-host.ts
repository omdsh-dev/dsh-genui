/** Explicit host registration for Markdown fence integration tests. */
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { renderGenuiFence } from '../../src/client/fence-render.tsx'

type HostFenceExt = {
  registerFenceRenderer?: (lang: string, renderer: (raw: string, key: unknown, context?: unknown) => unknown) => () => void
}

export const hasFenceRegistry: boolean = typeof (primitives as unknown as HostFenceExt).registerFenceRenderer === 'function'

if (hasFenceRegistry) {
  ;(primitives as unknown as HostFenceExt).registerFenceRenderer!('dsh-ui', renderGenuiFence as never)
}

