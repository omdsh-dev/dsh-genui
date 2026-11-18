import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as GenUI from '../src/plugin/index.ts'

import { COMPONENT_SCHEMAS } from '../src/client/genui-runtime/schema.ts'

/** Assemble the prompt with a visible Skill tool when requested. */
async function assemble(config?: GenUI.GenuiPluginConfig, skillTool: boolean | 'scoped' | 'incompatible' = true, userSkill?: string) {
  const ctx = new Context()
  const scope = skillTool === 'scoped' || skillTool === 'incompatible' ? {} : undefined
  await ctx.plugin(SystemPrompt)
  if (skillTool) {
    await ctx.plugin(SkillRegistry)
    if (userSkill !== undefined) {
      const candidate = { name: 'genui', description: 'User GenUI guidance', invocation: { modelInvocable: true, userInvocable: true }, source: 'user-dsh', provider: 'test-user', rank: 0, locator: 'user-genui' }
      ctx.skills.registerProvider(() => ({ name: 'test-user', list: async () => [candidate], get: async () => ({ ...candidate, content: userSkill }) }))
    }
    const loader = { name: 'skill', parameters: { type: 'object', properties: { name: { type: 'string' } } }, output: { schema: { type: 'object', properties: { content: { type: 'string' } } } } }
    const definitions = new Map<string, { name: string }>([['skill', skillTool === 'incompatible' ? { name: 'skill' } : loader]])
    ctx.provide('tools', {
      register: (tool: { name: string }) => {
        definitions.set(tool.name, tool)
        return () => { definitions.delete(tool.name) }
      },
      get: (name: string, viewingScope?: object) => name === 'skill' && scope && viewingScope !== scope ? undefined : definitions.get(name),
      schemas: () => [...definitions.values()].map(tool => ({ name: tool.name })),
    } as never)
  }
  await ctx.plugin(GenUI, config)
  return ctx.systemPrompt.assemble({ scope: scope as never })
}

const BROKEN_FENCE_REPLY = '```dsh-ui\n{"items":[{"type":"stat"}]}\n```'

/** 将已经结束的 assistant 回复写入真实 Cordis Context。 */
function emitAssistantReply(ctx: Context, session: object): void {
  ctx.emit('session/event', session as never, {
    type: 'assistant/message',
    seq: 1,
    time: 1,
    data: { message: { content: [{ type: 'text', text: BROKEN_FENCE_REPLY }] } },
  } as never)
}

/** 写入 validate_dsh_ui 调用事件，触发本轮无交付修正路径。 */
function emitValidationToolCall(ctx: Context, session: object): void {
  ctx.emit('session/event', session as never, {
    type: 'tool/call',
    seq: 2,
    time: 2,
    data: { name: 'validate_dsh_ui' },
  } as never)
}

/** 触发允许插件请求修正的回合结束事件。 */
function emitTurnStopping(ctx: Context, session: object, steer: (message: { content: Array<{ text: string }> }) => void): void {
  ctx.emit('agent/turn-stopping', {
    agent: { session, steer },
    turn: 1,
    signal: new AbortController().signal,
  } as never)
}

