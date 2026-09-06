/**
 * Form family: radio aggregation + submit grading, switch, slider, IME-safe
 * input/select/textarea. All state flows through the shared AnswersState.
 * @module @changfenhuang/dsh-genui/client/blocks/forms
 */
import { useEffect, useId, useRef, useState } from 'react'
import css from '../GenuiBlock.module.css'
import { GENUI_LIMITS } from '../genui-runtime/index.ts'
import type { AnswersState, GenuiBlockProps, QuestionMeta } from './state.ts'
import type { GenuiInput, GenuiRadio, GenuiSelect, GenuiSlider, GenuiSubmit, GenuiSwitch, GenuiTextarea } from '../spec.ts'

export function RadioNode({ node, onAction, answers }: {
  node: GenuiRadio
  onAction?: GenuiBlockProps['onAction']
  answers?: AnswersState | undefined
}) {
  const action = node.action
  const group = node.group
  const grouped = group !== undefined
  const options = node.options.slice(0, GENUI_LIMITS.maxOptions)
  // No default selection unless the model explicitly sets `selected` — a
  // pre-checked first option silently swallows the user's "keep the default"
  // answer (the registry only records real change events). A DURABLE answer
  // (restored from localStorage) wins over both. The parent key includes the
  // reset round, so 重新作答 remounts this radio with a clean selection —
  // no sync effect needed.
  const restoredIndex = group !== undefined && answers?.answers[group] !== undefined
    ? options.indexOf(answers!.answers[group]!)
    : -1
  const [selected, setSelected] = useState<number | null>(restoredIndex >= 0 ? restoredIndex : (node.selected ?? null))
  const uid = useId()
  const locked = grouped && answers?.locked === true
  // Register question metadata for local grading (mount + when the question
  // changes). `answers` is deliberately NOT a dep: the callback identity is
  // stable and re-registering on every answers update is needless churn.
  useEffect(() => {
    if (group === undefined) return
    answers?.registerMeta(group, {
      label: node.label ?? group,
      options,
      answer: node.answer,
      explanation: node.explanation,
    })
    // A model-provided default selection IS the answer — but only when the
    // group has no durable answer yet (a restored user choice must win).
    if (node.selected !== undefined && options[node.selected] !== undefined && answers?.answers[group] === undefined) {
      answers?.setAnswer(group, options[node.selected]!)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, node.label, node.answer, node.explanation, node.options, node.selected])
  return (
    <div className={css.fieldGroup} role="radiogroup" aria-label={node.label}>
      {node.label !== undefined && <span className={css.fieldLabel}>{node.label}</span>}
      {options.map((opt, i) => (
        <label key={i} className={css.radio}>
          <input
            type="radio"
            name={`genui-radio-${uid}`}
            checked={selected === i}
            disabled={locked}
            onChange={() => {
              setSelected(i)
              if (grouped) {
                // Aggregation mode: record, do NOT round-trip per click.
                answers?.setAnswer(group, opt)
              } else if (action !== undefined && onAction !== undefined) {
                onAction(action, { type: 'radio', value: opt })
              }
            }}
          />
          <span>{opt}</span>
        </label>
      ))}
    </div>
  )
}

/** Resolve a question's correct label from its metadata. */
export function correctLabelOf(m: QuestionMeta): string | undefined {
  if (m.answer === undefined) return undefined
  if (typeof m.answer === 'number') return m.options[m.answer]
  return m.answer
}

/** Submit: the "交卷" control of a grouped-radio block. LOCAL-FIRST (v2.6):
 * when at least one question carries `answer` data the click grades IN PLACE
 * — score, per-question right/wrong, explanations — with zero model round
 * trip, and locks the questions until 重新作答 resets them. Only when NO
 * question has answers does it fall back to firing ONE action
 * (`{type:'submit', answers, total, answered}`). Disabled until the
 * selection criteria are met (all listed groups answered, or ≥1 answer
 * without a group list); the hint shows the progress. */
export function SubmitNode({ node, onAction, answers }: {
  node: GenuiSubmit
  onAction?: GenuiBlockProps['onAction']
  answers?: AnswersState | undefined
}) {
  const recorded = answers?.answers ?? {}
  const fields = answers?.fields ?? {}
  const meta = answers?.meta ?? {}
  const expected = node.groups
  // One shared notion of "filled fields" for answered/ready/payload: non-blank
  // values only, secrets (password inputs) never collected into submit.
  const filledFields = Object.fromEntries(
    Object.entries(fields).filter(([id, v]) => v.trim() !== '' && !answers?.secretFields.has(id)),
  )
  // Without an explicit group list, the submit counts radio answers AND
  // filled fields — a fields-only form (inputs with id + submit) enables
  // once any field has a value.
  const answered = expected === undefined
    ? Math.max(Object.keys(recorded).length, Object.keys(filledFields).length)
    : expected.filter(g => recorded[g] !== undefined).length
  const total = expected?.length ?? answered
  const scope = expected ?? Object.keys(recorded)
  // Local grading is possible when ANY in-scope question carries answers.
  const canGradeLocally = scope.some(g => meta[g]?.answer !== undefined)
  const submitted = answers?.locked === true
  // Ready = enough answers AND the click can do something: either local
  // grading, or a real action name + provider. A submit with neither is a
  // display-only control — honest disabled affordance (action is optional:
  // local grading needs no round trip).
  const ready = answered > 0 && answered >= total
    && (canGradeLocally || (node.action !== undefined && onAction !== undefined))

  if (submitted) {
    // ── local grading result ──
    const graded = scope.filter(g => recorded[g] !== undefined && meta[g]?.answer !== undefined)
    const score = graded.filter(g => recorded[g] === correctLabelOf(meta[g]!)).length
    return (
      <div className={css.gradeWrap} data-genui-grade>
        <div className={css.gradeScore}>
          <span className={css.gradeScoreValue}>{score} / {graded.length}</span>
          <span className={css.gradeScoreLabel}>得分{graded.length < scope.length ? `（${scope.length - graded.length} 题无答案未计分）` : ''}</span>
        </div>
        <div className={css.gradeList}>
          {scope.map(g => {
            const entry = recorded[g]
            const m = meta[g]
            if (entry === undefined || m === undefined) return null
            const correct = correctLabelOf(m)
            if (correct === undefined) {
              return (
                <div key={g} className={css.gradeItem}>
                  <span className={css.gradeQ}>{m.label}</span>
                  <span className={css.gradeAns}>你的答案：{entry}</span>
                </div>
              )
            }
            const isCorrect = entry === correct
            return (
              <div key={g} className={`${css.gradeItem} ${isCorrect ? css.gradeItemOk : css.gradeItemNo}`}>
                <span className={css.gradeQ}>{m.label}</span>
                <span className={css.gradeTag}>{isCorrect ? '✓' : '✗'}</span>
                <span className={css.gradeAns}>
                  你的答案：{entry}
                  {!isCorrect && <span className={css.gradeRight}> 正确答案：{correct}</span>}
                </span>
                {m.explanation !== undefined && <span className={css.gradeExp}>{m.explanation}</span>}
              </div>
            )
          })}
        </div>
        <button
          type="button"
          className={`${css.button} ${css.ghost} ${css.submit}`}
          onClick={() => {
            answers?.clear()
            if (node.resetAction !== undefined && onAction !== undefined) {
              onAction(node.resetAction, { type: 'submit-reset', groups: expected ?? Object.keys(recorded) })
            }
          }}
        >
          重新作答
        </button>
      </div>
    )
  }

  return (
    <div className={css.submitRow}>
      <button
        type="button"
        className={`${css.button} ${css.primary} ${css.submit}`}
        disabled={!ready}
        onClick={ready ? () => {
          if (canGradeLocally) {
            // Local grading: immediate in-place result, no model round trip.
            answers?.setLocked(true)
          } else if (node.action !== undefined && onAction !== undefined) {
            // `ready` already guarantees this branch, but the narrow keeps
            // the optional-action type honest.
            onAction(node.action, {
              type: 'submit',
              answers: recorded,
              ...(Object.keys(filledFields).length > 0 ? { fields: filledFields } : {}),
              total,
              answered,
            })
          }
        } : undefined}
      >
        {node.label}
      </button>
      {total > 0 && <span className={css.submitHint} aria-live="polite">已选 {answered}/{total}</span>}
    </div>
  )
}

/** Switch: toggle with local state. */
export function SwitchNode({ node, onAction }: { node: GenuiSwitch; onAction?: GenuiBlockProps['onAction'] }) {
  const [on, setOn] = useState(node.checked === true)
  const action = node.action
  return (
    <label className={css.switchRow}>
      <span className={css.switchLabel}>{node.label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={`${css.switch} ${on ? css.switchOn : ''}`}
        onClick={() => {
          const next = !on
          setOn(next)
          if (action !== undefined && onAction !== undefined) onAction(action, { type: 'switch', checked: next })
        }}
      >
        <span className={css.switchKnob} />
      </button>
    </label>
  )
}

/** Slider: range input for numeric form values (v2.9). Field-aligned: with an
 * `id` the value persists across refresh and joins the sibling submit's
 * `fields` collection (stored as the numeric string); a model-provided
 * default registers at mount; a restored durable value wins. Dragging fires
 * the action (block-level debounce collapses the drag into one delivery). */
export function SliderNode({ node, onAction, answers }: {
  node: GenuiSlider
  onAction?: GenuiBlockProps['onAction']
  answers?: AnswersState | undefined
}) {
  const action = node.action
  const id = node.id
  const restored = id !== undefined && answers?.fields[id] !== undefined
    ? Number(answers!.fields[id]!)
    : NaN
  const initial = Number.isFinite(restored) ? restored : node.value ?? node.min ?? 0
  const [value, setValue] = useState<number>(initial)
  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    if (id !== undefined) answers?.setField(id, String(initial))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const send = (v: number): void => {
    if (action !== undefined && onAction !== undefined) {
      onAction(action, { type: 'slider', value: v, ...(id !== undefined ? { id } : {}) })
    }
  }
  return (
    <label className={css.sliderRow}>
      {node.label !== undefined && <span className={css.fieldLabel}>{node.label}</span>}
      <input
        type="range"
        className={css.sliderInput}
        min={node.min}
        max={node.max}
        step={node.step ?? 1}
        value={value}
        aria-label={node.label}
        onChange={e => {
          const v = Number(e.currentTarget.value)
          setValue(v)
          if (id !== undefined) answers?.setField(id, String(v))
          send(v)
        }}
      />
      <span className={css.sliderValue}>{Math.round(value * 100) / 100}</span>
    </label>
  )
}

/** Reuse the DSH main input's three-layer IME protection (verified in the
 *  host InputBar): composition start arms a ref, composition end clears it
 *  10ms later (Safari sends the closing keydown BEFORE compositionend), and
 *  every submit keydown re-checks the ref, the native `isComposing` flag,
 *  and `keyCode === 229`. A Chinese selection Enter must never submit. */
export function useImeComposing(): {
  isComposing: () => boolean
  onCompositionStart: () => void
  onCompositionEnd: () => void
} {
  const composing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])
  return {
    isComposing: () => composing.current,
    onCompositionStart: () => {
      composing.current = true
      if (timer.current !== null) {
        clearTimeout(timer.current)
        timer.current = null
      }
    },
    onCompositionEnd: () => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        composing.current = false
      }, 10)
    },
  }
}

