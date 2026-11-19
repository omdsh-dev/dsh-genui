/**
 * Test-only host fixture. No browser hooks, private service inspection, model
 * network calls, real customer data, or production routes. Does not ship.
 * Parent must be created through public workspace/create + session/create.
 * Seed and resume are distinct process lifetimes. Runtime validation pending.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// Exact reviewed built paths are resolved and version checked by the runner.
// No dependency installation or NODE_PATH escape is needed by this host-only package.
import { snapshotTrace, readSnapshotSession } from './snapshot-diagnostics.mjs'
import { validateUiAway, verifyUiAwayOwnership } from './ui-away.mjs'
import { PARENT_ID, CHILD_IDS, PROVIDER, MODEL, CONTENT, chunksFor } from './spec.mjs'

export const name = 'fixture-dsh354-dual'
export const inject = ['agents', 'agentLoop', 'agentDefaultModel', 'llm', 'sessionTitle', 'sessionController', 'sessionPersistence', 'workspaceRegistry']
const ALL_IDS = [PARENT_ID, ...CHILD_IDS]
const MAX_POLLS = 1200
const POLL_MS = 250

export async function apply(ctx, config) {
  const { createSystemMessage } = await import(pathToFileURL(config.llmModule).href)
  const { installModelSelection } = await import(pathToFileURL(config.agentModule).href)
  const { snapshotSubagentDescriptor } = await import(pathToFileURL(config.subagentModule).href)
  const { installLlmReplay } = await import(pathToFileURL(config.replayModule).href)
  const phase = config.phase
  if (!['seed', 'resume'].includes(phase)) throw new Error('explicit seed or resume phase required')
  // The write destination is explicitly under this task's fresh host workspace.
  const out = config.output
  if (!out) throw new Error('fixture requires DSH354_FIXTURE_OUTPUT inside its fresh synthetic host directory')
  const output = resolve(out)
  const allowed = resolve(config.ownedRoot ?? '')
  if (!config.ownedRoot || !output.startsWith(allowed + '/')) {
    throw new Error('fixture output must be a child of DSH354_HOST_ROOT')
  }
  mkdirSync(output, { recursive: true })
  const audit = [], calls = new Map(), requests = new Map()
  let fatal, replayConsumed = false, uiAway
  const createdUiSessionIds = []
  ctx.on('session/created', session => {
    if (phase !== 'resume' || [...ALL_IDS, config.awayId].includes(session.id)) return
    if (createdUiSessionIds.length < 2) createdUiSessionIds.push(session.id)
    fatal = 'Unexpected extra synthetic root: New Session must reuse the existing blank'
  }, { global: true })
  const save = record => {
    if (audit.length >= 512) { fatal = 'Bounded audit capacity exceeded'; return }
    audit.push(record)
  }
  const deny = (type, sessionId, reason) => {
    fatal = reason
    save({ type, sessionId, allowed: false, reason })
    throw new Error(reason)
  }
  ctx.on('agent/request', async ({ agent, turn, step }, next) => {
    const number = (requests.get(agent.id) ?? 0) + 1
    if (phase !== 'resume' || !CHILD_IDS.includes(agent.id) || turn !== number + 1 || number > 2 || step !== 1) {
      return deny('rejected-event', agent.id, 'Unowned, seed, parent, extra, or invalid model request')
    }
    const selection = await next()
    const allowed = selection.provider === PROVIDER && selection.model === MODEL
    save({ type: 'agent-request-route', phase, sessionId: agent.id, turn, step,
      provider: selection.provider, model: selection.model, allowed })
    if (!allowed) return deny('rejected-event', agent.id, 'Non-replay selection before preparation')
    requests.set(agent.id, number)
    return selection
  }, { global: true, prepend: true })
  ctx.on('llm/stream', (options, next) => {
    const call = (calls.get(options.sessionId) ?? 0) + 1
    const allowed = phase === 'resume' && CHILD_IDS.includes(options.sessionId)
      && options.provider === PROVIDER && options.model === MODEL && call <= 2
      && requests.get(options.sessionId) === call
    save({ type: 'llm-route', phase, sessionId: options.sessionId, turn: call + 1, step: 1,
      provider: options.provider, model: options.model, call, allowed })
    if (!allowed) return deny('rejected-event', options.sessionId, 'Invalid final streaming dispatch')
    calls.set(options.sessionId, call)
    return next()
  }, { global: true, prepend: true })
  const replayDir = fileURLToPath(new URL('../replay/', import.meta.url))
  const replay = installLlmReplay(ctx, {
    file: join(replayDir, 'first-child.v4.jsonl'),
    childFiles: [join(replayDir, 'second-child.v4.jsonl')],
    providers: [{ id: PROVIDER, name: 'DSH354 synthetic replay only', models: [{ id: MODEL, contextWindow: 128000 }] }],
  })
  ctx.effect(() => () => replay.dispose(), 'fixture-dsh354: replay lifetime')
  // Public session/event is the real inbox/settlement evidence source. No test
  // endpoint creates actions: the browser must click the actual GenUI controls.
  const relevant = new Set(['agent/inbox/spliced', 'user/message', 'assistant/message', 'turn/start', 'turn/end', 'step/start', 'step/end'])
  const finished = new Set()
  ctx.on('session/event', (session, event) => {
    if (!relevant.has(event.type)) return
    if (!ALL_IDS.includes(session.id)) {
      fatal = 'Foreign or away session emitted relevant event'
      save({ type: 'rejected-event', sessionId: session.id, event: { type: event.type, seq: event.seq }, allowed: false })
      return
    }
    save({ type: 'observed-event', sessionId: session.id, event: { type: event.type, seq: event.seq } })
    if (phase === 'resume' && event.type === 'turn/end' && event.data.turn === 3) {
      finished.add(session.id)
      if (CHILD_IDS.every(id => finished.has(id))) {
        try {
          assert.deepEqual(CHILD_IDS.map(id => calls.get(id)), [2, 2])
          replay.assertConsumed()
          replayConsumed = true
          save({ type: 'replay-consumed', calls: 4, scripts: 2 })
        } catch { fatal = 'Bounded replay consumption failed'; save({ type: 'fixture-failed', reason: fatal }) }
      }
    }
  }, { global: true })
  ctx.on('agent/error', ({ agent }) => {
    fatal = 'AgentLoop error in synthetic run'
    save({ type: 'agent-error', sessionId: agent.id, reason: fatal })
  }, { global: true })
  const childHandles = []
  ctx.effect(() => async () => {
    for (const handle of childHandles) await handle.dispose()
    await ctx.sessionPersistence.flush()
    const destination = join(output, `fixture-${phase}-disposed.json`)
    writeFileSync(destination + '.tmp', JSON.stringify({ phase, ownedChildrenClosed: childHandles.length, flushCompleted: true }) + '\n')
    renameSync(destination + '.tmp', destination)
  }, 'fixture-dsh354: owned child lifetime')

  async function compose(presetId) {
    const presets = ctx.get('agentPresets')
    if (!presets) return { setup: async () => {} }
    const resolved = await presets.resolve(presetId)
    return { agentPreset: resolved.id, setup: async (agentCtx) => { await presets.mount(agentCtx, resolved.id) } }
  }
  async function readPersisted(id) {
    const handle = await ctx.sessionPersistence.open(id, 'read')
    try { return { header: handle.header, events: (await handle.read()).events } }
    finally { await handle.close() }
  }
  function verifyStored(id, record, assistantSeq) {
    const assistant = record.events.find(event => event.data?.message?.id === `fixture-assistant-${id}`)
    if (assistant?.seq !== assistantSeq || JSON.stringify(assistant.data.message.content) !== JSON.stringify(CONTENT)) {
      throw new Error(`durable synthetic assistant mismatch: ${id}`)
    }
    const ends = record.events.filter(event => event.type === 'turn/end')
    if (ends.length !== 1 || ends[0].data.turn !== 1) throw new Error(`expected one completed seeded turn: ${id}`)
  }

  async function resume() {
    const prior = JSON.parse(readFileSync(join(output, 'fixture-state.json'), 'utf8'))
    if (prior.status !== 'seed-persisted-restart-required') throw new Error('resume requires verified durable seed, not a live reseed')
    for (const id of ALL_IDS) verifyStored(id, await readPersisted(id), prior.assistantEventSeq)
    const found = await ctx.sessionController.resolveAgent(PARENT_ID)
    if ('error' in found) throw found.error
    await ctx.sessionController.selectModel({ sessionId: PARENT_ID, provider: PROVIDER, model: MODEL })
    for (const id of CHILD_IDS) {
      if (ctx.agents.get(id)) throw new Error('child already active before fresh fixture resume')
      const stored = await readPersisted(id)
      const { setup } = await compose(stored.header.agentPreset)
      const handle = await ctx.agents.resume({ resumeSessionId: id,
        agentOptions: { provider: PROVIDER, model: MODEL }, setup,
        signal: AbortSignal.timeout(15000) })
      childHandles.push(handle)
      installModelSelection(handle.agent.ctx, { current: { provider: PROVIDER, model: MODEL } })
    }
    const result = { ...prior, status: 'resumed-from-durable-seed', phase,
      expectedNextTurn: 2, runtimeAcceptanceComplete: false }
    writeFileSync(join(output, 'fixture-state.json'), JSON.stringify(result, null, 2) + '\n')
    save({ type: 'fixture-resumed', phase })
    return true
  }

  let timer, inFlight = false, polls = 0, done = false, disposed = false
  const stop = () => { if (timer) clearInterval(timer); timer = undefined }
  const fail = (error) => {
    stop()
    if (disposed) return
    save({ type: 'fixture-failed', error: error instanceof Error ? error.message : String(error) })
    fatal = 'Synthetic fixture lifecycle failed'
    console.error('[fixture-dsh354] lifecycle failed')
  }
  async function seed() {
    const agents = ctx.get('agents')
    const parent = agents.get(PARENT_ID)
    if (!parent) return false
    const participants = [parent]
    const titles = ctx.get('sessionTitle')
    titles.rename(parent.session, 'DSH354 synthetic parent')
    await ctx.sessionController.selectModel({ sessionId: PARENT_ID, provider: PROVIDER, model: MODEL })
    for (const [index, id] of CHILD_IDS.entries()) {
      if (agents.get(id)) throw new Error('fixture child already exists; require a fresh profile')
      const label = `Side: DSH354 thread-${index === 0 ? 'A' : 'B'}`
      const descriptor = snapshotSubagentDescriptor({ mode: 'continuable', provider: 'sidechat', label, agentProvider: PROVIDER, agentModel: MODEL })
      const seedEvents = [{ type: 'subagent/descriptor', seq: 0, time: Date.now(), data: descriptor }]
      const composed = await compose(parent.session.header.agentPreset)
      const handle = await agents.create({
        sessionId: id,
        meta: { ...(parent.session.header.cwd ? { cwd: parent.session.header.cwd } : {}), parentSession: PARENT_ID, isSeeded: true, origin: 'subagent', delegationDepth: 1,
          ...(composed.agentPreset ? { agentPreset: composed.agentPreset } : {}) },
        seed: seedEvents,
        inheritedEventCount: seedEvents.length,
        agentOptions: { ...parent.options, provider: PROVIDER, model: MODEL },
        setup: composed.setup,
        signal: AbortSignal.timeout(15000),
      })
      childHandles.push(handle)
      handle.agent.inbox.clear()
      titles.rename(handle.agent.session, label)
      parent.session.append('subagent/catalog', { version: 0, childId: id, childCreatedAt: handle.agent.session.header.createdAt, mode: 'continuable', label })
      participants.push(handle.agent)
    }
    for (const agent of participants) {
      const route = { provider: PROVIDER, model: MODEL }
      if (agent.id !== PARENT_ID) installModelSelection(agent.ctx, { current: route })
      agent.session.append('model/selection', route)
      agent.session.append('turn/start', { turn: 1 })
      agent.session.append('step/start', { turn: 1, step: 1 })
      // Mirror AgentLoop's initial empty system head before any user surface.
      // The real first action may replace it; late insertion is invalid in v4.
      agent.session.append('system/message', { turn: 1, step: 1, message: createSystemMessage('') }, { surfaceOp: 'append' })
      agent.session.append('user/message', {
        id: `fixture-user-${agent.session.id}`, role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Synthetic DSH354 fixture. Display the isolation form.' }],
      }, { surfaceOp: 'append' })
    }
    // All three assistant events deliberately share one eventSeq. Repeated
    // valid model/selection events pad only this fresh synthetic test history.
    const assistantSeq = Math.max(...participants.map(a => Number(a.session.seq)))
    for (const agent of participants) {
      const session = agent.session
      while (Number(session.seq) < assistantSeq) session.append('model/selection', { provider: PROVIDER, model: MODEL })
      const now = Date.now()
      session.append('assistant/message', {
        turn: 1, step: 1,
        message: { id: `fixture-assistant-${session.id}`, role: 'assistant', source: { kind: 'model', provider: PROVIDER, model: MODEL }, content: structuredClone(CONTENT) },
        stream: chunksFor(CONTENT).map(chunk => ({ type: 'chunk', time: now, chunk })),
      }, { surfaceOp: 'append' })
      session.append('step/end', { turn: 1, step: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      if (session.snapshotEvents().find(e => e.data?.message?.id === `fixture-assistant-${session.id}`)?.seq !== assistantSeq) {
        throw new Error(`assistant seq misalignment in ${session.id}`)
      }
    }
    await ctx.sessionPersistence.flush()
    for (const id of ALL_IDS) verifyStored(id, await readPersisted(id), assistantSeq)
    const result = { status: 'seed-persisted-restart-required', phase, sessionIds: ALL_IDS, assistantEventSeq: assistantSeq, textBlockIndexes: [0, 2], fenceCountPerTextBlock: 2, expectedFormsPerSession: 4, dataConstructionOnly: true, runtimeAcceptanceComplete: false }
    writeFileSync(join(output, 'fixture-state.json'), JSON.stringify(result, null, 2) + '\n')
    save({ type: 'fixture-seeded', phase })
    console.log('[fixture-dsh354] seeded synthetic parent, thread-A and thread-B')
    return true
  }
  async function tick() {
    if (inFlight || done || disposed) return
    inFlight = true
    try {
      if (await (phase === 'seed' ? seed() : resume())) { done = true; stop() }
      else if (++polls >= MAX_POLLS) throw new Error('parent session did not arrive within five minutes')
    } catch (error) { fail(error) }
    finally { inFlight = false }
  }
  ctx.effect(() => () => { disposed = true; stop() }, 'fixture-dsh354: parent polling')
  // Patch supplies the default before activation, avoiding a config-save lock race.
  assert.deepEqual(ctx.agentDefaultModel.currentSelection(), { provider: PROVIDER, model: MODEL })
  writeFileSync(join(output, 'fixture-ready.json'), JSON.stringify({ phase, provider: PROVIDER, model: MODEL }) + '\n')
  timer = setInterval(() => { void tick() }, POLL_MS)
  await tick()

  // Request/response only under this fresh private synthetic root. Every request
  // flushes and reopens the public persistence handles; not a cached live view.
  let snapshotBusy = false, lastRequest, snapshotTask
  const snapshotTimer = setInterval(() => {
    if (snapshotBusy || disposed || !done) return
    const requestFile = join(output, 'snapshot-request.json')
    if (!existsSync(requestFile)) return
    let request
    try { request = JSON.parse(readFileSync(requestFile, 'utf8')) } catch { return }
    if (typeof request.requestId !== 'string' || request.requestId === lastRequest) return
    lastRequest = request.requestId; snapshotBusy = true
    const trace = snapshotTrace()
    snapshotTask = (async () => {
      await trace.run('binding', 'all', () => {
        if (request.uiAway !== undefined) {
          const next = validateUiAway(request.uiAway, config.awayId)
          if (uiAway) assert.deepEqual(next, uiAway, 'UI away binding cannot change')
          else uiAway = next
        } else assert.equal(uiAway, undefined, 'A bound UI away cannot be omitted')
      })
      await trace.run('flush', 'all', () => ctx.sessionPersistence.flush())
      const sessions = {}
      let uiAwayOwnership
      for (const id of [...ALL_IDS, config.awayId]) {
        const owner = id === PARENT_ID ? 'parent' : id === CHILD_IDS[0] ? 'child-a' : id === CHILD_IDS[1] ? 'child-b'
          : 'seeded-away'
        const stored = await readSnapshotSession(ctx.sessionPersistence, id, owner, trace)
        if (id === uiAway?.sessionId) uiAwayOwnership = await trace.run('ownership', owner, () => verifyUiAwayOwnership(uiAway, stored.header,
          ctx.workspaceRegistry.get(uiAway.workspaceId), join(allowed, 'workspace'), [...ALL_IDS, config.awayId], config.awayId))
        sessions[id] = await trace.run('projection', owner, () => {
          const events = stored.events.filter(event => relevant.has(event.type) && event.type !== 'agent/inbox/spliced').map(event => {
            const result = { type: event.type, seq: event.seq, data: event.data }
            // Runtime context may include paths. Retain only kind and a strict
            // action-marker flag for non-user context; never export that text.
            if (event.type === 'user/message' && event.data.source?.kind !== 'user') {
              const containsAction = JSON.stringify(event.data.content).includes('[genui-action]')
              result.data = { id: event.data.id, source: { kind: event.data.source?.kind }, content: [], containsAction }
            }
            return result
          })
          if (events.length > 256) throw new Error('Bounded session event capacity exceeded')
          return events
        })
      }
      const data = { requestId: request.requestId, phase, sessions, audit, replayConsumed, fatal, createdUiSessionIds, uiAwayOwnership }
      const destination = join(output, 'snapshot-response.json')
      await trace.run('write', 'all', () => {
        writeFileSync(destination + '.tmp', JSON.stringify(data) + '\n')
        renameSync(destination + '.tmp', destination)
      })
    })().catch(error => {
      const snapshotFailure = trace.failure(error, fatal)
      fatal ??= 'Durable snapshot failed'; save({ type: 'fixture-failed', reason: fatal })
      const destination = join(output, 'snapshot-response.json')
      writeFileSync(destination + '.tmp', JSON.stringify({ requestId: request.requestId, fatal, audit, snapshotFailure }) + '\n')
      renameSync(destination + '.tmp', destination)
    }).finally(() => { snapshotBusy = false })
  }, 50)
  ctx.effect(() => async () => { clearInterval(snapshotTimer); await snapshotTask }, 'fixture-dsh354: durable snapshot reader')
}
