import { createHash } from 'node:crypto'
import { GENUI_CHECKBOX_VALUE, GENUI_COMPUTED_CELL } from '../client/spec.ts'
import type { GenuiNode, GenuiSpec } from '../client/spec.ts'
import { evaluateComputed, resolveComputedSpec } from '../client/computed.ts'
import { tableCellText, tableToCsv, tableToMarkdown } from '../client/table-export.ts'
import { nativeSubmission } from './dsh-go-submission.ts'
import { emptyNativeState } from './dsh-go-types.ts'
import type { NativeState, NativeView } from './dsh-go-types.ts'

export type NativeSurface = 'tool' | 'fence' | 'panel'
export interface NativeAction { node: GenuiNode; key: string; kind?: 'tab' | 'accordion' | 'reset' }
export const nativeIdentity = (spec: GenuiSpec): string => createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0,24)
const text = (value: string): NativeView => ({ type:'text',text:value })
const stack = (children: NativeView[]): NativeView => ({ type:'stack',children })
const tone = (value: string | undefined): string | undefined => ({success:'good',warning:'warn',error:'bad',danger:'bad'} as Record<string,string>)[value ?? ''] ?? value

/** Keep full grading feedback within the App's 2000 UTF-16 units per text node. */
function feedbackBlocks(value: string): NativeView[] {
  const parts: NativeView[] = []
  let start = 0
  while (start < value.length) {
    let end = Math.min(start+2000,value.length)
    if (end < value.length && /[\uD800-\uDBFF]/u.test(value[end-1]!)) end--
    parts.push({type:'callout',tone:'info',text:value.slice(start,end)})
    start = end
  }
  return parts
}

