import { isIsoDate } from './date-picker.ts'
import { GENUI_LIMITS } from './genui-runtime/limits.ts'
import { BLOCK_CELL_TONES, SCHEDULE_VIEWS } from './genui-runtime/schema.ts'
import { color, enu, num, obj, opt, str } from './genui-runtime/value-utils.ts'
import type {
  GenuiGantt,
  GenuiGanttEvent,
  GenuiGanttRow,
  GenuiSchedule,
  GenuiScheduleEvent,
  GenuiScheduleRange,
  GenuiScheduleRow,
} from './spec.ts'

export type TimeScale = 'clock' | 'date' | 'datetime'

export interface AxisTick {
  value: number
  pos: number
  label: string
}

export interface AxisDayColumn {
  pos: number
  width: number
  label: string
  weekend: boolean
}

const CLOCK_RE = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/u
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[ T]((?:[01]\d|2[0-3]):[0-5]\d|24:00)$/u
const MS_PER_DAY = 86_400_000

function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && CLOCK_RE.test(value)
}

/** Detect the time format scale used by a gantt timestamp. */
export function detectTimeScale(value: unknown): TimeScale | undefined {
  if (typeof value !== 'string') return undefined
  if (CLOCK_RE.test(value)) return 'clock'
  if (isIsoDate(value)) return 'date'
  const m = DATETIME_RE.exec(value)
  return m !== null && isIsoDate(m[1]) ? 'datetime' : undefined
}

/** Turn a validated clock time into minutes from midnight. */
export function scheduleMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
}

function utcDayNumber(isoDate: string): number {
  const y = Number(isoDate.slice(0, 4))
  const m = Number(isoDate.slice(5, 7))
  const d = Number(isoDate.slice(8, 10))
  return Date.UTC(y, m - 1, d) / MS_PER_DAY
}

/** Parse a validated timestamp into linear numeric coordinates for its scale. */
export function parseTimeValue(value: string, scale: TimeScale): number {
  if (scale === 'clock') return scheduleMinutes(value)
  if (scale === 'date') return utcDayNumber(value)
  return utcDayNumber(value.slice(0, 10)) * 1440 + scheduleMinutes(value.slice(11))
}

function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function formatUtcIsoDate(dayNumber: number): string {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10)
}

function formatTimeValue(value: number, scale: TimeScale): string {
  if (scale === 'clock') return formatClock(value)
  if (scale === 'date') return formatUtcIsoDate(value)
  const day = Math.floor(value / 1440)
  const min = value - day * 1440
  return `${formatUtcIsoDate(day)} ${formatClock(min)}`
}

function formatDateTick(dayNumber: number, spanDays: number): string {
  const d = new Date(dayNumber * MS_PER_DAY)
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return spanDays > 180 ? `${d.getUTCFullYear()}-${mm}` : `${mm}/${dd}`
}

/** Format a tick label for the axis ruler. */
export function formatTimeTick(value: number, scale: TimeScale, span = 0, prevValue?: number): string {
  if (scale === 'clock') return formatClock(value)
  if (scale === 'date') return formatDateTick(value, span)
  const day = Math.floor(value / 1440)
  const min = value - day * 1440
  const prevDay = prevValue === undefined ? undefined : Math.floor(prevValue / 1440)
  if (prevDay === day) return formatClock(min)
  const dayLabel = formatDateTick(day, Math.ceil(span / 1440))
  return min === 0 ? dayLabel : `${dayLabel} ${formatClock(min)}`
}

/** Format a concise timestamp for row sub-labels and milestone callouts. */
export function formatShortTimestamp(value: string, scale: TimeScale): string {
  if (scale === 'clock') return value
  if (scale === 'date') return `${value.slice(5, 7)}/${value.slice(8, 10)}`
  return `${value.slice(5, 7)}/${value.slice(8, 10)} ${value.slice(11)}`
}

/** Format a compact event time range suitable for inline task-cell display. */
export function formatCompactEventRange(start: string, end: string, scale: TimeScale, milestone?: boolean): string {
  if (milestone === true) return formatShortTimestamp(start, scale)
  if (scale === 'clock') return `${start}–${end}`
  if (scale === 'date') {
    const s = formatShortTimestamp(start, 'date')
    return start === end ? s : `${s}–${formatShortTimestamp(end, 'date')}`
  }
  const dayDiff = utcDayNumber(end.slice(0, 10)) - utcDayNumber(start.slice(0, 10))
  if (dayDiff === 0) return `${start.slice(11)}–${end.slice(11)}`
  if (dayDiff === 1) return `${start.slice(11)}–${end.slice(11)} +1d`
  return `${formatShortTimestamp(start, 'date')}–${formatShortTimestamp(end, 'date')}`
}

