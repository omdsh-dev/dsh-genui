// @vitest-environment jsdom
// Achievements (0.9.5): rules, dedupe, persistence and the spec builder.
import { beforeEach, describe, expect, it } from 'vitest'
import { ACHIEVEMENTS, buildAchievementsSpec, checkAchievements, countSpecKinds, emptyState } from '../src/client/achievements.ts'
import { getAchievementSnapshot, recordFence, recordInteraction, recordPanel, recordTemplateUse, subscribeAchievements } from '../src/client/achievement-store.ts'
import { validateGenuiSpec } from '../src/client/guard.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

const SAMPLE: GenuiSpec = {
  title: '测试',
  items: [
    { type: 'text', content: 'hi' },
    { type: 'chart', data: [{ label: 'a', value: 1 }] },
    { type: 'scene3d', meshes: [{ shape: 'box', size: 1 }] },
  ],
}

beforeEach(() => {
  localStorage.clear()
})

describe('成就规则', () => {
  it('12 个成就且 id 唯一', () => {
    const ids = new Set(ACHIEVEMENTS.map(a => a.id))
    expect(ids.size).toBe(ACHIEVEMENTS.length)
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(10)
  })

  it('累计到阈值才解锁', () => {
    expect(checkAchievements(emptyState(), {})).toEqual([])
    const s1 = { ...emptyState(), fences: 1 }
    expect(checkAchievements(s1, {}).map(a => a.id)).toContain('first-fence')
    const s50 = { ...emptyState(), fences: 50 }
    const unlocks = checkAchievements(s50, {})
    expect(unlocks.map(a => a.id)).toContain('fence-50')
  })

  it('已解锁不重复出现', () => {
    const s1 = { ...emptyState(), fences: 5 }
    const once = checkAchievements(s1, { 'first-fence': 1, 'fence-5': 1 })
    expect(once.map(a => a.id)).toEqual([])
  })
})

describe('埋点与持久化', () => {
  it('recordFence 按指纹去重（同内容只计一次）', () => {
    recordFence(SAMPLE)
    recordFence(SAMPLE)
    expect(getAchievementSnapshot().state.fences).toBe(1)
    // 不同内容再计
    recordFence({ title: 'b', items: [{ type: 'text', content: 'x' }] })
    expect(getAchievementSnapshot().state.fences).toBe(2)
  })

  it('图表/高级节点计数（增量断言，避免跨用例状态）', () => {
    const before = getAchievementSnapshot().state
    recordFence({ title: 'chart-test', items: [
      { type: 'chart', data: [{ label: 'a', value: 1 }] },
      { type: 'scene3d', meshes: [{ shape: 'box', size: 1 }] },
    ] })
    const s = getAchievementSnapshot().state
    expect(s.charts - before.charts).toBe(1)
    expect(s.advanced - before.advanced).toBe(1)
  })

  it('持久化：load 后保留', () => {
    recordFence(SAMPLE)
    const saved = localStorage.getItem('dsh.genui.achievements')
    expect(saved).toBeTruthy()
  })

  it('交互/面板/模板埋点', () => {
    recordInteraction()
    recordPanel()
    recordTemplateUse()
    expect(getAchievementSnapshot().state.interactions).toBe(1)
    expect(getAchievementSnapshot().state.panels).toBe(1)
    expect(getAchievementSnapshot().state.templates).toBe(1)
  })

  it('解锁进队列并通知订阅者', () => {
    let notified = 0
    const off = subscribeAchievements(() => { notified += 1 })
    recordFence(SAMPLE)
    expect(notified).toBeGreaterThan(0)
    const snapshot = getAchievementSnapshot()
    expect(Object.keys(snapshot.unlocked)).toContain('first-fence')
    off()
  })
})

describe('成就页 spec', () => {
  it('生成的 spec 通过渲染器守卫', () => {
    const spec = buildAchievementsSpec({ ...emptyState(), fences: 5, charts: 2 }, { 'first-fence': 1 })
    const v = validateGenuiSpec(spec)
    expect(v.ok, v.errors.join('; ')).toBe(true)
  })
})
