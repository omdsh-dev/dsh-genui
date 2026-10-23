import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnOwned, delay } from '../scripts/owned-process.mjs'
const options = { cwd: process.cwd(), env: { PATH: process.env.PATH }, label: 'Synthetic process contract' }
test('successful one-shot command is not treated as unexpected host exit', async () => {
  const command = spawnOwned(process.execPath, ['-e', 'process.exitCode=0'], options)
  await command.finish(); assert.deepEqual(await command.stop(), { code: 0, signal: null })
})
test('a host that exits zero before requested stop still fails', async () => {
  const child = spawnOwned(process.execPath, ['-e', 'process.exitCode=0'], options)
  await assert.rejects(child.launch(2000), /exited before completion/u)
  await assert.rejects(child.stop(), /exited unexpectedly/u)
})
test('owned SIGINT await and documented 130 are distinct from live host work', async () => {
  const child = spawnOwned(process.execPath, ['-e', `process.on('SIGINT',()=>process.exit(130));console.log('dsh web: http://127.0.0.1:1234/?token=synthetic');setInterval(()=>{},1000)`], { ...options, expectedStopCode: 130 })
  assert.match(await child.launch(2000), /token=synthetic/u)
  assert.deepEqual(await child.stop(), { code: 130, signal: null })
})
test('callback timeout is surfaced and command resources remain closable', async () => {
  const child = spawnOwned(process.execPath, ['-e', `process.on('SIGINT',()=>process.exit(0));setInterval(()=>{},1000)`], options)
  await assert.rejects(child.launch(200), /timed out/u)
  await child.stop()
})

test('normal install cannot pass by silently ignoring a dependency lifecycle build', async () => {
  const command = spawnOwned(process.execPath, ['-e', "console.log('Ignored build scripts: synthetic-package. Run pnpm approve-builds')"], { ...options, rejectBlockedBuilds: true })
  await assert.rejects(command.finish(), /requires dependency-build approval/u)
  await assert.rejects(command.stop(), /exited unexpectedly/u)
})
