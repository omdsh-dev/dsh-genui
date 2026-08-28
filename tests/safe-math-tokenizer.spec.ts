import { describe, expect, it } from 'vitest'
import { compileMathExpr } from '../src/client/safe-math.ts'

describe('SafeMath number tokenizer', () => {
  it('keeps adjacent + and - as expression operators', () => {
    expect(compileMathExpr('1+2')!(0)).toBe(3)
    expect(compileMathExpr('2-1')!(0)).toBe(1)
    expect(compileMathExpr('2-sin(x)')!(0)).toBe(2)
    expect(compileMathExpr('.5+1')!(0)).toBe(1.5)
    expect(compileMathExpr('1.5-0.5')!(0)).toBe(1)
  })

  it('still accepts signed scientific-notation exponents', () => {
    expect(compileMathExpr('1e-3+2')!(0)).toBeCloseTo(2.001)
    expect(compileMathExpr('1e+3-2')!(0)).toBe(998)
    expect(compileMathExpr('1e3+2')!(0)).toBe(1002)
  })

  it('rejects malformed numeric literals', () => {
    for (const expr of ['.', '1e', '1e+', '1e-', '1e--2']) {
      expect(compileMathExpr(expr), `should reject ${expr}`).toBeNull()
    }
  })
})
