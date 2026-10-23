// @vitest-environment jsdom
/**
 * i18n contract: dictionary completeness, locale resolution, the `t()` lookup
 * chain, and the fact that real UI surfaces actually render in the active
 * language (and re-render when it switches).
 *
 * The rest of the suite runs pinned to `zh` (see tests/setup.ts), which keeps
 * the pre-extraction Chinese wording under test. This file owns English and
 * the switching behaviour, and restores `zh` afterwards so suite order can
 * never leak a locale.
 */
import { cleanup, act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EN } from '../src/client/i18n/en.ts'
import { ZH } from '../src/client/i18n/zh.ts'
import {
  detectLocale,
  FALLBACK_LOCALE,
  getLocale,
  LOCALE_IDS,
  normalizeLocale,
  setLocale,
  t,
} from '../src/client/i18n/index.ts'
import { genuiTemplates, TEMPLATE_CATEGORIES } from '../src/client/templates.ts'
import { defaultPanelSpec } from '../src/client/panel-command.ts'
import { ACHIEVEMENTS, buildAchievementsSpec, emptyState } from '../src/client/achievements.ts'
import { TemplateDrawer } from '../src/client/TemplateDrawer.tsx'
import { validateGenuiSpec } from '../src/client/guard.ts'

afterEach(() => {
  cleanup()
  // Restore the suite-wide pin so test order cannot leak a locale.
  setLocale('zh')
})

describe('dictionary completeness', () => {
  it('zh covers exactly the English key set', () => {
    const en = Object.keys(EN).sort()
    const zh = Object.keys(ZH).sort()
    expect(zh).toEqual(en)
  })

  it('no dictionary entry is empty', () => {
    for (const id of LOCALE_IDS) {
      const dict = id === 'en' ? EN : ZH
      for (const [key, value] of Object.entries(dict)) {
        expect(String(value).trim(), `${id}:${key} is empty`).not.toBe('')
      }
    }
  })

  it('placeholders match between the two dictionaries', () => {
    const placeholders = (s: string): string[] => (s.match(/\{(\w+)\}/g) ?? []).sort()
    for (const key of Object.keys(EN) as Array<keyof typeof EN>) {
      expect(placeholders(ZH[key]), `placeholder mismatch on ${key}`)
        .toEqual(placeholders(EN[key]))
    }
  })

  it('every achievement id has a name and description in both languages', () => {
    for (const a of ACHIEVEMENTS) {
      for (const suffix of ['name', 'desc'] as const) {
        const key = `ach.${a.id}.${suffix}` as keyof typeof EN
        expect(EN[key], `missing en ${key}`).toBeTruthy()
        expect(ZH[key], `missing zh ${key}`).toBeTruthy()
      }
    }
  })

  it('every template category has a label in both languages', () => {
    for (const c of [...TEMPLATE_CATEGORIES, 'all']) {
      const key = `tpl.category.${c}` as keyof typeof EN
      expect(EN[key], `missing en ${key}`).toBeTruthy()
      expect(ZH[key], `missing zh ${key}`).toBeTruthy()
    }
  })
})

describe('locale resolution', () => {
  it('normalizes region and script subtags onto a shipped locale', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh')
    expect(normalizeLocale('zh-Hant-TW')).toBe('zh')
    expect(normalizeLocale('en-GB')).toBe('en')
    expect(normalizeLocale('EN_us')).toBe('en')
  })

  it('rejects unshipped or malformed tags', () => {
    expect(normalizeLocale('fr')).toBeUndefined()
    expect(normalizeLocale('')).toBeUndefined()
    expect(normalizeLocale(undefined)).toBeUndefined()
    expect(normalizeLocale(null)).toBeUndefined()
  })

  it('falls back to English when the browser names no shipped language', () => {
    expect(FALLBACK_LOCALE).toBe('en')
    // jsdom's navigator reports en-US.
    expect(detectLocale()).toBe('en')
  })

  it('ignores an unknown tag instead of blanking the UI', () => {
    setLocale('zh')
    setLocale('fr')
    expect(getLocale()).toBe('zh')
  })
})

