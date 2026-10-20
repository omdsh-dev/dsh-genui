import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ICONS } from '../src/client/icons/icon-data.ts'

const repoRoot = process.cwd()

describe('icon generation from upstream-style TSX', () => {
  it('reads literal geometry and inherited paint, rejects whole complex glyphs, and is repeatable', () => {
    const root = mkdtempSync(join(tmpdir(), 'genui-icons-'))
    try {
      const source = join(root, 'upstream')
      const out = join(root, 'output', 'src', 'client', 'icons')
      mkdirSync(source)
      // The real upstream exports React functions, not object definitions.
      const component = (name: string, svg: string): string => `import type { SVGProps } from 'react'\nconst ${name} = (props: SVGProps<SVGSVGElement>) => (${svg})\nexport default ${name}\n`
      for (const name of Object.keys(ICONS)) {
        writeFileSync(join(source, `${name}.tsx`), component(name, '<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M0 0h1" /></svg>'))
      }
      writeFileSync(join(source, 'Geometry.tsx'), component('Geometry', '<svg viewBox="0 0 20 20" fill="currentColor" stroke="currentColor" strokeWidth={2} {...props}><rect x={12} y={12} width={6} height={6} rx={3} fill="var(--green-500)" /><circle cx={12.1} cy={12.1} r={1} /><path d="M1 1h2" fill="none" strokeWidth={1.5} /></svg>'))
      writeFileSync(join(source, 'Complex.tsx'), component('Complex', '<svg viewBox="0 0 24 24"><path d="M0 0h1" /><g><path d="M2 2h1" /></g></svg>'))
      writeFileSync(join(source, 'Dynamic.tsx'), component('Dynamic', '<svg viewBox="0 0 24 24"><path d={process.exit(99)} /></svg>'))
      const generate = (): string => execFileSync(process.execPath, [join(repoRoot, 'scripts/generate-icon-data.mjs'), '--source', source, '--out', out], { cwd: repoRoot, encoding: 'utf8' })
      const log = generate()
      expect(log).toContain('65 total / 64 inline / 1 lazy')
      expect(log).toContain('Complex: unsupported nested SVG structure')
      expect(log).toContain('Dynamic: non-literal SVG attribute')
      const full = readFileSync(join(out, 'icon-data-full.ts'), 'utf8')
      expect(full).toContain('attrs: {"fill":"currentColor","stroke":"currentColor","strokeWidth":2}')
      expect(full).toContain('"attrs":{"x":12,"y":12,"width":6,"height":6,"rx":3,"fill":"var(--green-500)"}')
      expect(full).toContain('"attrs":{"cx":12.1,"cy":12.1,"r":1}')
      expect(full).toContain('"fill":"none","strokeWidth":1.5')
      expect(full).not.toContain('"Complex"')
      expect(full).not.toContain('"Dynamic"')
      const files = ['icon-data.ts', 'icon-data-full.ts', 'icon-names-full.ts'].map(file => join(out, file))
      files.push(join(root, 'output', 'ICON-NAMES.md'))
      const first = files.map(file => readFileSync(file))
      expect(generate()).toBe(log)
      expect(files.map(file => readFileSync(file))).toEqual(first)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
