#!/usr/bin/env node
/**
 * Cross-platform `prepack` wrapper: rebuild lib before packing, but keep the
 * build's stdout OFF the process stdout. `npm pack --json` parses stdout as
 * JSON, so any tsdown banner leaking to stdout corrupts the pack gate and
 * tooling that drives npm pack programmatically. Build progress is forwarded
 * to stderr instead.
 */
import { spawnSync } from 'node:child_process'

const pm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const result = spawnSync(pm, ['run', 'build'], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
})

if (result.stdout !== null && result.stdout.length > 0) process.stderr.write(result.stdout)
if (result.stderr !== null && result.stderr.length > 0) process.stderr.write(result.stderr)
if (result.error !== undefined) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
