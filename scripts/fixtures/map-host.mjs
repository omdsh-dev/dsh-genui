/** Test-only Cordis plugin. Real AgentLoop + official local ReplayAdapter, no
 * seeded messages, fake conversation services, renderer patches, or endpoints.
 * Loaded only by e2e.mjs's fresh rc.2 smoke profile through --patch.
 */
import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const name = 'e2e-map-host'
export const inject = ['agentLoop', 'agentDefaultModel', 'llm']

export async function apply(ctx, config) {
  const { sessionId, provider, model, replayModule, replayFile, auditFile } = config
  assert.ok(sessionId && provider === 'map-e2e-replay' && model === 'map-e2e')
  const save = record => appendFileSync(auditFile, `${JSON.stringify(record)}\n`)
  let streams = 0
  const { installLlmReplay } = await import(pathToFileURL(replayModule).href)

  // This seam runs before prepareCall. Inspect the FINAL selection after inner
  // model middleware, rejecting any route that might prepare a live provider.
  ctx.on('agent/request', async ({ agent, turn, step }, next) => {
    assert.equal(agent.id, sessionId, 'Unexpected agent in synthetic profile')
    assert.ok((turn === 1 || turn === 2) && step === 1, 'Only two one-step turns are scripted')
    const selection = await next()
    const allowed = selection.provider === provider && selection.model === model
    save({ type: 'agent-route', sessionId: agent.id, turn, step, allowed })
    assert.ok(allowed, 'Refusing a non-replay agent route before preparation')
    return selection
  }, { global: true, prepend: true })
  ctx.on('llm/stream', (options, next) => {
    const allowed = options.sessionId === sessionId && options.provider === provider && options.model === model
    save({ type: 'llm-route', sessionId: options.sessionId, allowed, call: ++streams })
    assert.ok(allowed && streams <= 2, 'Refusing unexpected or extra model calls')
    return next()
  }, { global: true, prepend: true })
  const replay = installLlmReplay(ctx, {
    file: replayFile, overrideFile: replayFile,
    providers: [{ id: provider, name: 'Synthetic map replay', models: [{ id: model, contextWindow: 128000 }] }],
  })
  ctx.effect(() => () => replay.dispose(), 'map replay lifetime')
  ctx.on('session/event', (session, event) => {
    // Log user inputs from ALL sessions, so misrouting cannot disappear from
    // the oracle. Only real session/event settlements supply these records.
    if (event.type === 'user/message') {
      save({ type: 'user-message', sessionId: session.id, seq: event.seq, message: event.data })
    }
    if (session.id !== sessionId) return
    if (event.type === 'assistant/message') {
      save({ type: 'assistant-message', sessionId, seq: event.seq, turn: event.data.turn, message: event.data.message })
    }
    if (event.type === 'turn/end') {
      save({ type: 'turn-end', sessionId, turn: event.data.turn, reason: event.data.reason })
      if (event.data.turn === 2) {
        replay.assertConsumed()
        assert.equal(streams, 2)
        save({ type: 'replay-consumed', sessionId, calls: streams })
      }
    }
  }, { global: true })
  ctx.on('agent/error', ({ agent, error }) => {
    save({ type: 'agent-error', sessionId: agent.id, error: String(error) })
  }, { global: true })
  // Default selection comes from this run's --patch overlay. Do not await a
  // config-editor write while async plugin activation holds the profile lock.
  assert.deepEqual(ctx.agentDefaultModel.currentSelection(), { provider, model })
  save({ type: 'ready', sessionId, provider, model })
}
