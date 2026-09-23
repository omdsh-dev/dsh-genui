#!/usr/bin/env node
/**
 * dsh-genui 真机 e2e：真实 dsh web + 插件 → 模型输出 dsh-ui fence → 浏览器渲染
 * → 点击 action 按钮 → 模型收到 [genui-action] 并响应更新。全程走真实链路，
 * 不 mock 任何环节。
 *
 * 防假通过：点击后的"响应"只认「出现新的 assistant-step key（且新节点不再
 * streaming）或面板/块数由新操作驱动」——按钮的本地 chip 文案变化不算响应。
 * 失败日志可读：web 的 stdout/stderr 真写进 dsh-web.log，失败时输出日志尾部，
 * 截图保留到当前目录；清理在 finally 中完成，只杀自己起的进程组。
 *
 * 用法：
 *   node scripts/e2e.mjs [--port 3088] [--keep] [--install link|npm|tarball]
 *                        [--tarball <路径> --tarball-sha256 <sha>] [--smoke]
 *
 *   --install link    （默认）装当前工作区，测的就是当前代码
 *   --install npm     从公开 npm 包安装
 *   --install tarball 必须给 --tarball 绝对路径与 --tarball-sha256（防假安装）
 *   --smoke           不要求模型 Key：安装 → 启动 → 首页/client.js 200 →
 *                     无页面异常 → 插件 boot → Diff/Code/JSON 渲染与复制；不跑模型链路
 * 退出码 0 = PASS，1 = FAIL。
 */

import { spawn, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, rmSync } from 'node:fs'
import { mkdtemp, mkdir, copyFile, rm, writeFile, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_ROOT = process.env.DSH_ROOT ?? resolve(process.env.HOME ?? '', '.dsh/source/current')
// 精确宿主二进制：必须是 DSH_ROOT 内构建出的绝对路径；默认不从 PATH 找 dsh。
const DSH_BIN = process.env.DSH_BIN ?? join(DSH_ROOT, 'apps/cli/lib/bin.js')
if (!resolve(DSH_BIN).startsWith('/')) fail('DSH_BIN 必须是绝对路径')
if (!existsSync(DSH_BIN)) fail(`DSH_BIN 不存在: ${DSH_BIN}（在 DSH_ROOT 内先 pnpm run build）`)
const arg = (name) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}
function findDshWebUrl(output) {
  return output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+(?:\/\?token=[A-Za-z0-9_-]+)?)/u)?.[1]
}
const PORT = Number(arg('--port') ?? 3088)
const KEEP = process.argv.includes('--keep')
const SMOKE = process.argv.includes('--smoke')
const INSTALL = arg('--install') ?? 'link'
const TARBALL = arg('--tarball')
const TARBALL_SHA = arg('--tarball-sha256')
const PROMPT = '请严格照抄以下三行 Markdown，不要增加或删除任何字符。第一行只有围栏标签，JSON 从第二行开始：\n```dsh-ui\n{"items":[{"type":"text","content":"兼容验收"},{"type":"radio","label":"模式","group":"mode","options":["甲","乙"]},{"type":"checkbox","label":"启用","group":"flags"},{"type":"input","id":"note","label":"备注"},{"type":"button","label":"发送动作","action":"compat_ping"}]}\n```'

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }
const log = (msg) => console.log(`· ${msg}`)

