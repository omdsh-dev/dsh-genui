import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { GENUI_LIMITS } from '../src/client/genui-runtime/limits.ts'
import { processGenuiSpec, repairGenuiSpec } from '../src/client/guard.ts'
import { t } from '../src/client/i18n/index.ts'
import type { GenuiGantt, GenuiSchedule } from '../src/client/spec.ts'

afterEach(cleanup)

const schedule: GenuiSchedule = {
  type: 'schedule',
  title: 'Class timetable',
  axis: { start: '08:00', end: '12:00' },
  rows: [
    { group: 'Monday', items: [
      { label: 'Lab', start: '09:00', end: '10:00', hint: 'Room 204', action: 'open_lab', color: '#fb923c' },
      { label: 'Studio', start: '08:30', end: '10:30', tone: 'accent' },
      { label: 'Workshop', start: '10:30', end: '11:30', tone: 'success' },
    ] },
    { group: 'Tuesday', items: [] },
    { label: 'Review', start: '08:00', end: '08:30' },
  ],
}

function eventButton(name: RegExp): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name })
}

describe('schedule', () => {
  it('accepts grouped dates, an empty day and single events as a bare node', () => {
    const result = processGenuiSpec(schedule)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.spec?.items).toContainEqual(schedule)
  })

  it('allows the day boundary only as an end time', () => {
    const overnightPart = {
      type: 'schedule',
      axis: { start: '00:00', end: '24:00' },
      rows: [{ label: 'Late shift', start: '23:45', end: '24:00' }],
    }
    expect(processGenuiSpec(overnightPart).errors).toEqual([])
    const errors = processGenuiSpec({
      ...overnightPart, rows: [{ label: 'Invalid shift', start: '24:00', end: '24:00' }],
    }).errors
    expect(errors).toContainEqual(expect.stringContaining('.rows[0].start must be a 24-hour clock time'))
  })

  it('diagnoses malformed times and out-of-axis events without changing surviving durations', () => {
    const invalid = {
      ...schedule,
      rows: [{ group: 'Monday', items: [
        { label: 'Lab', start: '09:00', end: '10:00' },
        { label: 'Malformed', start: '08:60', end: '10:00' },
        { label: 'Reversed', start: '10:00', end: '09:00' },
        { label: 'Outside', start: '11:00', end: '12:15' },
      ] }],
    }
    const result = processGenuiSpec(invalid)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('.rows[0].items[1].start must be a 24-hour clock time'),
      expect.stringContaining('.rows[0].items[2].end must be after start'),
      expect.stringContaining('.rows[0].items[3] must fit within axis.start and axis.end'),
    ]))
    expect(repairGenuiSpec(invalid)?.items).toContainEqual({
      ...schedule, rows: [{ group: 'Monday', items: [{ label: 'Lab', start: '09:00', end: '10:00' }] }],
    })
    expect(repairGenuiSpec({ ...schedule, axis: { start: '12:00', end: '12:00' } })?.items).toEqual([])
  })

  it.each(['week', 'timeline'] as const)('positions events from the same time data in %s view', view => {
    const { container } = render(<GenuiBlock spec={{ items: [{ ...schedule, view }] }} />)
    expect(container.querySelector('[data-genui-schedule]')?.getAttribute('data-view')).toBe(view)
    const studio = eventButton(/^Studio/).style
    const lab = eventButton(/^Lab/).style
    const workshop = eventButton(/^Workshop/).style
    expect(studio.getPropertyValue('--start')).toBe('12.5%')
    expect(studio.getPropertyValue('--length')).toBe('50%')
    expect(lab.getPropertyValue('--start')).toBe('25%')
    expect(lab.getPropertyValue('--length')).toBe('25%')
    expect(studio.getPropertyValue('--track')).toBe('0')
    expect(lab.getPropertyValue('--track')).toBe('1')
    expect(workshop.getPropertyValue('--track-width')).toBe('100%')
    expect(screen.getByText('Tuesday')).toBeTruthy()
  })

  it('sends an action with the clicked event while local details stay local', async () => {
    const onAction = vi.fn()
    render(<GenuiActionContext.Provider value={onAction}>
      <GenuiBlock spec={{ items: [schedule] }} />
    </GenuiActionContext.Provider>)

    fireEvent.click(eventButton(/^Studio/))
    expect((await screen.findByRole('tooltip')).textContent).toContain('08:30–10:30')
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(eventButton(/^Lab/))
    expect(onAction).toHaveBeenCalledExactlyOnceWith('open_lab', {
      type: 'schedule', label: 'Lab', group: 'Monday', start: '09:00', end: '10:00',
    })
  })
})

