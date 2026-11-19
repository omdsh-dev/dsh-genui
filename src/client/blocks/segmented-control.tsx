import { useEffect, useId, useState } from 'react'
import { renderInline } from '../inline.ts'
import { useT } from '../i18n/index.ts'
import type { GenuiSegmentedControl } from '../spec.ts'
import type { GenuiBlockProps, AnswersState } from './state.ts'
import css from './segmented-control.module.css'

/** 渲染可通过选中值更新同级组件的单选控件。 */
export function SegmentedControlNode({ node, onAction, answers }: {
  node: GenuiSegmentedControl
  onAction?: GenuiBlockProps['onAction']
  answers?: AnswersState | undefined
}) {
  const t = useT()
  const uid = useId()
  const id = node.id
  const options = node.options
  const restored = id === undefined ? undefined : answers?.fields[id]
  const initial = restored !== undefined && options.includes(restored)
    ? restored
    : node.value !== undefined && options.includes(node.value) ? node.value : ''
  const [localValue, setLocalValue] = useState(initial)
  const validDefault = node.value !== undefined && options.includes(node.value) ? node.value : ''
  const value = id === undefined ? localValue : (answers?.fields[id] ?? localValue)

  useEffect(() => {
    if (id !== undefined && restored === undefined && initial !== '') answers?.setField(id, initial)
  }, [])

  // 无共享字段时，流式更换选项也必须移除失效的本地选择。
  useEffect(() => {
    if (id !== undefined && answers !== undefined) return
    setLocalValue(previous => previous !== '' && !options.includes(previous) ? validDefault : previous)
  }, [id, answers, options, validDefault])

  useEffect(() => {
    if (id !== undefined && value !== '' && !options.includes(value)) answers?.setField(id, '')
  }, [id, options, value, answers])

  return (
    <fieldset className={css.control}>
      {node.label !== undefined && <legend className={css.label}>{renderInline(node.label, false)}</legend>}
      <div className={css.options} role="radiogroup" aria-label={node.label ?? t('block.segmentedControl')}>
        {options.map((option, index) => (
          <label key={`${index}-${option}`} className={css.option} data-selected={value === option ? '' : undefined}>
            <input
              className={css.radio}
              type="radio"
              name={`${uid}-options`}
              value={option}
              checked={value === option}
              onChange={() => {
                setLocalValue(option)
                if (id !== undefined) answers?.setField(id, option)
                if (node.action !== undefined && onAction !== undefined) {
                  onAction(node.action, { type: 'segmented-control', value: option, ...(id === undefined ? {} : { id }) })
                }
              }}
            />
            <span>{renderInline(option, false)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
