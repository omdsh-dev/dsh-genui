import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const checks = vi.hoisted(() => ({ browser: vi.fn(), dom: vi.fn() }))
vi.mock('../scripts/gallery-browser-checks.mjs', () => ({
  checkGalleryBrowser: checks.browser, runGalleryBrowserChecks: checks.dom,
}))
import { runGalleryFixedContexts } from '../scripts/gallery-fixed-contexts.mjs'
const desktopInput = { points: 0, hover: true, hoverNone: false, coarsePointer: false, finePointer: true }
const touchInput = { points: 1, hover: false, hoverNone: true, coarsePointer: true, finePointer: false }
const directories: string[] = []
beforeEach(() => {
  vi.clearAllMocks()
  checks.browser.mockImplementation(async ({ report, inputProfile }) => { report.passed = true; report.context = { inputProfile } })
  checks.dom.mockImplementation(async ({ report, inputProfile }) => { report.passed = true; report.context = { inputProfile } })
})
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
async function fixture(real = true) {
  const order: string[] = []
  const artifactsDir = await mkdtemp(join(tmpdir(), 'gallery-fixed-contract-')); directories.push(artifactsDir)
  const page = { url: () => 'http://127.0.0.1:3190/', evaluate: vi.fn(async () => ({ ...desktopInput })) }
  const handlers: Record<string, (event: unknown) => void> = {}
  const touchPage = { url: page.url, evaluate: vi.fn(async () => ({ ...touchInput })),
    on(event: string, callback: (event: unknown) => void) { handlers[event] = callback },
    async goto(url: string) { expect(url).toBe('http://127.0.0.1:3190/?token=ephemeral'); order.push('touch-goto'); handlers.console({ text: () => '[genui] client active; fence-channel=dom' }) },
    async waitForTimeout() {},
    getByRole: vi.fn(() => ({ async isVisible() { return true }, async click() { order.push('touch-onboarding') } })),
    close: vi.fn(async () => { order.push('touch-close') }),
  }
  const browser = { version: () => 'synthetic-contract', newPage: vi.fn(async () => touchPage) }
  const root = { synthetic: 'existing-real-root' }
  const galleryConversation = real ? {
    openConversation: vi.fn(async () => { order.push('create-once'); return root }),
    openExistingConversation: vi.fn(async () => { order.push('open-existing'); return root }),
    assertNoActions: vi.fn(async () => ({ userMessages: 1, genuiActions: 0, replayCalls: 1 })),
    verifyChoose: vi.fn(async () => { order.push('choose-once'); return { genuiActions: 1, replayCalls: 2 } }),
  } : null
  const args = { browser, page, readyUrl: 'http://127.0.0.1:3190/?token=ephemeral', artifactsDir, galleryConversation,
    galleryAssets: real ? { requests: ['/wide.svg', '/tall.svg', '/missing.svg'].map(path => ({ path })) } : null,
    createDismissCredentialsOverlay: () => async () => {}, log: () => {} }
  return { args, order, browser, page, touchPage, galleryConversation, artifactsDir }
}

