import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent, SessionStore, UserMessage } from '@deepseek-ai/dsh-session'
import { createHash, randomUUID } from 'node:crypto'
import { isRenderableProcess, processGenuiSpec } from '../client/guard.ts'
import { GENUI_CHECKBOX_VALUE } from '../client/spec.ts'
import { walkGenuiNodes } from '../client/walk-spec.ts'
import { compileSubmissionRegistry } from '../client/submission-registry.ts'
import { mergePanelSpecs } from '../shared/panel-merge.ts'
import type { GenuiSpec } from '../client/spec.ts'
import { extractDshUiFences } from './fence-feedback.ts'
import { nativeSubmission } from './dsh-go-submission.ts'
import { compileDshGo, fitsNativeView } from './dsh-go-compiler.ts'
import { emptyNativeState } from './dsh-go-types.ts'
import type { NativeEffect, NativeEvent, NativeScope, NativeState, NativeView } from './dsh-go-types.ts'

const PANEL = 'genui'
const RECORD = 'plugin:dsh-genui/native-state' as const
interface StateRecord { document: string; state: NativeState }
declare module '@deepseek-ai/dsh-session' {
  interface PluginRecordMap { 'plugin:dsh-genui/native-state': StateRecord }
}
export interface NativeDocument { spec: GenuiSpec; source: number; generation: string; stateIdentity: string; valid: boolean }
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,24)
const object = (v: unknown): Record<string,unknown> | undefined => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string,unknown>:undefined

/** Ordered replay of committed results and closed fences; never pending tool args. */
export function nativeDocument(events: readonly SessionEvent[],sessionId: string): NativeDocument | null {
  let spec: GenuiSpec | null = null, panel: GenuiSpec | null = null, source = -1, panelIdentity = '', stateIdentity = ''
  const calls = new Map<string,string>()
  const accept = (raw: unknown,seq: number,fromTool = false): void => {
    const result = processGenuiSpec(raw,{deferPanelReferences:true})
    if (!isRenderableProcess(result) || !result.spec) return
    const next = result.spec
    if (fromTool) {panel = next;panelIdentity = hash([sessionId,seq,next]);spec = panel;stateIdentity = panelIdentity}
    else if (next.panel) {
      if (!next.append || panel === null) panelIdentity = hash([sessionId,seq,next])
      panel = next.append ? mergePanelSpecs(panel,next):next;spec = panel;stateIdentity = panelIdentity
    } else {spec = next;stateIdentity = hash([sessionId,seq,next])}
    source = seq
  }
  for (const event of events) {
    if ('surfaceOp' in event && event.surfaceOp !== 'append') continue
    if (event.type === 'tool/call') calls.set(event.data.callId,event.data.name)
    if (event.type === 'tool/result' && !event.data.message.isError && calls.get(event.data.message.toolCallId) === 'render_ui') accept(event.data.meta,event.seq,true)
    if (event.type !== 'assistant/message' || event.data.interrupted) continue
    for (const block of event.data.message.content) {
      if (block.type !== 'text') continue
      for (const fence of extractDshUiFences(block.text)) {
        if (!fence.closed) continue
        try { accept(JSON.parse(fence.raw),event.seq) } catch { /* Invalid source remains available in the transcript. */ }
      }
    }
  }
  if (spec === null) return null
  const checked = processGenuiSpec(spec)
  return {spec,source,generation:hash([sessionId,source,spec]),stateIdentity,valid:isRenderableProcess(checked) && !checked.warnings.some(w => w.kind === 'truncated')}
}

function stateFrom(value: unknown): NativeState | undefined {
  const v = object(value), fields = object(v?.fields), choices = object(v?.choices), tabs = object(v?.tabs), feedback = object(v?.feedback)
  if (!fields || !choices || !tabs || !feedback) return undefined
  if (Object.values(feedback).some(v => typeof v !== 'string') || Object.values(fields).some(v => typeof v !== 'string') || Object.values(choices).some(v => !Array.isArray(v) || v.some(x => typeof x !== 'string')) || Object.values(tabs).some(v => !Number.isSafeInteger(v) || Number(v) < 0)) return undefined
  return {fields:Object.assign(Object.create(null),fields),choices:Object.assign(Object.create(null),structuredClone(choices)),tabs:Object.assign(Object.create(null),tabs),feedback:Object.assign(Object.create(null),feedback)}
}

