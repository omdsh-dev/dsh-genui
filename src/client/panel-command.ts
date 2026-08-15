/**
 * /panel slash command + the default panel spec.
 *
 * The session panel dock is an always-present seat, but it only becomes
 * visible once a spec has been published — both existing publish paths
 * (render_ui tool result, panel:true fence) are model-driven. The /panel
 * command gives a deterministic, client-side entry point:
 * - `/panel` — publishes the default spec and requests the dock to expand
 *   instantly, with zero model round-trip;
 * - `/panel clear` (off/close) — empties the panel so the dock retracts;
 * - `/panel <指令>` — shows the default spec for immediate feedback, then
 *   relays the instruction to the model, which replaces the panel with
 *   content tailored to the request (panel:true fence).
 * Panel updates afterwards still flow through the model (say "更新面板" or
 * re-run render_ui) or through another /panel.
 */
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { GenuiSpec } from './spec.ts'
import { requestPanelExpand, setLocalPanel } from './panel-store.ts'

/** Default panel content published by `/panel`: the component overview. */
export const DEFAULT_PANEL_SPEC: GenuiSpec = {
  title: 'GenUI panel',
  items: [
    { type: 'text', size: 'h3', content: 'GenUI generative interface' },
    { type: 'text', size: 'muted', content: 'The panel updates in place: say "update panel" in chat, or run /panel again to refresh.' },
    {
      type: 'grid', cols: 4, items: [
        { type: 'stat', label: 'Components', value: '38' },
        { type: 'stat', label: 'Single', value: '12' },
        { type: 'stat', label: 'Composite', value: '8' },
        { type: 'stat', label: 'Advanced', value: '18' },
      ],
    },
    {
      type: 'list', items: [
        { title: 'Single ×12', desc: 'text button input select checkbox link badge stat progress divider avatar spacer' },
        { title: 'Composite ×8', desc: 'row col grid card list table chart tabs' },
        { title: 'Data ×7', desc: 'plot callout steps keyvalue diff json code' },
        { title: 'Interactive ×5', desc: 'radio switch textarea accordion copy' },
        { title: 'Advanced ×5', desc: 'mermaid scene3d timeline file-tree breadcrumb' },
        { title: 'Quiz ×1', desc: 'quiz' },
      ],
    },
    { type: 'callout', tone: 'info', title: 'How to update', content: 'Say "update panel" in chat → the model emits a panel:true fence; /panel clear empties the panel.' },
  ],
}

/** Shared command application: apply the local override (default panel +
 * expand, or clear). The override is the fold base and shields against every
 * replay at/below the highest message seq seen so far; the next later real
 * tool/fence operation replaces or merges into it as usual. */
function applyPanelCommand(sessionId: string, args: string): void {
  const cmd = args.trim().toLowerCase()
  if (cmd === 'clear' || cmd === 'off' || cmd === 'close') {
    setLocalPanel(sessionId, null)
    return
  }
  setLocalPanel(sessionId, DEFAULT_PANEL_SPEC)
  requestPanelExpand(sessionId)
}

/**
 * Build the command claim for one session (span CAS is handled by the input).
 * `sendInstruction` relays a /panel instruction to the model when the user
 * typed more than a bare command — otherwise the instruction would be
 * swallowed (the draft is cleared on submit) and the panel would never leave
 * its default content.
 */
function panelClaim(sessionId: SessionId, sendInstruction: (sessionId: SessionId, instruction: string) => void) {
  return {
    token: '/panel',
    hint: 'Enable the GenUI panel; /panel <command> customizes it; /panel clear empties it',
    submit: async (args: string, _actx: ClientContext) => {
      const instruction = args.trim()
      if (instruction === '' ) {
        applyPanelCommand(sessionId, '')
      } else if (/^(clear|off|close)$/i.test(instruction)) {
        applyPanelCommand(sessionId, instruction)
      } else {
        // Instructed panel: show the default spec instantly for feedback,
        // then let the model replace it with the requested content.
        applyPanelCommand(sessionId, '')
        sendInstruction(sessionId, instruction)
      }
      // Success clears the draft without sending a message (the dock itself
      // is the feedback); no `text` so the input shows no notice either.
      return { kind: 'success' as const }
    },
  }
}

/**
 * The /panel source. Menu group `genui` under the '/' trigger; the panel
 * candidate claims the line so both the menu pick and a bare `/panel` enter
 * resolve to the same command. `matchEnter` is implemented so the command
 * works without opening the menu (leading-token adjudication), and it also
 * catches `/panel clear` style args.
 */
export function createPanelSlashSource(sendInstruction: (sessionId: SessionId, instruction: string) => void): InputTriggerSource {
  return {
    trigger: '/',
    name: 'genui',
    order: 60,
    candidates: async (_session, _req) => [{
      name: 'panel',
      description: 'Enable the GenUI panel (/panel clear empties; /panel <command> customizes content)',
      hint: '/panel',
    }],
    onPick(pick) {
      return { claim: panelClaim(pick.session.sessionId, sendInstruction) }
    },
    matchEnter: async (session, line, _signal) => {
      if (!/^\/panel(?:\s|$)/.test(line.trim())) return undefined
      return { claim: panelClaim(session.sessionId, sendInstruction) }
    },
  }
}
