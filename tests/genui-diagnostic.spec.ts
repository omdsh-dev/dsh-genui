import { describe, expect, it } from 'vitest'
import { processGenuiSpec } from '../src/client/guard.ts'
import { droppedNodeFailure } from '../src/plugin/genui-diagnostic.ts'

describe('genui diagnostic fields', () => {
  it('reports dropped nodes with language-neutral protocol fields', () => {
    const value = { items: [{ type: 'callout', title: 'Only title' }] }
    const result = droppedNodeFailure(processGenuiSpec(value), value)
    const text = result?.join('\n')

    expect(result).toBeDefined()
    expect(text).toContain('node=items[0]')
    expect(text).toContain('type=callout')
    expect(text).toContain('error=missing_required_field')
    expect(text).toContain('field=content')
    expect(text).toContain('written=title')
    expect(text).not.toContain('[genui-validation]')
    expect(text).not.toContain('next=fix_and_revalidate')
    expect(text).not.toContain('reply_language=conversation')
    expect(text).not.toContain('验证未通过')
    expect(text).not.toContain('缺少必填字段')
    expect(text).not.toContain('请修正')
    expect(text).not.toMatch(/[\u3400-\u9fff]/u)
  })
})