describe('genui:fence section', () => {
  it('uses current fields when an older user skill shadows the bundled reference', async () => {
    const stale = await assemble(undefined, true, 'User preference: concise. Old fields and delivery examples.')
    expect(stale.sections.find(section => section.name === 'genui:reference')?.text).toContain('shownPeople')
    const guidance = stale.sections.find(section => section.name === 'genui:fence')!.text
    expect(guidance).toContain('MUST call the skill tool to load `genui`')
    expect(guidance).toContain('current system guidance and reference updates MUST take precedence')
    const currentBody = readFileSync('SKILL.md', 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim()
    const current = await assemble(undefined, true, currentBody)
    expect(current.sections.find(section => section.name === 'genui:reference')?.text).toBe('')
    expect(current.sections.find(section => section.name === 'genui:fence')?.text).toContain('call the skill tool')
    for (const fenceSection of ['full', 'minimal', false] as const) {
      const customized = await assemble({ fenceSection }, true, `${currentBody}\n\nUser preference: keep diagrams in monochrome.`)
      expect(customized.sections.find(section => section.name === 'genui:reference')?.text).toBe('')
      if (fenceSection !== false) expect(customized.sections.find(section => section.name === 'genui:fence')?.text).toContain('call the skill tool')
    }
  })

  it('loads agent-scoped skills without injecting a complete reference in any mode', async () => {
    const currentBody = readFileSync('SKILL.md', 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim()
    for (const fenceSection of ['full', 'minimal', false] as const) {
      const current = await assemble({ fenceSection }, 'scoped', currentBody)
      expect(current.sections.find(section => section.name === 'genui:reference')?.text).toBe('')
      if (fenceSection !== false) expect(current.sections.find(section => section.name === 'genui:fence')?.text).toContain('MUST call the skill tool')
      const oldBody = currentBody.replace(/交互区内随输入变化的数字[^\n]+\n/, '')
      const older = await assemble({ fenceSection }, 'scoped', oldBody)
      const update = older.sections.find(section => section.name === 'genui:reference')!.text
      expect(update).toContain('交互区内随输入变化的数字')
      expect(update).not.toContain('- table:')
      expect(update).not.toContain('- chart:')
      expect(update).not.toContain('地图 `map`')
    }
  })

  it('retains the fallback for a same-name tool without the skill loader contract', async () => {
    const assembly = await assemble({ fenceSection: 'minimal' }, 'incompatible')
    expect(assembly.sections.find(section => section.name === 'genui:reference')?.text).toContain('- chart:')
    expect(assembly.sections.find(section => section.name === 'genui:fence')?.text).not.toContain('call the skill tool')
  })

  it('registers the dsh-ui fence language section', async () => {
    const assembly = await assemble()
    const names = assembly.sections.map(s => s.name)
    expect(names).toContain('genui:fence')
  })

  it('teaches the fence syntax and requests the component skill', async () => {
    const assembly = await assemble()
    const section = assembly.sections.find(s => s.name === 'genui:fence')
    expect(section).toBeDefined()
    const text = typeof section!.text === 'string' ? section!.text : ''
    expect(text).toContain('dsh-ui')
    expect(text).toContain('call the skill tool to load `genui`')
    expect(text).toContain('LANGUAGE: MUST match reply+UI to conversation language')
    expect(text).toContain('NEVER infer it from examples/tools')
    expect(text).toContain('never emit placeholders literally')
    expect(text).toContain('Tool channel: render_ui')
    expect(text).not.toContain('"title":"可选标题"')
  })

  it('omits render_ui guidance from the system prompt when the tool is disabled', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const genui = await ctx.plugin(GenUI, { renderUiTool: false })
    const assembly = await ctx.systemPrompt.assemble({})
    const section = assembly.sections.find(item => item.name === 'genui:fence')
    const text = typeof section?.text === 'string' ? section.text : ''

    expect(text).toContain('validate_dsh_ui')
    expect(text).not.toContain('render_ui')
    await genui.dispose()
  })

  it('keeps fence modes within budget and supplies the bundled component reference when needed', async () => {
    for (const { fenceSection, limit } of [
      { fenceSection: 'full' as const, limit: 1600 },
      { fenceSection: 'minimal' as const, limit: 300 },
      { fenceSection: false as const, limit: 0 },
    ]) {
      const assembly = await assemble({ fenceSection })
      const section = assembly.sections.find(s => s.name === 'genui:fence')
      if (fenceSection === false) {
        expect(section).toBeUndefined()
      } else {
        expect(section).toBeDefined()
        const text = renderPrompt({ ...assembly, sections: [section!] })
        expect(text.length).toBeLessThanOrEqual(limit)
        expect(text).toContain('call the skill tool to load `genui`')
        if (fenceSection === 'minimal') expect(text).toContain('fenceSection: minimal')
      }
      expect(assembly.sections.find(s => s.name === 'genui:reference')?.text).toBe('')
    }

    const fallback = await assemble({ fenceSection: 'minimal' }, false)
    const reference = fallback.sections.find(section => section.name === 'genui:reference')
    expect(reference?.text).toContain('## 组件词汇（只允许这些 type）')
    for (const type of Object.keys(COMPONENT_SCHEMAS)) expect(reference?.text).toContain(`\`${type}\``)
    expect(fallback.sections.find(section => section.name === 'genui:fence')?.text).toContain('Follow the GenUI reference in this system prompt.')

    for (const fenceSection of ['full', 'minimal'] as const) {
      const withoutLoader = await assemble({ fenceSection }, false)
      const sections = withoutLoader.sections.filter(section => section.name.startsWith('genui:'))
      expect(renderPrompt({ ...withoutLoader, sections }).length).toBeLessThanOrEqual(3400)
    }

    const withoutTools = await assemble({ fenceSection: false }, false)
    expect(withoutTools.sections.find(section => section.name === 'genui:reference')?.text).toBe('')

    const disabled = await assemble({ fenceSection: false, renderUiTool: false }, false)
    expect(disabled.sections.find(section => section.name === 'genui:fence')).toBeUndefined()
    expect(disabled.sections.find(section => section.name === 'genui:reference')?.text).toBe('')
  })

  it('makes proactive semantic guidance the default with or without Skill and render_ui', async () => {
    // Full is proactive by default. The Skill must preserve that preference;
    // neither the number of bullets nor answer length decides whether to use UI.
    for (const skillTool of [true, false]) {
      for (const renderUiTool of [true, false]) {
        const assembly = await assemble({ fenceSection: 'full', renderUiTool }, skillTool)
        const text = assembly.sections.find(section => section.name === 'genui:fence')!.text
        expect(text).toContain('fenceSection: full')
        expect(text).toContain('不必等用户提醒')
        for (const component of ['table', 'chart', 'diagram', 'compare', 'input']) expect(text).toContain(component)
        expect(text).toContain('MUST 服从用户明确的纯文字要求')
        expect(text).toContain('SHOULD 优先直接用最小的合适组件')
        expect(text).toContain('普通解释和短清单默认正文')
        expect(text).toContain('逐字复制')
        expect(text).toContain('validated_json')
        expect(text).toContain('生成围栏本身不是仓库视觉改动')
        expect(text).not.toContain('≥3 条')
        expect(text.includes('Tool channel: render_ui')).toBe(renderUiTool)
        expect(text.includes('call the skill tool')).toBe(skillTool)
      }
    }
    const defaultAssembly = await assemble()
    const fullAssembly = await assemble({ fenceSection: 'full' })
    expect(defaultAssembly.sections.find(section => section.name === 'genui:fence')?.text)
      .toBe(fullAssembly.sections.find(section => section.name === 'genui:fence')?.text)
  })

  it('promotes appropriate tasks without a component quota or an extra opt-in gate', async () => {
    const assembly = await assemble()
    const section = assembly.sections.find(s => s.name === 'genui:fence')
    const text = typeof section!.text === 'string' ? section!.text : ''
    expect(text).toContain('优先直接用最小的合适组件')
    expect(text).not.toContain('会才出；不会就写正文')
    for (const quota of ['默认就该出 UI', '3–8 个组件', '最后自检一次']) {
      expect(text).not.toContain(quota)
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

  it.each([
    { name: 'default config', config: undefined, expected: ['render_ui', 'validate_dsh_ui'] },
    { name: 'renderUiTool enabled', config: { renderUiTool: true }, expected: ['render_ui', 'validate_dsh_ui'] },
    { name: 'renderUiTool disabled', config: { renderUiTool: false }, expected: ['validate_dsh_ui'] },
    { name: 'renderUiTool and fenceFeedback disabled', config: { renderUiTool: false, fenceFeedback: false }, expected: ['validate_dsh_ui'] },
  ])('registers the configured model tools with $name', async ({ config, expected }) => {
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

    const genui = await ctx.plugin(GenUI, config)
    expect([...registered.keys()].sort()).toEqual(expected)

    await genui.dispose()
    expect(registered.size).toBe(0)
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

  it('registers only validate_dsh_ui when tools becomes available later', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const genui = await ctx.plugin(GenUI, { renderUiTool: false })
    const registered = new Map<string, unknown>()
    ctx.provide('tools', {
      register: (tool: unknown) => {
        const name = (tool as { name: string }).name
        if (registered.has(name)) throw new Error(`duplicate tool: ${name}`)
        registered.set(name, tool)
        return () => { registered.delete(name) }
      },
    })

    await vi.waitFor(() => {
      expect([...registered.keys()]).toEqual(['validate_dsh_ui'])
    })

    await genui.dispose()
    expect(registered.size).toBe(0)
  })

  it('keeps only validate_dsh_ui when the tools service is replaced', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const genui = await ctx.plugin(GenUI, { renderUiTool: false })
    const firstRegistry = new Map<string, unknown>()
    const disposeFirstRegistry = ctx.provide('tools', {
      register: (tool: unknown) => {
        const name = (tool as { name: string }).name
        firstRegistry.set(name, tool)
        return () => { firstRegistry.delete(name) }
      },
    })
    await vi.waitFor(() => {
      expect([...firstRegistry.keys()]).toEqual(['validate_dsh_ui'])
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
      expect([...replacementRegistry.keys()]).toEqual(['validate_dsh_ui'])
    })

    await genui.dispose()
    expect(replacementRegistry.size).toBe(0)
  })

  it('applies the current tool config across plugin unload and reloads', async () => {
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

    const disabled = await ctx.plugin(GenUI, { renderUiTool: false })
    expect([...registered.keys()]).toEqual(['validate_dsh_ui'])
    await disabled.dispose()
    expect(registered.size).toBe(0)

    const enabled = await ctx.plugin(GenUI)
    expect([...registered.keys()].sort()).toEqual(['render_ui', 'validate_dsh_ui'])
    await enabled.dispose()
    expect(registered.size).toBe(0)

    const disabledAgain = await ctx.plugin(GenUI, { renderUiTool: false })
    expect([...registered.keys()]).toEqual(['validate_dsh_ui'])
    await disabledAgain.dispose()
    expect(registered.size).toBe(0)
  })

  it('registers genui through the real skill registry', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(SkillRegistry)

    const genui = await ctx.plugin(GenUI)

    const catalog = await ctx.skills.list()
    expect(catalog).toEqual(expect.arrayContaining([
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
    const summary = catalog.find(skill => skill.name === 'genui')
    const frontmatter = readFileSync('SKILL.md', 'utf8').split('\n---\n')[0]
    expect(frontmatter?.split('\n')).toContain(`description: ${JSON.stringify(summary?.description)}`)

    const skill = await ctx.skills.get('genui')
    expect(skill).toMatchObject({
      name: 'genui',
      provider: 'dsh-genui',
      source: 'bundled',
    })
    expect(skill?.description).toBe(summary?.description)
    expect(skill?.description).toContain('Preserve conversation language')
    expect(skill?.description).not.toMatch(/[\u3400-\u9fff]/u)

    // The description the panel shows is PARSED out of SKILL.md, not a second copy in
    // code. Asserting the two agree would not catch the bug: both copies shared the
    // sentence \`Preserve conversation language\`, and they had already drifted apart
    // everywhere else, so a substring check passed while the panel showed a stale
    // sentence the model never read. Compare against the file instead.
    const skillMd = readFileSync(join(process.cwd(), 'SKILL.md'), 'utf8')
    const front = skillMd.slice(4, skillMd.indexOf('\n---\n', 4))
    const declared = /^description:\s*(.+?)\s*$/mu.exec(front)?.[1]?.replace(/^['"]|['"]$/gu, '')
    expect(declared, 'SKILL.md must declare a description').toBeDefined()
    expect(skill?.description).toBe(declared)
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

  it('enables final fence feedback by default', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const genui = await ctx.plugin(GenUI)
    const session = { id: 'default-feedback', header: { id: 'default-feedback' }, snapshotEvents: () => [] }
    let steerCalls = 0
    const steer = () => { steerCalls += 1 }
    emitAssistantReply(ctx, session)
    emitTurnStopping(ctx, session, steer)
    expect(steerCalls).toBe(1)
    await genui.dispose()
  })

  it('keeps final fence feedback enabled when render_ui registration is disabled', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const registered = new Map<string, unknown>()
    ctx.provide('tools', {
      register: (tool: unknown) => {
        const name = (tool as { name: string }).name
        registered.set(name, tool)
        return () => { registered.delete(name) }
      },
    })
    const genui = await ctx.plugin(GenUI, { renderUiTool: false })
    const session = { id: 'render-ui-disabled-feedback', header: { id: 'render-ui-disabled-feedback' }, snapshotEvents: () => [] }
    let steerCalls = 0
    const steer = () => { steerCalls += 1 }
    emitAssistantReply(ctx, session)
    emitTurnStopping(ctx, session, steer)

    expect([...registered.keys()]).toEqual(['validate_dsh_ui'])
    expect(steerCalls).toBe(1)
    await genui.dispose()
    expect(registered.size).toBe(0)
  })

  it('steers a fence-only delivery correction when render_ui is disabled', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const genui = await ctx.plugin(GenUI, { renderUiTool: false })
    const session = { id: 'render-ui-disabled-delivery', header: { id: 'render-ui-disabled-delivery', version: 4 }, snapshotEvents: () => [] }
    const steered: Array<{ content: Array<{ text: string }> }> = []
    const steer = (message: { content: Array<{ text: string }> }) => { steered.push(message) }
    emitValidationToolCall(ctx, session)
    emitTurnStopping(ctx, session, steer)

    expect(steered).toHaveLength(1)
    expect(steered[0]!.content[0]!.text).toContain('status=nothing_delivered')
    expect(steered[0]!.content[0]!.text).toContain('需要 UI 时，在回答正文输出你最终选定的 dsh-ui 围栏。')
    expect(steered[0]!.content[0]!.text).not.toContain('render_ui')
    await genui.dispose()
  })

  it('allows final fence feedback to be disabled explicitly', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const genui = await ctx.plugin(GenUI, { fenceFeedback: false })
    const session = { id: 'disabled-feedback', header: { id: 'disabled-feedback' }, snapshotEvents: () => [] }
    let steerCalls = 0
    const steer = () => { steerCalls += 1 }
    emitAssistantReply(ctx, session)
    emitTurnStopping(ctx, session, steer)
    expect(steerCalls).toBe(0)
    await genui.dispose()
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