describe('fixed-context orchestration (synthetic, no browser)', () => {
  it('uses one created session, opens it in touch, closes touch, then submits exactly one desktop Choose', async () => {
    const f = await fixture()
    checks.browser.mockImplementation(async ({ inputProfile, report }) => { f.order.push(`check-${inputProfile}`); report.passed = true })
    const result = await runGalleryFixedContexts(f.args)
    expect(f.order).toEqual(['create-once', 'check-desktop', 'touch-goto', 'touch-onboarding', 'open-existing', 'check-touch', 'touch-close', 'choose-once'])
    expect(f.galleryConversation!.openConversation).toHaveBeenCalledOnce()
    expect(f.galleryConversation!.openExistingConversation).toHaveBeenCalledOnce()
    expect(f.galleryConversation!.verifyChoose).toHaveBeenCalledOnce()
    expect(f.browser.newPage).toHaveBeenCalledWith({ viewport: { width: 1440, height: 1200 }, locale: 'zh-CN', hasTouch: true })
    expect(result.contexts.desktop.inputChecks.at(-1)?.phase).toBe('after-touch-context-closed')
    expect(result.hostActionPassed).toBe(true)
    expect(JSON.stringify(result)).not.toContain('ephemeral')
  })
  it('runs explicitly separated minimum-host DOM checks without inventing routing evidence', async () => {
    const f = await fixture(false)
    const result = await runGalleryFixedContexts(f.args)
    expect(checks.browser).not.toHaveBeenCalled()
    expect(checks.dom.mock.calls.map(([options]) => options.inputProfile)).toEqual(['desktop', 'touch'])
    expect(result.hostActionPassed).toBeNull()
    expect(result.fixture).toContain('no conversation or host action routing claim')
    expect(f.touchPage.close).toHaveBeenCalledOnce()
  })
  it('does not assume a second context must show Continue, and still proves the gallery', async () => {
    const f = await fixture()
    const click = vi.fn()
    f.touchPage.getByRole.mockReturnValueOnce({ async isVisible() { return false }, click })
    const report = await runGalleryFixedContexts(f.args)
    expect(click).not.toHaveBeenCalled()
    expect(report.contexts.touch.onboarding).toEqual({ continueVisible: false, continued: false })
    expect(f.galleryConversation!.openExistingConversation).toHaveBeenCalledOnce()
    expect(checks.browser.mock.calls.map(([options]) => options.inputProfile)).toEqual(['desktop', 'touch'])
    expect(report.passed).toBe(true)
  })
  it('closes touch and preserves the original assertion and secondary cleanup failure without choosing', async () => {
    const f = await fixture()
    checks.browser.mockImplementation(async ({ inputProfile }) => { if (inputProfile === 'touch') throw new Error('original touch assertion detail') })
    f.touchPage.close.mockRejectedValueOnce(new Error('secondary close failure'))
    await expect(runGalleryFixedContexts(f.args)).rejects.toThrow('Fixed-context gallery regression failed')
    const report = JSON.parse(await readFile(join(f.artifactsDir, 'gallery-browser-results.json'), 'utf8'))
    expect(report.errorDetails.message).toBe('original touch assertion detail')
    expect(report.cleanupErrors[0].message).toBe('secondary close failure')
    expect(f.galleryConversation!.verifyChoose).not.toHaveBeenCalled()
    expect(f.touchPage.close).toHaveBeenCalledOnce()
    expect(report.touchContextCleanup.closed).toBe(false)
    expect(report.touchContextCleanup.fallback).toContain('common cleanup')
  })
  it('preserves unexpected desktop media values after closing touch and fails before Choose', async () => {
    const f = await fixture()
    f.touchPage.close.mockImplementationOnce(async () => { f.page.evaluate.mockResolvedValue({ ...desktopInput, hover: false }) })
    await expect(runGalleryFixedContexts(f.args)).rejects.toThrow()
    const report = JSON.parse(await readFile(join(f.artifactsDir, 'gallery-browser-results.json'), 'utf8'))
    expect(report.contexts.desktop.inputChecks.at(-1).hover).toBe(false)
    expect(report.errorDetails.message).toContain('after-touch-context-closed')
    expect(f.galleryConversation!.verifyChoose).not.toHaveBeenCalled()
  })
  it('redacts nested navigation tokens in both JSON and thrown stderr diagnostics', async () => {
    const f = await fixture()
    f.touchPage.goto = async () => { throw new Error('goto failed: http://127.0.0.1:3190/?token=ephemeral') }
    let thrown: unknown
    try { await runGalleryFixedContexts(f.args) } catch (error) { thrown = error }
    const { inspect } = await import('node:util')
    expect(inspect(thrown, { depth: 10 })).not.toContain('token=ephemeral')
    const json = await readFile(join(f.artifactsDir, 'gallery-browser-results.json'), 'utf8')
    expect(json).not.toContain('token=ephemeral')
    expect(json).toContain('goto failed:')
    expect(f.touchPage.close).toHaveBeenCalledOnce()
  })
  it('reports a primary failed close as cleanup failure without retrying or choosing', async () => {
    const f = await fixture()
    f.touchPage.close.mockRejectedValueOnce(new Error('primary close failure'))
    await expect(runGalleryFixedContexts(f.args)).rejects.toThrow()
    const report = JSON.parse(await readFile(join(f.artifactsDir, 'gallery-browser-results.json'), 'utf8'))
    expect(report.cleanupErrors[0].message).toBe('primary close failure')
    expect(report.touchContextCleanup.closed).toBe(false)
    expect(f.touchPage.close).toHaveBeenCalledOnce()
    expect(f.galleryConversation!.verifyChoose).not.toHaveBeenCalled()
  })
  it('source retains fixed profiles, per-state evidence and viewport-only touch screenshots', async () => {
    const main = await readFile(join(process.cwd(), 'scripts', 'gallery-browser-checks.mjs'), 'utf8')
    const capability = await readFile(join(process.cwd(), 'scripts', 'gallery-input-mode.mjs'), 'utf8')
    const host = await readFile(join(process.cwd(), 'scripts', 'e2e-gallery-host.mjs'), 'utf8')
    const e2e = await readFile(join(process.cwd(), 'scripts', 'e2e.mjs'), 'utf8')
    expect(capability).not.toMatch(/Emulation\.|newCDPSession|waitForFunction/)
    expect(main).not.toContain('createGalleryInputMode')
    expect(main).toContain('await page.screenshot({ ...options, fullPage: false })')
    expect(main).not.toMatch(/(?:track|dialog|renderedRoot|locator)\.screenshot\(/)
    for (const phase of ['before:${state.name}', 'after-viewport-theme:${state.name}', 'after:${state.name}', 'after-screenshot:${file}']) expect(main).toContain(phase)
    expect(main).toContain("if (touchContext && state.name === 'narrow-light')")
    expect(e2e).toContain('hasTouch: false')
    const existing = host.slice(host.indexOf('const openExistingConversation ='), host.indexOf('webArgs:'))
    expect(existing).toContain('await title.click(')
    expect(existing).not.toMatch(/rpc\(|session\/create|session\/prompt/)
    expect(host.match(/rpc\('session\/prompt'/g)).toHaveLength(1)
  })
})
