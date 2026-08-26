/**
 * templates.spec.ts — 模板中心数据契约：
 * 每条模板的 demo 必须通过 validateGenuiSpec（与渲染器同一守卫），
 * 规模在 GENUI_LIMITS 内，instruction 非空且含「dsh-ui」关键词。
 */
import { describe, expect, it } from 'vitest'
import { GENUI_TEMPLATES } from '../src/client/templates.ts'
import { GENUI_LIMITS, validateGenuiSpec, countGenuiNodes } from '../src/client/guard.ts'

describe('模板中心数据契约', () => {
  it('每条 demo 通过渲染器守卫校验', () => {
    const problems: string[] = []
    for (const tpl of GENUI_TEMPLATES) {
      const v = validateGenuiSpec(tpl.demo)
      if (!v.ok) problems.push(`${tpl.id} (${tpl.name}): ${v.errors.join('; ')}`)
    }
    expect(problems).toEqual([])
  })

  it('每条 demo 规模在限制内（≤200 节点、≤8 层）', () => {
    for (const tpl of GENUI_TEMPLATES) {
      const count = countGenuiNodes(tpl.demo)
      expect(count, `${tpl.id}: ${count} 节点`).toBeLessThanOrEqual(GENUI_LIMITS.maxNodes)
    }
  })

  it('id 唯一 + instruction 有效 + name/description 非空', () => {
    const ids = new Set<string>()
    for (const tpl of GENUI_TEMPLATES) {
      expect(ids.has(tpl.id), `重复 id: ${tpl.id}`).toBe(false)
      ids.add(tpl.id)
      expect(tpl.instruction.trim().length).toBeGreaterThan(10)
      expect(tpl.instruction).toContain('dsh-ui')
      expect(tpl.name.trim()).not.toBe('')
      expect(tpl.description.trim().length).toBeGreaterThanOrEqual(10)
    }
    expect(GENUI_TEMPLATES.length).toBeGreaterThanOrEqual(10)
  })

  it('覆盖主要类别', () => {
    const categories = new Set(GENUI_TEMPLATES.map(t => t.category))
    for (const expected of ['仪表盘', '数据', '流程', '图表', '交互', '测验', '高级']) {
      expect(categories.has(expected), `缺类别: ${expected}`).toBe(true)
    }
  })
})
