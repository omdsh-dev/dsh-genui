/** Pure, synthetic Map fixtures and CI launch contract. No browser/server at import. */
export const MAP_TITLE = 'Map browser locations'
export const MAP_ACTION = 'map-confirm'
export const MAP_SUBMIT = 'Submit map selection'
export function createMapSpec() {
  return { title: 'Synthetic Map acceptance', items: [
    { type: 'map', id: 'destination', title: MAP_TITLE, height: 320, center: [0, 0], zoom: 2,
      locations: [
        { id: 'west', label: 'Synthetic West', coordinates: [-20, 0] },
        { id: 'east', label: 'Synthetic East', coordinates: [20, 0] },
      ],
      routes: [{ id: 'inline-route', label: 'Synthetic inline route', coordinates: [[-20, 0], [20, 0]] }],
    },
    { type: 'submit', label: MAP_SUBMIT, action: MAP_ACTION, groups: ['destination'] },
  ] }
}
export function mapBrowserLaunchOptions(executablePath) {
  return {
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    headless: true, chromiumSandbox: true,
    // Pinned host Playwright 1.61.1 adds this unsafe fallback by default.
    // Remove only that exact default; retain all other defaults and the live
    // forbidden-flag audit. Never use ignoreDefaultArgs: true.
    // https://github.com/microsoft/playwright/blob/v1.61.1/packages/playwright-core/src/server/chromium/chromium.ts
    ignoreDefaultArgs: ['--enable-unsafe-swiftshader'],
    // Chromium's supported OpenGL ES driver on GPU-less bots, NOT the unsafe
    // WebGL fallback. Keep both renderer/GPU sandboxes and WebGL enabled.
    // https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/swiftshader.md
    // CDP Browser.getBrowserCommandLine requires this ordinary automation
    // marker explicitly; do not rely on the host Playwright's default flags.
    // https://chromedevtools.github.io/devtools-protocol/tot/Browser/#method-getBrowserCommandLine
    args: ['--enable-automation', '--use-gl=angle', '--use-angle=swiftshader'],
  }
}
export function validateMapMode({ map, smoke, sidechat, install, env, uid }) {
  if (!map) return
  if (!smoke || sidechat || install !== 'tarball') throw new Error('--map requires --smoke --install tarball, without --sidechat')
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_OS !== 'Linux') throw new Error('Map acceptance runs only in the existing Linux GitHub Actions runner; do not launch a local browser')
  if (uid === 0) throw new Error('Map acceptance requires the normal non-root sandboxed Chrome runner')
}
export function safeMapError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/([?&](?:token|key|secret|password)=)[^\s&#"']*/giu, '$1[redacted]')
    .slice(0, 2500)
}
/** Keep independent checks running without ever converting a failure to a pass. */
export async function recordMapCheckFailure(failures, stage, check) {
  try { await check(); return true } catch (error) {
    failures.push({ stage, error: safeMapError(error) })
    return false
  }
}
export function assertMapChecksPassed(failures) {
  if (failures.length) throw new Error('Map acceptance failed: ' + failures.map(failure => `${failure.stage}: ${failure.error}`).join('; '))
}
/** Analyze only the center screenshot crop, not same-blue endpoint markers. */
export function measureRoutePixels({ data, width, height }) {
  if (width !== 80 || height !== 32 || data.length !== width * height * 4) throw new Error('Expected an 80x32 RGBA screenshot crop')
  let route = 0, background = 0, longest = 0
  for (let y = 0; y < height; y++) {
    let run = 0
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const near = rgb => rgb.every((value, channel) => Math.abs(data[i + channel] - value) <= 12)
      const blue = near([49, 95, 168]) && y >= 11 && y <= 21
      if (blue) { route++; run++; longest = Math.max(longest, run) } else run = 0
      if ((y < 8 || y > 24) && near([238, 242, 246])) background++
    }
  }
  return { width, height, route, background, longest, pass: longest >= 60 && route >= 120 && background >= 800 }
}
/** Check the DECODED artifact, since base64 can hide a host-config leak in HTML. */
export function assertOfflineMapArtifact(artifact) {
  const map = artifact?.spec?.items?.find(node => node.type === 'map')
  if (!map || artifact?.state?.fields?.destination !== 'east') throw new Error('Export must contain the selected synthetic Map snapshot')
  if (JSON.stringify(artifact).includes('host-background')) throw new Error('Trusted host style sentinel leaked into the encoded artifact')
  for (const key of ['style', 'source', 'sources', 'config', 'workerUrl', 'glyphs', 'accessToken', 'token']) {
    if (Object.hasOwn(map, key)) throw new Error(`Host-only Map field leaked: ${key}`)
  }
  for (const key of ['config', 'mapConfig', 'hostConfig']) {
    if (Object.hasOwn(artifact, key)) throw new Error(`Host configuration leaked into artifact: ${key}`)
  }
  return artifact
}
