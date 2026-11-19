import { describe, expect, it } from 'vitest'
import { compileMathExpr, compileMathExprProgram, parseDecimalNumber } from '../src/client/safe-math.ts'

describe('SafeMath 数字解析', () => {
  it('保留相邻的加减运算符', () => {
    expect(compileMathExpr('1+2')!(0)).toBe(3)
    expect(compileMathExpr('2-1')!(0)).toBe(1)
    expect(compileMathExpr('2-sin(x)')!(0)).toBe(2)
    expect(compileMathExpr('.5+1')!(0)).toBe(1.5)
    expect(compileMathExpr('1.5-0.5')!(0)).toBe(1)
  })

  it('接受带符号的科学计数法指数', () => {
    expect(compileMathExpr('1e-3+2')!(0)).toBeCloseTo(2.001)
    expect(compileMathExpr('1e+3-2')!(0)).toBe(998)
    expect(compileMathExpr('1e3+2')!(0)).toBe(1002)
  })

  it('只接受十进制输入，并支持正负号、小数和科学计数法', () => {
    expect(parseDecimalNumber('+12')).toBe(12)
    expect(parseDecimalNumber('-.5')).toBe(-0.5)
    expect(parseDecimalNumber('1.')).toBe(1)
    expect(parseDecimalNumber('1.25e-2')).toBe(0.0125)
    for (const value of ['0x10', '0b10', '0o10', 'Infinity', '1e999', '-', '']) {
      expect(parseDecimalNumber(value), `should reject ${value}`).toBeUndefined()
    }
  })

  it('拒绝格式错误的数字', () => {
    for (const expr of ['.', '1e', '1e+', '1e-', '1e--2']) {
      expect(compileMathExpr(expr), `should reject ${expr}`).toBeNull()
    }
  })

  it('在 strict 表达式中报告已声明字段', () => {
    const program = compileMathExprProgram('quantity * rate + tax', {
      vars: { quantity: 2, rate: 3, tax: 4 },
      allowImplicitVariables: false,
    })

    expect(program?.variables).toEqual(['quantity', 'rate', 'tax'])
    expect(program?.evaluate(0)).toBe(10)
  })

  it('在 strict 表达式中允许 x 和常量名称作为字段', () => {
    const program = compileMathExprProgram('x + pi', {
      vars: { x: 2, pi: 3 },
      allowImplicitVariables: false,
    })

    expect(program?.variables).toEqual(['x', 'pi'])
    expect(program?.evaluate(0)).toBe(5)
  })

  it('在 strict 表达式中保留未声明常量', () => {
    const program = compileMathExprProgram('2 * pi + e', { allowImplicitVariables: false })
    expect(program?.variables).toEqual([])
    expect(program?.evaluate(0)).toBeCloseTo(2 * Math.PI + Math.E)
  })

  it('拒绝未声明字段和继承函数名称', () => {
    expect(compileMathExprProgram('missing + 1', { allowImplicitVariables: false })).toBeNull()
    expect(compileMathExprProgram('constructor()', { allowImplicitVariables: false })).toBeNull()
    expect(compileMathExprProgram('toString()', { allowImplicitVariables: false })).toBeNull()
  })

  it('默认保留 plot 隐式参数', () => {
    expect(compileMathExpr('a * x')?.(3)).toBe(3)
  })

  it('限制表达式长度、递归层数和非有限数字', () => {
    expect(compileMathExprProgram('1'.repeat(513))).toBeNull()
    expect(compileMathExprProgram(`${'('.repeat(33)}1${')'.repeat(33)}`)).toBeNull()
    expect(compileMathExprProgram('1e999')).toBeNull()
    expect(compileMathExprProgram('amount + 1', { vars: { amount: Number.POSITIVE_INFINITY }, allowImplicitVariables: false })).toBeNull()
  })
})
