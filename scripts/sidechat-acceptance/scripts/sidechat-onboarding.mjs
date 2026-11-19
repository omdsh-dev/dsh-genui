/** 记录 dsh-v0.2.1-rc.3 的公开界面文案，用于处理预览提示和可跳过的初始化弹窗。
 * 来源：packages/client/ui-settings-models 与 packages/client/ui-settings-account。
 */
import { setTimeout as delay } from 'node:timers/promises'

const specs = [
  {
    "kind": "preview-notice",
    "locale": "en",
    "title": "Preview Notice",
    "paragraphs": [
      "DeepSeek Harness 0.2 is still in preview, and many areas need continued improvement and refinement. We welcome feedback and suggestions from all developers and users. The new desktop app now targets a broad range of users, while developer-related advanced features can be enabled in the settings. DeepSeek Harness’s product features and plugin APIs are expected to continue rapid iteration and evolution, and will gradually stabilize over time.",
      "We look forward to exploring the limits of intelligence together with users and developers around the world, building on open-source, reusable, and composable infrastructure. We welcome everyone to bring their ideas to life with DeepSeek Harness and participate in the community to enrich the plugin ecosystem."
    ],
    "buttons": [
      {
        "label": "Continue",
        "text": "Continue"
      }
    ],
    "action": "Continue"
  },
  {
    "kind": "optional-model-setup",
    "locale": "en",
    "title": "Get started",
    "paragraphs": [
      "Sign in to your DeepSeek account or add an API Key to get started. Your projects and files are stored locally."
    ],
    "buttons": [
      {
        "label": "Close",
        "text": ""
      },
      {
        "label": "Add API Key",
        "text": "Add API Key"
      },
      {
        "label": "Sign in",
        "text": "Sign in"
      }
    ],
    "action": "Close"
  },
  {
    "kind": "preview-notice",
    "locale": "zh",
    "title": "预览版说明",
    "paragraphs": [
      "DeepSeek Harness 目前的 0.2 版本仍处于预览阶段，还有许多地方需要持续改进和打磨，希望听取广大开发者和用户的反馈建议。现在，新的桌面端面向广泛用户，开发者相关的进阶功能可在配置中开启使用。预计 DeepSeek Harness 的产品功能以及插件 API 都会继续快速迭代、持续演化，并逐渐趋于稳定。",
      "我们期待与全球用户和开发者一起，在开源、可复用、可组合的基础设施之上，共同探索智能上限。欢迎大家用 DeepSeek Harness 将想法变成现实，与社区一起丰富插件生态。"
    ],
    "buttons": [
      {
        "label": "继续",
        "text": "继续"
      }
    ],
    "action": "继续"
  },
  {
    "kind": "optional-model-setup",
    "locale": "zh",
    "title": "开始使用",
    "paragraphs": [
      "登录 DeepSeek 账号，或添加 API Key，即可开始使用。你的项目和文件保存在本地。"
    ],
    "buttons": [
      {
        "label": "关闭",
        "text": ""
      },
      {
        "label": "添加 API Key",
        "text": "添加 API Key"
      },
      {
        "label": "登录",
        "text": "登录"
      }
    ],
    "action": "关闭"
  }
]
export const ONBOARDING_DIALOGS = Object.freeze(specs.map(spec => Object.freeze({ ...spec,
  paragraphs: Object.freeze(spec.paragraphs), buttons: Object.freeze(spec.buttons.map(Object.freeze)) })))
const normalize = text => typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim() : ''

