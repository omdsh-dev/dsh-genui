/**
 * `choices` node: a decision the reader has to MAKE. Each row carries its own
 * cost, so the trade-off is visible at the point of choosing instead of being
 * reconstructed from a paragraph.
 *
 * Local-first: selection is local state, `action` is optional. Submitting an
 * option is not the same as the work being done — the footer therefore says
 * "已提交" and keeps the rows editable instead of pretending completion.
 * @module @changfenhuang/dsh-genui/client/blocks/choices
 */
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react'

import { useGenuiAction } from '../action-context.ts'
import { renderInline } from '../inline.ts'
import { useT } from '../i18n/index.ts'
import type { GenuiChoices } from '../spec.ts'
import type { AnswersState } from './state.ts'
import css from './choices.module.css'

/** Cap matches the guard: more than eight options is a table, not a choice. */
const MAX_OPTIONS = 8

export function ChoicesNode({ node, onAction, answers }: {
  node: GenuiChoices
  onAction?: ((action: string, payload: Record<string, unknown>) => void) | undefined
  answers?: AnswersState | undefined
}): ReactNode {
  const t = useT()
  const contextAction = useGenuiAction()
  const send = onAction ?? contextAction
  const name = useId()
  const group = node.group
  // Paper mode: the selection lives in the block's shared registry so a sibling
  // `submit` can collect and grade it. Local mode keeps its own state and can
  // fire its own action.
  const paper = group !== undefined && answers !== undefined
  const localOnly = !paper && (node.action === undefined || node.action.trim() === '')
  const locked = paper && answers?.locked === true
  const mode = node.mode ?? 'single'
  // A grouped list is a paper question graded from one answer
  // (submission-registry registers it as kind 'radio'), so it is single-select
  // even when the spec says `mode: 'multi'`. Present what is actually graded
  // instead of a checkbox row whose second pick can never be recorded.
  const single = group !== undefined || mode === 'single'
  const max = single ? 1 : Math.max(1, Math.min(node.max ?? node.items.length, node.items.length))
  const items = useMemo(() => node.items.slice(0, MAX_OPTIONS), [node.items])
  const [localSelected, setLocalSelected] = useState<readonly string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const recorded = paper ? answers?.answers[group] : undefined
  const selected: readonly string[] = paper
    ? (recorded === undefined ? [] : [recorded])
    : localSelected

  const toggle = useCallback((label: string): void => {
    if (locked) return
    if (paper) {
      // Paper questions are single-select; re-clicking the same option keeps it
      // (a paper answer is not a toggle).
      answers?.setAnswer(group, label)
      return
    }
    // Editing after submit is allowed and clears the "已提交" line: the model
    // worked on the previous answer, so leaving it up would be a lie.
    setSubmitted(false)
    setLocalSelected(previous => {
      if (previous.includes(label)) return previous.filter(item => item !== label)
      if (single) return [label]
      if (previous.length >= max) return previous
      return [...previous, label]
    })
  }, [answers, group, locked, max, single, paper])

  const submit = (): void => {
    if (selected.length === 0 || node.action === undefined || node.action.trim() === '') return
    setSubmitted(true)
    send?.(node.action, {
      question: node.prompt ?? node.title ?? '',
      selected: [...selected],
      // A grouped paper question is graded as one answer, so report the mode
      // that is actually presented rather than a `multi` that never applies.
      mode: single ? 'single' : 'multi',
    })
  }

  const hint = single
    ? t('block.choices.singleHint')
    : node.max !== undefined
      ? t('block.choices.maxHint', { max: String(max) })
      : t('block.choices.multiHint')

  return (
    <section className={css.choices} data-genui-choices data-choice-mode={single ? 'single' : 'multi'} aria-labelledby={`${name}-title`}>
      <h3 className={css.title} id={`${name}-title`}>{renderInline(node.title ?? t('block.choices'))}</h3>
      {node.prompt !== undefined && <p className={css.prompt}>{renderInline(node.prompt)}</p>}

      <div className={css.list} role={single ? 'radiogroup' : 'group'} aria-labelledby={`${name}-title`}>
        {items.map((item, index) => {
          const active = selected.includes(item.label)
          const unavailable = item.disabled === true || locked
          return (
            <label
              key={`${index}-${item.label}`}
              className={[css.row, active ? css.rowActive : '', unavailable ? css.rowDisabled : '']
                .filter(Boolean).join(' ')}
              data-selected={active ? '' : undefined}
            >
              <input
                className={css.control}
                type={single ? 'radio' : 'checkbox'}
                name={single ? `${name}-group` : undefined}
                checked={active}
                disabled={unavailable}
                onChange={() => toggle(item.label)}
              />
              <span className={css.body}>
                <span className={css.labelLine}>
                  <span className={css.label}>{renderInline(item.label)}</span>
                  {item.recommended === true && <span className={css.recommended}>{t('block.choices.recommended')}</span>}
                  {unavailable && <span className={css.unavailable}>{t('block.choices.unavailable')}</span>}
                </span>
                {(unavailable ? item.reason : item.hint) !== undefined && (
                  <span className={css.hint}>{renderInline(unavailable ? item.reason! : item.hint!)}</span>
                )}
              </span>
              {item.meta !== undefined && <span className={css.meta}>{renderInline(item.meta)}</span>}
            </label>
          )
        })}
      </div>

      <div className={css.footer}>
        {!paper && node.submit !== undefined && node.submit !== '' && (
          <button
            type="button"
            className={css.submit}
            disabled={selected.length === 0 || localOnly}
            onClick={submit}
          >
            {node.submit}
          </button>
        )}
        <span className={css.status} role="status" aria-live="polite">
          {submitted
            ? (node.action === undefined || node.action === ''
              // Older fences can still carry a submit with no action: say what
              // actually happened instead of claiming a delivery that never was.
              ? t('block.choices.localOnly')
              : t('block.choices.sent'))
            : selected.length === 0
              ? hint
              : `${t('block.choices.count', { count: String(selected.length) })} · ${hint}`}
        </span>
        {localOnly && (
          <span className={css.localWarning} role="note">{t('block.choices.noAction')}</span>
        )}
      </div>
    </section>
  )
}
