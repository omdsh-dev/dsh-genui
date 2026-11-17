import { createRoot } from 'react-dom/client'
import { GenuiBlock } from '../GenuiBlock.tsx'
import { GenuiActionContext } from '../action-context.ts'
import { ErrorBoundary } from '../ErrorBoundary.tsx'
import { parseGenuiArtifact } from '../artifact/parse.ts'
import { setGenuiMediaOverrides } from '../media-overrides.ts'
import { setLocale } from '../i18n/runtime.ts'
import './katex-style.ts'
import './bootstrap-types.ts'

/**
 * 读取导出页内嵌的媒体表。
 *
 * The HTML export embeds same-origin images it could read and lists them here,
 * keyed by the URL the spec kept. A malformed payload is not fatal: the spec
 * still carries its original sources.
 */
function readMediaOverrides(): Map<string, string> | undefined {
  const element = document.querySelector<HTMLScriptElement>('#genui-media')
  const encoded = element?.textContent?.trim()
  if (encoded === undefined || encoded === '') return undefined
  try {
    const parsed: unknown = JSON.parse(encoded)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    return entries.length === 0 ? undefined : new Map(entries)
  } catch {
    return undefined
  }
}

/** 挂载独立 artifact，并返回卸载该界面的函数。 */
function mount(root: HTMLElement, rawArtifact: unknown): () => void {
  setGenuiMediaOverrides(readMediaOverrides())
  const artifact = parseGenuiArtifact(rawArtifact)
  if (artifact === null) throw new Error('invalid GenUI artifact')
  setLocale(artifact.presentation.locale)
  document.body.toggleAttribute('data-ds-dark-theme', artifact.presentation.theme === 'dark')
  const reactRoot = createRoot(root)
  reactRoot.render(
    <GenuiActionContext.Provider value={undefined}>
      <ErrorBoundary label="GenUI">
        <GenuiBlock spec={artifact.spec} initialState={artifact.state} animateEntrance={false} />
      </ErrorBoundary>
    </GenuiActionContext.Provider>,
  )
  return () => reactRoot.unmount()
}

window.__GenuiStandalone__ = { mount }
