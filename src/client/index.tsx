/**
 * dsh-genui browser half: the ```dsh-ui fence renderer, the keyed toolview
 * for the `render_ui` tool, and the session panel dock.
 *
 * Fence rendering is dual-mode, chosen at boot:
 * - **Registry channel** (contract hosts): the host's MarkdownText resolves
 *   ```dsh-ui fences through the fence-registry extension point; this package
 *   registers `renderGenuiFence`. Action callbacks ride the host-installed
 *   GenuiActionContext.
 * - **DOM channel** (pristine hosts): no extension point exists, so
 *   `dom-fence.ts` observes the conversation DOM, finds settled stock code
 *   blocks labelled `dsh-ui`, and mounts the same render pipeline in its own
 *   React roots — wrapped in the plugin-owned GenuiActionContext that relays
 *   `[genui-action]` through the scoped conversation send. Either way the
 *   deployment is the STOCK DSH snapshot plus this plugin.
 *
 * The renderer parses the fence body with the partial parser: while the reply
 * streams, every FINISHED component appears the moment its JSON object
 * closes, so the UI assembles top-down before the fence (or reply) completes.
 * A body with no finished component yet falls back to a plain code block.
 * @module @omdsh-dev/dsh-genui/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { Key, ReactNode } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { installDomFenceRenderer } from './dom-fence.tsx'
import { renderGenuiFence, type GenuiFenceContext } from './fence-render.tsx'
import { createPanelSlashSource } from './panel-command.ts'
import { GenuiPanel, type GenuiPanelInjected } from './panel.tsx'
import { GenuiToolView } from './toolview.tsx'
import type { InputTriggerServiceContract } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { assetUrl } from './asset-loader.ts'

/** Host extension surface the registry channel needs (absent on pristine). */
type HostFenceExt = {
  registerFenceRenderer?: (lang: string, renderer: (raw: string, key: Key, context?: GenuiFenceContext) => ReactNode) => () => void
}

/** Add low-priority prefetch links for the lazy engine assets (mermaid/three).
 * Browser-dependent: some engines ignore `<link rel=prefetch>`; harmless
 * either way — the on-demand loader still covers a cache miss. Exported for
 * tests. */
export function prefetchGenuiAssets(): void {
  if (typeof document === 'undefined') return
  for (const file of ['mermaid.js', 'three.js']) {
    if (document.head.querySelector(`link[rel="prefetch"][href="${assetUrl(file)}"]`) !== null) continue
    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.as = 'script'
    link.href = assetUrl(file)
    document.head.appendChild(link)
  }
}

/** Session panel action loop: same [genui-action] contract as inline fences,
 * routed through the scoped conversation send (queued user message). The
 * prompt asks the model to re-run render_ui so the panel updates in place. */
function panelActionSend(ctx: Context, sessionId: SessionId): GenuiPanelInjected {
  const scoped = ctx.sessions.scope(sessionId)
  const conversation = scoped?.get('conversation') as IConversation | undefined
  return {
    sessionId,
    sendGenuiAction: (action, payload) => {
      if (conversation === undefined) return
      const payloadText = Object.keys(payload).length === 0
        ? ''
        : ` Component data: ${JSON.stringify(payload)}`
      void conversation.send(`[genui-action] ${action}. The user just triggered an action in the panel "${action}", act on the component data, and output only a panel:true dsh-ui fence to update the panel, replying with at most one line of confirmation up to 10 characters (e.g."Refreshed"), no explanations, no ordinary fences.${payloadText}`).catch((err: unknown) => {
        // A failed prompt (session gone, agent busy) drops the action; the
        // panel stays interactive — the component is not disabled. Log the
        // failure WITHOUT the action payload or any secret values (the
        // message may contain field content).
        console.warn(`[genui] panel action "${action}" failed to send (session ${sessionId}): `, err instanceof Error ? err.message : String(err))
      })
    },
  }
}

/** Relay a `/panel <指令>` instruction to the model: the scoped conversation
 * send with an explicit panel-only directive, so the model replaces the
 * default panel with content tailored to the request. */
