/** Source-shaped seed contracts only; real official format/persistence reproduction
 * is separate evidence, not a mock-host or browser acceptance claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const fixture = readFileSync(new URL('../fixture/lib/index.mjs', import.meta.url), 'utf8')
const start = fixture.indexOf('    for (const agent of participants) {')
const end = fixture.indexOf('    // All three assistant events', start)
assert.ok(start >= 0 && end > start)
const seedParticipants = vm.runInNewContext('(function(participants, PARENT_ID, PROVIDER, MODEL, installModelSelection, createSystemMessage) {' + fixture.slice(start, end) + '\n})')
function participants() {
  return ['parent', 'a', 'b'].map(id => {
    const events = [], session = { id, append(type, data, intent) { events.push({ type, data, intent }) } }
    return { id, session, ctx: {}, events }
  })
}
test('all three seeded participants establish an empty system head before user surface', () => {
  const agents = participants(), calls = []
  seedParticipants(agents, 'parent', 'synthetic-provider', 'synthetic-model', () => {}, text => {
    calls.push(text)
    return { id: 'synthetic-system-' + calls.length, role: 'system', source: { kind: 'system-prompt' }, content: [] }
  })
  assert.deepEqual(calls, ['', '', ''])
  for (const agent of agents) {
    const surface = agent.events.filter(event => event.intent?.surfaceOp === 'append')
    assert.deepEqual(surface.map(event => event.type), ['system/message', 'user/message'])
    assert.equal(surface[0].data.turn, 1); assert.equal(surface[0].data.step, 1)
    assert.equal(surface[0].data.message.role, 'system'); assert.deepEqual(surface[0].data.message.content, [])
    assert.equal(surface[0].data.message.source.kind, 'system-prompt')
    assert.equal(agent.events.at(-3).type, 'step/start')
    assert.equal(surface[1].data.id, `fixture-user-${agent.id}`)
    assert.equal(surface[1].data.content[0].text, 'Synthetic DSH354 fixture. Display the isolation form.')
  }
})
test('system factory failure is propagated instead of seeding an invalid surface', () => {
  const agents = participants(), failure = new Error('Synthetic factory failure')
  assert.throws(() => seedParticipants(agents, 'parent', 'p', 'm', () => {}, () => { throw failure }), error => error === failure)
  assert.equal(agents[0].events.filter(event => event.intent?.surfaceOp === 'append').length, 0)
})
test('fixture uses the official host-resolved system-message factory with an empty prompt', () => {
  assert.match(fixture, /const \{ createSystemMessage \} = await import\(pathToFileURL\(config\.llmModule\)\.href\)/u)
  assert.match(fixture.slice(start, end), /message: createSystemMessage\(''\)/u)
})
