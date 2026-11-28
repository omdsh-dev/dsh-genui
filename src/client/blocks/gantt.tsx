import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  autoUpdate, flip, FloatingPortal, offset, shift, useClick, useDismiss,
  useFloating, useFocus, useHover, useInteractions, useRole,
} from '@floating-ui/react'
import { useT } from '../i18n/index.ts'
import {
  detectTimeScale, formatCompactDuration, formatCompactEventRange, formatShortTimestamp,
  ganttDurationMinutes, generateAxisTicks, inferGanttAxis, parseTimeValue, rangeBounds, type TimeScale,
} from '../schedule-data.ts'
import type { GenuiGantt, GenuiGanttEvent, GenuiScheduleRange } from '../spec.ts'
import { readableOn } from './blocks.tsx'
import type { GenuiBlockProps } from './state.ts'
import css from './gantt.module.css'

type Action = GenuiBlockProps['onAction']

interface ResolvedAxis {
  range: GenuiScheduleRange
  scale: TimeScale
  start: number
  span: number
  at: (timestamp: string) => number
  ticks: ReturnType<typeof generateAxisTicks>['ticks']
  dayColumns: ReturnType<typeof generateAxisTicks>['dayColumns']
}

interface ViewportMetrics {
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
  leftColWidth: number
  trackPad: number
}

function resolveAxis(range: GenuiScheduleRange): ResolvedAxis {
  const scale = detectTimeScale(range.start) ?? 'clock'
  const { start, span } = rangeBounds(range, scale)
  const { ticks, dayColumns } = generateAxisTicks(range, scale)
  const at = (timestamp: string): number => {
    if (span <= 0) return 0
    return (parseTimeValue(timestamp, scale) - start) / span * 100
  }
  return { range, scale, start, span, at, ticks, dayColumns }
}

function resolveNowPos(now: string | undefined, axis: ResolvedAxis): { pos: number; day?: number; label: string } | undefined {
  if (now === undefined) return undefined
  const scale = detectTimeScale(now)
  if (scale !== axis.scale) return undefined
  const value = parseTimeValue(now, scale)
  const endBound = axis.start + (axis.scale === 'date' ? axis.span - 1 : axis.span)
  if (value < axis.start || value > endBound) return undefined
  const offsetVal = axis.scale === 'date' ? value + 0.5 : value
  const pos = axis.span <= 0 ? 0 : (offsetVal - axis.start) / axis.span * 100
  return { pos, ...(axis.scale === 'date' ? { day: value } : {}), label: formatShortTimestamp(now, scale) }
}

function fullDurationText(minutes: number, scale: TimeScale, t: ReturnType<typeof useT>): string {
  if (scale === 'date') {
    const days = Math.max(1, Math.round(minutes / 1440))
    return t('block.gantt.days', { days })
  }
  if (minutes >= 60 && minutes % 60 !== 0) {
    return `${formatCompactDuration(minutes, scale, d => t('block.gantt.days', { days: d }))} (${t('block.gantt.duration', { minutes })})`
  }
  return t('block.gantt.duration', { minutes })
}

function formatAxisRange(range: GenuiScheduleRange, scale: TimeScale): string {
  return `${formatShortTimestamp(range.start, scale)}–${formatShortTimestamp(range.end, scale)}`
}

function formatEventRange(event: GenuiGanttEvent, scale: TimeScale): string {
  const s = formatShortTimestamp(event.start, scale)
  if (event.milestone) return s
  if (scale === 'date' && event.start === event.end) return s
  return `${s}–${formatShortTimestamp(event.end, scale)}`
}

function GanttGuides({ axis, nowPos }: { axis: ResolvedAxis; nowPos: { pos: number } | undefined }) {
  return (
    <>
      {axis.dayColumns?.map((col, idx) =>
        col.weekend ? (
          <span
            key={`wknd-${idx}`}
            className={css.weekendBand}
            aria-hidden="true"
            style={{ '--pos': `${col.pos - col.width / 2}%`, '--width': `${col.width}%` } as CSSProperties}
          />
        ) : null,
      )}
      {axis.ticks.map((tick, idx) => (
        <span
          key={`g-${tick.value}-${idx}`}
          className={idx === 0 || idx === axis.ticks.length - 1 ? css.guideEdge : css.guide}
          aria-hidden="true"
          style={{ '--pos': `${tick.pos}%` } as CSSProperties}
        />
      ))}
      {nowPos !== undefined && (
        <span className={css.nowLine} aria-hidden="true" style={{ '--pos': `${nowPos.pos}%` } as CSSProperties} />
      )}
    </>
  )
}