/** The original web spec stays authoritative; native limitations are visible. */
export function compileDshGo(spec: GenuiSpec, surface: NativeSurface, state: NativeState = emptyNativeState(), locale = 'zh', generation?: string) {
  const identity = generation ?? nativeIdentity(spec), actions = new Map<string,NativeAction>(), issues: string[] = []
  const en = locale.startsWith('en')
  const unsupported = (key: string,reason: string): NativeView => {
    issues.push(`${key}: ${reason}`)
    return {type:'callout',tone:'warn',text:en ? `Unavailable in the native view: ${reason}` : `原生界面暂不支持：${reason}`}
  }
  const action = (node: GenuiNode,key: string,kind?: NativeAction['kind']): string => {
    const id = `g${identity}.${key}${kind ? `.${kind}`:''}`
    actions.set(id,{node,key,...(kind ? {kind}:{})})
    return id
  }
  const panelOnly = (key: string) => unsupported(key,en ? 'use the GenUI native panel for this interaction':'此交互请打开 GenUI 原生面板')
  const labeled = (label: string | undefined,body: NativeView) => label ? stack([text(label),body]):body
  const choices = (item: GenuiNode,key: string,labels: string[],selected: string[] = []): NativeView => {
    if (labels.length > 8 || new Set(labels).size !== labels.length || labels.some(l => l.length > 80 || /[\r\n]/u.test(l))) return unsupported(key,'options labels/limit')
    if (surface === 'tool' || (surface === 'fence' && labels.some(l => l.includes('、')))) return panelOnly(key)
    return {type:'options',id:surface === 'panel' ? action(item,key):key,options:labels.map(label => ({label,value:label})),...(surface === 'panel' ? {selected}:{})}
  }
  const children = (items: GenuiNode[],key: string): NativeView[] => items.map((item,i) => node(item,`${key}.${i}`))
  const node = (item: GenuiNode,key: string): NativeView => {
    switch (item.type) {
      case 'row': case 'col': case 'grid': case 'card': {
        if ((item.type === 'row' || item.type === 'grid') && item.items.length >= 2 && item.items.length <= 4) {
          const cards = item.items.flatMap(card => card.type === 'card' && card.title && card.title.length <= 40 && (card.eyebrow?.length ?? 0) <= 12 && card.items.length === 1 && card.items[0]?.type === 'keyvalue' && card.items[0].pairs.length <= 8 && card.items[0].pairs.every(p => p.key.length <= 40 && p.value.length <= 80) ? [{title:card.title,...(card.eyebrow ? {badge:card.eyebrow}:{}),rows:card.items[0].pairs.map(p => [p.key,p.value])}]:[])
          if (cards.length === item.items.length) return {type:'compare',items:cards}
        }
        const c = children(item.items,key)
        if (item.type === 'card') { if (item.title) c.unshift(text(item.title)); if (item.eyebrow) c.unshift(text(item.eyebrow)) }
        return {type:item.type === 'row' || item.type === 'grid' ? 'row':'stack',children:c}
      }
      case 'text': return {...text(item.content),...(item.size === 'muted' || item.size === 'caption' ? {tone:'muted'}:{})}
      case 'stat': {
        const m: NativeView = {type:'metric',label:item.label,value:item.value,...(item.delta ? {caption:item.delta}:{})}
        return item.spark ? stack([m,{type:'chart',kind:'line',categories:item.spark.map((_,i) => String(i+1)),series:[{values:item.spark}]}]):m
      }
      case 'hero': return stack([text(item.title),...(item.value ? [{type:'metric',label:item.label ?? item.title,value:item.value,...(item.delta ? {caption:item.delta}:{})}]:item.delta || item.label ? [text([item.label,item.delta].filter(Boolean).join(' · '))]:[]),...(item.subtitle ? [text(item.subtitle)]:[]),...(item.spark ? [{type:'chart',kind:'line',categories:item.spark.map((_,i) => String(i+1)),series:[{values:item.spark}]}]:[])])
      case 'badge': return text(item.label)
      case 'divider': return text(item.label ?? '—')
      case 'spacer': return text('')
      case 'callout': return {type:'callout',text:[item.title,item.content].filter(Boolean).join('\n'),tone:tone(item.tone) ?? 'info'}
      case 'progress': {
        if (surface === 'fence') return panelOnly(key)
        const p: NativeView = {type:'progress',value:item.value,...(item.label ? {label:item.label}:{}),...(item.valueLabel ? {caption:item.valueLabel}:{})}
        return item.target === undefined ? p:stack([p,text(`${en ? 'Target':'目标'}: ${item.target}%`)])
      }
      case 'steps': return {type:'steps',items:item.steps.map((step,i) => ({label:step.title,status:i < (item.current ?? item.steps.length) ? 'done':i === item.current ? 'current':'todo',...(step.desc ? {detail:step.desc}:{})}))}
      case 'timeline': return {type:'steps',items:item.items.map(i => ({label:i.title,status:'todo',...([i.time,i.desc].some(Boolean) ? {detail:[i.time,i.desc].filter(Boolean).join(' · ')}:{})}))}
      case 'keyvalue': return surface === 'fence' ? stack(item.pairs.map(p => text(`${p.key}: ${p.value}`))):{type:'keyValue',items:item.pairs.map(p => [p.key,p.value])}
      case 'list': {
        const q = item.filter ? state.fields[item.filter]?.toLowerCase() ?? '':''
        const entries = item.items.map((item,index) => ({item,index})).filter(({item}) => !q || JSON.stringify(item).toLowerCase().includes(q))
        const rows = entries.map(e => e.item)
        if (surface === 'panel' && rows.every(i => typeof i === 'string' || !('type' in i) || i.type === 'button' || i.type === 'link')) {
          const items = entries.map(({item:i,index}) => {
            if (typeof i === 'string') return {title:i}
            if (!('type' in i)) return {title:i.title,...(i.desc ? {subtitle:i.desc}:{})}
            if (i.type !== 'button' && i.type !== 'link') throw new Error('native list row violated its checked component kind')
            const result = node(i,`${key}.${index}`)
            const id = result.type === 'actions' ? (result.items as {action:string}[])[0]?.action:undefined
            return {title:i.label,...(id ? {action:id}:{})}
          })
          if (!issues.length) return {type:'list',items}
        }
        if (rows.every(i => typeof i === 'string' || !('type' in i))) {
          const values = rows.map(i => typeof i === 'string' ? {title:i}:{title:(i as {title:string}).title,...((i as {desc?:string}).desc ? {subtitle:(i as {desc:string}).desc}:{})})
          return surface === 'fence' ? stack(values.map(i => text([i.title,i.subtitle].filter(Boolean).join('\n')))):{type:'list',items:values}
        }
        return stack(entries.map(({item:i,index}) => typeof i === 'string' ? text(i):'type' in i ? node(i,`${key}.${index}`):text([i.title,i.desc].filter(Boolean).join('\n'))))
      }
      case 'table': {
        if (surface === 'fence') return panelOnly(key)
        if (item.export && surface !== 'panel') return panelOnly(key)
        if (item.details?.some(Boolean) || item.types?.some(t => !['text','num','delta','badge','index'].includes(t))) return unsupported(key,'table details/graphic cells')
        const scalar = (v: typeof item.rows[number][number]) => typeof v === 'object' && v !== null && GENUI_COMPUTED_CELL in v ? v.value:v
        const display = (v: typeof item.rows[number][number]) => typeof v === 'object' && v !== null && GENUI_COMPUTED_CELL in v ? v.formatted:v
        let rows = item.rows
        const q = item.filter ? state.fields[item.filter]?.toLowerCase() ?? '':''
        if (q) rows = rows.filter(row => (item.filterColumn === undefined ? row:[row[item.filterColumn]]).some(v => tableCellText(v).toLowerCase().includes(q)))
        const sort = item.sortField ? item.columns.indexOf(state.fields[item.sortField] ?? ''):-1
        if (sort >= 0) rows = [...rows].sort((a,b) => typeof scalar(a[sort]!) === 'number' && typeof scalar(b[sort]!) === 'number' ? Number(scalar(a[sort]!))-Number(scalar(b[sort]!)):tableCellText(a[sort]).localeCompare(tableCellText(b[sort])))
        if (rows.some(r => r.some(v => typeof display(v) !== 'string' && typeof display(v) !== 'number'))) return unsupported(key,'table cell value')
        const values = rows.map((r,i) => r.map((v,j) => item.types?.[j] === 'index' ? i+1:display(v)))
        if (item.total) values.push(item.columns.map((_,j) => j === 0 ? en ? 'Total':'合计':rows.every(r => typeof scalar(r[j]!) === 'number') ? rows.reduce((sum,r) => sum+Number(scalar(r[j]!)),0):''))
        const table: NativeView = {type:'table',columns:item.columns,rows:values}
        if (!item.export) return table
        const exports = [
          {type:'copy' as const,label:en ? 'Copy Markdown':'复制 Markdown',text:tableToMarkdown(item.columns,item.rows)},
          {type:'copy' as const,label:en ? 'Copy CSV':'复制 CSV',text:tableToCsv(item.rows)},
        ]
        return stack([table,...exports.map((copy,i) => node(copy,`${key}.export${i}`))])
      }
      case 'chart': {
        if (item.stacked) return unsupported(key,'stacked chart')
        const series = item.series?.length ? item.series:[{label:'',data:item.data}]
        const q = item.filter ? state.fields[item.filter]?.toLowerCase() ?? '':''
        const categories = [...new Set(series.flatMap(s => s.data.map(p => p.label)))].filter(l => !q || l.toLowerCase().includes(q))
        if (series.some(s => new Set(s.data.map(p => p.label)).size !== s.data.length || s.data.some(p => p.value !== null && typeof p.value !== 'number'))) return unsupported(key,'chart labels/values')
        if (item.kind === 'donut' && series.length > 1) return unsupported(key,'multiple donut series')
        return {type:'chart',kind:item.kind === 'line' || item.kind === 'donut' ? item.kind:item.horizontal ? 'hbar':'bar',categories,series:series.map(s => ({name:s.label,values:categories.map(l => s.data.find(p => p.label === l)?.value ?? null)}))}
      }
      case 'button': return !item.action ? text(item.label):surface === 'panel' ? {type:'actions',items:[{label:item.label,action:action(item,key),...(item.tone === 'primary' ? {style:'primary'}:{})}]}:choices(item,key,[item.label])
      case 'select': case 'radio': {
        if (surface === 'fence' && (!item.action || item.type === 'radio' && item.group)) return panelOnly(key)
        const group = item.type === 'select' ? item.id:item.group
        const value = state.fields[group ?? key] ?? (item.selected === undefined ? undefined:item.options[item.selected])
        return labeled(item.label,choices(item,key,item.options,value === undefined ? []:[value]))
      }
      case 'checkbox': case 'switch': {
        if (surface === 'tool' || surface === 'fence' && (!item.action || item.type === 'checkbox' && item.group)) return panelOnly(key)
        if (surface === 'fence') return labeled(item.label,{type:'confirm',confirmLabel:en ? 'Enable':'开启',cancelLabel:en ? 'Disable':'关闭'})
        const group = item.type === 'checkbox' ? item.group:undefined
        const checked = state.choices[group ?? key]?.includes(item.type === 'checkbox' ? item[GENUI_CHECKBOX_VALUE] ?? item.label:item.label) ?? item.checked ?? false
        return labeled(`${item.label} · ${checked ? en ? 'On':'已开启':en ? 'Off':'已关闭'}`,{type:'confirm',id:action(item,key),confirmLabel:en ? 'Enable':'开启',cancelLabel:en ? 'Disable':'关闭'})
      }
      case 'tabs': {
        if (surface !== 'panel') return panelOnly(key)
        if (item.tabs.length > 8) return unsupported(key,'tabs option limit')
        const selected = state.tabs[key] ?? 0, tab = item.tabs[selected] ?? item.tabs[0]
        return stack([{type:'options',id:action(item,key,'tab'),options:item.tabs.map((t,i) => ({label:t.label,value:String(i)})),selected:[String(selected)]},...children(tab?.items ?? [],`${key}.t${selected}`)])
      }
      case 'accordion': {
        if (surface !== 'panel') return panelOnly(key)
        if (item.items.length > 8) return unsupported(key,'accordion option limit')
        const selected = state.choices[key] ?? []
        return stack([{type:'options',id:action(item,key,'accordion'),multi:true,selected,options:item.items.map((s,i) => ({label:s.title,value:String(i)}))},...item.items.flatMap((s,i) => selected.includes(String(i)) ? [text(s.title),...children(s.items,`${key}.a${i}`)]:[])])
      }
      case 'copy': return surface !== 'panel' ? panelOnly(key):!item.text.length ? unsupported(key,en ? 'no content to copy':'没有可复制的内容'):item.text.length > 8000 ? unsupported(key,'clipboard limit'):{type:'actions',items:[{label:item.label ?? (en ? 'Copy':'复制'),action:action(item,key)}]}
      case 'link': {
        if (!item.href) return text(item.label)
        if (surface !== 'panel') return panelOnly(key)
        try {const url = new URL(item.href);if (url.protocol !== 'https:' || url.username || url.password || item.href.length > 2048) return unsupported(key,'link scheme/credentials')} catch {return unsupported(key,'link URL')}
        return {type:'actions',items:[{label:item.label,action:action(item,key)}]}
      }
      case 'image':
        if (surface === 'fence') return panelOnly(key)
        if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(item.src) || item.src.length > 65536) return unsupported(key,'image needs embedded PNG/JPEG/GIF/WebP')
        return {type:'image',src:item.src,...(item.alt ? {alt:item.alt}:{}),...(item.caption ? {caption:item.caption}:{})}
      case 'image-group': return stack(item.items.map((i,n) => node({type:'image',...i},`${key}.${n}`)))
      case 'submit': {
        if (surface !== 'panel') return panelOnly(key)
        const {registry,resolved:submission} = nativeSubmission(spec,state,item.groups)
        const members = (item.groups ?? [...registry.members.keys()]).flatMap(k => registry.members.get(k) ? [registry.members.get(k)!]:[])
        if (item.groups && members.some(m => m.kind === 'field' && m.fieldType !== 'select')) return unsupported(key,en ? 'this form requires an input the native App does not provide':'此表单需要原生界面尚未提供的输入项')
        if (!item.action && !submission.localGradeEligible) return text(item.label)
        return state.feedback[key] ? stack([...feedbackBlocks(state.feedback[key]!),{type:'actions',items:[{label:en ? 'Try again':'重新作答',action:action(item,key,'reset')}]}]):{type:'actions',items:[{label:item.label ?? (en ? 'Submit':'提交'),action:action(item,key)}]}
      }
      case 'quiz': {
        if (surface !== 'panel') return panelOnly(key)
        const selected = state.choices[key] ?? [], answer = selected[0] === undefined ? undefined:item.options[Number(selected[0])]
        return stack([text(item.question),{type:'options',id:action(item,key),options:item.options.map((o,i) => ({label:o.label,value:String(i)})),selected},...(answer ? [{type:'callout',tone:answer.correct ? 'good':'warn',text:answer.feedback ?? item.explanation ?? (answer.correct ? en ? 'Correct':'回答正确':en ? 'Try again':'再想一想')}]:[])])
      }
      case 'code': return text(item.code)
      case 'json': return text(JSON.stringify(item.value,null,2))
      case 'avatar': return text(item.name)
      case 'breadcrumb': return text(item.items.join(' › '))
      case 'icon': return text(item.label ?? item.name)
      case 'arrow': return text([item.dir === 'right' ? '→':'↓',item.label].filter(Boolean).join(' '))
      default: return unsupported(key,item.type)
    }
  }
  const resolved = spec.computed?.length ? resolveComputedSpec(spec,evaluateComputed(spec,state.fields)):spec
  return {view:{...stack(children(resolved.items,'n')),...(spec.title ? {title:spec.title}:{})},actions,issues,identity}
}

