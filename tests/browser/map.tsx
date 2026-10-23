/** Real public embed entry. Fixture controls change public props only; selection
 * and submission are driven through the component's actual DOM controls. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { GenuiBlock, GenuiActionContext, GenuiMapContext, setGenuiAssetBase,
  createGenuiArtifact, buildStandaloneHtml } from '@changfenhuang/dsh-genui/embed'
import type { GenuiSpec, BlockInteractionState } from '@changfenhuang/dsh-genui/embed'
import { setLocale } from '@map-test/i18n'
import { STANDALONE_THEME_CSS } from '@map-test/theme'
// @ts-expect-error Pure JS fixture shared with the Node runner.
import { createMapSpec } from '../../scripts/map-acceptance/contract.mjs'
setLocale('en')
setGenuiAssetBase('/__map-assets__/')
const style = document.createElement('style')
style.textContent = STANDALONE_THEME_CSS
  + 'body{margin:24px}#fixture{max-width:760px}nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}pre{white-space:pre-wrap}'
document.head.appendChild(style)
const hostConfig = { style: { version: 8 as const, sources: {}, layers: [{ id: 'host-background', type: 'background', paint: { 'background-color': '#eef2f6' } }] } }
const base: GenuiSpec = createMapSpec()
function Fixture() {
  const [mounted, setMounted] = useState(false)
  const [spec, setSpec] = useState(base)
  const [snapshot, setSnapshot] = useState<BlockInteractionState>({})
  const [actions, setActions] = useState<unknown[]>([])
  const [dark, setDark] = useState(false)
  const [hostStyle, setHostStyle] = useState(false)
  const [error, setError] = useState('')
  async function exportHtml() {
    try {
      const artifact = createGenuiArtifact(spec, snapshot, { locale: 'en', theme: dark ? 'dark' : 'light' })
      const html = await buildStandaloneHtml(artifact)
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      const a = document.createElement('a'); a.href = url; a.download = 'map-offline.html'; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { setError(String(e)) }
  }
  return <>
    <nav aria-label="Synthetic fixture controls">
      <button onClick={() => setMounted(true)}>Mount map</button>
      <button onClick={() => setMounted(false)}>Unmount map</button>
      <button onClick={() => setSpec({ ...base, items: base.items.map(node => node.type === 'map' ? {
        ...node, locations: node.locations.map(location => location.id === 'east' ? { ...location, label: 'Synthetic East renamed' } : location),
      } : node) })}>Stream label update</button>
      <button onClick={() => setSpec({ ...base, items: base.items.map(node => node.type === 'map' ? {
        ...node, locations: node.locations.filter(location => location.id !== 'east'),
      } : node) })}>Remove selected location</button>
      <button onClick={() => setSpec(base)}>Restore locations</button>
      <button onClick={() => { setDark(!dark); document.body.toggleAttribute('data-ds-dark-theme', !dark) }}>Toggle theme</button>
      <button onClick={() => setHostStyle(!hostStyle)}>Toggle trusted style</button>
      <button onClick={() => void exportHtml()}>Export offline HTML</button>
    </nav>
    <GenuiMapContext.Provider value={hostStyle ? hostConfig : undefined}>
      <GenuiActionContext.Provider value={(action, payload) => setActions(current => [...current, { action, payload }])}>
        {mounted && <GenuiBlock spec={spec} stateKey="synthetic-map-browser" onStateSnapshot={setSnapshot} animateEntrance={false} />}
      </GenuiActionContext.Provider>
    </GenuiMapContext.Provider>
    <pre id="map-snapshot">{JSON.stringify(snapshot)}</pre>
    <pre id="map-actions">{JSON.stringify(actions)}</pre>
    <pre id="map-fixture-error">{error}</pre>
  </>
}
createRoot(document.getElementById('fixture')!).render(<Fixture />)