function GanttRuler({ axis, nowPos, defaultNowLabel }: {
  axis: ResolvedAxis
  nowPos: { pos: number; day?: number; label: string } | undefined
  defaultNowLabel: string
}) {
  return (
    <div className={css.ruler} aria-hidden="true">
      <div className={css.rulerInner}>
        {axis.dayColumns !== undefined ? (
          axis.dayColumns.map((col, idx) => {
            const isToday = nowPos?.day !== undefined && axis.start + idx === nowPos.day
            return (
              <span
                key={`day-${idx}`}
                className={`${css.dayLabel}${col.weekend ? ` ${css.dayLabelWeekend}` : ''}`}
                style={{ '--pos': `${col.pos}%`, '--width': `${col.width}%` } as CSSProperties}
              >
                <span className={isToday ? css.dayLabelToday : undefined} title={isToday ? defaultNowLabel : undefined}>
                  {col.label}
                </span>
              </span>
            )
          })
        ) : (
          axis.ticks.map((tick, idx) => (
            <span key={`t-${tick.value}-${idx}`} className={css.tick} style={{ '--pos': `${tick.pos}%` } as CSSProperties}>
              {tick.label}
            </span>
          ))
        )}
        {nowPos !== undefined && axis.dayColumns === undefined && (
          <span
            className={css.nowDot}
            style={{ '--pos': `${nowPos.pos}%` } as CSSProperties}
            title={`${defaultNowLabel} ${nowPos.label}`}
          />
        )}
      </div>
    </div>
  )
}

