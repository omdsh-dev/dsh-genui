#!/usr/bin/env node
/**
 * Cross-platform `lib` cleanup for the `build` / `check` scripts.
 *
 * The scripts used to spell this `rm -rf lib`. npm and pnpm run package
 * scripts through `cmd.exe` on Windows, where `rm` is not a command, so the
 * step failed (exit 1) and took the rest of the `&&` chain with it — most
 * visibly inside `prepack`, which spawns `cmd.exe /d /s /c "pnpm run build"`
 * on Windows on purpose. Doing the removal in Node keeps one command that
 * resolves in every shell the repo is built from.
 */
import { rmSync } from 'node:fs'

rmSync('lib', { recursive: true, force: true })
