import { describe, expect, it } from 'vitest'
import { processGenuiSpec } from '../src/client/guard.ts'
import { droppedNodeFailure } from '../src/plugin/genui-diagnostic.ts'

describe('genui diagnostic protocol', () => {
  it('reports dropped nodes with language-neutral protocol fields', () => {
    const value = { items: [{ type: 'callout', title: 'Only title' }] }
    const result = droppedNodeFailure(processGenuiSpec(value), value)

    expect(result).toBeDefined()
    expect(result).toContain('status=invalid')
    expect(result).toContain('node=items[0]')
    expect(result).toContain('type=callout')
    expect(result).toContain('error=missing_required_field')
    expect(result).toContain('field=content')
    expect(result).toContain('written=title')
    expect(result).toContain('reply_language=preserve')
    expect(result).not.toContain('验证未通过')
    expect(result).not.toContain('缺少必填字段')
    expect(result).not.toContain('请修正')
    expect(result).not.toMatch(/[\u3400-\u9fff]/u)
  })
})
