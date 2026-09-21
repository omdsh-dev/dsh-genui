// SKILL.md frontmatter regression gate: the skill catalog silently IGNORES a
// skill whose YAML frontmatter fails to parse (the harness's yaml parser, not
// ours). The genui description historically contained `: ` sequences
// ("charts: callouts", "prose: 要点") which the parser rejects as compact
// nested mappings — the skill was invisible from install until quoted.
// This test pins the file against the SAME parser the host uses.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/** Replicate skill-filesystem's parseFrontmatter: leading `---`, body until the
 * next `---` line. */
function frontmatterYaml(raw: string): string {
  const lines = raw.slice(4).split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (line.trim() === '---') break
    out.push(line)
  }
  return out.join('\n')
}

describe('SKILL.md frontmatter (host yaml parser)', () => {
  const raw = readFileSync(join(process.cwd(), 'SKILL.md'), 'utf8')

  it('starts with the frontmatter fence', () => {
    expect(raw.startsWith('---\n')).toBe(true)
  })

  it('parses with the harness yaml parser', () => {
    expect(() => parse(frontmatterYaml(raw))).not.toThrow()
  })

  it('declares name and a non-empty description', () => {
    const data = parse(frontmatterYaml(raw)) as Record<string, unknown>
    expect(data.name).toBe('genui')
    expect(typeof data.description).toBe('string')
    expect((data.description as string).length).toBeGreaterThan(20)
    expect(data.description).toContain('Preserve conversation language')
    expect(data.description).not.toMatch(/[\u3400-\u9fff]/u)
  })
})