function GanttEventItem({ event, group, axis, onAction }: {
  event: GenuiGanttEvent
  group: string | undefined
  axis: ResolvedAxis
  onAction: Action
}) {
  const t = useT()
  const canSend = event.action !== undefined && onAction !== undefined
  const [open, setOpen] = useState(false)
  const { refs, context, floatingStyles } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  })
  const hover = useHover(context, { mouseOnly: true, delay: { open: 120 } })
  const focus = useFocus(context)
  const click = useClick(context, { enabled: !canSend })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, click, dismiss, role])

  const startPct = axis.at(event.start)
  const endPct = axis.scale === 'date'
    ? (parseTimeValue(event.end, 'date') + 1 - axis.start) / axis.span * 100
    : axis.at(event.end)
  const lengthPct = Math.max(0, endPct - startPct)

  const minutes = ganttDurationMinutes(event.start, event.end, axis.scale)
  const timeText = formatEventRange(event, axis.scale)
  const fullDur = event.milestone ? t('block.gantt.milestone') : fullDurationText(minutes, axis.scale, t)
  const compactDur = formatCompactDuration(minutes, axis.scale, days => t('block.gantt.days', { days }))
  const progress = event.progress
  const done = progress === 100
  const partialProgress = progress !== undefined && progress < 100
  const canFitProgressInside = partialProgress && progress >= 40 && (lengthPct * progress / 100) >= 18
  const barTag = done ? `✓ ${compactDur}` : (partialProgress ? `${compactDur} · ${progress}%` : compactDur)
  const nearEnd = event.milestone ? startPct > 82 : endPct > 88
  const customInk = event.color !== undefined ? readableOn(event.color) : undefined

  const ariaLabel = [
    event.label,
    group,
    timeText,
    fullDur,
    progress === undefined ? undefined : t('block.gantt.progress', { percent: progress }),
  ].filter(Boolean).join(', ')

  const style = {
    '--start': `${startPct}%`,
    '--length': `${lengthPct}%`,
    '--event-color': event.color,
    '--bar-ink': customInk,
    '--progress': progress === undefined ? undefined : `${progress}%`,
  } as CSSProperties

  return (
    <>
      {event.milestone ? (
        <button
          {...getReferenceProps({
            'aria-label': ariaLabel,
            'aria-expanded': canSend ? undefined : open,
            onClick: canSend ? () => {
              setOpen(false)
              onAction(event.action!, {
                type: 'gantt',
                label: event.label,
                start: event.start,
                end: event.end,
                ...(group === undefined ? {} : { group }),
              })
            } : undefined,
          })}
          type="button"
          tabIndex={0}
          ref={refs.setReference}
          className={css.milestone}
          style={style}
          data-tone={event.tone}
          data-genui-schedule-event
        >
          <span className={css.diamond} aria-hidden="true" />
          <span className={css.milestoneLabel} data-side={nearEnd ? 'start' : 'end'}>
            {event.hint || timeText}
          </span>
        </button>
      ) : (
        <button
          {...getReferenceProps({
            'aria-label': ariaLabel,
            'aria-expanded': canSend ? undefined : open,
            onClick: canSend ? () => {
              setOpen(false)
              onAction(event.action!, {
                type: 'gantt',
                label: event.label,
                start: event.start,
                end: event.end,
                ...(group === undefined ? {} : { group }),
              })
            } : undefined,
          })}
          type="button"
          tabIndex={0}
          ref={refs.setReference}
          className={css.bar}
          style={style}
          data-tone={event.tone}
          data-genui-schedule-event
          data-has-progress={progress !== undefined ? '' : undefined}
          data-partial-progress={partialProgress ? '' : undefined}
          data-progress-inside={canFitProgressInside ? '' : undefined}
          data-long-tag={!partialProgress && barTag.length > 6 ? '' : undefined}
        >
          <span className={css.barBody}>
            {partialProgress && <span className={css.barProgress} aria-hidden="true" />}
            <span className={css.barInsideLabel}>{barTag}</span>
          </span>
          <span className={css.barOutsideLabel} data-side={nearEnd ? 'start' : 'end'}>
            {barTag}
          </span>
        </button>
      )}
      {open && (
        <FloatingPortal>
          <div {...getFloatingProps()} ref={refs.setFloating} className={css.tooltip} style={floatingStyles}>
            <div className={css.tooltipHead}>
              <span
                className={event.milestone ? css.tooltipDiamond : css.tooltipSwatch}
                data-tone={event.tone}
                style={{ '--event-color': event.color } as CSSProperties}
                aria-hidden="true"
              />
              <strong className={css.tooltipTitle}>{event.label}</strong>
              {group !== undefined && <span className={css.tooltipGroup}>{group}</span>}
            </div>
            <div className={css.tooltipTime}>{[timeText, fullDur].filter(Boolean).join(' · ')}</div>
            {progress !== undefined && (
              <div className={css.tooltipProgress}>
                <span className={css.tooltipProgressTrack}>
                  <span
                    className={css.tooltipProgressFill}
                    data-tone={event.tone}
                    style={{ '--event-color': event.color, '--progress': `${progress}%` } as CSSProperties}
                  />
                </span>
                <span>{t('block.gantt.progress', { percent: progress })}</span>
              </div>
            )}
            {event.hint && <div className={css.tooltipHint}>{event.hint}</div>}
            {canSend && <div className={css.tooltipAction}>{t('block.gantt.clickAction')}</div>}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}

function countTasks(node: GenuiGantt): number {
  let count = 0
  for (const row of node.rows) {
    if ('group' in row) count += row.items.length
    else count++
  }
  return count
}

export function GanttNode({ node, onAction }: { node: GenuiGantt; onAction: Action }) {
  const t = useT()
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})
  const viewportRef = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState<ViewportMetrics>({
    scrollLeft: 0, clientWidth: 0, scrollWidth: 0, leftColWidth: 0, trackPad: 24,
  })

  useEffect(() => {
    const vp = viewportRef.current
    if (vp === null) return
    const measure = () => {
      const leftEl = vp.querySelector<HTMLElement>(`.${css.axisHeading}, .${css.groupHeading}, .${css.taskCell}`)
      const trackEl = vp.querySelector<HTMLElement>(`.${css.track}`)
      const leftColWidth = leftEl ? leftEl.getBoundingClientRect().width : 0
      const trackPad = trackEl ? (parseFloat(getComputedStyle(trackEl).paddingInlineStart) || 24) : 24
      setMetrics({
        scrollLeft: vp.scrollLeft,
        clientWidth: vp.clientWidth,
        scrollWidth: vp.scrollWidth,
        leftColWidth,
        trackPad,
      })
    }
    measure()
    vp.addEventListener('scroll', measure, { passive: true })
    if (typeof ResizeObserver === 'undefined') return () => vp.removeEventListener('scroll', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(vp)
    return () => {
      vp.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [node, collapsed])

  const fallbackAxis = node.axis ?? inferGanttAxis(node.rows)?.range ?? { start: '00:00', end: '24:00' }
  const rootAxis = resolveAxis(fallbackAxis)
  const rootNow = resolveNowPos(node.now, rootAxis)
  const sharedAxis = node.rows.some(row => !('group' in row) || row.axis === undefined)

  let maxTicks = sharedAxis ? Math.max(4, rootAxis.dayColumns?.length ?? rootAxis.ticks.length) : 4
  let hasDatetime = sharedAxis && rootAxis.scale === 'datetime'
  for (const row of node.rows) {
    if ('group' in row && row.axis !== undefined) {
      const local = resolveAxis(row.axis)
      maxTicks = Math.max(maxTicks, local.dayColumns?.length ?? local.ticks.length)
      if (local.scale === 'datetime') hasDatetime = true
    }
  }

  const boardStyle = {
    '--gantt-ticks': maxTicks,
    '--gantt-tick-step': hasDatetime ? '5.5em' : '4.5em',
    '--gantt-track-pad': hasDatetime ? '2.75rem' : '1.5rem',
  } as CSSProperties

  const taskCount = countTasks(node)
  const isScrollable = metrics.scrollWidth > metrics.clientWidth + 2 && metrics.leftColWidth > 0
  const trackInnerWidth = isScrollable ? Math.max(0, metrics.scrollWidth - metrics.leftColWidth - 2 * metrics.trackPad) : 0
  const visStartPx = metrics.scrollLeft - metrics.trackPad
  const visEndPx = metrics.scrollLeft + (metrics.clientWidth - metrics.leftColWidth) - metrics.trackPad

  const toggleGroup = (index: number) => {
    setCollapsed(prev => ({ ...prev, [index]: !prev[index] }))
  }

  const scrollToRange = (startPx: number, endPx: number) => {
    const vp = viewportRef.current
    if (vp === null) return
    const visibleTrackWidth = Math.max(1, metrics.clientWidth - metrics.leftColWidth)
    const centerPx = (startPx + endPx) / 2
    const target = Math.max(0, centerPx + metrics.trackPad - visibleTrackWidth / 2)
    vp.scrollTo({ left: target, behavior: 'smooth' })
  }

  const renderTaskRow = (
    event: GenuiGanttEvent,
    key: string,
    axis: ResolvedAxis,
    group: string | undefined,
    nowPos: { pos: number } | undefined,
    inGroup: boolean,
  ) => {
    const swatchStyle = { '--event-color': event.color } as CSSProperties
    const compactTime = formatCompactEventRange(event.start, event.end, axis.scale, event.milestone)
    const startPct = axis.at(event.start)
    const endPct = event.milestone
      ? startPct
      : (axis.scale === 'date' ? (parseTimeValue(event.end, 'date') + 1 - axis.start) / axis.span * 100 : axis.at(event.end))

    let offscreen: { dir: 'left' | 'right'; anchorPx: number; startPx: number; endPx: number } | undefined
    if (isScrollable && trackInnerWidth > 0) {
      const startPx = startPct / 100 * trackInnerWidth
      const endPx = endPct / 100 * trackInnerWidth
      if (startPx > visEndPx - 8) {
        offscreen = { dir: 'right', anchorPx: Math.max(40, visEndPx - 6), startPx, endPx }
      } else if (endPx < visStartPx + 8) {
        offscreen = { dir: 'left', anchorPx: Math.max(4, visStartPx + 6), startPx, endPx }
      }
    }

    return (
      <div className={`${css.taskRow}${inGroup ? ` ${css.taskRowChild}` : ''}`} key={key}>
        <div className={css.taskCell}>
          <span
            className={event.milestone ? css.swatchDiamond : css.swatch}
            data-tone={event.tone}
            style={swatchStyle}
            aria-hidden="true"
          />
          <div className={css.taskMeta}>
            <div className={css.taskHead}>
              <span className={css.taskLabel}>{event.label}</span>
              <span className={css.taskTime}>{compactTime}</span>
            </div>
            {event.hint && <span className={css.taskHint}>{event.hint}</span>}
          </div>
        </div>
        <div className={css.track} data-genui-schedule-track>
          <div className={css.trackInner}>
            <GanttGuides axis={axis} nowPos={nowPos} />
            <GanttEventItem event={event} group={group} axis={axis} onAction={onAction} />
            {offscreen !== undefined && (
              <button
                type="button"
                className={css.jumpChip}
                data-dir={offscreen.dir}
                data-tone={event.tone}
                style={{ '--anchor': `${offscreen.anchorPx}px`, '--event-color': event.color } as CSSProperties}
                onClick={() => scrollToRange(offscreen.startPx, offscreen.endPx)}
              >
                {offscreen.dir === 'right'
                  ? `${formatShortTimestamp(event.start, axis.scale)} →`
                  : `← ${formatShortTimestamp(event.start, axis.scale)}`}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <figure className={css.gantt} data-genui-gantt>
      {node.title && (
        <figcaption className={css.header}>
          <span className={css.title}>{node.title}</span>
          {taskCount > 0 && (
            <span className={css.summary}>
              <span>{t('block.gantt.taskCount', { count: taskCount })}</span>
              {sharedAxis && <span>· {formatAxisRange(rootAxis.range, rootAxis.scale)}</span>}
              {rootNow !== undefined && (
                <span className={css.summaryNow}>
                  <span className={css.summaryNowDot} aria-hidden="true" />
                  {node.nowLabel ?? t('block.gantt.now')} {rootNow.label}
                </span>
              )}
            </span>
          )}
        </figcaption>
      )}
      {node.rows.length === 0 ? (
        <p className={css.empty}>{t('block.gantt.empty')}</p>
      ) : (
        <div className={css.shell} data-scrolled={metrics.scrollLeft > 1 ? '' : undefined}>
          <div
            ref={viewportRef}
            className={css.viewport}
            role="region"
            aria-label={node.title || t('block.gantt')}
            tabIndex={0}
          >
            <div className={css.board} style={boardStyle}>
              {sharedAxis && (
                <div className={css.axisRow}>
                  <div className={css.axisHeading}>{t('block.gantt.tasks')}</div>
                  <GanttRuler
                    axis={rootAxis}
                    nowPos={rootNow}
                    defaultNowLabel={node.nowLabel ?? t('block.gantt.now')}
                  />
                </div>
              )}
              {node.rows.map((row, index) => {
                if (!('group' in row)) {
                  return renderTaskRow(row, `task-${index}-${row.label}`, rootAxis, undefined, rootNow, false)
                }
                const hasCustomAxis = row.axis !== undefined
                const localAxis = hasCustomAxis ? resolveAxis(row.axis!) : rootAxis
                const localNow = hasCustomAxis ? resolveNowPos(row.now, localAxis) : rootNow
                const isCollapsed = collapsed[index] === true
                const showSummary = !hasCustomAxis && row.items.length > 0 && (row.items.length >= 2 || isCollapsed)

                let summaryBracket: { startPct: number; lengthPct: number; title: string } | undefined
                if (showSummary) {
                  let minStart = Number.POSITIVE_INFINITY
                  let maxEnd = Number.NEGATIVE_INFINITY
                  let minTs = row.items[0]!.start
                  let maxTs = row.items[0]!.end
                  for (const item of row.items) {
                    const s = localAxis.at(item.start)
                    const e = localAxis.scale === 'date'
                      ? (parseTimeValue(item.end, 'date') + 1 - localAxis.start) / localAxis.span * 100
                      : localAxis.at(item.end)
                    if (s < minStart) { minStart = s; minTs = item.start }
                    if (e > maxEnd) { maxEnd = e; maxTs = item.end }
                  }
                  if (Number.isFinite(minStart) && Number.isFinite(maxEnd)) {
                    summaryBracket = {
                      startPct: minStart,
                      lengthPct: Math.max(0, maxEnd - minStart),
                      title: `${formatShortTimestamp(minTs, localAxis.scale)}–${formatShortTimestamp(maxTs, localAxis.scale)}`,
                    }
                  }
                }

                return (
                  <div className={css.group} key={`group-${row.group}-${index}`} role="group" aria-label={row.group}>
                    <div className={hasCustomAxis ? css.groupAxisRow : css.groupRow}>
                      <div className={css.groupHeading}>
                        <button
                          type="button"
                          className={css.groupToggle}
                          aria-expanded={!isCollapsed}
                          aria-label={t('block.gantt.toggleGroup', { group: row.group })}
                          onClick={() => toggleGroup(index)}
                        >
                          <svg
                            className={css.chevron}
                            data-collapsed={isCollapsed ? '' : undefined}
                            width="12"
                            height="12"
                            viewBox="0 0 12 12"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M3 4.5L6 7.5L9 4.5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          <span className={css.groupName}>{row.group}</span>
                          <span className={css.groupCount}>{row.items.length}</span>
                        </button>
                      </div>
                      {hasCustomAxis ? (
                        <GanttRuler
                          axis={localAxis}
                          nowPos={localNow}
                          defaultNowLabel={row.nowLabel ?? t('block.gantt.now')}
                        />
                      ) : (
                        <div className={css.groupTrack} aria-hidden="true">
                          <div className={css.trackInner}>
                            <GanttGuides axis={localAxis} nowPos={localNow} />
                            {summaryBracket !== undefined && (
                              <span
                                className={css.summaryBracket}
                                title={summaryBracket.title}
                                style={{
                                  '--start': `${summaryBracket.startPct}%`,
                                  '--length': `${summaryBracket.lengthPct}%`,
                                } as CSSProperties}
                              />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    {!isCollapsed && row.items.map((item, i) =>
                      renderTaskRow(item, `item-${index}-${i}-${item.label}`, localAxis, row.group, localNow, true),
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </figure>
  )
}