// ── 预检：参数、端口、工具 ─────────────────────────────────────────────────
if (!['link', 'npm', 'tarball'].includes(INSTALL)) fail(`--install 仅允许 link | npm | tarball，收到 "${INSTALL}"`)
if (INSTALL === 'tarball') {
  if (!TARBALL || !TARBALL_SHA) fail('tarball 模式必须提供 --tarball <绝对路径> 与 --tarball-sha256 <sha256>')
  if (!resolve(TARBALL).startsWith('/')) fail('--tarball 必须是绝对路径')
  if (!existsSync(TARBALL)) fail(`tarball 不存在: ${TARBALL}`)
  const actual = createHash('sha256').update(await (await import('node:fs/promises')).readFile(TARBALL)).digest('hex')
  if (actual !== TARBALL_SHA.toLowerCase()) fail(`tarball SHA256 不匹配：期望 ${TARBALL_SHA}，实际 ${actual}`)
  log(`✓ tarball SHA256 匹配（${actual.slice(0, 12)}…）`)
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) fail(`非法端口: ${PORT}`)
await new Promise((res) => {
  const probe = createServer()
  probe.once('error', () => { fail(`端口 ${PORT} 已被占用，请用 --port 换一个`) })
  probe.listen(PORT, '127.0.0.1', () => probe.close(res))
})
if (!SMOKE && !process.env.DEEPSEEK_API_KEY) fail('缺少 DEEPSEEK_API_KEY（模型需要真实 key；--smoke 模式不需要）')
{
  const r = spawnSync('sh', ['-c', 'command -v pnpm'], { encoding: 'utf8' })
  if (r.status !== 0) fail('未找到 pnpm，请先安装并确保在 PATH 上')
}
log(`DSH_BIN: ${DSH_BIN}`)
log(`pnpm: ${spawnSync('pnpm', ['--version'], { encoding: 'utf8' }).stdout.trim()}`)

// ── 临时环境 ──────────────────────────────────────────────────────────────
const DSH_HOME = await mkdtemp(join(REPO_ROOT, '.e2e-artifacts-host-'))
const env = { ...process.env, DSH_HOME }
const webLog = join(DSH_HOME, 'dsh-web.log')
const artifactsDir = process.cwd()
let webChild = null

const killWeb = () => {
  if (webChild === null) return
  // 只杀自己启动的进程组（detached spawn 的负 pid），绝不 broad pkill
  try { process.kill(-webChild.pid, 'SIGTERM') } catch { /* already gone */ }
  try { process.kill(webChild.pid, 'SIGTERM') } catch { /* already gone */ }
  webChild = null
}

// fail() 会直接退出；exit 钩子保证失败路径也只清理本脚本创建的临时环境。
process.on('exit', () => {
  killWeb()
  if (!KEEP) rmSync(DSH_HOME, { recursive: true, force: true })
})

const cleanup = async () => {
  killWeb()
  if (!KEEP) await rm(DSH_HOME, { recursive: true, force: true })
  else log(`保留临时环境: ${DSH_HOME}（日志: ${webLog}）`)
}

const logTail = async (n = 30) => {
  try {
    const content = await (await import('node:fs/promises')).readFile(webLog, 'utf8')
    const lines = content.split('\n').filter(Boolean).slice(-n)
    console.error('── dsh-web.log 尾部 ──')
    console.error(lines.join('\n') || '(空)')
  } catch { /* no log yet */ }
}

