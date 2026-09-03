// The /panel slash command: default panel spec validity, source shape, and
// the publish/clear/expand behavior of its claim's submit.
import { describe, expect, it } from 'vitest'
import { createPanelSlashSource, DEFAULT_PANEL_SPEC } from '../src/client/panel-command.ts'
import { getPanelExpandToken, getPanelSpec } from '../src/client/panel-store.ts'
import { repairGenuiSpec } from '../src/client/guard.ts'

const SID = 'panel-command-test'

describe('DEFAULT_PANEL_SPEC', () => {
  it('is a valid repairable spec', () => {
    const repaired = repairGenuiSpec(DEFAULT_PANEL_SPEC)
    expect(repaired).not.toBeNull()
    expect(repaired!.title).toBe('GenUI 面板')
    expect(repaired!.items.length).toBeGreaterThan(3)
  })
})

describe('/panel slash source', () => {
  const instructions: Array<{ sessionId: string; instruction: string }> = []
  const sendInstruction = (sessionId: string, instruction: string): void => {
    instructions.push({ sessionId, instruction })
  }
  const source = createPanelSlashSource(sendInstruction as never)

  it('is a leading "/" source grouped under genui', () => {
    expect(source.trigger).toBe('/')
    expect(source.name).toBe('genui')
    expect(typeof source.candidates).toBe('function')
  })

  it('offers the panel candidate', async () => {
    const candidates = await source.candidates!({ sessionId: SID } as never, { query: 'panel', position: 'leading', signal: new AbortController().signal })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.name).toBe('panel')
  })

  it('filters the candidate by query prefix so the group vanishes for unmatched queries', async () => {
    const call = (query: string): Promise<readonly { name: string }[]> =>
      source.candidates!({ sessionId: SID } as never, { query, position: 'leading', signal: new AbortController().signal })
    // Bare "/" and any prefix of "panel" (case-insensitive) keep the candidate.
    for (const query of ['', 'p', 'pa', 'PANEL']) {
      expect(await call(query)).toHaveLength(1)
    }
    // Anything else must drop the group: an unfiltered group stays the only
    // ready non-empty group for unmatched queries and steals the menu's
    // default highlight from real command/skill candidates.
    for (const query of ['sk', 'venus', 'zzz', 'panels', ' panel ']) {
      expect(await call(query)).toHaveLength(0)
    }
  })

  it('publishes the default spec and requests expansion on pick', async () => {
    const before = getPanelExpandToken(SID)
    const outcome = source.onPick!({
      candidate: { name: 'panel' },
      session: { sessionId: SID },
      position: 'leading',
      via: 'enter',
      span: { start: 0, end: 6, draftRev: 0 },
    })
    expect(outcome).not.toBeUndefined()
    expect(outcome).toHaveProperty('claim')
    const claim = (outcome as { claim: { submit: (a: string) => Promise<unknown> } }).claim
    const result = await claim.submit('')
    expect(result).toEqual({ kind: 'success' })
    expect(getPanelSpec(SID)).toEqual(DEFAULT_PANEL_SPEC)
    expect(getPanelExpandToken(SID)).toBe(before + 1)
  })

  it('clears the panel on /panel clear (matchEnter path)', async () => {
    const outcome = await source.matchEnter!({ sessionId: SID } as never, '/panel clear', new AbortController().signal)
    expect(outcome).not.toBeUndefined()
    const claim = (outcome as { claim: { submit: (a: string) => Promise<unknown> } }).claim
    const result = await claim.submit('clear')
    expect(result).toEqual({ kind: 'success' })
    expect(getPanelSpec(SID)).toBeNull()
  })

  it('relays an instruction to the model on /panel <指令> instead of swallowing it', async () => {
    const outcome = await source.matchEnter!({ sessionId: SID } as never, '/panel 总结一下会话内容', new AbortController().signal)
    expect(outcome).not.toBeUndefined()
    const claim = (outcome as { claim: { submit: (a: string) => Promise<unknown> } }).claim
    const result = await claim.submit('总结一下会话内容')
    expect(result).toEqual({ kind: 'success' })
    // The default spec shows instantly for feedback…
    expect(getPanelSpec(SID)).toEqual(DEFAULT_PANEL_SPEC)
    // …and the instruction reached the model verbatim.
    expect(instructions).toContainEqual({ sessionId: SID, instruction: '总结一下会话内容' })
  })

  it('ignores non-panel lines in matchEnter', async () => {
    const outcome = await source.matchEnter!({ sessionId: SID } as never, '/other', new AbortController().signal)
    expect(outcome).toBeUndefined()
  })
})
