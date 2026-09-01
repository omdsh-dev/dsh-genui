#!/usr/bin/env node
/**
 * Cross-platform `prepack` wrapper: rebuild lib before packing, but keep the
 * build's stdout OFF the process stdout. `npm pack --json` parses stdout as
 * JSON, so any tsdown banner leaking to stdout corrupts the pack gate and
 * tooling that drives npm pack programmatically. Build progress is forwarded
 * to stderr instead.
 */
import { spawnSync } from 'node:child_process'

const isWindows = process.platform === 'win32'
const result = spawnSync(
  isWindows ? (process.env.ComSpec || 'cmd.exe') : 'pnpm',
  isWindows
    ? ['/d', '/s', '/c', 'pnpm run build']
    : ['run', 'build'],
  {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)

if (result.stdout?.length) process.stderr.write(result.stdout)
if (result.stderr?.length) process.stderr.write(result.stderr)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
