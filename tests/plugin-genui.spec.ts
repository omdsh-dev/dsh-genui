import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as GenUI from '../src/plugin/index.ts'

/** Boot the plugin and return the assembled system-prompt sections. */
async function assemble() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(GenUI)
  return ctx.systemPrompt.assemble({})
}

/** The complete whitelist the slim fence section must still advertise. */
const WHITELISTED_COMPONENT_TYPES = [
  'text', 'row', 'col', 'grid', 'card',
  'button', 'input', 'textarea', 'select', 'checkbox', 'switch', 'slider', 'radio', 'submit', 'quiz', 'link',
  'badge', 'stat', 'progress', 'divider', 'spacer', 'list', 'table', 'audio', 'video',
  'chart', 'tabs', 'accordion', 'avatar', 'plot', 'callout', 'steps',
  'keyvalue', 'json', 'code', 'diff', 'copy',
  'mermaid', 'scene3d', 'timeline', 'file-tree', 'breadcrumb',
] as const

describe('genui:fence section', () => {
  it('registers the dsh-ui fence language section', async () => {
    const assembly = await assemble()
    const names = assembly.sections.map(s => s.name)
    expect(names).toContain('genui:fence')
  })

  it('teaches the fence syntax and the component vocabulary', async () => {
    const assembly = await assemble()
    const section = assembly.sections.find(s => s.name === 'genui:fence')
    expect(section).toBeDefined()
    const text = typeof section!.text === 'string' ? section!.text : ''
    expect(text).toContain('dsh-ui')
    // The model must know the white-listed component types.
    for (const type of ['text', 'card', 'grid', 'stat', 'table', 'audio', 'video', 'chart', 'tabs', 'button', 'progress', 'plot', 'callout', 'steps', 'diff', 'mermaid', 'scene3d']) {
      expect(text).toContain(type)
    }
    expect(text).toContain('"kind":"bars|line|donut"')
    expect(text).toContain('"label":"...","value":n')
    expect(text).toContain('series 仅 bars')
  })

  it('keeps the full type whitelist in the slim section within the token budget', async () => {
    // Issue #29: GENUI_SECTION_TEXT is a fixed per-request cost, so the slim
    // section must stay compact while still listing every allowed type.
    const assembly = await assemble()
    const section = assembly.sections.find(s => s.name === 'genui:fence')
    expect(section).toBeDefined()
    const text = typeof section!.text === 'string' ? section!.text : ''
    // Budget: 3200 chars keeps the mixed CJK/ASCII section near ~1k tokens
    // (CJK ≈ 1 tok/char, ASCII ≈ 0.25 tok/char) — roughly half of the
    // original ~6.1k chars / ~2.3k tokens measured in issue #29.
    expect(text.length).toBeLessThanOrEqual(3200)
    for (const type of WHITELISTED_COMPONENT_TYPES) {
      expect(text).toContain(type)
    }
  })

  it('sorts the section among the tool-guidance sections', async () => {
    const assembly = await assemble()
    const names = assembly.sections.map(s => s.name)
    // The section lands among the tool-guidance band, not at the harness identity head.
    const index = names.indexOf('genui:fence')
    expect(index).toBeGreaterThan(0)
  })

  it('registers the render_ui tool when the tools service exists', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const registered: unknown[] = []
    ctx.provide('tools', { register: (tool: unknown) => { registered.push(tool) } })
    await ctx.plugin(GenUI)
    expect(registered).toHaveLength(2)
    const names = registered.map(t => (t as { name: string }).name).sort()
    expect(names).toEqual(['render_ui', 'validate_dsh_ui'])
  })

  it('registers render_ui when tools binds AFTER the plugin (start-up ordering)', async () => {
    // Regression: this plugin injects only systemPrompt, so cordis starts it
    // before the tools provider (which injects deeper dependencies) on real
    // hosts. A one-shot probe at apply time silently missed the registry —
    // the fence section landed, the tool never registered. The plugin must
    // subscribe to the service-binding event and register when tools appears.
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(GenUI) // plugin first — tools not yet provided
    const registered: unknown[] = []
    ctx.provide('tools', { register: (tool: unknown) => { registered.push(tool) } })
    expect(registered).toHaveLength(2)
    const names = registered.map(t => (t as { name: string }).name).sort()
    expect(names).toEqual(['render_ui', 'validate_dsh_ui'])
  })

  it('registers genui through the real skill registry', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(SkillRegistry)

    const genui = await ctx.plugin(GenUI)

    expect(await ctx.skills.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'genui',
        provider: 'dsh-genui',
        source: 'bundled',
        invocation: {
          modelInvocable: true,
          userInvocable: true,
        },
      }),
    ]))

    const skill = await ctx.skills.get('genui')
    expect(skill).toMatchObject({
      name: 'genui',
      provider: 'dsh-genui',
      source: 'bundled',
    })
    expect(skill?.description).toContain('完整组件与字段规范')
    expect(skill?.content).toContain('chart:')
    expect(skill?.content).not.toContain('name: genui')

    await genui.dispose()
    expect((await ctx.skills.list()).find(skill => skill.name === 'genui')).toBeUndefined()
  })

  it('registers genui when the real skill service binds after the plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(GenUI)
    await ctx.plugin(SkillRegistry)

    expect((await ctx.skills.list()).find(skill => skill.name === 'genui')).toMatchObject({
      name: 'genui',
      provider: 'dsh-genui',
      source: 'bundled',
    })
    expect(await ctx.skills.get('genui')).toBeDefined()
  })

  it('keeps the fence channel without a tools service', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(GenUI)
    const assembly = await ctx.systemPrompt.assemble({})
    expect(assembly.sections.map(s => s.name)).toContain('genui:fence')
  })

  it('registers the asset route when webServer binds after the plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(GenUI)
    const routes: unknown[] = []
    ctx.provide('webServer', { register: (route: unknown) => { routes.push(route) } })
    expect(routes).toEqual([expect.objectContaining({
      kind: 'prefix',
      path: '/plugins/@changfenhuang/dsh-genui/assets',
    })])
  })
})
