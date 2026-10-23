/** Verify the shipped map engine stays lazy, with worker/CSS payloads intact. */
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
const root = new URL('../', import.meta.url)
const engine = await readFile(new URL('lib/assets/maplibre.js', root), 'utf8')
for (const file of ['lib/client.js', 'lib/assets/standalone-runtime.js']) {
  const runtime = await readFile(new URL(file, root), 'utf8')
  if (runtime.includes('maplibregl-ctrl-attrib') || runtime.includes('MapLibre GL JS')) {
    throw new Error(`${file} eagerly contains the map engine or vendor CSS`)
  }
}
if (!engine.includes('maplibregl-ctrl-attrib') || !engine.includes('MapLibre GL JS')) {
  throw new Error('maplibre asset is missing vendor CSS/main/worker content')
}
const sandbox = {
  console,
  URL: { createObjectURL() { throw new Error('worker Blob was created before map mount') } },
}
// Asset evaluation alone must neither create a worker nor touch the DOM.
runInNewContext(engine, sandbox, { timeout: 5000 })
if (typeof sandbox.__GenuiAssets__?.maplibre?.mountMap !== 'function') {
  throw new Error('maplibre asset did not register its engine API')
}
console.log('lazy map asset check passed (not a real WebGL acceptance test)')
