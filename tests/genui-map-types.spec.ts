// Consumer declaration contract: no engine dependency is needed for host config.
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

// Compiling a consumer project through the TypeScript API takes 1–2s idle; under
// a full-suite run it has been measured at 11s. The 5s default turned that into a
// flake that failed locally and passed on CI, which is the worst combination:
// local verification stops meaning anything.
it('type-checks public map configuration with the engine package unavailable', { timeout: 30_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'genui-map-types-'))
  try {
    const file = join(dir, 'consumer.ts')
    writeFileSync(file, `import type { GenuiMapConfig } from ${JSON.stringify(resolve('src/client/map-config.ts'))};\nconst config: GenuiMapConfig = { style: { version: 8, sources: {}, layers: [], glyphs: 'https://host.example/fonts/{fontstack}/{range}.pbf', metadata: { theme: 'host' } } };\nvoid config;\n`)
    const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true }
    const host = ts.createCompilerHost(options)
    const originalRead = host.readFile.bind(host), originalExists = host.fileExists.bind(host)
    const enginePath = /(?:^|[/\\])maplibre-gl(?:[/\\@]|$)/
    host.readFile = path => enginePath.test(path) ? undefined : originalRead(path)
    host.fileExists = path => !enginePath.test(path) && originalExists(path)
    const program = ts.createProgram([file], options, host)
    const diagnostics = ts.getPreEmitDiagnostics(program)
    expect(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
    expect(readFileSync('src/client/map-config.ts', 'utf8')).not.toMatch(/from ['"]maplibre-gl/)
    // Existing hosts can keep the vendor's richer type without a structural cast.
    writeFileSync(file, readFileSync(file, 'utf8') + `\nimport type { StyleSpecification } from ${JSON.stringify(realpathSync(resolve('node_modules/maplibre-gl/dist/maplibre-gl.d.ts')))};\ndeclare const vendorStyle: StyleSpecification; const vendorConfig: GenuiMapConfig = { style: vendorStyle }; void vendorConfig;\n`)
    const vendorProgram = ts.createProgram([file], options)
    expect(ts.getPreEmitDiagnostics(vendorProgram).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
