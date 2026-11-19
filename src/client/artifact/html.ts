import { assetUrl } from '../asset-loader.ts'
import { bytesToBase64 } from './base64.ts'
import { parseGenuiArtifact } from './parse.ts'
import { collectGenuiMediaRefs, inlineStandaloneMedia, isDesktopMediaUrl } from './media.ts'
import { analyzeGenuiPortability } from './portability.ts'
import { GenuiExportError, type GenuiArtifactV1, type GenuiStandaloneAsset } from './types.ts'
import { STANDALONE_THEME_CSS } from './standalone-theme.ts'
import type { GenuiSpec } from '../spec.ts'

const bundleCache = new Map<string, Promise<Uint8Array>>()

/** 转义 HTML 属性和标题中的文本。 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

/** 获取并缓存构建产物字节，失败时保留可识别的导出错误。 */
function cachedBundle(name: string, code: GenuiStandaloneAsset | 'runtime'): Promise<Uint8Array> {
  const existing = bundleCache.get(name)
  if (existing !== undefined) return existing
  const task = fetch(assetUrl(name)).then(async response => {
    if (!response.ok) throw new GenuiExportError(code === 'runtime' ? 'runtime-fetch-failed' : 'asset-fetch-failed', `${name}: HTTP ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }).catch(error => {
    bundleCache.delete(name)
    if (error instanceof GenuiExportError) throw error
    throw new GenuiExportError(code === 'runtime' ? 'runtime-fetch-failed' : 'asset-fetch-failed', `${name}: ${error instanceof Error ? error.message : 'fetch failed'}`)
  })
  bundleCache.set(name, task)
  return task
}

/** 创建仅存放 Base64 数据的非执行 payload 节点。 */
function bundleElement(name: string, bytes: Uint8Array): string {
  return `<script type="application/octet-stream" data-genui-bundle="${name}">${bytesToBase64(bytes)}</script>`
}

/**
 * 将媒体相对地址转换为导出页面所在站点的绝对地址。
 *
 * Walks the same writable media fields the inline step uses, so every media
 * kind (including `compare` panels and `entity-card` portraits, which the old
 * per-type visit skipped) resolves the same way.
 */
export function resolveMediaUrls(spec: GenuiSpec, baseURI: string): GenuiSpec {
  const copy = structuredClone(spec)
  for (const ref of collectGenuiMediaRefs(copy)) {
    const media = ref.src
    if (media === '' || /^https?:\/\//i.test(media)) continue
    const url = new URL(media, baseURI)
    if (isDesktopMediaUrl(url) && isDesktopMediaUrl(new URL(baseURI))) continue
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new GenuiExportError('artifact-invalid', `media URL cannot be exported: ${media}`)
    ref.set(url.href)
  }
  return copy
}

/** 返回执行内嵌 bundle 的静态启动代码。 */
function bootstrapSource(): string {
  return `
async function loadBundle(element) {
  const binary = atob(element.textContent.trim());
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function start() {
  for (const element of document.querySelectorAll('[data-genui-bundle]:not([data-genui-bundle=mermaid])')) await loadBundle(element);
  const encoded = document.querySelector('#genui-artifact').textContent.trim();
  const artifact = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), character => character.charCodeAt(0))));
  window.__GenuiStandalone__.mount(document.querySelector('#genui-root'), artifact);
}
start().catch(error => {
  const root = document.querySelector('#genui-root');
  root.textContent = error instanceof Error ? error.message : 'GenUI could not start';
  root.setAttribute('role', 'alert');
});
`
}

/** 序列化内联媒体表，避免文本里的 "<" 提前闭合 script 标签。 */
function mediaPayload(media: ReadonlyMap<string, string> | undefined): string {
  if (media === undefined || media.size === 0) return ''
  const json = JSON.stringify(Object.fromEntries(media)).replace(/</g, '\\u003c')
  return `<script type="application/json" id="genui-media">${json}</script>`
}

/** 使用已下载的运行文件生成完整的独立 HTML 文档。 */
export function createStandaloneHtmlDocument(
  artifact: GenuiArtifactV1,
  bundles: ReadonlyMap<string, Uint8Array>,
  baseURI = document.baseURI,
  media?: ReadonlyMap<string, string>,
): string {
  const htmlArtifact = { ...artifact, spec: resolveMediaUrls(artifact.spec, baseURI) }
  const encodedArtifact = bytesToBase64(new TextEncoder().encode(JSON.stringify(htmlArtifact)))
  const engines = artifactPortabilityAssets(artifact).map(name => {
    const bytes = bundles.get(`${name}.js`)
    if (bytes === undefined) throw new GenuiExportError('asset-fetch-failed', `${name}.js: bundle unavailable`)
    return bundleElement(name, bytes)
  }).join('\n')
  const runtime = bundles.get('standalone-runtime.js')
  if (runtime === undefined) throw new GenuiExportError('runtime-fetch-failed', 'standalone-runtime.js: bundle unavailable')
  const csp = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; font-src data:; img-src 'self' data: blob: https: http:; media-src 'self' data: blob: https: http:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  return `<!doctype html>
<html lang="${artifact.presentation.locale === 'zh' ? 'zh-CN' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(artifact.spec.title ?? 'GenUI')}</title>
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style>${STANDALONE_THEME_CSS}</style>
</head>
<body${artifact.presentation.theme === 'dark' ? ' data-ds-dark-theme' : ''}>
  <main id="genui-root"></main>
  <script type="application/octet-stream" id="genui-artifact">${encodedArtifact}</script>
  ${mediaPayload(media)}
  ${engines}
  ${bundleElement('runtime', runtime)}
  <script>${bootstrapSource()}</script>
</body>
</html>`
}

/** 返回 artifact 所需图形引擎名称。 */
function artifactPortabilityAssets(artifact: GenuiArtifactV1): GenuiStandaloneAsset[] {
  return analyzeGenuiPortability(artifact.spec).requiredAssets
}

/**
 * 获取独立运行文件及规格实际使用的图形引擎，生成单文件 HTML。
 *
 * Same-origin images are read once and embedded as `data:` URLs so the
 * exported page shows them without the host process, a cookie, or a network
 * (issue #453). Anything unreadable keeps its absolute URL.
 */
export async function buildStandaloneHtml(rawArtifact: GenuiArtifactV1): Promise<string> {
  const artifact = parseGenuiArtifact(rawArtifact)
  if (artifact === null) throw new GenuiExportError('artifact-invalid', 'invalid GenUI artifact')
  const report = analyzeGenuiPortability(artifact.spec)
  if (report.customTypes.length > 0) {
    throw new GenuiExportError('unsupported-custom-component', `custom components: ${report.customTypes.join(', ')}`)
  }
  const baseURI = typeof document === 'undefined' ? 'about:blank' : document.baseURI
  const spec = baseURI === 'about:blank' ? artifact.spec : resolveMediaUrls(artifact.spec, baseURI)
  const media = baseURI === 'about:blank' ? undefined : await inlineStandaloneMedia(spec, baseURI)
  const names = [...report.requiredAssets.map(name => `${name}.js`), 'standalone-runtime.js']
  const results = await Promise.all(names.map(async name => [name, await cachedBundle(name, name === 'standalone-runtime.js' ? 'runtime' : name.slice(0, -3) as GenuiStandaloneAsset)] as const))
  return createStandaloneHtmlDocument({ ...artifact, spec }, new Map(results), baseURI, media)
}
