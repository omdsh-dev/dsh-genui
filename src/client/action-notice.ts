/**
 * action-notice.ts — the visible failure signal for the [genui-action] relay.
 *
 * Body-level (its own host, not the panel) so an inline-fence click and a
 * panel click fail the same way even when no panel exists. Each notice carries
 * the action name only: the transport detail can quote field content or a
 * server message, so it stays out of the DOM and out of logs.
 * @module @changfenhuang/dsh-genui/client/action-notice
 */
import { t } from './i18n/index.ts'
import css from './GenuiBlock.module.css'

const HOST_SELECTOR = 'data-genui-action-notice-host'
const ITEM_SELECTOR = 'data-genui-action-notice'
const DISMISS_MS = 4000

function host(): HTMLElement {
  const existing = document.querySelector<HTMLElement>(`[${HOST_SELECTOR}]`)
  if (existing !== null) return existing
  const element = document.createElement('div')
  element.setAttribute(HOST_SELECTOR, '1')
  element.className = css.actionNoticeHost ?? ''
  document.body.appendChild(element)
  return element
}

/** Show one failure notice for `action`; auto-dismisses. No-op without a DOM. */
export function showActionFailure(action: string): void {
  if (typeof document === 'undefined') return
  const container = host()
  const item = document.createElement('div')
  item.setAttribute(ITEM_SELECTOR, '1')
  item.className = css.actionNotice ?? ''
  item.setAttribute('role', 'status')
  item.textContent = t('action.failed', { action })
  container.appendChild(item)
  setTimeout(() => {
    item.remove()
    if (container.childElementCount === 0) container.remove()
  }, DISMISS_MS)
}