const gantt: GenuiGantt = {
  type: 'gantt',
  axis: { start: '08:00', end: '20:00' },
  rows: [
    { label: '铺相机', start: '15:00', end: '16:30', color: '#fb923c', hint: '10 关' },
    { label: '跑图验证', start: '16:40', end: '17:40', hint: '两组' },
    { group: '周一', items: [{ label: 'AI 问题清单', start: '10:00', end: '11:00' }] },
  ],
}

describe('gantt', () => {
  it('accepts the issue #472 spec as a standalone component with no field diagnostics', () => {
    const result = processGenuiSpec(gantt)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.spec?.items).toContainEqual(gantt)
  })

  it('renders proportional bars, consistent h/m durations, tooltip time ranges, and action payloads', async () => {
    const tuesday = {
      group: '周二',
      axis: { start: '22:00', end: '24:00' },
      items: [
        { label: '夜间回归', start: '22:30', end: '24:00', hint: '完整跑一轮', action: 'open_nightly' },
        { label: '准备报告', start: '23:00', end: '23:30' },
      ],
    }
    const result = processGenuiSpec({ ...gantt, rows: [...gantt.rows, tuesday] })
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(repairGenuiSpec(result.spec)).toEqual(result.spec)
    const badGroup = { ...tuesday, axis: { start: '23:00', end: '24:00' } }
    expect(processGenuiSpec({ ...gantt, rows: [badGroup] }).errors).toContainEqual(
      expect.stringContaining('.rows[0].items[0] must fit within axis.start and axis.end'),
    )

    const onAction = vi.fn()
    render(<GenuiActionContext.Provider value={onAction}><GenuiBlock spec={result.spec!} /></GenuiActionContext.Provider>)
    const mondayGroup = screen.getByRole('group', { name: '周一' })
    // 1-item expanded group omits redundant summary bracket; collapses show it
    expect(mondayGroup.querySelector('[class*="summaryBracket"]')).toBeNull()
    const mondayToggle = within(mondayGroup).getByRole('button', { name: t('block.gantt.toggleGroup', { group: '周一' }) })
    fireEvent.click(mondayToggle)
    expect(mondayGroup.querySelector('[class*="summaryBracket"]')).not.toBeNull()
    fireEvent.click(mondayToggle)

    const weekday = within(screen.getByRole('group', { name: '周二' }))
    const overnight = weekday.getByRole<HTMLButtonElement>('button', { name: /^夜间回归/ })
    const report = weekday.getByRole<HTMLButtonElement>('button', { name: /^准备报告/ })
    const reportTrack = report.closest('[data-genui-schedule-track]')
    expect(overnight.closest('[data-genui-schedule-track]')).not.toBe(reportTrack)
    // Exact compact range appears in the left task cell, not duplicated on the track
    expect(weekday.getByText('23:00–23:30')).toBeTruthy()
    expect(reportTrack?.contains(weekday.getByText('23:00–23:30'))).toBe(false)
    expect(report.getAttribute('aria-label')).toContain('23:00–23:30')
    expect(report.getAttribute('aria-label')).toContain(t('block.gantt.duration', { minutes: 30 }))
    expect(parseFloat(eventButton(/^铺相机/).style.getPropertyValue('--length'))).toBeCloseTo(12.5)
    expect(overnight.style.getPropertyValue('--start')).toBe('25%')
    expect(overnight.style.getPropertyValue('--length')).toBe('75%')
    expect(overnight.textContent).toContain('1h 30m')

    // Local bar click shows exact time range in tooltip without firing action
    fireEvent.click(report)
    expect((await screen.findByRole('tooltip')).textContent).toContain('23:00–23:30')
    expect(onAction).not.toHaveBeenCalled()

    // Action bar tooltip carries clickAction hint when hovered, and click sends payload
    fireEvent.mouseEnter(overnight)
    fireEvent.click(overnight)
    expect(onAction).toHaveBeenCalledExactlyOnceWith('open_nightly', {
      type: 'gantt', label: '夜间回归', group: '周二', start: '22:30', end: '24:00',
    })
  })

  it('supports date-scale roadmaps with inclusive day widths, progress, milestones, and summary brackets', () => {
    const roadmap: GenuiGantt = {
      type: 'gantt',
      title: 'Release Roadmap',
      axis: { start: '2026-11-01', end: '2026-11-05' },
      now: '2026-11-03',
      nowLabel: 'Today',
      rows: [
        {
          group: 'Core',
          items: [
            { label: 'API Freeze', start: '2026-11-01', end: '2026-11-02', progress: 100, tone: 'success' },
            { label: 'QA Pass', start: '2026-11-03', end: '2026-11-03', progress: 50, tone: 'accent' },
            { label: 'GA Launch', start: '2026-11-05', end: '2026-11-05', milestone: true, tone: 'warning' },
          ],
        },
      ],
    }
    const result = processGenuiSpec(roadmap)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])

    render(<GenuiBlock spec={result.spec!} />)
    expect(screen.getByText(/Today/)).toBeTruthy()
    const coreGroup = screen.getByRole('group', { name: 'Core' })
    expect(coreGroup.querySelector('[class*="summaryBracket"]')).not.toBeNull()
    const apiBar = eventButton(/^API Freeze/)
    const qaBar = eventButton(/^QA Pass/)
    const launch = eventButton(/^GA Launch/)
    expect(apiBar.style.getPropertyValue('--start')).toBe('0%')
    expect(apiBar.style.getPropertyValue('--length')).toBe('40%')
    expect(apiBar.textContent).toContain('✓')
    expect(qaBar.style.getPropertyValue('--start')).toBe('40%')
    expect(qaBar.style.getPropertyValue('--length')).toBe('20%')
    expect(qaBar.getAttribute('data-partial-progress')).toBe('')
    expect(launch.style.getPropertyValue('--start')).toBe('80%')
    expect(launch.getAttribute('aria-label')).toContain(t('block.gantt.milestone'))

    const toggle = screen.getByRole('button', { name: t('block.gantt.toggleGroup', { group: 'Core' }) })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /^API Freeze/ })).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: /^API Freeze/ })).toBeTruthy()
  })

  it('infers axis, formats datetime durations consistently, and rejects now on shared-axis groups', () => {
    const inferred: GenuiGantt = {
      type: 'gantt',
      rows: [
        { label: 'Deploy Canary', start: '2026-11-28 22:30', end: '2026-11-29 01:30', progress: 40 },
        { label: 'Precheck', start: '2026-11-28 22:00', end: '2026-11-28 23:15' },
        { label: 'Signoff', start: '2026-11-29 02:00', end: '2026-11-29 02:00', milestone: true },
      ],
    }
    const ok = processGenuiSpec(inferred)
    expect(ok.errors).toEqual([])
    render(<GenuiBlock spec={ok.spec!} />)
    const deploy = eventButton(/^Deploy Canary/)
    const precheck = eventButton(/^Precheck/)
    expect(parseFloat(deploy.style.getPropertyValue('--length'))).toBeCloseTo(75)
    expect(deploy.getAttribute('data-progress-inside')).toBe('')
    expect(screen.getByText('22:30–01:30 +1d')).toBeTruthy()
    expect(precheck.textContent).toContain('1h 15m')

    const sharedNowError = processGenuiSpec({
      type: 'gantt',
      axis: { start: '08:00', end: '20:00' },
      rows: [{ group: 'Phase 1', now: '12:00', items: [{ label: 'A', start: '09:00', end: '10:00' }] }],
    })
    expect(sharedNowError.errors).toContainEqual(expect.stringContaining('.rows[0].now requires a group axis'))

    const bareMilestone = {
      type: 'gantt',
      axis: { start: '2026-11-01', end: '2026-11-05' },
      rows: [{ label: 'Kickoff', start: '2026-11-02', milestone: true }],
    }
    expect(processGenuiSpec(bareMilestone).errors).toEqual([])

    const bad = processGenuiSpec({
      type: 'gantt',
      axis: { start: '2026-11-01', end: '2026-11-05' },
      now: '2026-11-10',
      rows: [
        { label: 'Bad date', start: '2026-02-30', end: '2026-03-01' },
        { label: 'Bad progress', start: '2026-11-01', end: '2026-11-02', progress: 150 },
      ],
    })
    expect(bad.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('.now must fit within axis.start and axis.end'),
      expect.stringContaining('.rows[0].start must be HH:mm, YYYY-MM-DD, or YYYY-MM-DD HH:mm'),
      expect.stringContaining('.rows[1].progress must be a number between 0 and 100'),
    ]))
  })

  it('clamps gantt rows to GENUI_LIMITS.maxScheduleRows during repair', () => {
    const many = Array.from({ length: GENUI_LIMITS.maxScheduleRows + 10 }, (_, i) => ({
      label: `Task ${i}`, start: '09:00', end: '10:00',
    }))
    const repaired = repairGenuiSpec({ type: 'gantt', axis: { start: '08:00', end: '18:00' }, rows: many })
    const node = repaired?.items[0] as GenuiGantt
    expect(node.rows).toHaveLength(GENUI_LIMITS.maxScheduleRows)
  })
})