function sendPanelInstruction(ctx: Context, sessionId: SessionId, instruction: string): void {
  const scoped = ctx.sessions.scope(sessionId)
  const conversation = scoped?.get('conversation') as IConversation | undefined
  if (conversation === undefined) return
  void conversation.send(`The user ran /panel and requested: ${instruction}. Output only a panel:true dsh-ui fence to update the session panel, customizing the content per the request; reply with at most one line of confirmation up to 10 characters (e.g."Updated"), no explanations, no ordinary fences.`).catch((err: unknown) => {
    // A failed prompt drops the instruction; the default panel stays
    // visible. Log without the instruction text (may contain secrets).
    console.warn(`[genui] /panel command failed to send (session ${sessionId}): `, err instanceof Error ? err.message : String(err))
  })
}

/**
 * Inline-fence action relay (DOM channel): the same message template the
 * contract host's sendGenuiAction uses, so the model sees one identical
 * [genui-action] contract on both channels.
 */
function sendInlineGenuiAction(ctx: Context, sessionId: SessionId, action: string, payload: Record<string, unknown>): void {
  const scoped = ctx.sessions.scope(sessionId)
  const conversation = scoped?.get('conversation') as IConversation | undefined
  if (conversation === undefined) return
  const payloadText = Object.keys(payload).length === 0
    ? ''
    : ` Component data: ${JSON.stringify(payload)}`
  void conversation.send(`[genui-action] ${action}. The user just triggered an action in the interface "${action}", act on the component data and output the updated interface using dsh-ui.${payloadText}`).catch(() => {
    // A failed prompt (session gone, agent busy) drops the action;
    // the UI stays interactive — the component is not disabled.
  })
}

/** Cordis client entry: register the fence renderer on boot, the keyed
 * toolview for the render_ui tool, and the session panel dock; returning the
 * disposers lets cordis tear all registrations down on plugin unload. */
export function apply(ctx: Context): () => void {
  // Fence channel selection: the registry extension point when the host
  // ships it (contract line), the DOM observer otherwise (pristine line).
  // One plugin build serves both deployments.
  const registerFn = (primitives as unknown as HostFenceExt).registerFenceRenderer
  const disposers: Array<() => void> = typeof registerFn === 'function'
    ? [registerFn('dsh-ui', renderGenuiFence)]
    : (console.info('[genui] fence-registry extension point missing (vanilla DSH) — enabling the DOM render channel'),
      [installDomFenceRenderer(ctx, (sessionId, action, payload) => sendInlineGenuiAction(ctx, sessionId, action, payload))])
  // Idle prefetch of the lazy engine assets: the browser downloads them at
  // LOW priority whenever the page is idle, so the first mermaid/3D node in
  // a session usually hits a warm cache instead of paying the fetch on first
  // use. Never blocks first paint; the loader still handles a miss.
  prefetchGenuiAssets()
  // Keyed toolview: the harness dispatches 'tool.call.toolview' by wire tool
  // name; registering under 'render_ui' gives the tool's result card the
  // GenUI renderer (reading the repaired spec from result meta). The toolview
  // also publishes every settled spec to the session panel store.
  disposers.push(ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'render_ui',
  }, GenuiToolView)))
  // Session panel dock: a session-scoped, always-present seat above the
  // composer (TodoDock posture). Renders the session's latest render_ui
  // spec in place; absent spec = no panel.
  disposers.push(ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'genui-panel',
    order: 50,
    inject: (sessionId: SessionId): GenuiPanelInjected => panelActionSend(ctx, sessionId),
  }, GenuiPanel)))
  // /panel slash command: a deterministic, client-side entry point that
  // opens the panel dock (publishes the default spec + expand request),
  // clears it (/panel clear), or relays an instruction to the model
  // (/panel <指令>) so the panel gets tailored content.
  const slash = ctx.get('inputTriggers') as InputTriggerServiceContract | undefined
  if (slash !== undefined) {
    disposers.push(ctx.effect(() => slash.registerSource(
      createPanelSlashSource((sessionId, instruction) => sendPanelInstruction(ctx, sessionId, instruction)),
    ), 'genui: /panel'))
  } else {
    console.warn('[genui] inputTriggers service unavailable; /panel command disabled')
  }
  return () => {
    for (const dispose of disposers) dispose()
  }
}

// Browser services the client entry needs: the slots registry (toolview +
// dock), sessions (scoped conversation send behind actions), and
// inputTriggers (the /panel command source). This declaration is what the
// host's fiber inject waiting uses — without it apply() runs before the
// services bind and the whole plugin tree fails the boot sweep.
export const inject = ['slots', 'sessions', 'inputTriggers']

// Re-export the registry renderer for the test suite (setup.ts registers it
// exactly like apply() does on contract hosts).
export { renderGenuiFence }
export type { GenuiFenceContext } from './fence-render.tsx'
