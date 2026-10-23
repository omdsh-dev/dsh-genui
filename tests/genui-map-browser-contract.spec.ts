/** Pure/script checks only. Passing this suite is NOT browser/WebGL acceptance. */
import { afterEach, describe, expect, it } from 'vitest'
import assert from 'node:assert/strict'
import { within } from '@testing-library/dom'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { parse } from 'yaml'
import { assertMapChecksPassed, assertOfflineMapArtifact, createMapSpec, mapBrowserLaunchOptions, measureRoutePixels, recordMapCheckFailure, safeMapError, validateMapMode } from '../scripts/map-acceptance/contract.mjs'
import { assertMapSubmission, mapConversationTitle, prepareMapConversation, replayChunks } from '../scripts/e2e-map-host.mjs'
import { validateGenuiSpec } from '../src/client/guard.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
function rgba(draw: (x: number, y: number) => number[]) {
  return { width: 80, height: 32, data: Array.from({ length: 80 * 32 }, (_, i) => [...draw(i % 80, Math.floor(i / 80)), 255]).flat() }
}
const paper = [238, 242, 246], blue = [49, 95, 168]
describe('Map real-browser acceptance contract (no browser launched)', () => {
  it('selects the conversation navigation target, not an identical visible breadcrumb', () => {
    const root = document.createElement('div')
    root.innerHTML = '<nav aria-label="会话"><span>Map browser synthetic conversation</span></nav><nav aria-label="会话层级"><span>Map browser synthetic conversation</span></nav>'
    const textTarget = (scope: HTMLElement, text: string, options: { exact: boolean }) => ({
      and: (_visible: unknown) => within(scope).getAllByText(text, options),
    })
    const page = {
      getByText: (text: string, options: { exact: boolean }) => textTarget(root, text, options),
      getByLabel: (label: string, options: { exact: boolean }) => {
        expect(options).toEqual({ exact: true })
        const scope = within(root).getByLabelText(label, options)
        return { getByText: (text: string, opts: { exact: boolean }) => textTarget(scope, text, opts) }
      },
      locator: (selector: string) => { expect(selector).toBe(':visible'); return 'visible' },
    }
    expect(within(root).getAllByText('Map browser synthetic conversation', { exact: true })).toHaveLength(2)
    const matches = mapConversationTitle(page)
    expect(matches).toHaveLength(1)
    expect(matches[0].parentElement?.getAttribute('aria-label')).toBe('会话')
  })
  it('preserves independent failures and redacts them even after later cleanup succeeds', async () => {
    const failures: { stage: string; error: string }[] = []
    let workers = 1
    expect(await recordMapCheckFailure(failures, 'embed-worker-cleanup', async () => assert.equal(workers, 0))).toBe(false)
    expect(await recordMapCheckFailure(failures, 'offline-file', async () => { throw new Error('https://synthetic.invalid/?token=private-value') })).toBe(false)
    workers = 0 // A later context close cannot erase the earlier failed verdict.
    expect(await recordMapCheckFailure(failures, 'touch-embed', async () => assert.equal(workers, 0))).toBe(true)
    expect(failures.map(failure => failure.stage)).toEqual(['embed-worker-cleanup', 'offline-file'])
    expect(failures[1]!.error).toContain('token=[redacted]')
    expect(JSON.stringify(failures)).not.toContain('private-value')
    expect(() => assertMapChecksPassed(failures)).toThrow('embed-worker-cleanup')
  })
  it('exits nonzero after executing later independent checks when cleanup failed', () => {
    const module = pathToFileURL(resolve('scripts/map-acceptance/contract.mjs')).href
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { recordMapCheckFailure, assertMapChecksPassed } from ${JSON.stringify(module)};
      const failures = [];
      await recordMapCheckFailure(failures, 'embed-worker-cleanup', async () => { throw new Error('Workers remain ?token=private-value'); });
      for (const stage of ['offline-file', 'touch-embed', 'blocked-worker-fallback']) {
        await recordMapCheckFailure(failures, stage, async () => console.log(stage));
      }
      assertMapChecksPassed(failures);
      console.log('must-not-report-passed');
    `], { encoding: 'utf8', timeout: 10000 })
    expect(result.status).toBe(1)
    expect(result.stdout.trim().split('\n')).toEqual(['offline-file', 'touch-embed', 'blocked-worker-fallback'])
    expect(result.stderr).toContain('embed-worker-cleanup')
    expect(result.stderr).not.toContain('private-value')
    expect(result.stdout).not.toContain('must-not-report-passed')
  })
  it('only permits aggregate success when every independent check passes', async () => {
    const failures: { stage: string; error: string }[] = []
    expect(await recordMapCheckFailure(failures, 'synthetic-success', async () => {})).toBe(true)
    expect(() => assertMapChecksPassed(failures)).not.toThrow()
    expect(failures).toEqual([])
  })
  it('snapshots last-unmount evidence before context teardown and gates the final pass', async () => {
    const runner = await readFile('scripts/map-acceptance/run.mjs', 'utf8')
    const cleanup = runner.indexOf("independentCheck('embed-worker-cleanup'")
    const snapshot = runner.indexOf('workerClosesBeforeContextCleanup:')
    const verdict = runner.indexOf('embedEvidence.workerCleanup.passed = workerCleanupPassed')
    const teardown = runner.indexOf('await context.close()')
    expect(cleanup).toBeGreaterThan(0)
    expect(snapshot).toBeGreaterThan(cleanup)
    expect(verdict).toBeGreaterThan(snapshot)
    expect(teardown).toBeGreaterThan(verdict)
    expect(runner).toContain("await until(() => embed.workers().length === 0, 'Workers stop after last Map unmount')")
    expect(runner).toContain("assert.ok(embedEvidence.workerUrlsRevoked.length > 0 && embedEvidence.workerUrlsRevoked.every(Boolean), 'Worker blob URLs revoked after termination')")
    for (const stage of ['offline-file', 'touch-embed', 'blocked-worker-fallback']) expect(runner).toContain(`await independentCheck('${stage}', async () => {`)
    expect(runner.indexOf('assertMapChecksPassed(report.failures)')).toBeLessThan(runner.indexOf('report.passed = true'))
  })
  it.each([undefined, '/synthetic/official-chrome'])('keeps command-line audit available with sandboxed Chrome (%s)', executablePath => {
    const options = mapBrowserLaunchOptions(executablePath)
    expect(options).toEqual({ ...(executablePath ? { executablePath } : { channel: 'chrome' }),
      ignoreDefaultArgs: ['--enable-unsafe-swiftshader'],
      headless: true, chromiumSandbox: true, args: ['--enable-automation', '--use-gl=angle', '--use-angle=swiftshader'] })
    expect(JSON.stringify(options.args)).not.toMatch(/no-sandbox|disable-gpu|unsafe|bypassCSP/)
  })
  it('keeps the actual running-browser audit rejecting every forbidden flag and valued variant', async () => {
    const runner = await readFile('scripts/map-acceptance/run.mjs', 'utf8')
    // Execute the unchanged production assertion, not a duplicated predicate.
    // Fail closed if its source shape changes; no browser or command is run.
    const audit = runner.match(/      const forbidden = \[[^\n]+\]\n      assert\.ok\([^\n]+\)/u)?.[0]
    expect(audit).toBeDefined()
    const check = new Function('assert', 'command', audit!)
    const safe = mapBrowserLaunchOptions().args
    expect(() => check(assert, { arguments: safe })).not.toThrow()
    for (const flag of ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu-sandbox', '--disable-web-security', '--disable-gpu', '--enable-unsafe-swiftshader']) {
      for (const suffix of ['', '=true', '=false']) {
        expect(() => check(assert, { arguments: [...safe, flag + suffix] })).toThrow('Running Chrome must not disable sandboxes/WebGL or enable unsafe fallback')
      }
    }
  })
  it('refuses local, root, non-smoke, sidechat and unverified installs before browser/port work', () => {
    const valid = { map: true, smoke: true, sidechat: false, install: 'tarball', env: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux' }, uid: 1001 }
    expect(() => validateMapMode(valid)).not.toThrow()
    for (const change of [{ env: {} }, { uid: 0 }, { smoke: false }, { sidechat: true }, { install: 'link' }]) {
      expect(() => validateMapMode({ ...valid, ...change })).toThrow()
    }
    expect(() => validateMapMode({ map: false })).not.toThrow()
  })
  it('keeps the synthetic fixed-camera fixture within the real map schema', () => {
    const spec = createMapSpec()
    expect(validateGenuiSpec(spec).ok).toBe(true)
    expect(spec.items[0]).toMatchObject({ id: 'destination', center: [0, 0], zoom: 2,
      locations: [{ coordinates: [-20, 0] }, { coordinates: [20, 0] }], routes: [{ coordinates: [[-20, 0], [20, 0]] }] })
    expect(JSON.stringify(spec)).not.toMatch(/https?:|credentials|geolocation/)
  })
  it('accepts actual line-shaped pixels with background context', () => {
    expect(measureRoutePixels(rgba((_x, y) => y >= 14 && y <= 17 ? blue : paper))).toMatchObject({ pass: true, longest: 80, route: 320 })
  })
  it.each(['blank', 'marker', 'wrong-row', 'solid-blue'])('rejects a false route oracle: %s', kind => {
    const image = rgba((x, y) => kind === 'blank' ? paper : kind === 'solid-blue' ? blue
      : kind === 'wrong-row' ? (y < 4 ? blue : paper) : (x > 25 && x < 55 && y > 4 && y < 28 ? blue : paper))
    expect(measureRoutePixels(image).pass).toBe(false)
  })
  it('rejects an unexpected screenshot geometry instead of passing another crop', () => {
    expect(() => measureRoutePixels({ width: 1, height: 1, data: [49, 95, 168, 255] })).toThrow('80x32')
  })
  it('requires exactly the one explicit map submit payload, not a label/local chip', () => {
    const payload = { type: 'submit', answers: {}, fields: { destination: 'east' }, total: 1, answered: 1 }
    const message = (value: unknown) => '[genui-action] map-confirm。 组件数据: ' + JSON.stringify(value)
    expect(assertMapSubmission(message(payload))).toEqual(payload)
    expect(() => assertMapSubmission(message({ ...payload, fields: { destination: 'west' } }))).toThrow()
    expect(() => assertMapSubmission(message({ ...payload, hidden: true }))).toThrow()
    expect(() => assertMapSubmission('local confirmation')).toThrow()
  })
  it('rejects host style/settings leaks inside a decoded base64 artifact', () => {
    const good = { spec: createMapSpec(), state: { fields: { destination: 'east' } } }
    expect(assertOfflineMapArtifact(good)).toBe(good)
    for (const key of ['style', 'source', 'config', 'workerUrl', 'accessToken']) {
      const bad = structuredClone(good)
      bad.spec.items[0][key] = 'host-only'
      expect(() => assertOfflineMapArtifact(JSON.parse(Buffer.from(JSON.stringify(bad)).toString()))).toThrow('leaked')
    }
    const encodedLeak = Buffer.from(JSON.stringify({ ...good, hostConfig: { layers: [{ id: 'host-background' }] } })).toString('base64')
    expect(encodedLeak).not.toContain('host-background')
    expect(() => assertOfflineMapArtifact(JSON.parse(Buffer.from(encodedLeak, 'base64').toString()))).toThrow('sentinel')
  })
  it('distinguishes unaudited rc.1 controls and observes CSP in every real context', async () => {
    const checks = await readFile('scripts/map-acceptance/browser-checks.mjs', 'utf8')
    expect(checks).toContain("noImplicitActionAudit: assertNoActions ? 'passed' : 'not-covered'")
    const runner = await readFile('scripts/map-acceptance/run.mjs', 'utf8')
    for (const page of ['page', 'embed', 'offline', 'touch', 'failure']) expect(runner).toContain(`await installCspObserver(${page})`)
    for (const prefix of ['host', 'embed', 'offline', 'touch']) expect(runner).toContain(`assert.deepEqual(${prefix}Evidence.csp, []`)
  })
  it('redacts bootstrap tokens from bounded report errors', () => {
    expect(safeMapError(new Error('http://127.0.0.1:3190/?token=secret-token&key=other'))).toBe('http://127.0.0.1:3190/?token=[redacted]&key=[redacted]')
    expect(safeMapError('x'.repeat(3000))).toHaveLength(2500)
  })
  it('sanitizes Map-only throw, outer console and host-log tail without changing other modes', async () => {
    const runner = await readFile('scripts/map-acceptance/run.mjs', 'utf8')
    const e2e = await readFile('scripts/e2e.mjs', 'utf8')
    expect(runner).toContain('throw new Error(safeMapError(error))')
    expect(e2e).toContain("console.error('✗ e2e 异常:', MAP ? safeMapError(e) : e)")
    expect(e2e).toContain("console.error(MAP ? safeMapError(lines.join('\\n') || '(空)')")
  })
  it('prepares only the pinned rc.2 official replay and explicitly excludes rc.1 host-action claims', async () => {
    const root = await mkdtemp(join(tmpdir(), 'map-replay-contract-')); directories.push(root)
    await mkdir(join(root, 'apps/cli'), { recursive: true })
    await writeFile(join(root, 'apps/cli/package.json'), JSON.stringify({ version: '0.2.0-rc.1' }))
    expect(await prepareMapConversation({ dshRoot: root, dshHome: root, spec: createMapSpec() })).toBeNull()
    await writeFile(join(root, 'apps/cli/package.json'), JSON.stringify({ version: 'unexpected' }))
    await expect(prepareMapConversation({ dshRoot: root, dshHome: root, spec: createMapSpec() })).rejects.toThrow('Unrecognized host')
    await writeFile(join(root, 'apps/cli/package.json'), JSON.stringify({ version: '0.2.1-rc.2' }))
    await expect(prepareMapConversation({ dshRoot: root, dshHome: root, spec: createMapSpec() })).rejects.toThrow()
    await mkdir(join(root, 'packages/test-support/llm-replay/lib'), { recursive: true })
    await writeFile(join(root, 'packages/test-support/llm-replay/lib/index.js'), '// Not executed by this pure fixture test')
    const prepared = await prepareMapConversation({ dshRoot: root, dshHome: root, spec: createMapSpec() })
    const patch = JSON.parse(await readFile(prepared.webArgs[1], 'utf8'))
    expect(patch[0].config).toEqual({ provider: 'map-e2e-replay', model: 'map-e2e' })
    const config = patch[1].insert[0].config
    expect(config.replayModule).toBe(join(root, 'packages/test-support/llm-replay/lib/index.js'))
    const responses = JSON.parse(await readFile(config.replayFile, 'utf8'))
    expect(responses).toHaveLength(2)
    expect(responses[0]).toEqual(replayChunks('```dsh-ui\n' + JSON.stringify(createMapSpec()) + '\n```'))
    expect(await readFile(prepared.auditFile, 'utf8')).toBe('')
    expect(await readFile(patch[1].insert[0].name, 'utf8')).toContain('Refusing unexpected or extra model calls')
  })
  it('extends only ordinary steps in the existing host CI matrix, with bounded synthetic artifacts', async () => {
    const workflow = parse(await readFile('.github/workflows/ci.yml', 'utf8'))
    expect(Object.keys(workflow.jobs)).toEqual(['check', 'browser-text-newlines', 'windows-pack'])
    expect(workflow.permissions).toBeUndefined()
    const steps = workflow.jobs.check.steps
    const step = steps.find((s: { name?: string }) => s.name?.startsWith('Map real browser'))
    expect(step.run).toContain('--smoke --map --install tarball')
    expect(step.run).toContain('steps.pack.outputs.sha256')
    const archive = steps.find((s: { name?: string }) => s.name === 'Archive synthetic Map browser evidence')
    expect(archive.with['retention-days']).toBe(7)
    expect(archive.with.path).not.toMatch(/HOME|\.log|profile|events\.jsonl/)
  })
  it('keeps Map mode separate from existing Gallery/Sidechat and validates before port probing', async () => {
    const source = await readFile('scripts/e2e.mjs', 'utf8')
    expect(source.indexOf('validateMapMode({')).toBeLessThan(source.indexOf('const probe = createServer()'))
    expect(source).toContain('MAP ? mapBrowserLaunchOptions(process.env.E2E_CHROMIUM)')
    expect(source).toContain('} else if (SMOKE) {\n    galleryAssets = await startGalleryImageServer()')
    expect(source).toContain('await runGalleryFixedContexts({')
    expect(source).toContain('await runSidechatCI({')
  })
  it('resets the fixed camera before tapping the opposite endpoint in a narrow touch viewport', async () => {
    const source = await readFile('scripts/map-acceptance/run.mjs', 'utf8')
    const start = source.indexOf('await assertSelection(touchMap)')
    const reset = source.indexOf("await touchMap.getByRole('button', { name: controls.reset }).tap()", start)
    const west = source.indexOf("await marker(touchMap, 'Synthetic West').tap()", start)
    expect(start).toBeGreaterThan(0)
    expect(reset).toBeGreaterThan(start)
    expect(west).toBeGreaterThan(reset)
  })
  it('type-checks the actual browser fixture public API calls without launching a browser', () => {
    const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true,
      target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX, allowImportingTsExtensions: true, baseUrl: process.cwd(), paths: {
        '@changfenhuang/dsh-genui/embed': ['src/client/embed.ts'], '@map-test/i18n': ['src/client/i18n/runtime.ts'],
        '@map-test/theme': ['src/client/artifact/standalone-theme.ts'],
      } }
    const program = ts.createProgram([resolve('tests/browser/map.tsx')], options)
    expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
  }, 60000)
})
