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
  title: 'GenUI 面板',
  items: [
    { type: 'text', size: 'h3', content: 'GenUI 生成式界面' },
    { type: 'text', size: 'muted', content: '面板会原地更新：对话里说「更新面板」，或再次执行 /panel 刷新。' },
    {
      type: 'grid', cols: 4, items: [
        { type: 'stat', label: '组件', value: '38' },
        { type: 'stat', label: '单个', value: '12' },
        { type: 'stat', label: '组合', value: '8' },
        { type: 'stat', label: '高级', value: '18' },
      ],
    },
    {
      type: 'list', items: [
        { title: '单个 ×12', desc: 'text button input select checkbox link badge stat progress divider avatar spacer' },
        { title: '组合 ×8', desc: 'row col grid card list table chart tabs' },
        { title: '数据 ×7', desc: 'plot callout steps keyvalue diff json code' },
        { title: '交互 ×5', desc: 'radio switch textarea accordion copy' },
        { title: '高级 ×5', desc: 'mermaid scene3d timeline file-tree breadcrumb' },
        { title: '教学 ×1', desc: 'quiz' },
      ],
    },
    { type: 'callout', tone: 'info', title: '更新方式', content: '对话说「更新面板」→ 模型输出 panel:true 围栏；/panel clear 清空面板。' },
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
    hint: '开启 GenUI 面板；/panel <指令> 让模型定制；/panel clear 清空',
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
    candidates: async (_session, req) => {
      // Filter by query prefix: once the user types past "panel" the genui
      // group must disappear. Unfiltered candidates kept this group the only
      // ready non-empty group for unmatched queries, so the menu's default
      // highlight fell through to `panel` and Enter picked it instead of the
      // intended command/skill candidate.
      const query = req.query.toLowerCase()
      if (query !== '' && !'panel'.startsWith(query)) return []
      return [{
        name: 'panel',
        description: '开启 GenUI 面板（/panel clear 清空；/panel <指令> 定制内容）',
        hint: '/panel',
      }]
    },
    onPick(pick) {
      return { claim: panelClaim(pick.session.sessionId, sendInstruction) }
    },
    matchEnter: async (session, line, _signal) => {
      if (!/^\/panel(?:\s|$)/.test(line.trim())) return undefined
      return { claim: panelClaim(session.sessionId, sendInstruction) }
    },
  }
}