/** Initialize declared defaults once, before either painting or collecting state. */
function effectiveState(spec: GenuiSpec,saved: NativeState = emptyNativeState()): NativeState {
  const checkboxDefaults = new Map<string,string[]>()
  walkGenuiNodes(spec,node => {
    if ((node.type === 'radio' || node.type === 'select') && node.selected !== undefined) {
      const key = node.type === 'radio' ? node.group:node.id
      const value = node.options[node.selected]
      if (key && value !== undefined && !Object.hasOwn(saved.fields,key)) saved.fields[key] = value
    }
    if (node.type === 'checkbox' && node.group && node.checked) {
      const list = checkboxDefaults.get(node.group) ?? []
      list.push(node.label);checkboxDefaults.set(node.group,list)
    }
  })
  for (const [key,values] of checkboxDefaults) if (!Object.hasOwn(saved.choices,key)) saved.choices[key] = values
  return saved
}

/** Native services are optional, late-bound, and owned by the plugin lifetime. */
export function installDshGoNative(ctx: Context, fenceEnabled = true): void {
  ctx.inject(['dshGo','systemPrompt'],native => {
    native.effect(() => native.systemPrompt.section({
      name:'genui:native',order:native.systemPrompt.getSectionOrder('STRUCTURED_OUTPUT'),
      text:fenceEnabled ? 'This host can also serve dsh-go; an installed bridge does NOT identify the active client. Preserve the full ordinary GenUI items spec and all web capabilities. When validate_dsh_ui returns native_fence_json, that exact JSON works in both clients; never hand-edit its derived children. If the user is using the native App, validate even small inline fences and use the GenUI native panel for local controls and exact callbacks. A missing native projection must never remove advanced content from the original spec or downgrade a web reply. Native [dsh-ui reply] carries only the visible title and choice; respond to that visible choice in context. Keep the existing [genui-action] payload protocol for panel actions. Explain native limitations only when relevant to the user’s current client.' : 'This host can also serve dsh-go; an installed bridge does NOT identify the active client. Preserve the full GenUI items spec and all web capabilities. Use the GenUI native panel for local controls and exact callbacks. Keep the existing [genui-action] payload protocol for panel actions. Explain native limitations only when relevant to the user’s current client.',
    }),'dsh-genui: native guidance')
  })
  ctx.inject(['dshGo','sessions'],native => {
    native.effect(async () => {
      const bridge = native.dshGo
      const unavailable = () => bridge.panel(PANEL,{view:(_scope,caps) => ({type:'callout',tone:'info',text:caps.locale.startsWith('en') ? 'Native panel state could not load. Check the plugin installation; web views and native cards still work.':'原生面板未能载入状态服务，请检查插件安装。网页版和原生卡片仍可使用。'})})
      // Loaded only on a native host. Ordinary web hosts keep no runtime session dependency.
      let api: {
        appendPluginRecord(session: Session,type: typeof RECORD,data: StateRecord): unknown
        pluginRecordOf(event: SessionEvent): {type:string;data:unknown} | undefined
      }
      try {api = await import('@deepseek-ai/dsh-session') as unknown as typeof api}
      catch {return unavailable()}
      const {appendPluginRecord,pluginRecordOf} = api
      if (typeof appendPluginRecord !== 'function' || typeof pluginRecordOf !== 'function') {
        return bridge.panel(PANEL,{view:(_scope,caps) => ({type:'callout',tone:'info',text:caps.locale.startsWith('en') ? 'Native panels require DSH 0.2.1-rc.2 or later. Web views and native cards still work.':'原生面板需要 DSH 0.2.1-rc.2 或更新版本。网页版和原生卡片仍可使用。'})})
      }
      const subscribers = new Map<string,Set<(data: Record<string,unknown>) => void>>()
      const sessions = native.reflect.get('sessions') as Pick<SessionStore,'get'>
      const read = (scope: NativeScope) => scope.sessionId === undefined ? undefined:sessions.get(scope.sessionId as Session['id'])
      const saved = (session: Session,document: NativeDocument): NativeState => {
        const events = session.snapshotEvents()
        for (let i = events.length-1;i >= 0;i--) {
          const record = pluginRecordOf(events[i]!)
          if (record?.type !== RECORD) continue
          const data = object(record.data)
          if (data?.document === document.stateIdentity) return effectiveState(document.spec,stateFrom(data.state))
        }
        return effectiveState(document.spec)
      }
      const info = (text: string): NativeView => ({type:'callout',tone:'info',text})
      const view = (scope: NativeScope,locale: string): NativeView => {
        const session = read(scope), en = locale.startsWith('en')
        if (!session) return info(en ? 'Open GenUI from a loaded conversation.':'请在已加载的对话中打开 GenUI。')
        const document = nativeDocument(session.snapshotEvents(),session.id)
        if (!document) return info(en ? 'No GenUI content in this conversation yet.':'这个对话还没有 GenUI 内容。')
        if (!document.valid) return info(en ? 'This document is incomplete or exceeds the native limits.':'此内容结构尚未完整，或已超过原生容量。')
        const state = saved(session,document)
        const compiled = compileDshGo(document.spec,'panel',state,locale,hash([document.generation,state]))
        return fitsNativeView(compiled.view,'panel') ? compiled.view:info(en ? 'This document exceeds the native panel limits. Its full content remains in the conversation.':'此内容超过原生面板容量，完整内容仍保留在对话中。')
      }
      const notify = (session: Session): void => {
        for (const emit of subscribers.get(session.id) ?? []) emit({revision:session.snapshotEvents().length})
        bridge.refresh(PANEL,{sessionId:session.id})
      }
      const invoke = (scope: NativeScope,event: NativeEvent): NativeEffect[] => {
        const en = event.locale.startsWith('en'), toast = (text: string): NativeEffect[] => [{type:'toast',text}]
        const session = read(scope)
        if (!session) return toast(en ? 'Conversation is unavailable.':'对话尚未加载。')
        const document = nativeDocument(session.snapshotEvents(),session.id)
        if (!document || !document.valid) return toast(en ? 'No usable GenUI content.':'暂无可操作的 GenUI 内容。')
        const state = saved(session,document)
        const compiled = compileDshGo(document.spec,'panel',state,event.locale,hash([document.generation,state]))
        const descriptor = compiled.actions.get(event.action ?? '')
        if (!descriptor || !fitsNativeView(compiled.view,'panel')) return toast(en ? 'Outdated control. Reopen the panel.':'此控件已失效，请重新打开面板。')
        const {node,key,kind} = descriptor, value = object(event.value) ?? {}
        let modelAction: string | undefined, payload: Record<string,unknown> = {}
        if (kind === 'reset' && node.type === 'submit') {
          const registry = compileSubmissionRegistry(document.spec)
          const groups = node.groups ?? [...registry.members.keys()]
          for (const group of groups) {delete state.fields[group];delete state.choices[group]}
          delete state.feedback[key]
          modelAction = node.resetAction;payload = {type:'submit-reset',groups}
        } else if (kind === 'tab' && node.type === 'tabs') {
          const index = typeof value.value === 'string' ? Number(value.value):NaN
          if (!Number.isSafeInteger(index) || index < 0 || index >= node.tabs.length) return toast(en ? 'Invalid choice.':'选项无效。')
          state.tabs[key] = index
        } else if (kind === 'accordion' && node.type === 'accordion') {
          if (!Array.isArray(value.values) || value.values.some(v => typeof v !== 'string' || !/^(0|[1-9]\d*)$/u.test(v) || Number(v) >= node.items.length)) return toast(en ? 'Invalid choice.':'选项无效。')
          state.choices[key] = [...new Set(value.values as string[])]
        } else switch (node.type) {
          case 'select': case 'radio': {
            if (typeof value.value !== 'string' || !node.options.includes(value.value)) return toast(en ? 'Invalid choice.':'选项无效。')
            const group = node.type === 'select' ? node.id:node.group
            state.fields[group ?? key] = value.value
            if (group) state.feedback = Object.create(null)
            modelAction = node.type === 'radio' && node.group ? undefined:node.action
            payload = {type:node.type,value:value.value,...(node.type === 'select' && node.id ? {id:node.id}:{})}
            break
          }
          case 'checkbox': case 'switch': {
            if (typeof value.confirmed !== 'boolean') return toast(en ? 'Invalid choice.':'选项无效。')
            const group = node.type === 'checkbox' ? node.group:undefined
            const selected = new Set(state.choices[group ?? key] ?? [])
            const identity = node.type === 'checkbox' ? node[GENUI_CHECKBOX_VALUE] ?? node.label:node.label
            if (value.confirmed) selected.add(identity);else selected.delete(identity)
            state.choices[group ?? key] = [...selected]
            if (group) state.feedback = Object.create(null)
            modelAction = group ? undefined:node.action
            payload = {type:node.type,...(node.type === 'checkbox' ? {label:node.label}:{}),checked:value.confirmed}
            break
          }
          case 'button': modelAction = node.action;payload = {type:'button',label:node.label};break
          case 'copy': return [{type:'copy',text:node.text}]
          case 'link': return node.href ? [{type:'link',url:node.href}]:[]
          case 'quiz': {
            const index = typeof value.value === 'string' ? Number(value.value):NaN
            if (!Number.isSafeInteger(index) || index < 0 || index >= node.options.length) return toast(en ? 'Invalid choice.':'选项无效。')
            state.choices[key] = [String(index)]
            break
          }
          case 'submit': {
            modelAction = node.action
            const {resolved,answers,fields,collectedAnswers} = nativeSubmission(document.spec,state,node.groups)
            if (!resolved.total || resolved.answered !== resolved.total) return toast(en ? 'Complete the required choices first.':'请先完成必选项。')
            if (resolved.localGradeEligible && (!resolved.hasOutOfScopePayload || !modelAction)) {
              const graded = resolved.scope.flatMap(member => member.kind === 'radio' && member.answer !== undefined ? [member]:[])
              const lines = graded.map(member => {
                const correct = typeof member.answer === 'number' ? member.options[member.answer]:member.answer
                return `${answers[member.key] === correct ? '✓':'✗'} ${member.label}: ${answers[member.key]}${answers[member.key] === correct ? '':` → ${correct}`}\n${member.explanation ?? ''}`
              })
              const score = graded.filter(member => answers[member.key] === (typeof member.answer === 'number' ? member.options[member.answer]:member.answer)).length
              state.feedback[key] = `${score} / ${graded.length}\n${lines.join('\n')}`
              modelAction = undefined
            } else {
              payload = {type:'submit',answers:collectedAnswers,...(Object.keys(fields).length ? {fields}:{}),total:resolved.total,answered:resolved.answered}
              if (!modelAction) return toast(en ? 'This submission has no model action.':'此提交未配置模型动作。')
            }
            break
          }
          default: return toast(en ? 'This control is unavailable.':'此控件暂不可用。')
        }
        if (modelAction) {
          const agent = native.get('agents')?.get(session.id)
          if (!agent || agent.session !== session || agent.status !== 'idle' || (agent.inbox.nextTurn.length || agent.inbox.nextStep.length)) return toast(en ? 'Wait until this conversation is ready.':'请等当前对话空闲后再操作。')
          agent.followup({id:randomUUID() as UserMessage['id'],role:'user',content:[{type:'text',text:`[genui-action] ${modelAction} ${JSON.stringify(payload)}`}],source:{kind:'user'}})
        }
        appendPluginRecord(session,RECORD,{document:document.stateIdentity,state})
        return [{type:'refresh',id:PANEL}]
      }
      const disposePanel = bridge.panel(PANEL,{
        view:(scope,caps) => view(scope,caps.locale),
        data:(scope,emit) => {
          if (!scope.sessionId) return () => {}
          const set = subscribers.get(scope.sessionId) ?? new Set()
          subscribers.set(scope.sessionId,set);set.add(emit)
          emit({revision:read(scope)?.snapshotEvents().length ?? 0})
          return () => {set.delete(emit);if (!set.size) subscribers.delete(scope.sessionId!)}
        },
      })
      const disposeActions = bridge.on(PANEL,invoke)
      const disposeEvents = native.on('session/event',(session,event) => {
        if (['assistant/message','tool/result',RECORD].includes(event.type)) notify(session)
      })
      return () => {disposeEvents();disposeActions();disposePanel();subscribers.clear()}
    },'dsh-genui: native panel')
  })
}
