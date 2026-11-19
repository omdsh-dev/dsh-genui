import { describe, expect, it } from 'vitest'
// @ts-expect-error Dependency-free Node script shared by acceptance setup.
import { mergeExactVersionExceptions } from '../scripts/host-dependency-policy.mjs'

describe('exact host dependency age exceptions', () => {
  it('preserves both approved host versions without allowing other versions', () => {
    expect(mergeExactVersionExceptions([
      '@deepseek-ai/dsh-agent@0.2.1-rc.3',
      'esbuild@0.25.0',
      '@deepseek-ai/dsh-agent@0.2.2-alpha.2',
      '@deepseek-ai/dsh-agent@0.2.2-alpha.2',
    ])).toEqual(['@deepseek-ai/dsh-agent@0.2.1-rc.3 || 0.2.2-alpha.2', 'esbuild@0.25.0'])
  })

  it('preserves the order and meaning of existing package patterns', () => {
    expect(mergeExactVersionExceptions(['@trusted/*', 'other', 'pkg@1.0.0 || 1.0.1', 'pkg@1.0.2']))
      .toEqual(['@trusted/*', 'other', 'pkg@1.0.0 || 1.0.1 || 1.0.2'])
  })
})