function isClockRange(value: Record<string, unknown> | undefined): value is Record<string, unknown> & GenuiScheduleRange {
  return value !== undefined && isClockTime(value.start) && isClockTime(value.end) && value.start < value.end
}

function isStartBound24(value: string, scale: TimeScale): boolean {
  if (scale === 'clock') return value === '24:00'
  if (scale === 'datetime') return value.slice(11) === '24:00'
  return false
}

function isValidRangeForScale(start: string, end: string, scale: TimeScale, allowEqual: boolean): boolean {
  if (detectTimeScale(start) !== scale || detectTimeScale(end) !== scale) return false
  if (isStartBound24(start, scale)) return false
  const s = parseTimeValue(start, scale)
  const e = parseTimeValue(end, scale)
  if (scale === 'date') return s <= e
  return allowEqual ? s <= e : s < e
}

/** Numeric start, end (inclusive day end for date scale), and total span. */
export function rangeBounds(range: GenuiScheduleRange, scale: TimeScale): { start: number; end: number; span: number } {
  const start = parseTimeValue(range.start, scale)
  const rawEnd = parseTimeValue(range.end, scale)
  const end = scale === 'date' ? rawEnd + 1 : rawEnd
  return { start, end, span: end - start }
}

/** Duration in minutes for any scale (date scale uses inclusive calendar days). */
export function ganttDurationMinutes(start: string, end: string, scale: TimeScale): number {
  const s = parseTimeValue(start, scale)
  const e = parseTimeValue(end, scale)
  if (scale === 'date') return (e - s + 1) * 1440
  return e - s
}

