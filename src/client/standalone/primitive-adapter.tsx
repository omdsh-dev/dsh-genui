import { useState, type CSSProperties, type ReactNode } from 'react'
import { t } from '../i18n/index.ts'

export interface DiffBlockLabels {
  copy: string
  copied: string
  codeLabel: string
  wrapLabel: string
  unwrapLabel: string
  collapseAria: string
  expandAria: (hidden: number) => string
  collapse: string
  expand: (hidden: number) => string
  files: (count: number) => string
}

export interface JsonTreeLabels {
  copyValue: string
  copyJson: string
  copyPath: string
  copyPrettyJson: string
  copyCompactJson: string
  copied: string
  copyFailed: string
  collapseNode: string
  expandNode: string
  copyButtonTitle: (action: string) => string
}

const codeStyle: CSSProperties = { overflow: 'auto', padding: 12, borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }

/** 在独立页面显示可复制的代码内容。 */
export function CodeBlock({ code, lang, copyLabel, copiedLabel }: { code: string; lang?: string; copyLabel?: string; copiedLabel?: string }): ReactNode {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    if (!await writeClipboard(code)) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }
  return <div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--dsw-alias-label-secondary)' }}><span>{lang ?? t('label.code')}</span><button type="button" onClick={() => void copy()}>{copied ? copiedLabel ?? t('label.copied') : copyLabel ?? t('label.copy')}</button></div><pre style={codeStyle}><code>{code}</code></pre></div>
}

/** 在独立页面以差异文本显示文件变更。 */
export function DiffBlock({ diffs }: { diffs: Array<{ path: string; oldText?: string; newText?: string }>; labels?: DiffBlockLabels }): ReactNode {
  return <div>{diffs.map((diff, index) => <section key={`${diff.path}:${index}`}><strong>{diff.path}</strong><pre style={codeStyle}>{(diff.oldText ?? '').split('\n').map(line => `- ${line}`).concat((diff.newText ?? '').split('\n').map(line => `+ ${line}`)).join('\n')}</pre></section>)}</div>
}

/** 在独立页面显示 JSON，并提供本地折叠控制。 */
export function JsonTree({ data, label, copyable, labels }: { data: object | unknown[]; label?: string; copyable?: boolean; labels?: JsonTreeLabels }): ReactNode {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(data, null, 2)
  /** 复制当前 JSON 内容并更新按钮反馈。 */
  const copy = async (): Promise<void> => {
    if (!await writeClipboard(json)) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }
  return <section><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? t('label.collapse') : t('label.expandNode')} {label ?? 'JSON'}</button>{copyable && <button type="button" onClick={() => void copy()}>{copied ? labels?.copied ?? t('label.copied') : labels?.copyJson ?? t('label.copy')}</button>}</div>{expanded && <pre style={codeStyle}>{json}</pre>}</section>
}

/** 将文本复制到系统剪贴板。 */
export async function writeClipboard(text: string): Promise<boolean> {
  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  try {
    textarea.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}