/** Equality guards never expose arbitrary page text in assertion failures or reports. */
export function classifyOnboardingDialog(snapshot) {
  if (!snapshot || snapshot.role !== 'dialog' || snapshot.modal !== 'true' || snapshot.describedBy !== null || snapshot.extraControls !== 0
    || snapshot.alerts !== 0 || snapshot.busy !== false || !Array.isArray(snapshot.headings)
    || !Array.isArray(snapshot.paragraphs) || !Array.isArray(snapshot.buttons)) return null
  return ONBOARDING_DIALOGS.find(spec => snapshot.title === spec.title
    && snapshot.headings.length === 1 && snapshot.headings[0] === spec.title
    && JSON.stringify(snapshot.paragraphs) === JSON.stringify(spec.paragraphs.map(normalize))
    && JSON.stringify(snapshot.buttons) === JSON.stringify(spec.buttons.map(button => ({ ...button, disabled: false })))
    && snapshot.text === normalize([spec.title, ...spec.paragraphs, ...spec.buttons.map(button => button.text)].join(' '))) ?? null
}
function observation(snapshot, count) {
  const recognized = ONBOARDING_DIALOGS.find(spec => spec.title === snapshot?.title)
  // No arbitrary title/body/button labels, hrefs, input values, cookies or URLs.
  return { visibleDialogs: count, titleKind: recognized?.kind ?? 'unknown', locale: recognized?.locale ?? null,
    exactShape: !!classifyOnboardingDialog(snapshot), controls: snapshot?.buttons?.length ?? 0,
    extraControls: snapshot?.extraControls ?? 0, alerts: snapshot?.alerts ?? 0, busy: snapshot?.busy ?? false }
}

/** Closed artifact schema. Even a caller-supplied report cannot add raw page/auth data. */
export function projectOnboardingReport(value) {
  const source = value && typeof value === 'object' ? value : {}, result = {}
  if (['checking', 'ready', 'failed'].includes(source.status)) result.status = source.status
  if (['multiple-dialogs', 'unrecognized-dialog', 'repeated-dialog', 'unexpected-dialog-order',
    'readiness-timeout', 'browser-interaction-failed'].includes(source.reason)) result.reason = source.reason
  const action = value => {
    const spec = ONBOARDING_DIALOGS.find(spec => spec.kind === value?.kind && spec.locale === value?.locale && spec.action === value?.action)
    return spec ? { kind: spec.kind, locale: spec.locale, action: spec.action,
      ...(value.disappeared === true ? { disappeared: true } : {}) } : undefined
  }
  if (Array.isArray(source.actions)) result.actions = source.actions.slice(0, 2).map(action).filter(Boolean)
  const pending = action(source.pendingAction)
  if (pending) result.pendingAction = pending
  if (typeof source.workspaceActionabilityChecked === 'boolean') result.workspaceActionabilityChecked = source.workspaceActionabilityChecked
  if (source.lastDialog && typeof source.lastDialog === 'object') {
    const last = source.lastDialog, safe = {}
    if (['preview-notice', 'optional-model-setup', 'unknown'].includes(last.titleKind)) safe.titleKind = last.titleKind
    if (['en', 'zh', null].includes(last.locale)) safe.locale = last.locale
    for (const key of ['visibleDialogs', 'controls', 'extraControls', 'alerts']) {
      if (Number.isSafeInteger(last[key]) && last[key] >= 0) safe[key] = Math.min(last[key], 100)
    }
    for (const key of ['exactShape', 'busy']) if (typeof last[key] === 'boolean') safe[key] = last[key]
    result.lastDialog = safe
  }
  return result
}

