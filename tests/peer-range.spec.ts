import { readFile } from 'node:fs/promises'
import { satisfies } from 'semver'
import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
  peerDependencies: Record<string, string>
  engines: { dsh: string }
}
const dshPeers = Object.entries(pkg.peerDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
const supportedRange = '^0.2.0-rc.1 || ^0.2.1-rc.1'
const versionCases = [
  ['0.1.2-rc.1', false],
  ['0.1.7-alpha.1', false],
  ['0.1.7-rc.2', false],
  ['0.2.0-rc.1', true],
  ['0.2.0-rc.2', true],
  ['0.2.0', true],
  ['0.2.1-alpha.1', false],
  ['0.2.1-alpha.3', false],
  ['0.2.1-rc.1', true],
  ['0.2.1-rc.2', true],
  ['0.2.1', true],
  ['0.2.2-rc.1', false],
  ['0.2.2', true],
  ['0.3.0-rc.1', false],
  ['0.3.0', false],
  ['1.0.0', false],
] as const

describe('DSH peer version ranges', () => {
  it('covers all 18 DSH packages', () => {
    expect(dshPeers).toHaveLength(18)
  })

  it.each(versionCases)('%s support matches every DSH peer range', (version, expected) => {
    const mismatches = dshPeers
      .filter(([, range]) => satisfies(version, range) !== expected)
      .map(([name]) => name)

    expect(mismatches).toEqual([])
  })

  it('uses the same range for every peer and engines.dsh', () => {
    expect(pkg.engines.dsh).toBe(supportedRange)
    expect(dshPeers.every(([, range]) => range === supportedRange)).toBe(true)
  })
})