/** The published native budgets; refuse truncation of meaningful content. */
export function fitsNativeView(view: NativeView,surface: NativeSurface): boolean {
  let count = 0
  const panel = surface === 'panel'
  const visit = (v: NativeView,depth: number): boolean => {
    if (++count > (panel ? 120:40) || depth > (panel ? 8:6)) return false
    for (const [key,value] of Object.entries(v)) if (typeof value === 'string' && value.length > (key === 'src' ? 65536:key === 'text' ? 2000:key === 'title' ? 80:200)) return false
    if (v.type === 'stack' || v.type === 'row') {const c = v.children as NativeView[];if (!c.length || c.length > (panel ? 32:16) || !c.every(p => visit(p,depth+1))) return false}
    if (v.type === 'chart') {const c = v.categories as string[],s = v.series as {name?:string}[];if (c.length > 60 || c.some(l => l.length > 200) || s.length > 6 || s.some(i => (i.name?.length ?? 0) > 200)) return false}
    if (v.type === 'table') {const c = v.columns as string[],r = v.rows as unknown[][];if (c.length > 8 || c.some(l => l.length > 200) || r.length > 50 || r.some(row => row.length !== c.length || row.some(v => String(v).length > 200))) return false}
    if (v.type === 'steps') {const a = v.items as {label:string;detail?:string}[];if (a.length > 12 || a.some(i => i.label.length > 200 || (i.detail?.length ?? 0) > 200)) return false}
    if (v.type === 'keyValue') {const a = v.items as string[][];if (a.length > 24 || a.some(p => p.some(v => v.length > 200))) return false}
    if (v.type === 'list') {const a = v.items as {title:string;subtitle?:string}[];if (a.length > 50 || a.some(i => i.title.length > 200 || (i.subtitle?.length ?? 0) > 200)) return false}
    if (v.type === 'options') {const a = v.options as {label:string;value?:string;description?:string}[];if (a.length > 8 || a.some(i => !i.label.trim() || i.label.length > 80 || (i.description?.length ?? 0) > 200 || (i.value?.length ?? 0) > 200)) return false}
    if (v.type === 'compare') {const a = v.items as {title:string;badge?:string;rows:string[][]}[];if (a.length < 2 || a.length > 4 || a.some(i => i.title.length > 40 || (i.badge?.length ?? 0) > 12 || i.rows.length > 8 || i.rows.some(row => row[0]!.length > 40 || row[1]!.length > 80))) return false}
    if (v.type === 'actions') {const a = v.items as {label:string;action:string}[];if (a.length > 4 || a.some(i => i.label.length > 200 || i.action.length > 64)) return false}
    if ((v.type === 'options' || v.type === 'confirm') && typeof v.id === 'string' && v.id.length > 64) return false
    return true
  }
  return visit(view,1) && new TextEncoder().encode(JSON.stringify(view)).length <= (panel ? 32768:surface === 'fence' ? 16384:8192)
}

/** Fixed stack root is deliberately unknown to the web component vocabulary. */
export function dualNativeFence(spec: GenuiSpec): Record<string,unknown> | null {
  if (spec.panel || spec.append) return null
  const r = compileDshGo(spec,'fence')
  if (r.issues.length || !fitsNativeView(r.view,'fence')) return null
  // The App settles the whole model card after one visible reply.
  const answers = (v: NativeView): number => Number(v.type === 'options' || v.type === 'confirm') + ((v.children ?? []) as NativeView[]).reduce((sum,c) => sum+answers(c),0)
  if (answers(r.view) > 1) return null
  const dual = {...spec,...r.view}
  return new TextEncoder().encode(JSON.stringify(dual)).length <= 16384 ? dual:null
}
