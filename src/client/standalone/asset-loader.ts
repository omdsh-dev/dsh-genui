import { createMermaidRenderDocument, loadAssetScript } from '../asset-script.ts'

type StandaloneAssets = { __GenuiAssets__?: Record<string, unknown> }

let mermaid: Promise<unknown> | undefined

async function loadStandaloneMermaid(element: HTMLScriptElement): Promise<unknown> {
  const bytes = Uint8Array.from(atob(element.textContent.trim()), character => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }))
  try {
    return await loadAssetScript(createMermaidRenderDocument(), url, 'mermaid.js', 'mermaid')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 从启动代码预先载入的全局资源读取引擎。 */
export function loadGenuiAsset<T>(name: 'mermaid' | 'three' | 'echarts-core' | 'echarts-full' | 'icons' | 'maplibre'): Promise<T> {
  const key = name.replace(/-(\w)/g, (_match, character: string) => character.toUpperCase())
  const asset = (window as unknown as StandaloneAssets).__GenuiAssets__?.[key]
  if (name === 'mermaid' && asset === undefined) {
    const bundle = document.querySelector<HTMLScriptElement>('script[data-genui-bundle="mermaid"]')
    if (bundle !== null) return (mermaid ??= loadStandaloneMermaid(bundle)) as Promise<T>
  }
  if (asset === undefined) return Promise.reject(new Error(`standalone asset '${name}' was not preloaded`))
  return Promise.resolve(asset as T)
}
