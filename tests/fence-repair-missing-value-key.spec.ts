import { describe, expect, it } from 'vitest'
import { completeFenceJson, isCompleteJson, repairFenceJson } from '../src/shared/fence-repair.ts'
import { resolveFence } from '../src/shared/fence-resolve.ts'
import { createValidateDshUiTool } from '../src/plugin/tool.ts'

const WITH_SIBLING_NODES = '{"title":"示例","items":[{"type":"keyvalue","pairs":[{"key":"成本","3 台机器、约 12 小时"},{"key":"风险","单点故障"}]},{"type":"callout","tone":"info","content":"说明"}]}'
const WITHOUT_SIBLING_NODES = '{"title":"示例","items":[{"type":"keyvalue","pairs":[{"key":"成本","3 台机器、约 12 小时"}]}]}'

describe('missing keyvalue value member name (issue #420)', () => {
  it('does not absorb later pairs and sibling components into the malformed member name', async () => {
    expect(isCompleteJson(WITH_SIBLING_NODES)).toBe(false)
    expect(repairFenceJson(WITH_SIBLING_NODES)).toBeNull()
    expect(completeFenceJson(WITH_SIBLING_NODES)).toBeNull()
    expect(resolveFence(WITH_SIBLING_NODES, { settled: true }).spec).toBeNull()

    const validation = String(await createValidateDshUiTool().execute({ spec: WITH_SIBLING_NODES }))
    expect(validation).toContain('error=invalid_json')
    expect(validation).toContain('repair=failed')
    expect(validation).not.toContain('requires value (a string)')
    expect(validation).not.toContain('repaired_json:')
  })

  it('keeps the same malformed member invalid when no sibling component follows', () => {
    expect(isCompleteJson(WITHOUT_SIBLING_NODES)).toBe(false)
    expect(repairFenceJson(WITHOUT_SIBLING_NODES)).toBeNull()
    expect(completeFenceJson(WITHOUT_SIBLING_NODES)).toBeNull()
    expect(resolveFence(WITHOUT_SIBLING_NODES, { settled: true }).spec).toBeNull()
  })
})
