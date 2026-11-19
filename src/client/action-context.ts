/**
 * GenUI action context, plugin-owned.
 *
 * Inline fences and the session panel share this plugin-owned context so
 * component actions reach the matching session conversation.
 */
import { createContext, useContext } from 'react'
import type { Context } from 'react'

/** v2 action handler: component action + its collected data. */
export type GenuiActionHandler = (action: string, payload: Record<string, unknown>) => void

/** Plugin-owned context used by the inline renderer, panel, and embedded renderer. */
const localContext = createContext<GenuiActionHandler | undefined>(undefined)

/** Shared action context owned by this plugin. */
export const GenuiActionContext: Context<GenuiActionHandler | undefined> = localContext

/** Read the installed action handler, if any. */
export function useGenuiAction(): GenuiActionHandler | undefined {
  return useContext(GenuiActionContext)
}