describe('action prompt', () => {
  // The relay prompt becomes a visible user message, so it must follow the
  // interface language instead of always shipping Chinese.
  it('is written in the active locale and keeps the wire marker', () => {
    setLocale('en')
    const english = t('action.inline', { action: 'ping', payload: '' })
    expect(english).toMatch(/^\[genui-action\] ping\. /)
    expect(english).not.toMatch(/[\u4e00-\u9fff]/)
    expect(t('action.payload', { json: '{"a":1}' })).not.toMatch(/[\u4e00-\u9fff]/)

    setLocale('zh')
    expect(t('action.inline', { action: 'ping', payload: '' }))
      .toMatch(/^\[genui-action\] ping。/)
  })
})

describe('t() lookup chain', () => {
  it('returns the active language', () => {
    setLocale('en')
    expect(t('panel.badge')).toBe('Panel')
    setLocale('zh')
    expect(t('panel.badge')).toBe('面板')
  })

  it('interpolates named params', () => {
    setLocale('en')
    expect(t('label.diffFiles', { count: 3 })).toBe('3 files')
    expect(t('ach.toast.unlocked', { name: 'First contact' }))
      .toBe('Trophy unlocked: First contact')
  })

  it('keeps a placeholder whose param is missing', () => {
    setLocale('en')
    expect(t('label.diffFiles')).toBe('{count} files')
  })

  it('returns the key itself for an unknown key (diagnosable, not blank)', () => {
    expect(t('does.not.exist')).toBe('does.not.exist')
  })
})

describe('content builders follow the active locale', () => {
  it('templates render in English and in Chinese', () => {
    setLocale('en')
    const en = genuiTemplates()
    expect(en[0]!.name).toBe('Project dashboard')
    setLocale('zh')
    const zh = genuiTemplates()
    expect(zh[0]!.name).toBe('项目仪表盘')
    // Same ids and categories either way — only the display text changes.
    expect(en.map(x => x.id)).toEqual(zh.map(x => x.id))
    expect(en.map(x => x.category)).toEqual(zh.map(x => x.category))
  })

  it('every template demo stays valid in English', () => {
    setLocale('en')
    for (const tpl of genuiTemplates()) {
      const v = validateGenuiSpec(tpl.demo)
      expect(v.ok, `${tpl.id}: ${v.ok ? '' : v.errors.join('; ')}`).toBe(true)
    }
  })

  it('the default panel spec follows the locale and stays valid', () => {
    setLocale('en')
    const en = defaultPanelSpec()
    expect(en.title).toBe('GenUI panel')
    expect(validateGenuiSpec(en).ok).toBe(true)
    setLocale('zh')
    expect(defaultPanelSpec().title).toBe('GenUI 面板')
  })

  it('the trophy page follows the locale', () => {
    setLocale('en')
    expect(buildAchievementsSpec(emptyState(), {}).title).toBe('GenUI exploration trophies')
    setLocale('zh')
    expect(buildAchievementsSpec(emptyState(), {}).title).toBe('GenUI 探索成就')
  })

  it('achievement name/description are read at access time, not frozen', () => {
    const first = ACHIEVEMENTS[0]!
    setLocale('en')
    expect(first.name).toBe('First contact')
    setLocale('zh')
    expect(first.name).toBe('初次相见')
  })
})

describe('live components', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders the template drawer in English', () => {
    setLocale('en')
    render(<TemplateDrawer tab="templates" onUse={() => {}} />)
    expect(screen.getByRole('tab', { name: 'All' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toBeTruthy()
    expect(screen.getByText('Project dashboard')).toBeTruthy()
  })

  it('re-renders in place when the locale switches', () => {
    setLocale('en')
    render(<TemplateDrawer tab="templates" onUse={() => {}} />)
    expect(screen.getByText('Project dashboard')).toBeTruthy()

    act(() => {
      setLocale('zh')
    })

    expect(screen.getByText('项目仪表盘')).toBeTruthy()
    expect(screen.queryByText('Project dashboard')).toBeNull()
  })
})
