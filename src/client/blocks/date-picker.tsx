import { useEffect, useId, useState } from 'react'
import type { GenuiDatePicker } from '../spec.ts'
import { useT } from '../i18n/index.ts'
import { isDatePickerValueValid } from '../date-picker.ts'
import type { AnswersState } from './state.ts'
import css from './date-picker.module.css'

/** 渲染使用共享字段的单日期或日期范围控件。 */
export function DatePickerNode({ node, answers }: {
  node: GenuiDatePicker
  answers?: AnswersState | undefined
}) {
  const t = useT()
  const uid = useId()
  const id = node.id
  const range = node.mode === 'range'
  const restored = id !== undefined && answers !== undefined && Object.hasOwn(answers.fields, id)
    ? answers.fields[id] : undefined
  const initial = restored ?? node.value ?? ''
  const validInitial = isDatePickerValueValid(initial, range ? 'range' : 'single', node.min, node.max) ? initial : ''
  const initialParts = range ? validInitial.split('/') : [validInitial]
  const [start, setStart] = useState(initialParts[0] ?? '')
  const [end, setEnd] = useState(range ? initialParts[1] ?? '' : '')
  const invalidRange = range && start !== '' && end !== '' && start > end
  const invalidDate = range
    ? [start, end].some(value => value !== '' && !isDatePickerValueValid(value, 'single', node.min, node.max))
    : start !== '' && !isDatePickerValueValid(start, 'single', node.min, node.max)

  useEffect(() => {
    if (id === undefined) return
    if (restored !== undefined) {
      if (!isDatePickerValueValid(restored, range ? 'range' : 'single', node.min, node.max)) {
        answers?.setField(id, '')
        setStart('')
        setEnd('')
      }
      return
    }
    if (validInitial !== '') answers?.setField(id, validInitial)
  }, [])

  useEffect(() => {
    const current = range ? start !== '' && end !== '' ? `${start}/${end}` : '' : start
    if (current !== '' && !isDatePickerValueValid(current, range ? 'range' : 'single', node.min, node.max)) {
      setStart('')
      setEnd('')
      if (id !== undefined) answers?.setField(id, '')
    } else if (id !== undefined && current !== '') {
      // A constraint update can make a previously invalid draft valid. Keep
      // the submitted value aligned with the date now displayed as valid.
      answers?.setField(id, current)
    }
  }, [node.mode, node.min, node.max])

  /** 将已完成的日期选择写入共享字段，并清除未完成的范围值。 */
  const updateField = (nextStart: string, nextEnd: string): void => {
    if (id === undefined) return
    const value = range
      ? nextStart !== '' && nextEnd !== '' && nextStart <= nextEnd ? `${nextStart}/${nextEnd}` : ''
      : nextStart
    answers?.setField(id, value !== '' && isDatePickerValueValid(value, range ? 'range' : 'single', node.min, node.max) ? value : '')
  }

  return (
    <fieldset className={css.datePicker}>
      <legend className={css.label}>{node.label ?? t(range ? 'block.datePicker.range' : 'block.datePicker.date')}</legend>
      {range ? (
        <div className={css.range}>
          <label className={css.dateField} htmlFor={`${uid}-start`}>
            <span>{t('block.datePicker.start')}</span>
            <input
              id={`${uid}-start`}
              type="date"
              min={node.min}
              max={node.max}
              value={start}
              aria-invalid={invalidRange || invalidDate || undefined}
              onChange={event => {
                const value = event.currentTarget.value
                setStart(value)
                updateField(value, end)
              }}
            />
          </label>
          <label className={css.dateField} htmlFor={`${uid}-end`}>
            <span>{t('block.datePicker.end')}</span>
            <input
              id={`${uid}-end`}
              type="date"
              min={node.min}
              max={node.max}
              value={end}
              aria-invalid={invalidRange || invalidDate || undefined}
              onChange={event => {
                const value = event.currentTarget.value
                setEnd(value)
                updateField(start, value)
              }}
            />
          </label>
        </div>
      ) : (
        <label className={css.dateField} htmlFor={uid}>
          <input
            id={uid}
            type="date"
            aria-label={node.label ?? t('block.datePicker.date')}
            aria-invalid={invalidDate || undefined}
            min={node.min}
            max={node.max}
            value={start}
            onChange={event => {
              const value = event.currentTarget.value
              setStart(value)
              updateField(value, '')
            }}
          />
        </label>
      )}
      {(invalidRange || invalidDate) && <span className={css.error} role="status">{invalidRange ? t('block.datePicker.invalidRange') : t('block.datePicker.invalidDate')}</span>}
    </fieldset>
  )
}
