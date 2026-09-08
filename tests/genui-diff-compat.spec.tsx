// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenuiDiff } from '../src/client/spec.ts'

const { diffBlockSpy } = vi.hoisted(() => ({ diffBlockSpy: vi.fn() }))

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()
  return {
    ...actual,
    DiffBlock: (props: unknown) => {
      diffBlockSpy(props)
      return null
    },
  }
})

import { DiffNode } from '../src/client/blocks/advanced.tsx'

afterEach(() => {
  cleanup()
  diffBlockSpy.mockClear()
})

describe('DiffBlock host compatibility', () => {
  it('passes the labels required by newer dsh primitives', () => {
    const node = {
      type: 'diff',
      diffs: [{ path: 'a.txt', oldText: 'x', newText: 'y' }],
    } satisfies GenuiDiff

    render(<DiffNode node={node} />)

    expect(diffBlockSpy).toHaveBeenCalled()
    const props = diffBlockSpy.mock.calls[0]![0] as {
      diffs: GenuiDiff['diffs']
      labels?: {
        copy: string
        copied: string
        collapseAria: string
        expandAria: (hidden: number) => string
        collapse: string
        expand: (hidden: number) => string
        files: (count: number) => string
      }
    }

    expect(props.diffs).toEqual(node.diffs)
    expect(props.labels).toBeDefined()
    expect(props.labels?.copy).toBe('复制')
    expect(props.labels?.copied).toBe('复制成功')
    expect(props.labels?.expandAria(3)).toBe('展开其余 3 行差异')
    expect(props.labels?.expand(3)).toBe('… 其余 3 行')
    expect(props.labels?.files(1)).toBe('1 file')
    expect(props.labels?.files(2)).toBe('2 files')
  })
})
