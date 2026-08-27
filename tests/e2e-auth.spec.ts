import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'scripts/e2e.mjs'), 'utf8')
const match = source.match(/function findDshWebUrl\(output\) \{[\s\S]*?\n\}/u)
if (match === null) throw new Error('e2e script must define findDshWebUrl')
const findDshWebUrl = Function(`${match[0]}; return findDshWebUrl`)() as (output: string) => string | undefined

describe('dsh web authentication', () => {
  it('extracts only the tokenized local startup URL', () => {
    expect(findDshWebUrl('booting\ndsh web: http://127.0.0.1:3190/?token=abc_DEF-123\n'))
      .toBe('http://127.0.0.1:3190/?token=abc_DEF-123')
    expect(findDshWebUrl('dsh web: http://127.0.0.1:3190/')).toBeUndefined()
  })
})
