import { useState, type CSSProperties } from 'react'
import {
  autoUpdate, flip, FloatingPortal, offset, shift, useClick, useDismiss,
  useFloating, useFocus, useHover, useInteractions, useRole,
} from '@floating-ui/react'
import { useT } from '../i18n/index.ts'
import { scheduleMinutes } from '../schedule-data.ts'
import type { GenuiSchedule, GenuiScheduleEvent, GenuiScheduleRange, GenuiScheduleRow } from '../spec.ts'
import type { GenuiBlockProps } from './state.ts'
import css from './schedule.module.css'

type Action = GenuiBlockProps['onAction']

interface PositionedEvent {
  event: GenuiScheduleEvent
  start: number
  end: number
  track: number
  tracks: number
}

/** Partition overlapping intervals. Events touching at an endpoint share a track. */
function positionEvents(events: GenuiScheduleEvent[]): PositionedEvent[] {
  const sorted = events.map(event => ({
    event, start: scheduleMinutes(event.start), end: scheduleMinutes(event.end), track: 0, tracks: 1,
  })).sort((a, b) => a.start - b.start || b.end - a.end)
  const trackEnds: number[] = []
  let clusterStart = 0
  let clusterEnd = 0

  function finishCluster(until: number): void {
    for (let index = clusterStart; index < until; index++) sorted[index]!.tracks = trackEnds.length
    trackEnds.length = 0
    clusterStart = until
  }

  sorted.forEach((event, index) => {
    if (event.start >= clusterEnd) finishCluster(index)
    const freeTrack = trackEnds.findIndex(end => end <= event.start)
    event.track = freeTrack === -1 ? trackEnds.length : freeTrack
    trackEnds[event.track] = event.end
    clusterEnd = Math.max(clusterEnd, event.end)
  })
  finishCluster(sorted.length)
  return sorted
}

function layoutRow(row: GenuiScheduleRow) {
  const grouped = 'group' in row
  const events = positionEvents(grouped ? row.items : [row])
  return {
    group: grouped ? row.group : undefined,
    label: grouped ? row.group : row.label,
    events,
    tracks: events.reduce((count, event) => Math.max(count, event.tracks), 1),
  }
}

function clockLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function axisTicks(start: number, end: number, timeline: boolean): number[] {
  const step = [5, 10, 15, 30, 60, 120, 180, 240].find(minutes => (end - start) / minutes <= (timeline ? 6 : 12)) ?? 240
  const ticks = [start]
  for (let minute = Math.ceil((start + step / 2) / step) * step; minute <= end - step / 2; minute += step) {
    ticks.push(minute)
  }
  ticks.push(end)
  return ticks
}

function layoutAxis(axis: GenuiScheduleRange, horizontal: boolean) {
  const start = scheduleMinutes(axis.start)
  const end = scheduleMinutes(axis.end)
  const span = end - start
  const at = (minutes: number): number => (minutes - start) / span * 100
  const ticks = axisTicks(start, end, horizontal).map(minute => ({
    minute, style: { '--position': `${at(minute)}%` } as CSSProperties,
  }))
  return {
    at, span, ticks,
    guides: ticks.slice(1, -1).map(({ minute, style }) => (
      <span key={minute} className={css.guide} aria-hidden="true" style={style} />
    )),
  }
}

function ScheduleEvent({ entry, group, at, showLabel, onAction }: {
  entry: PositionedEvent
  group: string | undefined
  at: (time: number) => number
  showLabel: boolean
  onAction: Action
}) {
  const { event, start, end, track, tracks } = entry
  const action = event.action
  const canSend = action !== undefined && onAction !== undefined
  const [open, setOpen] = useState(false)
  const { refs, context, floatingStyles } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  })
  const hover = useHover(context, { mouseOnly: true, delay: { open: 150 } })
  const focus = useFocus(context)
  const click = useClick(context, { enabled: !canSend })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, click, dismiss, role])
  const time = `${event.start}–${event.end}`
  const visibleTime = <>{event.start}–<wbr />{event.end}</>
  const eventName = [event.label, group, time].filter(Boolean).join(', ')
  const style = {
    '--start': `${at(start)}%`,
    '--length': `${at(end) - at(start)}%`,
    '--track': track,
    '--track-start': `${track / tracks * 100}%`,
    '--track-width': `${100 / tracks}%`,
    '--event-color': event.color,
  } as CSSProperties

  return (
    <>
      <button
        {...getReferenceProps({
          'aria-label': eventName,
          'aria-expanded': canSend ? undefined : open,
          onClick: canSend ? () => {
            setOpen(false)
            onAction(action, {
              type: 'schedule',
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
        className={css.event}
        style={style}
        data-tone={event.tone}
        data-genui-schedule-event
      >
        <span className={css.eventContent}>
          <span className={showLabel ? css.eventLabel : css.eventTimeOnly}>{showLabel ? event.label : visibleTime}</span>
          {showLabel && <span className={css.eventTime}>{visibleTime}</span>}
          {event.hint && <span className={css.eventHint}>{event.hint}</span>}
        </span>
      </button>
      {open && (
        <FloatingPortal>
          <div {...getFloatingProps()} ref={refs.setFloating} className={css.tooltip} style={floatingStyles}>
            <strong>{event.label}</strong>
            <span className={css.tooltipTime}>{[time, group].filter(Boolean).join(' · ')}</span>
            {event.hint && <span>{event.hint}</span>}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}

export function ScheduleNode({ node, onAction }: { node: GenuiSchedule; onAction: Action }) {
  const t = useT()
  const timeline = node.view === 'timeline'
  const axis = layoutAxis(node.axis, timeline)
  const rows = node.rows.map(row => layoutRow(row))
  const style = {
    '--minutes': axis.span,
    '--columns': timeline ? undefined : rows.map(row => `minmax(${Math.max(7, 5.5 * row.tracks)}rem, 1fr)`).join(' '),
  } as CSSProperties

  return (
    <figure className={css.schedule} data-genui-schedule="" data-view={timeline ? 'timeline' : 'week'}>
      {node.title && <figcaption className={css.title}>{node.title}</figcaption>}
      {node.rows.length === 0 ? <p className={css.empty}>{t('block.schedule.empty')}</p> : (
        <div className={css.shell}>
          <div className={css.viewport} role="region" aria-label={node.title || t('block.schedule')} tabIndex={0}>
            <div className={css.board} style={style}>
              <div className={css.axis}>
                <div className={css.heading}>{t('block.schedule.time')}</div>
                <div className={css.ruler} aria-hidden="true">
                  {axis.ticks.map(({ minute, style }) => <span key={minute} className={css.tick} style={style}>{clockLabel(minute)}</span>)}
                </div>
              </div>
              {rows.map((row, index) => (
                <div className={css.row} key={`${row.label}:${index}`}>
                  <div className={css.heading}>{row.label}</div>
                  <div className={css.track} data-genui-schedule-track style={{ '--tracks': row.tracks } as CSSProperties}>
                    {axis.guides}
                    {row.events.map((entry, eventIndex) => (
                      <ScheduleEvent
                        key={JSON.stringify([entry.event.label, entry.start, entry.end, eventIndex])}
                        entry={entry}
                        group={row.group}
                        showLabel={row.group !== undefined}
                        at={axis.at}
                        onAction={onAction}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </figure>
  )
}
