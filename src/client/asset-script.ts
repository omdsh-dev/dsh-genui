type AssetWindow = Window & { __GenuiAssets__?: Record<string, unknown> }

/** Load an engine in the same document where it will run. */
export function loadAssetScript(owner: Document, src: string, file: string, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const script = owner.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => {
      const api = (owner.defaultView as AssetWindow | null)?.__GenuiAssets__?.[key]
      if (api === undefined) reject(new Error(`genui asset '${file}' loaded but registered no '${key}' engine`))
      else resolve(api)
    }
    script.onerror = () => reject(new Error(`genui asset '${file}' failed to load`))
    owner.head.appendChild(script)
  })
}

/** Mermaid measures inside its own document to avoid the transcript's style cascade. */
export function createMermaidRenderDocument(): Document {
  const frame = document.createElement('iframe')
  frame.dataset.genuiMermaidMeasure = ''
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = 'position:fixed;left:-100vw;top:0;width:100vw;height:100vh;border:0;visibility:hidden'
  document.body.appendChild(frame)
  return frame.contentDocument!
}