/** Format duration consistently across bars, tooltips, and headers (`30m`, `1h 15m`, `3d`). */
export function formatCompactDuration(minutes: number, scale: TimeScale, dayLabel: (days: number) => string): string {
  if (scale === 'date') return dayLabel(Math.max(1, Math.round(minutes / 1440)))
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Generate clean, non-colliding axis ticks and optional day columns. */
export function generateAxisTicks(axis: GenuiScheduleRange, scale: TimeScale): {
  ticks: AxisTick[]
  dayColumns?: AxisDayColumn[]
} {
  const { start, end, span } = rangeBounds(axis, scale)
  const at = (v: number): number => (span <= 0 ? 0 : (v - start) / span * 100)

  if (scale === 'date') {
    if (span <= 8) {
      const ticks: AxisTick[] = []
      const dayColumns: AxisDayColumn[] = []
      for (let i = 0; i <= span; i++) {
        ticks.push({ value: start + i, pos: at(start + i), label: '' })
      }
      for (let i = 0; i < span; i++) {
        const day = start + i
        const dow = new Date(day * MS_PER_DAY).getUTCDay()
        dayColumns.push({
          pos: (i + 0.5) / span * 100,
          width: 100 / span,
          label: formatDateTick(day, span),
          weekend: dow === 0 || dow === 6,
        })
      }
      return { ticks, dayColumns }
    }
    const step = [2, 3, 5, 7, 14, 30, 60].find(days => span / days <= 6) ?? 60
    const values = [start]
    for (let v = start + step; v <= end - step * 0.45; v += step) values.push(v)
    values.push(end)
    const ticks = values.map((v, i) => ({
      value: v,
      pos: at(v),
      label: formatDateTick(i === values.length - 1 ? v - 1 : v, span),
    }))
    return { ticks }
  }

  const candidates = scale === 'clock'
    ? [5, 10, 15, 30, 60, 120, 180, 240, 360]
    : [30, 60, 120, 180, 240, 360, 720, 1440, 2880]
  const step = candidates.find(s => span / s <= 6) ?? candidates[candidates.length - 1]!
  const values = [start]
  for (let v = Math.ceil((start + step * 0.45) / step) * step; v <= end - step * 0.45; v += step) {
    values.push(v)
  }
  values.push(end)
  const ticks: AxisTick[] = values.map((v, i) => ({
    value: v,
    pos: at(v),
    label: formatTimeTick(v, scale, span, i === 0 ? undefined : values[i - 1]),
  }))
  return { ticks }
}

function inAxisScale(event: GenuiScheduleRange, axis: GenuiScheduleRange, scale: TimeScale): boolean {
  return parseTimeValue(event.start, scale) >= parseTimeValue(axis.start, scale)
    && parseTimeValue(event.end, scale) <= parseTimeValue(axis.end, scale)
}

function repairRange(value: unknown): GenuiScheduleRange | undefined {
  const range = obj(value)
  return isClockRange(range) ? { start: range.start, end: range.end } : undefined
}

function repairScaledRange(value: unknown): { range: GenuiScheduleRange; scale: TimeScale } | undefined {
  const range = obj(value)
  if (range === undefined) return undefined
  const scale = detectTimeScale(range.start)
  if (scale === undefined || typeof range.start !== 'string' || typeof range.end !== 'string') return undefined
  if (!isValidRangeForScale(range.start, range.end, scale, false)) return undefined
  return { range: { start: range.start, end: range.end }, scale }
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function trimmed(value: string, cap: number = GENUI_LIMITS.maxString): string {
  return value.trim().slice(0, cap).trimEnd()
}

function repairEvent(value: unknown, axis: GenuiScheduleRange): GenuiScheduleEvent[] {
  const v = obj(value)
  if (!isClockRange(v) || v.start < axis.start || v.end > axis.end || !nonBlank(v.label)) return []
  return [{
    label: trimmed(v.label), start: v.start, end: v.end,
    ...opt('hint', str(v.hint, GENUI_LIMITS.maxString)),
    ...opt('tone', enu(v.tone, BLOCK_CELL_TONES)),
    ...opt('color', color(v.color)),
    ...opt('action', nonBlank(v.action) ? trimmed(v.action, 200) : undefined),
  }]
}

function repairGanttEvent(value: unknown, axis: GenuiScheduleRange, scale: TimeScale): GenuiGanttEvent[] {
  const v = obj(value)
  if (v === undefined || !nonBlank(v.label)) return []
  if (detectTimeScale(v.start) !== scale || typeof v.start !== 'string') return []
  const milestone = v.milestone === true
  const rawEnd = typeof v.end === 'string' ? v.end : (milestone ? v.start : undefined)
  if (rawEnd === undefined || !isValidRangeForScale(v.start, rawEnd, scale, milestone)) return []
  if (!inAxisScale({ start: v.start, end: rawEnd }, axis, scale)) return []
  const rawProgress = num(v.progress, 0, 100)
  const progress = rawProgress === undefined ? undefined : Math.round(rawProgress * 10) / 10
  return [{
    label: trimmed(v.label),
    start: v.start,
    end: rawEnd,
    ...opt('hint', str(v.hint, GENUI_LIMITS.maxString)),
    ...opt('tone', enu(v.tone, BLOCK_CELL_TONES)),
    ...opt('color', color(v.color)),
    ...opt('action', nonBlank(v.action) ? trimmed(v.action, 200) : undefined),
    ...opt('progress', progress),
    ...(milestone ? { milestone: true } : {}),
  }]
}

function collectRootGanttItems(rows: readonly unknown[]): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = []
  for (const entry of rows.slice(0, GENUI_LIMITS.maxScheduleRows)) {
    const row = obj(entry)
    if (row === undefined) continue
    if (row.group === undefined && row.items === undefined) {
      items.push(row)
    } else if (row.axis === undefined && Array.isArray(row.items)) {
      for (const child of row.items.slice(0, GENUI_LIMITS.maxScheduleItemsPerGroup)) {
        const item = obj(child)
        if (item !== undefined) items.push(item)
      }
    }
  }
  return items
}

export function inferGanttAxis(rows: readonly unknown[]): { range: GenuiScheduleRange; scale: TimeScale } | undefined {
  const items = collectRootGanttItems(rows)
  let scale: TimeScale | undefined
  for (const item of items) {
    scale = detectTimeScale(item.start)
    if (scale !== undefined) break
  }
  if (scale === undefined) return undefined

  let minS = Number.POSITIVE_INFINITY
  let maxE = Number.NEGATIVE_INFINITY
  for (const item of items) {
    if (!nonBlank(item.label) || detectTimeScale(item.start) !== scale || typeof item.start !== 'string') continue
    const milestone = item.milestone === true
    const end = typeof item.end === 'string' ? item.end : (milestone ? item.start : undefined)
    if (end === undefined || !isValidRangeForScale(item.start, end, scale, milestone)) continue
    minS = Math.min(minS, parseTimeValue(item.start, scale))
    maxE = Math.max(maxE, parseTimeValue(end, scale))
  }
  if (!Number.isFinite(minS) || !Number.isFinite(maxE)) return undefined

  if (scale === 'clock') {
    if (minS === maxE) {
      let s = Math.max(0, Math.floor((minS - 60) / 60) * 60)
      let e = Math.min(1440, Math.ceil((maxE + 60) / 60) * 60)
      if (s >= e) { s = 0; e = 1440 }
      return { range: { start: formatTimeValue(s, 'clock'), end: formatTimeValue(e, 'clock') }, scale }
    }
    const step = (maxE - minS) <= 120 ? 30 : 60
    const s = Math.floor(minS / step) * step
    const e = Math.min(1440, Math.ceil(maxE / step) * step)
    return { range: { start: formatTimeValue(s, 'clock'), end: formatTimeValue(e, 'clock') }, scale }
  }
  if (scale === 'datetime') {
    const s = minS === maxE ? Math.floor((minS - 60) / 60) * 60 : Math.floor(minS / 60) * 60
    const e = minS === maxE ? Math.ceil((maxE + 60) / 60) * 60 : Math.ceil(maxE / 60) * 60
    return { range: { start: formatTimeValue(s, 'datetime'), end: formatTimeValue(e, 'datetime') }, scale }
  }
  return { range: { start: formatTimeValue(minS, 'date'), end: formatTimeValue(maxE, 'date') }, scale }
}

function repairNow(value: unknown, axis: GenuiScheduleRange, scale: TimeScale): string | undefined {
  if (typeof value !== 'string' || detectTimeScale(value) !== scale) return undefined
  const v = parseTimeValue(value, scale)
  const s = parseTimeValue(axis.start, scale)
  const e = parseTimeValue(axis.end, scale)
  return v >= s && v <= e ? value : undefined
}

export function repairSchedule(value: Record<string, unknown>): GenuiSchedule | GenuiGantt | null {
  if (!Array.isArray(value.rows)) return null
  const gantt = value.type === 'gantt'
  const title = opt('title', nonBlank(value.title) ? trimmed(value.title) : undefined)

  if (!gantt) {
    const axis = repairRange(value.axis)
    if (axis === undefined) return null
    const rows = value.rows.slice(0, GENUI_LIMITS.maxScheduleRows).flatMap((entry): GenuiScheduleRow[] => {
      const row = obj(entry)
      if (row === undefined) return []
      if (row.group === undefined && row.items === undefined) return repairEvent(row, axis)
      if (!nonBlank(row.group) || !Array.isArray(row.items)) return []
      return [{
        group: trimmed(row.group),
        items: row.items.slice(0, GENUI_LIMITS.maxScheduleItemsPerGroup).flatMap(item => repairEvent(item, axis)),
      }]
    })
    return {
      type: 'schedule', axis, rows, ...title,
      ...opt('view', enu(value.view, SCHEDULE_VIEWS)),
    }
  }

  let rootAxis = value.axis !== undefined ? repairScaledRange(value.axis) : inferGanttAxis(value.rows)
  if (value.axis !== undefined && rootAxis === undefined) return null
  if (rootAxis === undefined) {
    const hasCustomAxisGroup = value.rows.some(entry => {
      const row = obj(entry)
      return row !== undefined && nonBlank(row.group) && Array.isArray(row.items) && repairScaledRange(row.axis) !== undefined
    })
    if (!hasCustomAxisGroup && value.rows.length > 0) return null
    rootAxis = { range: { start: '00:00', end: '24:00' }, scale: 'clock' }
  }

  const rows = value.rows.slice(0, GENUI_LIMITS.maxScheduleRows).flatMap((entry): GenuiGanttRow[] => {
    const row = obj(entry)
    if (row === undefined) return []
    if (row.group === undefined && row.items === undefined) {
      return repairGanttEvent(row, rootAxis.range, rootAxis.scale)
    }
    if (!nonBlank(row.group) || !Array.isArray(row.items)) return []
    const groupAxis = row.axis !== undefined ? repairScaledRange(row.axis) : undefined
    if (row.axis !== undefined && groupAxis === undefined) return []
    const effective = groupAxis ?? rootAxis
    const groupNow = groupAxis !== undefined ? repairNow(row.now, effective.range, effective.scale) : undefined
    const groupNowLabel = groupNow !== undefined && nonBlank(row.nowLabel) ? trimmed(row.nowLabel, 40) : undefined
    return [{
      group: trimmed(row.group),
      items: row.items.slice(0, GENUI_LIMITS.maxScheduleItemsPerGroup).flatMap(item =>
        repairGanttEvent(item, effective.range, effective.scale),
      ),
      ...opt('axis', groupAxis?.range),
      ...opt('now', groupNow),
      ...opt('nowLabel', groupNowLabel),
    }]
  })

  const rootNow = repairNow(value.now, rootAxis.range, rootAxis.scale)
  const rootNowLabel = rootNow !== undefined && nonBlank(value.nowLabel) ? trimmed(value.nowLabel, 40) : undefined
  return {
    type: 'gantt',
    ...(value.axis !== undefined ? { axis: rootAxis.range } : {}),
    ...opt('now', rootNow),
    ...opt('nowLabel', rootNowLabel),
    rows,
    ...title,
  }
}

function validateClockRange(value: Record<string, unknown>, at: string, errors: string[]): void {
  if (!isClockTime(value.start) || value.start === '24:00') errors.push(`${at}.start must be a 24-hour clock time (HH:mm)`)
  if (!isClockTime(value.end)) errors.push(`${at}.end must be a 24-hour clock time (HH:mm or 24:00)`)
  if (isClockTime(value.start) && isClockTime(value.end) && value.end <= value.start) {
    errors.push(`${at}.end must be after start on the same day`)
  }
}

function validateScaledRange(value: Record<string, unknown>, at: string, errors: string[]): { range: GenuiScheduleRange; scale: TimeScale } | undefined {
  const startScale = detectTimeScale(value.start)
  const endScale = detectTimeScale(value.end)
  if (startScale === undefined || isStartBound24(String(value.start), startScale)) {
    errors.push(`${at}.start must be HH:mm, YYYY-MM-DD, or YYYY-MM-DD HH:mm`)
    return undefined
  }
  if (endScale === undefined) {
    errors.push(`${at}.end must be HH:mm, YYYY-MM-DD, or YYYY-MM-DD HH:mm`)
    return undefined
  }
  if (startScale !== endScale) {
    errors.push(`${at}.start and ${at}.end must use the same time format`)
    return undefined
  }
  if (!isValidRangeForScale(value.start as string, value.end as string, startScale, false)) {
    errors.push(`${at}.end must be after start`)
    return undefined
  }
  return { range: { start: value.start as string, end: value.end as string }, scale: startScale }
}

function validateEvent(value: unknown, axis: GenuiScheduleRange | undefined, at: string, errors: string[]): void {
  const v = obj(value)
  if (v === undefined) return
  if (!nonBlank(v.label)) errors.push(`${at}.label must be a non-empty string`)
  validateClockRange(v, at, errors)
  if (axis !== undefined && isClockRange(v) && (v.start < axis.start || v.end > axis.end)) {
    errors.push(`${at} must fit within axis.start and axis.end`)
  }
  if (v.color !== undefined && color(v.color) === undefined) errors.push(`${at}.color must be a literal colour or host token`)
  if (v.action !== undefined && !nonBlank(v.action)) errors.push(`${at}.action must be a non-empty string`)
}

function validateGanttEvent(
  value: unknown,
  axis: { range: GenuiScheduleRange; scale: TimeScale } | undefined,
  at: string,
  errors: string[],
): void {
  const v = obj(value)
  if (v === undefined) return
  if (!nonBlank(v.label)) errors.push(`${at}.label must be a non-empty string`)
  const milestone = v.milestone === true
  if (v.milestone !== undefined && typeof v.milestone !== 'boolean') {
    errors.push(`${at}.milestone must be a boolean`)
  }
  const startScale = detectTimeScale(v.start)
  if (startScale === undefined || isStartBound24(String(v.start), startScale)) {
    errors.push(`${at}.start must be HH:mm, YYYY-MM-DD, or YYYY-MM-DD HH:mm`)
  }
  const rawEnd = v.end === undefined && milestone ? v.start : v.end
  const endScale = detectTimeScale(rawEnd)
  if (rawEnd === undefined || endScale === undefined) {
    errors.push(`${at}.end must be HH:mm, YYYY-MM-DD, or YYYY-MM-DD HH:mm`)
  } else if (startScale !== undefined && startScale !== endScale) {
    errors.push(`${at}.start and ${at}.end must use the same time format`)
  } else if (startScale !== undefined && !isValidRangeForScale(v.start as string, rawEnd as string, startScale, milestone)) {
    errors.push(`${at}.end must be after start`)
  } else if (axis !== undefined && startScale !== undefined) {
    if (startScale !== axis.scale) {
      errors.push(`${at} must match axis time format`)
    } else if (!inAxisScale({ start: v.start as string, end: rawEnd as string }, axis.range, axis.scale)) {
      errors.push(`${at} must fit within axis.start and axis.end`)
    }
  }
  if (v.progress !== undefined && (typeof v.progress !== 'number' || !Number.isFinite(v.progress) || v.progress < 0 || v.progress > 100)) {
    errors.push(`${at}.progress must be a number between 0 and 100`)
  }
  if (v.color !== undefined && color(v.color) === undefined) errors.push(`${at}.color must be a literal colour or host token`)
  if (v.action !== undefined && !nonBlank(v.action)) errors.push(`${at}.action must be a non-empty string`)
}

function validateNowField(
  now: unknown,
  axis: { range: GenuiScheduleRange; scale: TimeScale } | undefined,
  at: string,
  errors: string[],
): void {
  if (now === undefined) return
  const scale = detectTimeScale(now)
  if (scale === undefined) {
    errors.push(`${at}.now must be HH:mm, YYYY-MM-DD, or YYYY-MM-DD HH:mm`)
    return
  }
  if (axis !== undefined) {
    if (scale !== axis.scale) {
      errors.push(`${at}.now must match axis time format`)
    } else if (repairNow(now, axis.range, axis.scale) === undefined) {
      errors.push(`${at}.now must fit within axis.start and axis.end`)
    }
  }
}

/** Validate time semantics in addition to the registry's field checks. */
export function validateSchedule(value: Record<string, unknown>, at: string, errors: string[]): void {
  const gantt = value.type === 'gantt'
  const axisObj = obj(value.axis)

  if (!gantt) {
    if (axisObj !== undefined) validateClockRange(axisObj, `${at}.axis`, errors)
    const range = isClockRange(axisObj) ? axisObj : undefined
    if (!Array.isArray(value.rows)) return
    value.rows.forEach((entry, index) => {
      const row = obj(entry)
      if (row === undefined) return
      const path = `${at}.rows[${index}]`
      if (row.group === undefined && row.items === undefined) {
        validateEvent(row, range, path, errors)
        return
      }
      if (!nonBlank(row.group)) errors.push(`${path}.group must be a non-empty string`)
      if (!Array.isArray(row.items)) {
        errors.push(`${path}.items must be an array of schedule events`)
        return
      }
      row.items.forEach((event, i) => validateEvent(event, range, `${path}.items[${i}]`, errors))
    })
    return
  }

  let rootAxis: { range: GenuiScheduleRange; scale: TimeScale } | undefined
  if (axisObj !== undefined) {
    rootAxis = validateScaledRange(axisObj, `${at}.axis`, errors)
  } else if (Array.isArray(value.rows)) {
    rootAxis = inferGanttAxis(value.rows)
  }
  validateNowField(value.now, rootAxis, at, errors)

  if (!Array.isArray(value.rows)) return
  value.rows.forEach((entry, index) => {
    const row = obj(entry)
    if (row === undefined) return
    const path = `${at}.rows[${index}]`
    const hasGroupAxis = row.axis !== undefined
    if (row.group === undefined && row.items === undefined) {
      if (hasGroupAxis) errors.push(`${path}.axis belongs on a gantt group`)
      validateGanttEvent(row, rootAxis, path, errors)
      return
    }
    if (!nonBlank(row.group)) errors.push(`${path}.group must be a non-empty string`)
    if (!Array.isArray(row.items)) {
      errors.push(`${path}.items must be an array of schedule events`)
      return
    }
    const groupAxisObj = hasGroupAxis ? obj(row.axis) : undefined
    const groupAxis = groupAxisObj !== undefined ? validateScaledRange(groupAxisObj, `${path}.axis`, errors) : rootAxis
    if (row.now !== undefined && !hasGroupAxis) {
      errors.push(`${path}.now requires a group axis`)
    } else {
      validateNowField(row.now, groupAxis, path, errors)
    }
    row.items.forEach((event, i) => validateGanttEvent(event, groupAxis, `${path}.items[${i}]`, errors))
  })
}
