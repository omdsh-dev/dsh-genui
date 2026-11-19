// @vitest-environment jsdom
// install.sh file-safety boundaries, driven through a REAL shell with a
// temp DSH_HOME and stubbed dsh/pnpm. The script's idempotent branch
// (profile already lists dsh-genui) runs only the skill sync, so every
// target state is exercised without touching any real profile. The key
// property: a symlink pointing at another file is never written through —
// the sentinel bytes stay identical.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const INSTALL = join(process.cwd(), 'scripts', 'install.sh')
const PACKAGE_SKILL = 'PACKAGE-SKILL-CONTENT-9f8e7d\n'

interface Env {
  root: string
  home: string
  profile: string
  dest: string
  agentsDest: string
  run: (profile?: string) => { status: number; stdout: string }
}

function makeEnv(): Env {
  const root = mkdtempSync(join(tmpdir(), 'genui-install-'))
  const home = join(root, 'dshhome')
  const agentsHome = join(root, 'agentshome')
  const profile = join(home, 'profiles', 'web')
  // stub commands on PATH: dsh / pnpm version checks
  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'dsh'), '#!/bin/sh\necho "dsh test-version"\n')
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\necho "11.7.0"\n')
  for (const name of ['dsh', 'pnpm']) {
    execFileSync('chmod', ['+x', join(bin, name)])
  }
  // simulated installed package (no exports map → legacy subpath resolve)
  const pkg = join(profile, 'node_modules', '@changfenhuang', 'dsh-genui')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@changfenhuang/dsh-genui', version: '0.0.0-test' }))
  writeFileSync(join(pkg, 'SKILL.md'), PACKAGE_SKILL)
  // profile already lists the plugin → idempotent branch → sync_skill only
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), '{"name":"web","dependencies":{"@changfenhuang/dsh-genui":"link:whatever"}}\n')
  const dest = join(home, 'skills', 'genui', 'SKILL.md')
  const agentsDest = join(agentsHome, 'skills', 'genui', 'SKILL.md')
  const run: Env['run'] = (profileArg = 'web') => {
    try {
      const stdout = execFileSync('sh', [INSTALL, profileArg], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DSH_HOME: home, AGENTS_HOME: agentsHome },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return { status: 0, stdout }
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string }
      return { status: e.status ?? 1, stdout: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
  }
  return { root, home, profile, dest, agentsDest, run }
}

afterEach(() => {
  for (const env of active) rmSync(env.root, { recursive: true, force: true })
  active.length = 0
})
const active: Env[] = []

function env(): Env {
  const e = makeEnv()
  active.push(e)
  return e
}

// Each case spawns REAL shells (stub PATH + chmod + sh) at ~1s per run, so
// the default 5000ms per-test budget can trip under a full parallel suite
// (observed on busy machines). A suite-level timeout keeps CI deterministic.
describe('install.sh skill sync safety', { timeout: 30_000 }, () => {
  it('creates the skill file when the target does not exist', () => {
    const e = env()
    const { status, stdout } = e.run()
    expect(status).toBe(0)
    expect(readFileSync(e.dest, 'utf8')).toBe(PACKAGE_SKILL)
    expect(stdout).toContain('skill 已同步')
  })

  it('syncs BOTH skill roots (dshHome and agentsHome)', () => {
    const e = env()
    const { status, stdout } = e.run()
    expect(status).toBe(0)
    expect(readFileSync(e.dest, 'utf8')).toBe(PACKAGE_SKILL)
    expect(readFileSync(e.agentsDest, 'utf8')).toBe(PACKAGE_SKILL)
    expect(stdout).toContain('DSH_HOME/skills/genui')
    expect(stdout).toContain('AGENTS_HOME/skills/genui')
  })

  it('fails safely when the AGENTS root target is a symlink to another file', () => {
    const e = env()
    const sentinel = join(e.root, 'elsewhere', 'secret-agents.txt')
    mkdirSync(dirname(sentinel), { recursive: true })
    writeFileSync(sentinel, 'SENTINEL-AGENTS\n')
    mkdirSync(dirname(e.agentsDest), { recursive: true })
    symlinkSync(sentinel, e.agentsDest)
    const { status, stdout } = e.run()
    expect(status).not.toBe(0)
    expect(stdout).toContain('指向其他文件的符号链接')
    expect(readFileSync(sentinel, 'utf8')).toBe('SENTINEL-AGENTS\n')
  })

  it('atomically replaces a plain existing file', () => {
    const e = env()
    mkdirSync(dirname(e.dest), { recursive: true })
    writeFileSync(e.dest, 'OLD-CONTENT\n')
    const { status } = e.run()
    expect(status).toBe(0)
    expect(readFileSync(e.dest, 'utf8')).toBe(PACKAGE_SKILL)
  })

  it('skips a symlink that resolves to the same package file (dev ln -s case)', () => {
    const e = env()
    const pkgSkill = join(e.profile, 'node_modules', '@changfenhuang', 'dsh-genui', 'SKILL.md')
    mkdirSync(dirname(e.dest), { recursive: true })
    symlinkSync(pkgSkill, e.dest)
    const { status, stdout } = e.run()
    expect(status).toBe(0)
    expect(stdout).toContain('符号链接指向同一文件')
    expect(readFileSync(e.dest, 'utf8')).toBe(PACKAGE_SKILL)
  })

  it('safely fails on a symlink pointing at ANOTHER file — sentinel bytes unchanged', () => {
    const e = env()
    const sentinel = join(e.root, 'elsewhere', 'secret.txt')
    mkdirSync(dirname(sentinel), { recursive: true })
    writeFileSync(sentinel, 'SENTINEL-12345\n')
    mkdirSync(dirname(e.dest), { recursive: true })
    symlinkSync(sentinel, e.dest)
    const { status, stdout } = e.run()
    expect(status).not.toBe(0)
    expect(stdout).toContain('指向其他文件的符号链接')
    // the critical property: nothing was written through the link
    expect(readFileSync(sentinel, 'utf8')).toBe('SENTINEL-12345\n')
    expect(readFileSync(e.dest, 'utf8')).toBe('SENTINEL-12345\n') // still the link's target
  })

  it('safely fails on a dangling symlink', () => {
    const e = env()
    mkdirSync(dirname(e.dest), { recursive: true })
    symlinkSync(join(e.root, 'nowhere', 'missing.md'), e.dest)
    const { status, stdout } = e.run()
    expect(status).not.toBe(0)
    expect(stdout).toContain('悬空符号链接')
  })

  it('safely fails when the target is a directory', () => {
    const e = env()
    mkdirSync(e.dest, { recursive: true })
    const { status, stdout } = e.run()
    expect(status).not.toBe(0)
    expect(stdout).toContain('是目录')
  })

  it('fails loudly when the installed package lacks SKILL.md (incomplete install)', () => {
    const e = env()
    rmSync(join(e.profile, 'node_modules', '@changfenhuang', 'dsh-genui', 'SKILL.md'))
    const { status, stdout } = e.run()
    expect(status).not.toBe(0)
    expect(stdout).toContain('无法定位已安装包内的 SKILL.md')
  })
})

describe('install.sh argument safety', { timeout: 30_000 }, () => {
  it('rejects an illegal profile name before doing anything', () => {
    const e = env()
    const { status, stdout } = e.run('web; rm -rf /tmp/x')
    expect(status).not.toBe(0)
    expect(stdout).toContain('非法的 profile 名')
  })

  it('rejects a profile name with path separators', () => {
    const e = env()
    const { status } = e.run('../evil')
    expect(status).not.toBe(0)
  })
})
