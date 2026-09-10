import { describe, expect, it, vi } from 'vitest'
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
    expect(text).toContain('series：bars 分组/堆叠 / line 多序列')
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

  it('uses the named host order and deterministic tie-break for structured output', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const order = ctx.systemPrompt.getSectionOrder('STRUCTURED_OUTPUT')
    const getSectionOrder = vi.spyOn(ctx.systemPrompt, 'getSectionOrder')
    ctx.systemPrompt.section({ name: 'aaa:structured-output', order, text: 'before' })

    await ctx.plugin(GenUI)
    const names = (await ctx.systemPrompt.assemble({})).sections.map(section => section.name)

    expect(getSectionOrder).toHaveBeenCalledWith('STRUCTURED_OUTPUT')
    expect(names.indexOf('aaa:structured-output')).toBeLessThan(names.indexOf('genui:fence'))
  })

  it('owns model tools across plugin unload and reload when tools already exists', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const registered = new Map<string, unknown>()
    ctx.provide('tools', {
      register: (tool: unknown) => {
        const name = (tool as { name: string }).name
        if (registered.has(name)) throw new Error(`duplicate tool: ${name}`)
        registered.set(name, tool)
        return () => { registered.delete(name) }
      },
    })

    const first = await ctx.plugin(GenUI)
    expect([...registered.keys()].sort()).toEqual(['render_ui', 'validate_dsh_ui'])

    await first.dispose()
    expect(registered.size).toBe(0)

    const second = await ctx.plugin(GenUI)
    expect([...registered.keys()].sort()).toEqual(['render_ui', 'validate_dsh_ui'])
    await second.dispose()
    expect(registered.size).toBe(0)
  })

  it('moves model tools when the optional tools service is replaced', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const genui = await ctx.plugin(GenUI)
    const firstRegistry = new Map<string, unknown>()
    const disposeFirstRegistry = ctx.provide('tools', {
      register: (tool: unknown) => {
        const name = (tool as { name: string }).name
        firstRegistry.set(name, tool)
        return () => { firstRegistry.delete(name) }
      },
    })
    await vi.waitFor(() => {
      expect([...firstRegistry.keys()].sort()).toEqual(['render_ui', 'validate_dsh_ui'])
    })

    await disposeFirstRegistry()
    expect(firstRegistry.size).toBe(0)

    const replacementRegistry = new Map<string, unknown>()
    ctx.provide('tools', {
      register: (tool: unknown) => {
        const name = (tool as { name: string }).name
        replacementRegistry.set(name, tool)
        return () => { replacementRegistry.delete(name) }
      },
    })
    await vi.waitFor(() => {
      expect([...replacementRegistry.keys()].sort()).toEqual(['render_ui', 'validate_dsh_ui'])
    })

    await genui.dispose()
    expect(replacementRegistry.size).toBe(0)
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

  it('removes the asset route before a plugin reload', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const routes = new Map<string, unknown>()
    ctx.provide('webServer', {
      register: (route: unknown) => {
        const path = (route as { path: string }).path
        if (routes.has(path)) throw new Error(`duplicate route: ${path}`)
        routes.set(path, route)
        return () => { routes.delete(path) }
      },
    })

    const first = await ctx.plugin(GenUI)
    expect([...routes.keys()]).toEqual(['/plugins/@changfenhuang/dsh-genui/assets'])

    await first.dispose()
    expect(routes.size).toBe(0)

    const second = await ctx.plugin(GenUI)
    expect([...routes.keys()]).toEqual(['/plugins/@changfenhuang/dsh-genui/assets'])
    await second.dispose()
    expect(routes.size).toBe(0)
  })

  it('moves the asset route when the optional webServer is replaced', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const genui = await ctx.plugin(GenUI)
    const firstRoutes = new Map<string, unknown>()
    const disposeFirstServer = ctx.provide('webServer', {
      register: (route: unknown) => {
        const path = (route as { path: string }).path
        firstRoutes.set(path, route)
        return () => { firstRoutes.delete(path) }
      },
    })
    await vi.waitFor(() => {
      expect(firstRoutes.get('/plugins/@changfenhuang/dsh-genui/assets')).toEqual(expect.objectContaining({ kind: 'prefix' }))
    })

    await disposeFirstServer()
    expect(firstRoutes.size).toBe(0)

    const replacementRoutes = new Map<string, unknown>()
    ctx.provide('webServer', {
      register: (route: unknown) => {
        const path = (route as { path: string }).path
        replacementRoutes.set(path, route)
        return () => { replacementRoutes.delete(path) }
      },
    })
    await vi.waitFor(() => {
      expect(replacementRoutes.get('/plugins/@changfenhuang/dsh-genui/assets')).toEqual(expect.objectContaining({ kind: 'prefix' }))
    })

    await genui.dispose()
    expect(replacementRoutes.size).toBe(0)
  })
})
