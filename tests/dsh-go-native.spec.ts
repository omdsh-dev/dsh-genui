import { describe,expect,it,vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as GenUI from '../src/plugin/index.ts'
import { Session } from '@deepseek-ai/dsh-session'
import * as SessionApi from '@deepseek-ai/dsh-session'
import { installDshGoNative,nativeDocument } from '../src/plugin/dsh-go-native.ts'
import { compileDshGo,dualNativeFence,fitsNativeView } from '../src/plugin/dsh-go-compiler.ts'
import { emptyNativeState } from '../src/plugin/dsh-go-types.ts'
import type { NativeBridge,NativeView } from '../src/plugin/dsh-go-types.ts'
import type { GenuiSpec } from '../src/client/spec.ts'
import { processGenuiSpec } from '../src/client/guard.ts'
import { createValidateDshUiTool } from '../src/plugin/tool.ts'

function append(session: Session,spec: GenuiSpec) {
  session.append('assistant/message',{turn:1,step:1,message:{id:`message-${session.snapshotEvents().length}` as never,role:'assistant',source:{kind:'model',provider:'test',model:'test'},content:[{type:'text',text:`\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``}]},stream:[]},{surfaceOp:'append'})
}
function makeSession(id: string,spec: GenuiSpec) {const s = Session.create(id as never);append(s,spec);return s}
const nodeIds = (view: NativeView): string[] => [
  ...(typeof view.id === 'string' ? [view.id]:[]),
  ...((view.items ?? []) as {action?:unknown}[]).flatMap(i => typeof i.action === 'string' ? [i.action]:[]),
  ...((view.children ?? []) as NativeView[]).flatMap(nodeIds),
]
const hasNativeRecords = 'appendPluginRecord' in SessionApi && 'pluginRecordOf' in SessionApi
const nativeIt = it.runIf(hasNativeRecords)

async function host(sessions: Session[]) {
  const ctx = new Context(), store = new Map(sessions.map(s => [s.id,s]))
  let panel: Parameters<NativeBridge['panel']>[1] | undefined
  let invoke: Parameters<NativeBridge['on']>[1] | undefined
  const refresh = vi.fn()
  const bridge: NativeBridge = {
    panel:vi.fn((_id,definition) => {panel = definition;return () => {panel = undefined}}),
    on:vi.fn((_id,handler) => {invoke = handler;return () => {invoke = undefined}}),refresh,
  }
  const agents = new Map(sessions.map(session => {
    const agent = {session,status:'idle',inbox:{nextTurn:[] as unknown[],nextStep:[] as unknown[]},followup:vi.fn((message: unknown) => {agent.inbox.nextTurn.push(message)})}
    return [session.id,agent]
  }))
  ctx.provide('sessions',{get:(id: Session['id']) => store.get(id),list:() => [...store.values()]})
  ctx.provide('agents',{get:(id: Session['id']) => agents.get(id)})
  ctx.provide('dshGo',bridge)
  const plugin = await ctx.plugin({name:'native-test',apply:installDshGoNative})
  await vi.waitFor(() => expect(panel).toBeDefined())
  return {ctx,plugin,bridge,agents,store,
    view:(id: string) => panel!.view({sessionId:id},{locale:'en',components:[]}),
    tap:(id: string,action: string,value: unknown = {}) => invoke!({sessionId:id},{action,value,locale:'en'}),
  }
}

describe('existing native surfaces without changing the App',() => {
  it('keeps native and fence prompt sections within budget', async () => {
    for (const [fenceSection, limit] of [
      ['full', 2500],
      ['minimal', 1600],
      [false, 850],
    ] as const) {
      const h = await host([])
      await h.plugin.dispose()
      await h.ctx.plugin(SystemPrompt)
      const genui = await h.ctx.plugin(GenUI, { fenceSection })
      const assembly = await h.ctx.systemPrompt.assemble({})
      const native = assembly.sections.find(section => section.name === 'genui:native')
      const fence = assembly.sections.find(section => section.name === 'genui:fence')
      expect(native).toBeDefined()
      expect(fence !== undefined).toBe(fenceSection !== false)
      expect(renderPrompt({ ...assembly, sections: [native!] }).length).toBeLessThanOrEqual(850)
      const sections = assembly.sections.filter(section => section.name === 'genui:native' || section.name === 'genui:fence')
      expect(renderPrompt({ ...assembly, sections }).length).toBeLessThanOrEqual(limit)
      await genui.dispose()
    }
  })


  it('reports the installed host capability without breaking native projections',async () => {
    const s = makeSession('capability',{items:[{type:'text',content:'Hello'}]}),h = await host([s])
    if (hasNativeRecords) expect(h.view(s.id).type).toBe('stack')
    else {expect(JSON.stringify(h.view(s.id))).toContain('DSH 0.2.1-rc.2');expect(h.bridge.on).not.toHaveBeenCalled()}
    expect(dualNativeFence({items:[{type:'text',content:'Hello'}]})).not.toBeNull()
    await h.plugin.dispose()
  })

  it('contains a native-only dependency failure and reports it explicitly',async () => {
    vi.doMock('@deepseek-ai/dsh-session',() => {throw new Error('simulated missing optional session module')})
    let h: Awaited<ReturnType<typeof host>> | undefined
    try {
      const s = makeSession('missing-native-dependency',{items:[{type:'text',content:'Hello'}]})
      h = await host([s])
      expect(JSON.stringify(h.view(s.id))).toContain('Check the plugin installation')
      expect(h.bridge.on).not.toHaveBeenCalled()
      expect(dualNativeFence({items:[{type:'text',content:'Hello'}]})).not.toBeNull()
    } finally {await h?.plugin.dispose();vi.doUnmock('@deepseek-ai/dsh-session')}
  })
  it('keeps web content and diagnostics intact in a dual fence',async () => {
    const spec: GenuiSpec = {title:'Choose',items:[{type:'stat',label:'Total',value:'10'},{type:'select',label:'Period',options:['Today','Week'],action:'period'}]}
    const dual = dualNativeFence(spec)!
    expect(dual.type).toBe('stack')
    expect(dual.items).toEqual(spec.items)
    expect(processGenuiSpec(dual)).toMatchObject({errors:[],warnings:[],spec:processGenuiSpec(spec).spec})
    const result = String(await createValidateDshUiTool().execute({spec}))
    expect(result).toContain('native_fence_json:')
    expect(JSON.parse(result.split('native_fence_json:\n```\n')[1]!.split('\n```')[0]!)).toEqual(dual)
    expect(processGenuiSpec({...dual,typo:'still diagnosed'}).warnings).toContainEqual(expect.objectContaining({path:'spec.typo'}))
  })

  it('checks the whole dual document against the 16 KiB fence limit',() => {
    const spec: GenuiSpec = {items:Array.from({length:10},() => ({type:'text',content:'x'.repeat(1000)}))}
    expect(fitsNativeView(compileDshGo(spec,'fence').view,'fence')).toBe(true)
    expect(dualNativeFence(spec)).toBeNull()
    expect(processGenuiSpec(spec).spec?.items).toHaveLength(10)
  })

  it('uses visible native confirmation only for one model action, preserving local controls for the panel',() => {
    expect(JSON.stringify(dualNativeFence({items:[{type:'switch',label:'Enable notices',action:'notices'}]}))).toContain('"type":"confirm"')
    expect(dualNativeFence({items:[{type:'select',options:['A','B']}]})).toBeNull()
    expect(dualNativeFence({items:[{type:'select',options:['A','B'],action:'one'},{type:'select',options:['A','B'],action:'two'}]})).toBeNull()
  })

  it('does not turn an ambiguous visible reply or local widget into a hidden action',() => {
    expect(dualNativeFence({items:[{type:'select',options:['A、B','A'],action:'select'}]})).toBeNull()
    expect(dualNativeFence({items:[{type:'tabs',tabs:[{label:'One',items:[{type:'text',content:'One'}]}]}]})).toBeNull()
    const state = emptyNativeState()
    state.fields.period = 'B'
    const r = compileDshGo({items:[{type:'select',id:'period',options:['A','B']},{type:'table',columns:['Name'],rows:[['A'],['B']],filter:'period'}]},'panel',state)
    expect(JSON.stringify(r.view)).toContain('"selected":["B"]')
    expect(JSON.stringify(r.view)).toContain('"rows":[["B"]]')
  })

  nativeIt('shows unsupported and over-budget content explicitly, keeping the source',async () => {
    const spec: GenuiSpec = {items:[{type:'scene3d',meshes:[{shape:'box'}]},{type:'input',inputType:'password',id:'secret',value:'never persist'}]}
    const s = makeSession('unsupported',spec), h = await host([s])
    expect(JSON.stringify(h.view(s.id))).toContain('Unavailable')
    expect(nodeIds(h.view(s.id))).toEqual([])
    expect(s.snapshotEvents()).toHaveLength(1)
    await h.plugin.dispose()
  })

  nativeIt('persists local choices and restores them from the actual session record',async () => {
    const spec: GenuiSpec = {items:[{type:'select',id:'period',options:['A','B']},{type:'switch',label:'Enabled'}]}
    const s = makeSession('restore',spec), h = await host([s])
    const ids = nodeIds(h.view(s.id))
    await h.tap(s.id,ids[0]!,{value:'B'})
    await h.tap(s.id,nodeIds(h.view(s.id))[1]!,{confirmed:true})
    expect(h.agents.get(s.id)!.followup).not.toHaveBeenCalled()
    expect(s.snapshotEvents().at(-1)).toMatchObject({type:'plugin:dsh-genui/native-state',ignorable:true})
    const before = h.view(s.id)
    const restored = Session.create(s.id,s.snapshotEvents())
    await h.plugin.dispose()
    const next = await host([restored])
    expect(next.view(s.id)).toEqual(before)
    await next.plugin.dispose()
  })

  nativeIt('routes model actions only to the owning idle conversation and rejects duplicate input',async () => {
    const spec: GenuiSpec = {items:[{type:'button',label:'Continue',action:'continue'}]}
    const a = makeSession('thread-a',spec),b = makeSession('thread-b',spec),h = await host([a,b])
    const id = nodeIds(h.view(a.id))[0]!
    await h.tap(b.id,id)
    expect(h.agents.get(b.id)!.followup).not.toHaveBeenCalled()
    await h.tap(a.id,id)
    await h.tap(a.id,id)
    expect(h.agents.get(a.id)!.followup).toHaveBeenCalledTimes(1)
    expect(h.agents.get(a.id)!.followup.mock.calls[0]![0]).toMatchObject({content:[{text:'[genui-action] continue {"type":"button","label":"Continue"}'}]})
    h.agents.get(b.id)!.status = 'running'
    await h.tap(b.id,nodeIds(h.view(b.id))[0]!)
    expect(h.agents.get(b.id)!.followup).not.toHaveBeenCalled()
    await h.plugin.dispose()
  })

  nativeIt('rejects stale control ids and unknown option values',async () => {
    const s = makeSession('stale',{items:[{type:'select',options:['A','B'],action:'choose'}]}),h = await host([s])
    const old = nodeIds(h.view(s.id))[0]!
    await h.tap(s.id,old,{value:'not-an-option'})
    expect(h.agents.get(s.id)!.followup).not.toHaveBeenCalled()
    append(s,{items:[{type:'select',options:['New'],action:'new'}]})
    await h.tap(s.id,old,{value:'A'})
    expect(h.agents.get(s.id)!.followup).not.toHaveBeenCalled()
    await h.plugin.dispose()
    expect(h.bridge.on).toHaveBeenCalledTimes(1)
  })

  nativeIt('keeps copy, links, tabs and local quiz grading on their native paths',async () => {
    const s = makeSession('local',{items:[{type:'copy',text:'Copied'},{type:'link',label:'Docs',href:'https://example.com/docs'},{type:'tabs',tabs:[{label:'One',items:[{type:'text',content:'First'}]},{label:'Two',items:[{type:'text',content:'Second'}]}]},{type:'quiz',question:'2+2?',options:[{label:'4',correct:true},{label:'5'}]}]})
    const h = await host([s]), ids = nodeIds(h.view(s.id))
    expect(await h.tap(s.id,ids[0]!)).toEqual([{type:'copy',text:'Copied'}])
    expect(await h.tap(s.id,ids[1]!)).toEqual([{type:'link',url:'https://example.com/docs'}])
    await h.tap(s.id,ids[2]!,{value:'1'})
    expect(JSON.stringify(h.view(s.id))).toContain('Second')
    expect(JSON.stringify(h.view(s.id))).not.toContain('First')
    await h.tap(s.id,nodeIds(h.view(s.id))[3]!,{value:'0'})
    expect(JSON.stringify(h.view(s.id))).toContain('Correct')
    expect(h.agents.get(s.id)!.followup).not.toHaveBeenCalled()
    await h.plugin.dispose()
  })

  it('replays panel append by tab label without mixing in earlier inline cards',() => {
    const s = makeSession('ordered',{items:[{type:'text',content:'Inline'}]})
    append(s,{panel:true,append:true,items:[{type:'tabs',tabs:[{label:'A',items:[{type:'text',content:'First'}]}]}]})
    append(s,{panel:true,append:true,items:[{type:'tabs',tabs:[{label:'A',items:[{type:'text',content:'Second'}]}]}]})
    const doc = nativeDocument(s.snapshotEvents(),s.id)!
    expect(JSON.stringify(doc.spec)).not.toContain('Inline')
    expect(doc.spec.items).toEqual([{type:'tabs',tabs:[{label:'A',items:[{type:'text',content:'First'},{type:'text',content:'Second'}]}]}])
  })

  nativeIt('keeps defaults, checkbox groups and computed labels in the submission state',async () => {
    const s = makeSession('defaults',{computed:[{id:'amount',expr:'12'}],items:[
      {type:'radio',group:'q',options:['A','B'],selected:0},
      {type:'checkbox',group:'g',label:'Accept {{amount}}',checked:true},
      {type:'checkbox',group:'g',label:'Other',checked:true},
      {type:'switch',label:'Local toggle'},
      {type:'submit',label:'Send',groups:['q','g'],action:'send'},
    ]})
    const h = await host([s])
    await h.tap(s.id,nodeIds(h.view(s.id))[2]!,{confirmed:false})
    expect(JSON.stringify(h.view(s.id))).toContain('Accept 12 · On')
    await h.tap(s.id,nodeIds(h.view(s.id))[3]!,{confirmed:true})
    await h.tap(s.id,nodeIds(h.view(s.id)).at(-1)!)
    const message = h.agents.get(s.id)!.followup.mock.calls[0]![0] as {content:{text:string}[]}
    expect(message.content[0]!.text).toBe('[genui-action] send {"type":"submit","answers":{"q":"A","g":["Accept 12"]},"total":2,"answered":2}')
    await h.plugin.dispose()
  })

  nativeIt('grades default radio answers locally and resets with the existing web payload',async () => {
    const s = makeSession('grade',{items:[{type:'radio',label:'Question',group:'q',options:['A','B'],selected:0,answer:0},{type:'submit',label:'Grade',groups:['q'],resetAction:'reset'}]})
    const h = await host([s])
    await h.tap(s.id,nodeIds(h.view(s.id)).at(-1)!)
    expect(JSON.stringify(h.view(s.id))).toContain('1 / 1')
    expect(h.agents.get(s.id)!.followup).not.toHaveBeenCalled()
    await h.tap(s.id,nodeIds(h.view(s.id)).at(-1)!)
    expect(h.agents.get(s.id)!.followup.mock.calls[0]![0]).toMatchObject({content:[{text:'[genui-action] reset {"type":"submit-reset","groups":["q"]}'}]})
    await h.plugin.dispose()
  })

  nativeIt('preserves choices through panel append and resolves references after merge',async () => {
    const s = makeSession('append-state',{panel:true,items:[{type:'select',id:'period',options:['A','B']},{type:'radio',group:'q',options:['Yes','No'],selected:0}]})
    const h = await host([s])
    await h.tap(s.id,nodeIds(h.view(s.id))[0]!,{value:'B'})
    append(s,{panel:true,append:true,items:[{type:'submit',label:'Send',groups:['period','q'],action:'send'}]})
    expect(JSON.stringify(h.view(s.id))).toContain('"selected":["B"]')
    await h.tap(s.id,nodeIds(h.view(s.id)).at(-1)!)
    expect(h.agents.get(s.id)!.followup).toHaveBeenCalledTimes(1)
    await h.plugin.dispose()
  })

  nativeIt('never maps a delayed filtered-list click onto another action',async () => {
    const s = makeSession('filtered',{items:[{type:'select',id:'filter',options:['Alpha','Beta']},{type:'list',filter:'filter',items:[{type:'button',label:'Alpha',action:'approve_alpha'},{type:'button',label:'Beta',action:'delete_beta'}]}]})
    const h = await host([s]), initial = nodeIds(h.view(s.id))
    await h.tap(s.id,initial[0]!,{value:'Beta'})
    await h.tap(s.id,initial[1]!)
    expect(h.agents.get(s.id)!.followup).not.toHaveBeenCalled()
    await h.tap(s.id,nodeIds(h.view(s.id)).at(-1)!)
    expect(h.agents.get(s.id)!.followup.mock.calls[0]![0]).toMatchObject({content:[{text:'[genui-action] delete_beta {"type":"button","label":"Beta"}'}]})
    await h.plugin.dispose()
  })

  it('ignores model-only replacement copies when finding the latest human card',() => {
    const s = Session.create('replacement' as never)
    const callId = 'call-old' as never
    s.append('tool/call',{turn:1,step:1,callId,name:'render_ui',arguments:'{}'})
    const result = s.append('tool/result',{turn:1,step:1,message:{id:'old-result' as never,role:'tool',toolCallId:callId,source:{kind:'tool',callId},content:[{type:'text',text:'old'}]},meta:{items:[{type:'text',content:'Old'}]}},{surfaceOp:'append'})
    append(s,{items:[{type:'text',content:'Current'}]})
    s.append('tool/result',{...result.data,message:{...result.data.message,content:[{type:'text',text:'compacted'}]}},{surfaceOp:{op:'replace',startSeq:result.seq,endSeq:result.seq},sourceEventSeqs:[result.seq]})
    const document = nativeDocument(s.snapshotEvents(),s.id)!
    expect(document.spec.items).toEqual([{type:'text',content:'Current'}])
    expect(document.source).toBe(2)
  })

  nativeIt('keeps untouched optional groups out of grading and preserves the grade through unrelated toggles',async () => {
    for (const action of [undefined,'grade']) {
      const s = makeSession(`optional-${action}`,{items:[{type:'radio',group:'q',options:['A','B'],selected:0,answer:0},{type:'checkbox',group:'other',label:'Optional'},{type:'switch',label:'Local'},{type:'submit',label:'Grade',...(action ? {action,groups:['q']}:{})}]})
      const h = await host([s])
      await h.tap(s.id,nodeIds(h.view(s.id)).at(-1)!)
      expect(JSON.stringify(h.view(s.id))).toContain('1 / 1')
      expect(h.agents.get(s.id)!.followup).not.toHaveBeenCalled()
      await h.tap(s.id,nodeIds(h.view(s.id))[2]!,{confirmed:true})
      expect(JSON.stringify(h.view(s.id))).toContain('1 / 1')
      await h.plugin.dispose()
    }
  })

  nativeIt('gives identical forms in different messages independent answers',async () => {
    const spec: GenuiSpec = {items:[{type:'select',id:'pick',options:['A','B']}]}
    const s = makeSession('separate-cards',spec),h = await host([s])
    await h.tap(s.id,nodeIds(h.view(s.id))[0]!,{value:'B'})
    append(s,spec)
    expect(JSON.stringify(h.view(s.id))).not.toContain('"selected":["B"]')
    await h.plugin.dispose()
  })

  it('uses a successful tool result as the replacement base for later panel appends',() => {
    const s = makeSession('tool-base',{panel:true,items:[{type:'text',content:'Old panel'}]})
    const callId = 'replace' as never
    s.append('tool/call',{turn:1,step:1,callId,name:'render_ui',arguments:'{}'})
    s.append('tool/result',{turn:1,step:1,message:{id:'tool-base-result' as never,role:'tool',toolCallId:callId,source:{kind:'tool',callId},content:[{type:'text',text:'rendered'}]},meta:{items:[{type:'text',content:'Tool base'}]}},{surfaceOp:'append'})
    append(s,{panel:true,append:true,items:[{type:'text',content:'Append'}]})
    expect(nativeDocument(s.snapshotEvents(),s.id)!.spec.items).toEqual([{type:'text',content:'Tool base'},{type:'text',content:'Append'}])
  })

  it('preserves formatted computed cells in native tables',() => {
    const spec: GenuiSpec = {computed:[{id:'amount',expr:'12.5',format:{style:'currency',currency:'USD',locale:'en-US'}}],items:[{type:'table',columns:['Amount'],rows:[[{ $computed:'amount' }]]}]}
    const compiled = compileDshGo(spec,'panel')
    expect(compiled.issues).toEqual([])
    expect(JSON.stringify(compiled.view)).toContain('$12.50')
  })

  nativeIt('exports the full computed source table through native clipboard effects, as the web table does',async () => {
    const s = makeSession('table-export',{computed:[{id:'amount',expr:'12.5',format:{style:'currency',currency:'USD',locale:'en-US'}}],items:[
      {type:'select',id:'filter',options:['$12.50','Other'],selected:0},
      {type:'table',columns:['Name','Amount'],rows:[['A|B',{ $computed:'amount' }],['Other','say "yes", please']],export:true,filter:'filter'},
    ]})
    const h = await host([s]), ids = nodeIds(h.view(s.id))
    expect(JSON.stringify(h.view(s.id))).toContain('"rows":[["A|B","$12.50"]]')
    expect(await h.tap(s.id,ids[1]!)).toEqual([{type:'copy',text:'| Name | Amount |\n| --- | --- |\n| A\\|B | $12.50 |\n| Other | say "yes", please |'}])
    expect(await h.tap(s.id,ids[2]!)).toEqual([{type:'copy',text:'A|B,$12.50\nOther,"say ""yes"", please"'}])
    expect(h.agents.get(s.id)!.followup).not.toHaveBeenCalled()
    await h.plugin.dispose()
  })

  it('keeps a table readable when its full export exceeds the native clipboard limit',() => {
    const spec: GenuiSpec = {items:[{type:'table',columns:['Name'],rows:Array.from({length:50},() => ['x'.repeat(180)]),export:true}]}
    const compiled = compileDshGo(spec,'panel')
    expect(fitsNativeView(compiled.view,'panel')).toBe(true)
    expect(compiled.issues).toEqual(['n.0.export0: clipboard limit','n.0.export1: clipboard limit'])
    expect(compiled.actions.size).toBe(0)
    expect(JSON.stringify(compiled.view)).toContain('"type":"table"')
    expect(compileDshGo(spec,'tool').issues).not.toHaveLength(0)
  })

  it('does not offer an empty CSV effect that the native bridge would reject',() => {
    for (const rows of [[],[['']]]) {
      const compiled = compileDshGo({items:[{type:'table',columns:['Name'],rows,export:true}]},'panel')
      expect(compiled.issues).toEqual(['n.0.export1: 没有可复制的内容'])
      expect(compiled.actions.size).toBe(1)
      expect([...compiled.actions.values()][0]!.node).toMatchObject({type:'copy',text:'| Name |\n| --- |'+(rows.length ? '\n|  |':'')})
      expect(fitsNativeView(compiled.view,'panel')).toBe(true)
    }
  })

  nativeIt('keeps longer grading feedback readable and resettable within native text limits',async () => {
    const questions = Array.from({length:3},(_,i) => ({type:'radio' as const,group:`q${i}`,label:`Q${i}`,options:['A','B'],selected:0,answer:0,explanation:'😀'.repeat(500)}))
    const s = makeSession('long-feedback',{items:[...questions,{type:'submit',label:'Grade',groups:['q0','q1','q2']}]}),h = await host([s])
    await h.tap(s.id,nodeIds(h.view(s.id)).at(-1)!)
    expect(fitsNativeView(h.view(s.id),'panel')).toBe(true)
    expect(JSON.stringify(h.view(s.id))).toContain('3 / 3')
    await h.tap(s.id,nodeIds(h.view(s.id)).at(-1)!)
    expect(JSON.stringify(h.view(s.id))).not.toContain('3 / 3')
    await h.plugin.dispose()
  })
})
