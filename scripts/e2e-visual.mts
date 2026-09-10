#!/usr/bin/env node
/**
 * dsh-genui 视觉 E2E（无需模型 key）：真实 dsh web + link 安装当前插件 →
 * 通过 DOM 通道注入组件画廊围栏 → 真实浏览器渲染 → 截图 + 交互验证。
 * 与 e2e.mjs 互补：e2e.mjs 验证「模型 → fence → action 闭环」的完整链路
 * （需要 DEEPSEEK_API_KEY）；本脚本只验证渲染层（CSS、组件、本地交互），
 * 不需要任何额度，适合每次样式/组件改动后的快速视觉回归。
 *
 * 用法：
 *   npx tsx scripts/e2e-visual.mts [--port 3098] [--keep] [--out <dir>]
 *
 * 产物（默认 .e2e-artifacts/）：
 *   gallery.png       画廊全页渲染
 *   interactions.png   排序/判题等本地交互后的状态
 *   web.log            scratch 实例日志
 * 退出码 0 = PASS，1 = FAIL。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createServer } from 'node:net'

import { gallerySpec } from '../src/client/gallery.ts'

// tsx 运行下 import.meta.url 不可靠（曾指向 node 二进制），用 argv[1] 定位：
// 脚本约定在 <repo>/scripts/e2e-visual.mts，仓库根 = 上一级。
const SCRIPT_PATH = resolve(process.argv[1] ?? '')
const REPO_ROOT = dirname(SCRIPT_PATH).endsWith('scripts')
  ? resolve(dirname(SCRIPT_PATH), '..')
  : resolve(process.cwd())
// 宿主二进制：优先 $DSH_BIN，否则从 PATH 解析 `dsh`。旧默认
// ~/node_modules/.bin/dsh 在 rc7 切到 npm/pnpm 生产槽后已不存在，脚本会以
// 127（command not found）静默失败——这是 2026-09 视觉回归跑不起来的根因之一。
function resolveDshBin(): string {
  if (process.env.DSH_BIN !== undefined && process.env.DSH_BIN !== '') return process.env.DSH_BIN
  const found = spawnSync('which', ['dsh'], { encoding: 'utf8' }).stdout?.trim()
  return found !== undefined && found !== '' ? found : 'dsh'
}
const DSH_BIN = resolveDshBin()
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const PORT = Number(arg('--port') ?? 3098)
const KEEP = process.argv.includes('--keep')
const OUT_DIR = resolve(arg('--out') ?? join(REPO_ROOT, '.e2e-artifacts'))

const fail = (msg: string): never => { console.error(`✗ ${msg}`); process.exit(1) }
const log = (msg: string): void => console.log(`· ${msg}`)

/** 启动行里打印的带 token 根 URL（alpha 构建）；老构建则是不带 token 的裸 URL。 */
function findDshWebUrl(output: string): string | undefined {
  return output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+(?:\/\?token=[A-Za-z0-9_-]+)?)/u)?.[1]
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) fail(`非法端口: ${PORT}`)
await new Promise(res => {
  const probe = createServer()
  probe.once('error', () => fail(`端口 ${PORT} 已被占用，请用 --port 换一个`))
  probe.listen(PORT, '127.0.0.1', () => probe.close(res))
})

// playwright-core 解析顺序：显式 PLAYWRIGHT_PATH → agent-browser 全局依赖 →
// 本仓库 node_modules。chromium 走系统 Chrome（channel: 'chrome'）。
async function loadPlaywright(): Promise<{ chromium: any }> {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    join(homedir(), '.nvm/versions/node', `v${process.versions.node}`, 'lib/node_modules/agent-browser/node_modules/playwright-core/index.mjs'),
    join(REPO_ROOT, 'node_modules/playwright-core/index.mjs'),
    join(REPO_ROOT, 'node_modules/playwright/index.mjs'),
  ].filter((p): p is string => p !== undefined)
  for (const p of candidates) {
    try {
      return await import(p)
    } catch (e) {
      console.error(`· playwright 候选失败 ${p} → ${(e as Error).message}`)
    }
  }
  throw new Error('未找到 playwright-core（可设 PLAYWRIGHT_PATH 指定 index.mjs）')
}

const DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-visual-'))
const env = { ...process.env, DSH_HOME }
const webLog = join(DSH_HOME, 'web.log')
let webChild: ReturnType<typeof spawn> | null = null
// playwright Browser 实例：失败路径也要 close，避免浏览器子进程孤儿。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browser: any = null

const killWeb = (): void => {
  if (webChild === null) return
  try { process.kill(-webChild.pid!, 'SIGTERM') } catch { /* gone */ }
  try { process.kill(webChild.pid!, 'SIGTERM') } catch { /* gone */ }
  webChild = null
}
const cleanup = async (): Promise<void> => {
  killWeb()
  if (!KEEP) await rm(DSH_HOME, { recursive: true, force: true })
  else log(`保留临时环境: ${DSH_HOME}`)
}

try {
  await mkdir(OUT_DIR, { recursive: true })

  // ── 安装插件（link 当前工作区 = 测的就是当前代码）───────────────────────
  log('安装插件（link 当前工作区）...')
  const add = spawnSync(DSH_BIN, ['plugin', '--profile', 'web', 'add', `link:${REPO_ROOT}`], { env, stdio: 'inherit' })
  if (add.status !== 0) throw new Error('link 安装失败（见上方输出）')

  // ── 启动 dsh web ─────────────────────────────────────────────────────────
  // `--profile web` 明确加载刚安装插件的 profile；`--no-open` 防止每次回归
  // 都弹一个系统浏览器窗口。
  log(`启动 dsh web (port ${PORT})...`)
  const logStream = createWriteStream(webLog, { flags: 'a' })
  webChild = spawn(DSH_BIN, ['--profile', 'web', '--port', String(PORT), '--no-open'], {
    env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const BASE = `http://127.0.0.1:${PORT}`
  // 收集 stdout 以解析启动行里的 token；同时照常落盘日志。
  let webOutput = ''
  webChild.stdout!.on('data', (chunk: Buffer) => { webOutput += String(chunk) })
  webChild.stdout!.pipe(logStream)
  webChild.stderr!.pipe(logStream)
  // alpha 构建的根请求必须带进程 token（GET /?token=… → 303 + 会话 cookie），
  // 裸 fetch `/` 永远 401。老构建打印裸 URL，直接 200。
  let ready = false
  let launchUrl = BASE
  let sessionCookie: string | undefined
  for (let i = 0; i < 120; i++) {
    if (webChild.exitCode !== null) break
    const found = findDshWebUrl(webOutput)
    if (found !== undefined) {
      launchUrl = found
      try {
        const res = await fetch(found, { redirect: 'manual' })
        if (res.status === 303 || res.ok) {
          sessionCookie = res.headers.get('set-cookie')?.split(';')[0]
          ready = true
          break
        }
      } catch { /* booting */ }
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  if (!ready) {
    const tail = await (await import('node:fs/promises')).readFile(webLog, 'utf8').catch(() => '')
    console.error(tail.split('\n').slice(-30).join('\n'))
    throw new Error(`dsh web 120s 内未就绪（日志: ${webLog}）`)
  }
  log('dsh web 就绪')

  // 客户端半边不以 `/plugins/<pkg>/client.js` 单独提供：宿主把同一批插件
  // 合成一个 `??…,<pkg>/client.js,…&rev=` 资源。因此这里断言的是「它出现在
  // index 的 boot graph 里」，而不是某个固定 URL 返回 200。
  const indexRes = await fetch(`${BASE}/`, { headers: sessionCookie === undefined ? {} : { cookie: sessionCookie } })
  if (!indexRes.ok) throw new Error(`index 返回 ${indexRes.status}`)
  const indexHtml = await indexRes.text()
  if (!indexHtml.includes('@changfenhuang/dsh-genui/client.js')) {
    throw new Error('genui 客户端 bundle 未出现在 boot graph 中（插件未注册 client 半边？）')
  }
  log('✓ 客户端 bundle 已在 boot graph 中')

  // ── 浏览器渲染 ───────────────────────────────────────────────────────────
  const { chromium } = await loadPlaywright()
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 3000 } })
  const pageErrors: string[] = []
  page.on('pageerror', e => pageErrors.push(String(e)))
  // Engine-split evidence: which lazy assets the page actually pulls.
  const assetRequests: string[] = []
  page.on('request', req => {
    const url = req.url()
    const match = /\/assets\/([a-z-]+\.js)/.exec(url)
    if (match !== null) assetRequests.push(match[1]!)
  })
  const consoleLines: string[] = []
  page.on('console', msg => consoleLines.push(`${msg.type()}: ${msg.text()}`))
  // 强制 DOM 通道：0.1.3+ 宿主带 registry 扩展点时插件默认走 registry 通道，
  // 而 registry 只在真实 markdown 围栏里渲染；空 profile 的回归页需要一个
  // 可注入的渲染表面，所以用这个 flag 把插件钉在 DOM 通道上。
  await page.addInitScript(() => { (globalThis as { __DSH_GENUI_E2E__?: boolean }).__DSH_GENUI_E2E__ = true })
  // 走带 token 的根 URL：浏览器完成 303 → cookie 交换，之后的资源请求已认证。
  await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)
  // 空 profile 首次启动会弹内测声明：它的遮罩会拦截一切指针事件，先关掉，
  // 否则后面的 hover 断言会被 mask 抢走（曾导致 tooltip 回归超时）。
  const onboarding = page.getByRole('button', { name: /继续|我知道了|开始使用|进入/ })
  if (await onboarding.count() > 0) {
    await onboarding.first().click().catch(() => {})
    await page.waitForTimeout(500)
  }
  // 兜底：遮罩若仍在（按钮文案变化、二次弹出），直接摘掉它——这是 scratch
  // 实例的一次性页面，不是产品行为断言。
  const masks = await page.evaluate(() => {
    const found = document.querySelectorAll('[class*="_mask_"], [role="presentation"]')
    for (const el of found) el.remove()
    return found.length
  })
  if (masks > 0) log(`已移除 ${masks} 个遮罩节点`)

  // 注入画廊围栏：真实 dsh-ui fence 表面（叶子语言标签 + 单一 <pre> 代码体），
  // DOM 通道应当发现它并以插件自己的 React root 挂载真实组件。
  await page.evaluate((specJson: string) => {
    const host = document.createElement('div')
    host.className = 'md-code-block'
    host.setAttribute('data-visual-inject', '1')
    const label = document.createElement('div')
    label.textContent = 'dsh-ui'
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = specJson
    pre.appendChild(code)
    host.append(label, pre)
    const mount = document.querySelector('[data-chat-flow]') ?? document.body
    mount.appendChild(host)
  }, JSON.stringify(gallerySpec))

  let blocks = 0
  for (let i = 0; i < 30; i++) {
    blocks = await page.evaluate(() => document.querySelectorAll('[data-genui]').length)
    if (blocks > 0) break
    await new Promise(r => setTimeout(r, 1000))
  }
  if (blocks === 0) {
    await page.screenshot({ path: join(OUT_DIR, 'visual-fail.png'), fullPage: true })
    const genuiLog = consoleLines.filter(l => l.includes('genui')).slice(0, 6).join(' | ')
    const otherLog = consoleLines.slice(-14).join('\n    ')
    const diag = await page.evaluate(() => ({
      injected: document.querySelectorAll('[data-visual-inject]').length,
      containers: document.querySelectorAll('.genui-dom-fence').length,
      genuiRoots: document.querySelectorAll('[data-genui]').length,
      hidden: document.querySelectorAll('.md-code-block[style*="display: none"]').length,
      containerHtml: document.querySelector('.genui-dom-fence')?.innerHTML.slice(0, 300) ?? 'none',
      processed: document.querySelector('[data-visual-inject]')?.hasAttribute('data-genui-rendered') ?? null,
      codeBlocks: document.querySelectorAll('.md-code-block').length,
    }))
    throw new Error(`30s 内画廊未渲染（pageerrors: ${pageErrors.slice(0, 3).join(' | ') || '无'}；genui: ${genuiLog || '无'}；其他 console: ${otherLog || '无'}；diag: ${JSON.stringify(diag)}）`)
  }
  log(`✓ 画廊渲染成功（${blocks} 个 data-genui 块）`)

  // 等懒加载引擎：mermaid 渲染、three.js 场景就绪（WebGL 在 headless 走 swiftshader）
  await page.waitForTimeout(6000)
  await page.screenshot({ path: join(OUT_DIR, 'gallery.png'), fullPage: true })
  log(`✓ 截图 gallery.png`)

  // ── 流式骨架验证 ─────────────────────────────────────────────────────────
  // 半截 JSON 的 dsh-ui 围栏：不显示裸 JSON，而是骨架；settle 后若仍解析不了
  // 必须把原始代码块还回来（不能永久藏起来）。
  await page.evaluate(() => {
    const row = document.createElement('div')
    row.setAttribute('data-chat-anchor-key', 'e2e-skeleton:0')
    row.setAttribute('data-chat-flow-kind', 'assistant-step')
    row.setAttribute('data-streaming', '')
    const block = document.createElement('div')
    block.className = 'md-code-block'
    block.setAttribute('data-visual-skeleton', '1')
    const label = document.createElement('div')
    label.textContent = 'dsh-ui'
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = '{"items":[{"type":"stat","label":"CPU","value":"42%'
    pre.appendChild(code)
    block.append(label, pre)
    row.appendChild(block)
    ;(document.querySelector('[data-chat-flow]') ?? document.body).appendChild(row)
  })
  await page.waitForTimeout(2500)
  const skeleton = await page.evaluate(() => ({
    skeleton: document.querySelectorAll('.genui-dom-fence [class*="skeleton"]').length,
    rawVisible: document.querySelector('[data-visual-skeleton]')?.getAttribute('style') ?? '',
  }))
  if (skeleton.skeleton === 0) throw new Error(`流式骨架未出现（${JSON.stringify(skeleton)}）`)
  await page.evaluate(() => { document.querySelector('[data-chat-anchor-key="e2e-skeleton:0"]')?.removeAttribute('data-streaming') })
  await page.waitForTimeout(1800)
  // settle 后 tier-2 补全把半截 spec 修好 → 骨架换成真组件（这是更好的结果；
  // 「补不回来就归还原始代码块」由 tests/dom-fence.spec.tsx 覆盖）。
  const restored = await page.evaluate(() => {
    const block = document.querySelector('[data-visual-skeleton]')
    const container = document.querySelector('.genui-dom-fence')
    return {
      skeletons: document.querySelectorAll('.genui-dom-fence [class*="skeleton"]').length,
      hidden: block?.getAttribute('style')?.includes('display: none') ?? false,
      text: container?.textContent ?? '',
    }
  })
  if (restored.skeletons !== 0 || !restored.hidden || !restored.text.includes('CPU')) {
    throw new Error(`骨架未在 settle 后换成真组件（${JSON.stringify(restored)}）`)
  }
  log('✓ 流式骨架：出现 → settle 后换成真组件')

  // ── 引擎渐进披露验证 ─────────────────────────────────────────────────────
  // 基础图型只需 core 引擎；进阶图型（radar/sankey/…）或裸 option 才拉完整包。
  if (assetRequests.includes('echarts-core.js')) {
    if (!assetRequests.includes('echarts-full.js')) {
      throw new Error(`radar/sankey 采样在场却没拉完整引擎（请求：${assetRequests.join(', ')}）`)
    }
    log(`✓ 引擎按需：${[...new Set(assetRequests)].join(' + ')}`)
  }

  // ── 本地筛选（数据绑定）验证 ─────────────────────────────────────────────
  // 绑定筛选是纯客户端行为：输入框的值直接过滤表格，不发任何请求。断言它在真实
  // 浏览器里确实生效，且清空后恢复。
  const filterInput = page.getByPlaceholder('输入关键字即时过滤下表')
  if (await filterInput.count() > 0) {
    const before = await page.locator('table tbody tr').count()
    await filterInput.fill('搜索')
    await page.waitForTimeout(400)
    const after = await page.locator('table tbody tr').count()
    if (!(after < before)) throw new Error(`绑定筛选未生效（${before} → ${after} 行）`)
    await filterInput.fill('')
    await page.waitForTimeout(300)
    const restored = await page.locator('table tbody tr').count()
    if (restored !== before) throw new Error(`清空筛选后未恢复（期望 ${before}，实际 ${restored}）`)
    log(`✓ 本地筛选：${before} → ${after} → ${restored} 行`)
  }

  // ── 文件树布局验证 ───────────────────────────────────────────────────────
  // jsdom 没有布局，只有真实浏览器能证明「子节点在父节点下方」——这条断言钉住
  // 曾经的 bug：子节点被塞进父行的 flex 容器，整棵树横着排成一行。
  const treeCheck = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[class*="ftRow"]')] as HTMLElement[]
    if (rows.length < 2) return { ok: false, reason: `只有 ${rows.length} 行` }
    const [first, second] = rows as [HTMLElement, HTMLElement]
    const a = first.getBoundingClientRect()
    const b = second.getBoundingClientRect()
    return {
      ok: b.top >= a.bottom - 1,
      reason: `parent.top=${Math.round(a.top)} parent.bottom=${Math.round(a.bottom)} child.top=${Math.round(b.top)}`,
      rows: rows.length,
      guides: document.querySelectorAll('[class*="ftGuide"]').length,
      glyphs: document.querySelectorAll('[class*="ftGlyph"] svg').length,
    }
  })
  if (!treeCheck.ok) throw new Error(`文件树没有纵向堆叠（${treeCheck.reason}）`)
  log(`✓ 文件树：${treeCheck.rows} 行纵向堆叠 · ${treeCheck.guides} 条层级引导线 · ${treeCheck.glyphs} 个图标`)

  // ── ECharts 配色验证（读 canvas 像素）────────────────────────────────────
  // 回归：宿主把 --dsw-static-* 定义在 body 上，而引擎只从 :root 读 → 每个
  // 系列都回退成同一个强调色，多序列图全是一片蓝。这里直接数像素色数。
  const hueCheck = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('[data-genui-echart] canvas')] as HTMLCanvasElement[]
    const target = canvases[1] ?? canvases[0]
    if (target === undefined) return { ok: false, reason: '没有 canvas' }
    const ctx = target.getContext('2d')
    if (ctx === null) return { ok: false, reason: '没有 2d 上下文' }
    const { data } = ctx.getImageData(0, 0, target.width, target.height)
    const hues = new Set<string>()
    let saturated = 0
    for (let i = 0; i < data.length; i += 4 * 37) {
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      if ((data[i + 3] ?? 0) < 200) continue
      // Only count SATURATED pixels: greys are axes/labels/background and would
      // let a single-colour chart pass this check.
      if (Math.max(r, g, b) - Math.min(r, g, b) < 40) continue
      saturated += 1
      hues.add(`${r >> 5}-${g >> 5}-${b >> 5}`)
    }
    // The radar preset draws two series: two distinct saturated hues are the
    // minimum proof that the palette did not collapse to one accent colour.
    return { ok: hues.size >= 2 && saturated >= 20, hues: hues.size, saturated, canvases: canvases.length }
  })
  if (!hueCheck.ok) throw new Error(`ECharts 配色异常（${JSON.stringify(hueCheck)}）`)
  log(`✓ ECharts 配色：${hueCheck.canvases} 张画布，雷达图 ${hueCheck.hues} 种饱和色（${hueCheck.saturated} 像素）`)

  // ── 图表 tooltip 验证（真实 hover）────────────────────────────────────────
  const stackSeg = page.locator('[class*="stackSeg"]').first()
  if (await stackSeg.count() > 0) {
    await stackSeg.hover()
    await page.waitForTimeout(300)
    const tipText = await page.locator('[class*="chartTip"]').first().textContent().catch(() => null)
    if (tipText === null || !tipText.includes('合计')) {
      throw new Error(`堆叠段 hover 未弹出明细 tooltip（${String(tipText)}）`)
    }
    log(`✓ 图表 tooltip：${tipText.replace(/\s+/g, ' ').trim()}`)
  }

  // ── 本地交互验证 ─────────────────────────────────────────────────────────
  // 点击在第一个 evaluate 里做；React 18 的状态更新是异步的，断言放到
  // 下一次 evaluate（中间隔一个 timeout），否则必然读到旧 DOM。
  const clicked = await page.evaluate(() => {
    const out: string[] = []
    // 1) 表格排序：点数值列「Q1」表头（数值感知排序的最小行应当是 0.3% 的错误率行）
    const ths = [...document.querySelectorAll('[data-genui] thead th button')]
    const q1 = ths.find(b => b.textContent?.includes('Q1'))
    if (q1) { (q1 as HTMLButtonElement).click(); out.push('sort-clicked=Q1') }
    // 2) 判题：点 quiz 的正确选项「2」（排除解释文本里的“二进制”）
    const quizBtns = [...document.querySelectorAll('[data-genui-quiz] button')]
    const correct = quizBtns.find(b => b.textContent?.includes('2') && !b.textContent?.includes('二进制'))
    if (correct) { (correct as HTMLButtonElement).click(); out.push('quiz-clicked=2') }
    // 3) 目录折叠：点 file-tree 的「src」目录行（第一个 aria-expanded=true
    //    的按钮是 accordion 头，必须按行文本定位到文件树）
    const dirBtn = [...document.querySelectorAll<HTMLElement>('[data-genui] button[aria-expanded="true"]')]
      .find(b => b.textContent?.includes('src'))
    if (dirBtn) { dirBtn.click(); out.push('tree-clicked=src') }
    return out
  })
  await page.waitForTimeout(600)
  const interacted = await page.evaluate(() => {
    const out: string[] = []
    // 1) 排序结果：升序后首行应是最小 Q1（0.3% 的错误率行）；排序标记在 Q1 表头
    const rows = [...document.querySelectorAll('[data-genui] tbody tr')].map(tr => tr.textContent ?? '')
    const firstRow = rows[0] ?? ''
    out.push(`sort-first=${firstRow.includes('错误率') ? '错误率' : '?'}`)
    const q1th = document.querySelectorAll('[data-genui] thead th')[1]
    out.push(`sort-aria=${q1th?.getAttribute('aria-sort') ?? '?'}`)
    // 2) 判题结果
    out.push('quiz-correct=' + String(document.querySelector('[data-genui-quiz]')?.textContent?.includes('回答正确')))
    // 3) 目录折叠结果：按行文本回找同一个按钮
    const srcDir = [...document.querySelectorAll<HTMLElement>('[data-genui] button[aria-expanded]')]
      .find(b => b.textContent?.includes('src'))
    out.push('tree-collapsed=' + String(srcDir?.getAttribute('aria-expanded') === 'false'))
    // 4) 数值列右对齐类名在场
    out.push('tdNum=' + String(document.querySelectorAll('[data-genui] td[class*="tdNum"]').length))
    return out
  })
  log(`交互检查: ${interacted.join(' · ')}`)
  // 防假通过：本地交互是渲染层的核心承诺，任何一项不成立都必须失败。
  const mustPass = [
    ['sort-first=错误率', '数值感知排序'],
    ['sort-aria=ascending', '排序 aria 标记'],
    ['quiz-correct=true', '本地判题'],
    ['tree-collapsed=true', '目录折叠'],
  ]
  for (const [expectation, label] of mustPass) {
    if (!interacted.includes(expectation)) throw new Error(`交互断言失败: ${label}（期望 ${expectation}，实际 ${interacted.join(' · ')}）`)
  }
  if (!interacted.some(s => s.startsWith('tdNum=') && Number(s.slice(6)) > 0)) throw new Error('交互断言失败: 数值列右对齐类名缺失')
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT_DIR, 'interactions.png'), fullPage: true })
  log(`✓ 截图 interactions.png`)

  if (pageErrors.length > 0) throw new Error(`页面异常: ${pageErrors.slice(0, 3).join(' | ')}`)
  await browser.close()
  await cleanup()
  console.log('PASS 视觉 e2e：画廊渲染 + 本地交互 + 无页面异常')
  process.exit(0)
} catch (e) {
  console.error('✗ e2e 异常:', e)
  await browser?.close().catch(() => {}) // playwright 浏览器子进程不留孤儿
  await cleanup()
  process.exit(1)
}
