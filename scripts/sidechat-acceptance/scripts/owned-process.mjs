import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
/** 在指定时限内等待操作完成，超时则报告对应步骤。 */
export async function timeout(operation, ms, label) {
  let timer
  try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms) })]) }
  finally { clearTimeout(timer) }
}
/** 仅在受限进程内存中读取启动令牌，不写入原始日志。 */
/** 启动并管理验收脚本创建的子进程。 */
export function spawnOwned(command, args, { cwd, env, label, expectedStopCode = 0, rejectBlockedBuilds = false }) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: false })
  let output = '', launchUrl, closed, failure, stopping = false, completedCommand = false, blockedBuild = false
  let resolveClosed
  const closedPromise = new Promise(resolve => { resolveClosed = resolve })
  const receive = chunk => {
    output = (output + chunk.toString()).slice(-65536)
    if (rejectBlockedBuilds && /ignored build scripts|approve-builds|build scripts[^\n]*(?:ignored|blocked)|ERR_PNPM_IGNORED_BUILDS/iu.test(output)) blockedBuild = true
    const found = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)/u)?.[1]
    if (found) launchUrl = found
  }
  child.stdout.on('data', receive); child.stderr.on('data', receive)
  child.on('error', error => { failure = new Error(`${label} failed to spawn (${error.code ?? 'unknown'})`) })
  child.on('close', (code, signal) => { closed = { code, signal }; resolveClosed(closed) })
  /** 收集并清理最近的错误行，供进程失败信息使用。 */
  const diagnostic = () => output.split('\n').filter(line => /error|fatal|failed|unable|could not|cannot|not found|unknown|invalid|requires|ENOENT|ERR_/iu.test(line)).slice(-5).map(line => line.replace(/https?:\/\/[^\s]+/gu, '[URL withheld]').replace(/token[^\s]*/giu, '[token withheld]')).join(' | ').slice(0, 1800)
  /** 确认进程仍在运行，提早报告启动错误或异常退出。 */
  const alive = () => { if (failure) throw failure; if (closed !== undefined) throw new Error(`${label} exited before completion (${closed.code ?? closed.signal}); ${diagnostic()}`) }
  /** 结束本次验收启动的进程并核对退出状态。 */
  async function stop() {
    if (stopping) return closedPromise
    stopping = true
    if (closed) { if (failure) throw failure; assert.ok(completedCommand, `${label} exited unexpectedly before requested shutdown`); assert.equal(closed.code, 0, `${label} previously exited abnormally`); return closed }
    const stoppedAt = Date.now()
    child.kill('SIGINT')
    let result
    try { result = await timeout(() => closedPromise, 15000, `${label} graceful stop`) }
    catch (error) {
      // Escalate only the process we spawned. Force-cleaned runs never pass.
      child.kill('SIGTERM')
      try { await timeout(() => closedPromise, 3000, `${label} terminate`) }
      catch { child.kill('SIGKILL'); await timeout(() => closedPromise, 3000, `${label} owned kill`) }
      throw error
    }
    assert.equal(result.code, expectedStopCode, `${label} did not complete expected SIGINT cleanup`)
    if (expectedStopCode === 130) assert.ok(Date.now() - stoppedAt < 4500, `${label} may have reached official 5-second forced shutdown; refuse PASS`)
    output = ''; launchUrl = undefined
    return result
  }
  return { alive, stop, async launch(timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) { alive(); if (launchUrl) return launchUrl; await delay(100) }
    throw new Error(`${label} readiness timed out; raw launch output withheld`)
  }, async finish(timeoutMs = 120000) {
    const result = await timeout(() => closedPromise, timeoutMs, label)
    if (failure) throw failure
    assert.equal(result.code, 0, `${label} failed (${result.code}); ${diagnostic()}; no script approval or policy bypass will be attempted`)
    assert.equal(blockedBuild, false, `${label} requires dependency-build approval; skipped scripts cannot count as acceptance`)
    completedCommand = true; output = ''; return result
  } }
}