export function isImeSubmitKeydown(e: React.KeyboardEvent): boolean {
  const native = e.nativeEvent
  return native.isComposing === true || native.keyCode === 229
}

/** Select: single choice from a dropdown, field-aligned (v2.8). With an `id`
 * the chosen option persists across refresh and joins the sibling submit's
 * `fields` collection; a model-provided `selected` default registers at
 * mount; a restored durable value wins over both. Without any default a
 * placeholder option shows — nothing is silently pre-registered (same
 * philosophy as radio). */
export function SelectNode({ node, onAction, answers }: {
  node: GenuiSelect
  onAction?: GenuiBlockProps['onAction']
  answers?: AnswersState | undefined
}) {
  const action = node.action
  const id = node.id
  const options = node.options.slice(0, GENUI_LIMITS.maxOptions)
  const restored = id !== undefined && answers?.fields[id] !== undefined
    ? options.indexOf(answers!.fields[id]!)
    : -1
  const defaultValue = restored >= 0
    ? options[restored]!
    : node.selected !== undefined && options[node.selected] !== undefined
      ? options[node.selected]!
      : null
  const [value, setValue] = useState<string | null>(defaultValue)
  // Field invariant: a spec-provided default registers at mount.
  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    if (id !== undefined && defaultValue !== null) {
      answers?.setField(id, defaultValue)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const send = (v: string): void => {
    if (action !== undefined && onAction !== undefined) {
      onAction(action, { type: 'select', value: v, ...(id !== undefined ? { id } : {}) })
    }
  }
  return (
    <label className={css.field}>
      {node.label !== undefined && <span>{node.label}</span>}
      <select
        className={css.select}
        value={value ?? ''}
        onChange={e => {
          const v = e.currentTarget.value
          setValue(v)
          if (id !== undefined) answers?.setField(id, v)
          send(v)
        }}
      >
        {value === null && <option value="" hidden disabled>请选择…</option>}
        {options.map((o, i) => <option key={i} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

/** Input: single-line field. Controlled (value tracked for persistence and
 *  submit collection when `id` is set). With `action`: Enter submits
 *  immediately (`{type:'input', value, submit:true}`), blur sends too —
 *  the user never has to click elsewhere for the value to reach the model.
 *  Enter during IME composition never submits. `inputType: 'password'`
 *  stays masked; its value is never persisted and never joins submit
 *  collection (secrets stay out of localStorage), while its own `action`
 *  still delivers on explicit user submit. */
export function InputNode({ node, onAction, answers }: {
  node: GenuiInput
  onAction?: GenuiBlockProps['onAction']
  answers?: AnswersState | undefined
}) {
  const action = node.action
  const id = node.id
  const secret = node.inputType === 'password'
  // Initial value: spec default, else durable state (restored after refresh).
  // Secrets restore as blank: a password that survives a refresh would be a
  // stored secret, which is exactly what the boundary forbids.
  const [value, setValue] = useState<string>(() =>
    secret ? '' : (node.value ?? (id !== undefined ? answers?.fields[id] ?? '' : '')))
  // Last value actually DELIVERED to the model: blur only sends when the
  // value changed since the last delivery (a focus-in/focus-out with no edit
  // used to fire a pointless action round trip). Seeded with the mount value
  // so the very first unedited blur also stays silent.
  const lastSent = useRef<string | null>(value)
  const send = (submit: boolean): void => {
    if (action !== undefined && onAction !== undefined) {
      lastSent.current = value
      onAction(action, { type: 'input', value, ...(id !== undefined ? { id } : {}), ...(submit ? { submit: true } : {}) })
    }
  }
  const ime = useImeComposing()
  // Field invariant: a spec-provided non-blank default registers at mount.
  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    if (!secret && id !== undefined && node.value !== undefined && node.value.trim() !== '') {
      answers?.setField(id, node.value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Secret fields are filtered from persistence and submit collection.
  useEffect(() => {
    if (secret && id !== undefined) answers?.registerSecretField(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret, id])
  return (
    <label className={css.field}>
      {node.label !== undefined && <span>{node.label}</span>}
      <input
        className={css.input}
        type={node.inputType ?? 'text'}
        placeholder={node.placeholder}
        value={value}
        onChange={e => {
          const v = e.currentTarget.value
          setValue(v)
          if (id !== undefined) answers?.setField(id, v)
        }}
        onBlur={() => {
          if (value !== lastSent.current) send(false)
        }}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onKeyDown={e => {
          if (e.key !== 'Enter') return
          if (ime.isComposing() || isImeSubmitKeydown(e)) return
          e.preventDefault()
          send(true)
        }}
      />
    </label>
  )
}

/** Textarea: multi-line input; with `action`, blurring sends the value and
 *  Ctrl/Cmd+Enter submits immediately. Controlled when `id` is set (durable
 *  value + submit collection). Ctrl/Cmd+Enter during IME composition never
 *  submits. */
export function TextareaNode({ node, onAction, answers }: {
  node: GenuiTextarea
  onAction?: GenuiBlockProps['onAction']
  answers?: AnswersState | undefined
}) {
  const action = node.action
  const id = node.id
  const [value, setValue] = useState<string>(() =>
    node.value ?? (id !== undefined ? answers?.fields[id] ?? '' : ''))
  // Last value delivered to the model: blur sends only on change. Seeded
  // with the mount value so an unedited blur stays silent.
  const lastSent = useRef<string | null>(value)
  const send = (submit: boolean): void => {
    if (action !== undefined && onAction !== undefined) {
      lastSent.current = value
      onAction(action, { type: 'textarea', value, ...(id !== undefined ? { id } : {}), ...(submit ? { submit: true } : {}) })
    }
  }
  const ime = useImeComposing()
  // Field invariant: a spec-provided non-blank default registers at mount.
  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    if (id !== undefined && node.value !== undefined && node.value.trim() !== '') {
      answers?.setField(id, node.value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <label className={css.field}>
      {node.label !== undefined && <span>{node.label}</span>}
      <textarea
        className={css.textarea}
        placeholder={node.placeholder}
        rows={node.rows ?? 4}
        value={value}
        onChange={e => {
          const v = e.currentTarget.value
          setValue(v)
          if (id !== undefined) answers?.setField(id, v)
        }}
        onBlur={() => {
          if (value !== lastSent.current) send(false)
        }}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onKeyDown={e => {
          if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return
          if (ime.isComposing() || isImeSubmitKeydown(e)) return
          e.preventDefault()
          send(true)
        }}
      />
    </label>
  )
}

/** Accordion: collapsible sections with local open state. Headings and
 * bodies are wired via useId (`aria-controls`/`aria-labelledby`). */