/** Pure driver contract. Tests exercise orchestration, never render a fake host DOM. */
export async function runOnboardingSequence(driver, report = {}) {
  report.status = 'checking'; report.actions = []
  const deadline = driver.now() + 20000
  let readySince
  const fail = reason => { report.reason = reason; throw new Error('Synthetic host onboarding failed: ' + reason) }
  try {
    while (driver.now() < deadline) {
      const { count, snapshot } = await driver.readDialogs()
      if (count) {
        readySince = undefined
        report.lastDialog = observation(snapshot, count)
        if (count !== 1) fail('multiple-dialogs')
        const spec = classifyOnboardingDialog(snapshot)
        if (!spec) fail('unrecognized-dialog')
        if (report.actions.some(action => action.kind === spec.kind)) fail('repeated-dialog')
        if (spec.kind === 'optional-model-setup' && report.actions.length !== 1) fail('unexpected-dialog-order')
        if (spec.kind === 'preview-notice' && report.actions.length !== 0) fail('unexpected-dialog-order')
        report.pendingAction = { kind: spec.kind, locale: spec.locale, action: spec.action }
        await driver.dismiss(spec)
        report.actions.push({ ...report.pendingAction, disappeared: true })
        delete report.pendingAction
      } else if (report.actions.length > 0 && await driver.workspaceReady()) {
        readySince ??= driver.now()
        // Model readiness may briefly render no dialog after the preview completes.
        // Require repeated real actionability, never infer readiness from one empty snapshot.
        if (driver.now() - readySince >= 1000) {
          report.status = 'ready'; report.workspaceActionabilityChecked = true
          return report
        }
      } else readySince = undefined
      await driver.pause()
    }
    fail('readiness-timeout')
  } catch {
    report.status = 'failed'; report.reason ??= 'browser-interaction-failed'
    throw new Error('Synthetic host onboarding failed: ' + report.reason)
  }
}

export async function readOnboardingDialog(dialog) {
  return dialog.evaluate(node => {
    const text = value => (value ?? '').replace(/\s+/gu, ' ').trim()
    return { title: node.getAttribute('aria-label'), role: node.getAttribute('role'), modal: node.getAttribute('aria-modal'),
      describedBy: node.getAttribute('aria-describedby'), text: text(node.innerText),
      headings: [...node.querySelectorAll('h1,h2,h3,[role="heading"]')].map(item => text(item.innerText)),
      paragraphs: [...node.querySelectorAll('p')].map(item => text(item.innerText)),
      buttons: [...node.querySelectorAll('button,[role="button"]')].map(item => ({
        label: text(item.getAttribute('aria-label') ?? item.innerText), text: text(item.innerText),
        disabled: item.disabled === true || item.getAttribute('aria-disabled') === 'true' })),
      extraControls: node.querySelectorAll('a,input,textarea,select,form,iframe,object,embed,audio,video,[contenteditable]:not([contenteditable="false"]),[role="link"],[role="textbox"],[role="checkbox"],[role="combobox"],[role="switch"],[role="radio"],[role="radiogroup"],[role="slider"],[role="spinbutton"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="listbox"],[role="option"],[role="tree"],[role="treeitem"],[role="grid"],[role="gridcell"],[role="tab"],[role="tablist"],[role="form"]').length,
      alerts: node.querySelectorAll('[role="alert"],[role="alertdialog"]').length,
      busy: node.getAttribute('aria-busy') === 'true' || node.querySelector('[aria-busy="true"]') !== null }
  })
}

/** Real browser adapter: normal, scoped clicks only; no auth/config APIs or DOM writes. */
export async function completeSyntheticOnboarding(page, workspaceRow, report = {}) {
  const dialogs = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible')
  return runOnboardingSequence({
    now: () => Date.now(), pause: () => delay(100),
    readDialogs: async () => {
      const count = await dialogs.count()
      return { count, snapshot: count === 1 ? await readOnboardingDialog(dialogs) : undefined }
    },
    dismiss: async spec => {
      const dialog = page.getByRole('dialog', { name: spec.title, exact: true })
      if (await dialog.count() !== 1 || classifyOnboardingDialog(await readOnboardingDialog(dialog)) !== spec) {
        throw new Error('Onboarding dialog changed before its approved action')
      }
      const control = dialog.getByRole('button', { name: spec.action, exact: true })
      if (await control.count() !== 1) throw new Error('Onboarding action is ambiguous')
      await control.click({ timeout: 10000 })
      await dialog.waitFor({ state: 'detached', timeout: 10000 })
    },
    workspaceReady: async () => {
      const root = page.locator('#root')
      if (await root.count() !== 1 || await root.evaluate(node => node.inert === true)) return false
      try { await workspaceRow.click({ trial: true, timeout: 250 }) }
      catch (error) { if (error.name === 'TimeoutError') return false; throw error }
      return await dialogs.count() === 0
    },
  }, report)
}