try {
  // ── 安装插件 ────────────────────────────────────────────────────────────
  if (INSTALL === 'npm') {
    log('安装插件（npm 公开包）...')
    const r = spawnSync(DSH_BIN, ['plugin', '--profile', 'web', 'add', '@changfenhuang/dsh-genui'], { env, stdio: 'inherit' })
    if (r.status !== 0) fail('npm 安装失败（见上方输出）')
  } else if (INSTALL === 'tarball') {
    log(`安装插件（tarball ${TARBALL}）...`)
    const r = spawnSync(DSH_BIN, ['plugin', '--profile', 'web', 'add', TARBALL], { env, stdio: 'inherit' })
    if (r.status !== 0) fail('tarball 安装失败（见上方输出）')
  } else {
    log('安装插件（link 当前工作区）...')
    const r = spawnSync(DSH_BIN, ['plugin', '--profile', 'web', 'add', `link:${REPO_ROOT}`], { env, stdio: 'inherit' })
    if (r.status !== 0) fail('link 安装失败（见上方输出）')
  }

  // ── 启动 dsh web（stdout/stderr 真写进 webLog）──────────────────────────
  log('预置工作区注册表...')
  const workspaceId = randomUUID()
  const now = new Date().toISOString()
  const workspaceReg = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [workspaceId], archivedSessionIds: [] },
    tables: { workspaces: { [workspaceId]: {
      path: REPO_ROOT, title: 'dsh-genui-e2e', sessionIds: [], createdAt: now, updatedAt: now,
    } } },
  }
  await mkdir(join(DSH_HOME, 'storages'), { recursive: true })
  await writeFile(join(DSH_HOME, 'storages/workspace.json'), JSON.stringify(workspaceReg, null, 2))

  const hostSettings = join(homedir(), '.dsh/settings.yaml')
  if (!SMOKE && existsSync(hostSettings)) {
    await copyFile(hostSettings, join(DSH_HOME, 'settings.yaml'))
    log('已复制模型配置 settings.yaml')
  } else if (!SMOKE) {
    log('警告: 未找到 ~/.dsh/settings.yaml，模型可能不可用')
  }

  log(`启动 dsh web (port ${PORT}, DSH_HOME=${DSH_HOME})...`)
  const logStream = createWriteStream(webLog, { flags: 'a' })
  webChild = spawn(DSH_BIN, ['web', '--no-open', '--port', String(PORT)], {
    env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let webOutput = ''
  const captureWebOutput = (chunk) => {
    logStream.write(chunk)
    webOutput += chunk.toString()
  }
  webChild.stdout.on('data', captureWebOutput)
  webChild.stderr.on('data', captureWebOutput)
  let readyUrl
  for (let i = 0; i < 120; i++) {
    if (webChild.exitCode !== null) break
    readyUrl = findDshWebUrl(webOutput)
    if (readyUrl !== undefined) break
    await new Promise(r => setTimeout(r, 1000))
  }
  if (readyUrl === undefined) {
    await logTail()
    fail(`dsh web 120s 内未就绪（日志: ${webLog}）`)
  }
  log('dsh web 就绪')

  // ── 浏览器链路 ──────────────────────────────────────────────────────────
  const { chromium } = await import(pathToFileURL(join(DSH_ROOT, 'apps/web/node_modules/playwright/index.mjs')).href)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, locale: 'zh-CN', permissions: ['clipboard-read', 'clipboard-write'] })
  const pageErrors = []
  const pageMessages = []
  page.on('console', message => pageMessages.push(message.text()))
  page.on('pageerror', e => pageErrors.push(String(e)))
  await page.goto(readyUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)

  // 0.1.2 起使用启动图公告的不可变组合 URL；更早的受支持宿主使用裸插件地址。
  const boot = await page.evaluate(() => {
    const boot = window.__DSH_BOOT__
    if (boot === null || typeof boot !== 'object' || !Array.isArray(boot.entries)) return undefined
    return { entries: boot.entries.length, clientUrl: boot.entries.find(entry => entry.id === '@changfenhuang/dsh-genui')?.url }
  })
  if (boot?.entries === 0) {
    await page.screenshot({ path: join(artifactsDir, 'e2e-fail-empty-host-boot.png') })
    fail('dsh 宿主启动图为空（连内置浏览器插件都未注册）')
  }
  const clientUrl = boot?.clientUrl ?? '/plugins/@changfenhuang/dsh-genui/client.js'
  const clientRes = await fetch(new URL(clientUrl, readyUrl))
  if (!clientRes.ok) {
    await page.screenshot({ path: join(artifactsDir, 'e2e-fail-client404.png') })
    await logTail()
    fail(`GenUI bundle 返回 ${clientRes.status}`)
  }
  log(`✓ GenUI bundle ${clientRes.status}`)

  if (pageErrors.length > 0) {
    await page.screenshot({ path: join(artifactsDir, 'e2e-fail-pageerror.png') })
    fail(`页面异常: ${pageErrors.slice(0, 3).join(' | ')}`)
  }
  if (!pageMessages.some(message => message.includes('[genui] client active; fence-channel='))) {
    fail('GenUI bundle 已下载，但客户端入口未激活')
  }

  if (SMOKE) {
    // Fresh keyless profiles follow the host's normal two-step onboarding.
    await page.getByRole('button', { name: '继续', exact: true }).click()
    await page.getByRole('button', { name: '稍后配置', exact: true }).click()
    // Reuse the visual smoke's DOM fence channel with a deterministic primitive fixture.
    // This exercises the installed tarball against the actual host, without a model call.
    await page.evaluate(() => {
      const fixture = document.createElement('div')
      fixture.setAttribute('data-primitives-smoke', '')
      const host = document.createElement('div')
      host.className = 'md-code-block'
      const label = document.createElement('div')
      label.textContent = 'dsh-ui'
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.textContent = JSON.stringify({ items: [
        { type: 'diff', diffs: [{ path: 'smoke.txt', oldText: 'before', newText: 'after' }] },
        { type: 'code', lang: 'text', code: 'primitive smoke' },
        { type: 'json', value: { answer: 42 } },
        { type: 'table', columns: ['数值校验'], rows: [['103'], [86], ['25']] },
        { type: 'text', content: '表格后续文字' },
        { type: 'badge', label: '颜色校验', tone: 'success' },
        { type: 'progress', value: 70 },
        { type: 'callout', title: '提示颜色校验', tone: 'success', content: '颜色应正常显示' },
      ] })
      pre.appendChild(code)
      host.append(label, pre)
      fixture.appendChild(host)
      document.body.appendChild(fixture)
    })
    const rendered = page.locator('[data-primitives-smoke] [data-genui]')
    await rendered.locator('[data-diff]').waitFor({ state: 'visible' })
    await rendered.locator('[data-json-root-row]').waitFor({ state: 'visible' })
    if (await rendered.locator('[data-diff]').getByRole('button', { name: '复制' }).count() === 0) {
      throw new Error('DiffBlock 缺少复制文案')
    }
    await rendered.locator('.md-code-block button').click()
    await page.waitForFunction(async () => await navigator.clipboard.readText() === 'primitive smoke')
    const table = rendered.locator('table').filter({ has: page.getByRole('button', { name: '数值校验' }) })
    await table.getByRole('button', { name: '数值校验' }).click()
    assert.deepEqual(await table.locator('tbody td').allTextContents(), ['25', '86', '103'])
    await table.getByRole('button', { name: '数值校验' }).click()
    assert.deepEqual(await table.locator('tbody td').allTextContents(), ['103', '86', '25'])
    await page.waitForFunction(() => [...document.querySelectorAll('[data-primitives-smoke] [class*="reveal"]')]
      .every(element => getComputedStyle(element).animationName === 'none'))
    await table.scrollIntoViewIfNeeded()
    const beforeHover = await table.boundingBox()
    await table.hover()
    assert.deepEqual(await table.boundingBox(), beforeHover, '悬停不移动表格')
    const position = await table.evaluate(element => {
      const reveal = element.closest('[class*="reveal"]')
      const following = reveal.nextElementSibling
      const before = [element.getBoundingClientRect().y, following.getBoundingClientRect().y]
      reveal.remove()
      following.before(reveal)
      return { before, after: [element.getBoundingClientRect().y, following.getBoundingClientRect().y], animations: reveal.getAnimations().length }
    })
    assert.deepEqual(position.after, position.before, '重新插入已显示表格不重播位移动画')
    assert.equal(position.animations, 0)
    const colors = await rendered.evaluate(element => {
      const background = selector => getComputedStyle(element.querySelector(selector)).backgroundColor
      const fill = element.querySelector('[class*="track"] > [class*="fill"]')
      return { badge: background('[class*="badge"]'), callout: background('[class*="calloutSuccess"]'), fill: getComputedStyle(fill).backgroundImage, width: fill.style.width }
    })
    for (const color of [colors.badge, colors.callout]) {
      assert.ok(color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)', `语义颜色无效: ${color}`)
    }
    assert.notEqual(colors.fill, 'none')
    assert.equal(colors.width, '70%')
    log(`排序、颜色、悬停和节点重新插入验证通过：${JSON.stringify({ position, colors })}`)
    if (pageErrors.length > 0) throw new Error(`组件渲染异常: ${pageErrors.join(' | ')}`)
    // Exercise the installed SVG without remounting it when the host changes theme.
    await page.emulateMedia({ colorScheme: 'light' })
    await page.evaluate(() => {
      const fixture = document.createElement('div')
      fixture.setAttribute('data-diagram-smoke', '')
      fixture.style.width = '320px'
      const host = document.createElement('div')
      host.className = 'md-code-block'
      const label = document.createElement('div')
      label.textContent = 'dsh-ui'
      const pre = document.createElement('pre')
      pre.textContent = JSON.stringify({ items: [{ type: 'diagram', kind: 'architecture', title: '主题验收', nodes: [
        { id: 'a', label: '入口', type: 'focal', x: 40, y: 40, w: 128, h: 64 },
        { id: 'b', label: '服务', type: 'backend', x: 40, y: 144, w: 128, h: 64 },
        { id: 'c', label: '存储', type: 'store', x: 40, y: 248, w: 128, h: 64 },
      ], edges: [] }] })
      host.append(label, pre)
      fixture.append(host)
      document.body.prepend(fixture)
    })
    const diagram = page.locator('[data-diagram-smoke] [data-genui-diagram]')
    await diagram.waitFor({ state: 'visible' })
    const originalSvg = await diagram.locator('svg').elementHandle()
    for (const mode of ['light', 'dark', 'light']) {
      await page.emulateMedia({ colorScheme: mode })
      await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, mode === 'dark')
      const result = await diagram.evaluate(element => {
        const svg = element.querySelector('svg')
        const text = [...svg.querySelectorAll('text')].find(t => t.textContent === '服务')
        const probe = document.createElement('span')
        probe.style.backgroundColor = 'var(--dsw-alias-bg-layer-2)'
        probe.style.color = 'var(--dsw-alias-label-primary)'
        element.append(probe)
        const expected = { paper: getComputedStyle(probe).backgroundColor, ink: getComputedStyle(probe).color }
        probe.remove()
        const rect = svg.getBoundingClientRect()
        return {
          expected, paper: getComputedStyle(svg).backgroundColor, ink: getComputedStyle(text).fill,
          node: getComputedStyle(text.parentElement.querySelectorAll('rect')[1]).fill,
          clipped: [...svg.querySelectorAll('text')].filter(t => {
            const box = t.getBoundingClientRect()
            return box.left < rect.left - 1 || box.right > rect.right + 1 || box.bottom > rect.bottom + 1
          }).map(t => t.textContent),
        }
      })
      assert.equal(result.paper, result.expected.paper, `${mode}: diagram follows host background`)
      assert.equal(result.ink, result.expected.ink, `${mode}: diagram follows host text`)
      assert.equal(result.node, result.expected.paper, `${mode}: backend node follows theme`)
      assert.deepEqual(result.clipped, [], `${mode}: narrow diagram legend remains visible`)
      assert.ok(await originalSvg.evaluate(el => el.isConnected), 'theme changes must not remount the diagram')
      await diagram.screenshot({ path: join(artifactsDir, `diagram-${mode}.png`) })
    }
    log('图表深浅主题往返切换、节点配色及窄图例验证通过')

    // Exercise every math-bearing field against the installed host and fonts.
    await page.evaluate(() => {
      const fixture = document.createElement('div')
      fixture.setAttribute('data-math-smoke', '')
      fixture.style.width = '320px'
      const host = document.createElement('div')
      host.className = 'md-code-block'
      const label = document.createElement('div')
      label.textContent = '  dsh-ui\n'
      const pre = document.createElement('pre')
      pre.textContent = JSON.stringify({ title: '\\(x^2\\)', items: [
        { type: 'text', content: 'Energy **\\(E=mc^2\\)**; $$\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$$' },
        { type: 'list', items: ['Value ==\\(x^2\\)==', { title: '$a+b$', desc: '$c+d$' }] },
        { type: 'table', columns: ['\\(x\\)'], rows: [['$x+y$']] },
        { type: 'keyvalue', pairs: [{ key: 'Result', value: '$z^2$' }] },
        { type: 'callout', title: '$a^2$', content: '$b^2$' },
        { type: 'steps', steps: [{ title: '\\(a=b\\)', desc: '\\[\\begin{aligned}a&=b+c\\\\&=d\\end{aligned}\\]' }] },
        { type: 'timeline', items: [{ title: '\\(x\\)', desc: '\\[f(x)=\\begin{cases}x&x>0\\\\-x&x<0\\end{cases}\\]' }] },
        { type: 'card', title: '\\(a+b\\)', items: [] },
        { type: 'quiz', question: '\\(x^2\\)', options: [{ label: '\\(4\\)', correct: true }] },
        { type: 'tabs', tabs: [{ label: '\\(x\\)', items: [] }] },
        { type: 'input', label: '\\(y\\)' },
        { type: 'button', label: '\\(z\\)' },
      ] })
      host.append(label, pre)
      fixture.append(host)
      document.body.prepend(fixture)
    })
    const math = page.locator('[data-math-smoke] [data-genui]')
    await math.waitFor({ state: 'visible' })
    assert.equal(await math.locator('.katex').count(), 21, '所有覆盖的文字字段均渲染公式')
    assert.equal(await math.locator('.katex-display').count(), 3, '矩阵、分段函数、多行推导独立显示')
    assert.equal(await math.locator('.katex-error').count(), 0, '公式解析无错误')
    await page.evaluate(() => document.fonts.ready)
    for (const mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode })
      await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, mode === 'dark')
      const geometry = await math.evaluate(element => {
        const formula = element.querySelector('.katex')
        const parent = formula.closest('[class*="inlineMath"]')
        const box = formula.getBoundingClientRect()
        return { width: box.width, height: box.height, color: getComputedStyle(formula).color,
          inheritedColor: getComputedStyle(parent).color, overflow: element.scrollWidth > element.clientWidth + 1 }
      })
      assert.ok(geometry.width > 10 && geometry.height > 10)
      assert.equal(geometry.color, geometry.inheritedColor)
      assert.equal(geometry.overflow, false, '320px 窄卡公式不撑破布局')
      await math.screenshot({ path: join(artifactsDir, `math-${mode}.png`) })
    }
    if (pageErrors.length > 0) throw new Error(`公式渲染异常: ${pageErrors.join(' | ')}`)
    log('公式跨字段、深浅主题、窄卡布局和空白标签识别验证通过')

    // Regression fixture for issue #172: two legal fence bodies the guard used
    // to reject wholesale — the fence silently degraded to a raw JSON code
    // block. Both must now render as UI, while a genuinely broken body must
    // still stay a code block (all-or-nothing policy unchanged).
    await page.evaluate(() => {
      const fence = (marker, body) => {
        const fixture = document.createElement('div')
        fixture.setAttribute(marker, '')
        const host = document.createElement('div')
        host.className = 'md-code-block'
        const label = document.createElement('div')
        label.textContent = 'dsh-ui'
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        code.textContent = JSON.stringify(body)
        pre.appendChild(code)
        host.append(label, pre)
        fixture.appendChild(host)
        document.body.prepend(fixture)
      }
      // A: one stat carrying a metric list, next to a legal sibling node.
      fence('data-genui-172-stat', { title: '进度快照', gap: 12, items: [
        { type: 'stat', items: [{ label: '质量门进度', value: '1/5 施工中' }, { label: '阻塞项', value: '0' }] },
        { type: 'callout', tone: 'info', title: '进度说明', content: '内容' },
      ] })
      // B: bare data-component root whose `items` is its record list.
      fence('data-genui-172-steps', { type: 'steps', title: '修复策略', items: [
        { title: '第一层', desc: 'a' }, { title: '第二层', desc: 'b' }, { title: '第三层', desc: 'c' },
      ] })
      // Control: missing required fields stays a code block (no silent green).
      fence('data-genui-172-bad', { items: [{ type: 'stat' }] })
    })
    const statRow = page.locator('[data-genui-172-stat] [data-genui]')
    await statRow.waitFor({ state: 'visible' })
    const statText = await statRow.textContent()
    for (const fragment of ['质量门进度', '施工中', '阻塞项', '进度说明']) {
      assert.ok(statText.includes(fragment), `#172 A：渲染结果缺少 ${fragment}`)
    }
    assert.equal(await page.locator('[data-genui-172-stat] [data-genui] [data-genui]').count(), 0, '#172 A：不应出现多余的 col 包裹层')
    const stepsBlock = page.locator('[data-genui-172-steps] [data-genui]')
    await stepsBlock.waitFor({ state: 'visible' })
    const stepsText = await stepsBlock.textContent()
    for (const fragment of ['修复策略', '第一层', '第二层', '第三层']) {
      assert.ok(stepsText.includes(fragment), `#172 B：渲染结果缺少 ${fragment}`)
    }
    // The stock code block is hidden only after a replacement mounted.
    for (const marker of ['data-genui-172-stat', 'data-genui-172-steps']) {
      const hidden = await page.locator(`[${marker}] > .md-code-block`).evaluate(block =>
        block.style.display === 'none' && block.hasAttribute('data-genui-rendered'))
      assert.ok(hidden, `${marker}：原始代码块应被替换隐藏`)
    }
    assert.equal(await page.locator('[data-genui-172-bad] [data-genui]').count(), 0, '#172 对照组：非法围栏不应渲染 UI')
    const badKept = await page.locator('[data-genui-172-bad] > .md-code-block').evaluate(block =>
      getComputedStyle(block).display !== 'none' && block.textContent.includes('"stat"'))
    assert.ok(badKept, '#172 对照组：非法围栏应保留原始代码块')
    // Issue #158: the rejected fence explains itself instead of failing silently.
    const badAlert = page.locator('[data-genui-172-bad] .genui-dom-fence-diagnostic [role="alert"]')
    await badAlert.waitFor({ state: 'visible' })
    const badAlertText = await badAlert.textContent()
    assert.ok(badAlertText.includes("type 'stat' requires label"), `#158 诊断应给出字段错误，实际：${badAlertText}`)
    assert.ok(badAlertText.includes('保持为代码块'), '#158 诊断应说明围栏保持为代码块')
    log('issue #172 围栏（stat 指标组、裸 steps 根、非法对照组+可见诊断）验证通过')

    // 在真实宿主中验证打包产物的 source-unavailable 最终兜底；该 fixture 不代表真实模型消息验收。
    await page.evaluate(() => {
      const assistantRow = document.createElement('div')
      assistantRow.setAttribute('data-chat-flow-kind', 'assistant-step')
      const cases = [
        ['valid', '代码块', '{"items":[{"type":"text","content":"通用代码块验收"}]}'],
        ['ordinary', '代码块', '{"message":"ordinary JSON"}'],
        ['incomplete', '代码块', '{"items":[{"type":"text","content":'],
        ['explicit', 'json', '{"items":[{"type":"text","content":"保持 JSON"}]}'],
      ]
      for (const [name, language, raw] of cases) {
        const fixture = document.createElement('div')
        fixture.setAttribute(`data-generic-${name}`, '')
        const block = document.createElement('div')
        block.className = 'md-code-block'
        const banner = document.createElement('div')
        banner.setAttribute('data-code-block-banner', '')
        const label = document.createElement('span')
        label.textContent = language
        banner.appendChild(label)
        const content = document.createElement('div')
        content.setAttribute('data-code-block-content', '')
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        code.textContent = raw
        pre.appendChild(code)
        content.appendChild(pre)
        block.append(banner, content)
        fixture.appendChild(block)
        assistantRow.appendChild(fixture)
      }
      document.body.appendChild(assistantRow)
    })
    await page.locator('[data-generic-valid] [data-genui]').waitFor({ state: 'visible' })
    assert.ok((await page.locator('[data-generic-valid] [data-genui]').textContent()).includes('通用代码块验收'))
    for (const name of ['ordinary', 'incomplete', 'explicit']) {
      assert.equal(await page.locator(`[data-generic-${name}] [data-genui]`).count(), 0, `${name} 应保持普通代码块`)
      assert.equal(await page.locator(`[data-generic-${name}] .md-code-block`).isVisible(), true)
    }
    log('packed client source-unavailable CodeBlock 严格兜底验证通过')

    log('smoke 模式：安装、激活、Diff/Code/JSON 真实渲染及复制均通过')
    await browser.close()
    await cleanup()
    console.log('PASS smoke e2e（不消耗模型额度）')
    process.exit(0)
  }

  // 新会话（工作区已预置）；点击失败不算容错——直接失败留证据
  const newSession = page.getByText('新会话', { exact: false }).first()
  await newSession.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {})
  const clickedNew = await newSession.click().then(() => true).catch(() => false)
  if (!clickedNew) {
    await page.screenshot({ path: join(artifactsDir, 'e2e-fail-newsession.png') })
    await logTail()
    fail('未找到可点击的「新会话」入口')
  }
  await page.getByText('dsh-genui-e2e', { exact: true }).first().click()

  // 使用宿主公开标记定位可编辑输入区，等待会话初始化完成。
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-composer-input]')
    return input instanceof HTMLElement && input.isContentEditable && !input.closest('[inert]')
  }, undefined, { timeout: 30000 })
  const composer = page.locator('[data-composer-input]')
  await composer.fill(PROMPT)
  await composer.press('Enter')
  log('prompt 已发送，等待模型输出 dsh-ui fence...')

  const genuiCount = () => page.evaluate(() => document.querySelectorAll('[data-genui]').length)
  /** 最后一个 assistant-step 的稳定 key（流式结束即稳定；出现新 key = 新回复） */
  const lastStepKey = () => page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-chat-flow-kind="assistant-step"]')
    return nodes.length ? nodes[nodes.length - 1].getAttribute('data-chat-flow-key') : null
  })
  const stepSettled = async () => page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-chat-flow-kind="assistant-step"]')
    if (nodes.length === 0) return false
    return nodes[nodes.length - 1].querySelector('[data-streaming]') === null
  })

  // 等待第一个 fence 渲染
  let blocks = 0
  for (let i = 0; i < 180; i++) {
    blocks = await genuiCount()
    if (blocks > 0) break
    await new Promise(r => setTimeout(r, 1000))
  }
  if (blocks === 0) {
    console.error('最后一条模型回复:', ((await page.locator('[data-chat-flow-kind="assistant-step"]').last().textContent().catch(() => null)) ?? '无').slice(-2000))
    console.error('dsh-ui 代码块数量:', await page.locator('.md-code-block').count())
    await page.screenshot({ path: join(artifactsDir, 'e2e-fail-timeout.png') })
    await logTail()
    fail(`模型 180s 内未输出可渲染的 dsh-ui fence（pageerrors: ${pageErrors.slice(0, 3).join(' | ') || '无'}）`)
  }
  log(`✓ fence 渲染成功（${blocks} 个 data-genui 块）`)

  const radio = page.getByRole('radiogroup', { name: '模式' }).getByRole('radio', { name: '乙' })
  const checkbox = page.getByRole('checkbox', { name: '启用' })
  const input = page.getByRole('textbox', { name: '备注' })
  await radio.check()
  await checkbox.check()
  await input.fill('保留状态')
  await page.waitForTimeout(500)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-genui]').first().waitFor({ state: 'visible' })
  assert.equal(await radio.isChecked(), true, 'radio 选择在重新渲染后保持')
  assert.equal(await checkbox.isChecked(), true, 'checkbox 选择在重新渲染后保持')
  assert.equal(await input.inputValue(), '保留状态', 'input 内容在重新渲染后保持')
  log('✓ radio、checkbox、input 状态在重新渲染后保持')

  // 点击围栏声明的 action 按钮
  const beforeKey = await lastStepKey()
  await page.getByRole('button', { name: '发送动作' }).click()
  log('已点击 action 按钮，等待模型响应...')
  await page.locator('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]')
    .filter({ hasText: '[genui-action]' }).first().waitFor({ state: 'attached', timeout: 30000 })
  log('✓ [genui-action] 已进入宿主会话消息')

  // 响应判定：新的 assistant-step key 出现且新节点结束 streaming；
  // 或 genui 块数变化（面板/新 fence）。按钮 chip 的本地文本变化不算。
  let responded = false
  for (let i = 0; i < 180; i++) {
    const key = await lastStepKey()
    const b2 = await genuiCount()
    if (b2 !== blocks) { responded = true; blocks = b2; break }
    if (key !== null && key !== beforeKey) {
      const settled = await stepSettled()
      if (settled) { responded = true; break }
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  if (!responded) {
    await page.screenshot({ path: join(artifactsDir, 'e2e-fail-action-timeout.png') })
    await logTail()
    fail('点击 action 后 180s 内无真实模型响应（事件循环未闭环；本地 chip 变化不算）')
  }
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(artifactsDir, 'e2e-final.png') })
  log(`✓ 事件循环闭环（块数 ${blocks}，截图 e2e-final.png）`)
  console.log('PASS 真机 e2e 通过：安装 → 渲染 → action 回传 → 真实模型响应')
  await browser.close()
  await cleanup()
  process.exit(0)
} catch (e) {
  console.error('✗ e2e 异常:', e)
  await logTail()
  await cleanup()
  process.exit(1)
}
