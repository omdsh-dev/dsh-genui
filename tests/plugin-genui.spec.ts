import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import NodePtcRuntime from '@deepseek-ai/dsh-ptc-runtime-node'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory'
import * as GenUI from '../src/plugin/index.ts'

import { COMPONENT_SCHEMAS } from '../src/client/genui-runtime/schema.ts'

/** 启动 Skill 工具依赖的真实 DSH 宿主服务。 */
async function installSkillToolServices(ctx: Context) {
  await ctx.plugin(LocalFileSystem)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(WorkingDirectoryService)
}

/** Boot the plugin and return the assembled system-prompt sections. */
async function assemble(config?: GenUI.GenuiPluginConfig) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  await installSkillToolServices(ctx)
  await ctx.plugin(ToolSkill)
  await ctx.plugin(GenUI, config)
  return ctx.systemPrompt.assemble({})
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
    expect(text).toContain('LANGUAGE: reply+UI=conversation language')
    expect(text).toContain('NEVER infer it from prompt/skill/examples/tools')
    expect(text).toContain('never emit these placeholders literally')
    expect(text).toContain('Tool channel: render_ui')
    expect(text).not.toContain('"title":"可选标题"')
    expect(text).toContain('组件节点必须带字符串')
  })

  it.each(['full', 'minimal'] as const)('omits render_ui guidance in %s mode when the tool is disabled', async (fenceSection) => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const genui = await ctx.plugin(GenUI, { renderUiTool: false, fenceSection })
    const assembly = await ctx.systemPrompt.assemble({})
    const section = assembly.sections.find(item => item.name === 'genui:fence')
    const text = typeof section?.text === 'string' ? section.text : ''

    if (fenceSection === 'full') expect(text).toContain('validate_dsh_ui')
    expect(text).not.toContain('render_ui')
    await genui.dispose()
  })

  it('documents every supported component in the skill vocabulary', () => {
    const skill = readFileSync('SKILL.md', 'utf8')
    for (const type of Object.keys(COMPONENT_SCHEMAS)) expect(skill).toContain(`\`${type}\``)
  })

  it.each([
    { mode: 'full' as const, limit: 1600 },
    { mode: 'minimal' as const, limit: 300 },
  ])('keeps the assembled $mode fence within its character budget', async ({ mode, limit }) => {
    const assembly = await assemble({ fenceSection: mode })
    const section = assembly.sections.find(s => s.name === 'genui:fence')
    expect(section).toBeDefined()
    const text = renderPrompt({ ...assembly, sections: [section!] })
    expect(text.length).toBeLessThanOrEqual(limit)
    expect(renderPrompt(assembly).length).toBeLessThanOrEqual(limit + 1000)
    expect(text).toContain('call the skill tool to load `genui`')
    expect(text).toContain('```dsh-ui')
  })

  it('omits only fence guidance when fenceSection is false', async () => {
    const assembly = await assemble({ fenceSection: false })
    expect(assembly.sections.map(section => section.name)).not.toContain('genui:fence')
  })

  it.each(['full', 'minimal', false] as const)('supplies component fields without the skills service in %s mode', async (fenceSection) => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(GenUI, { fenceSection })
    const assembly = await ctx.systemPrompt.assemble({})
    const prompt = renderPrompt(assembly)
    expect(prompt).toContain('## 组件词汇（只允许这些 type）')
    expect(prompt).toContain('Computed（输入驱动计算）')
    expect(prompt).toContain('full option 模式')
    expect(prompt).toContain('本地优先（v2.6）')
    expect(prompt).toContain('秘密禁令')
    for (const type of Object.keys(COMPONENT_SCHEMAS)) expect(prompt).toContain(`\`${type}\``)
    expect(prompt.length).toBeLessThanOrEqual(30000)
    expect(prompt).not.toContain('call the skill tool to load `genui`')
    expect(assembly.sections.some(section => section.name === 'genui:fence')).toBe(fenceSection !== false)
    if (fenceSection === false) {
      expect(prompt).not.toContain('## 围栏书写铁律')
      expect(prompt).not.toContain('围栏位置：只写在')
      expect(prompt).not.toContain('```dsh-ui')
      expect(prompt).not.toContain('```json dsh-ui')
      expect(prompt).not.toContain('放在 dsh-ui 围栏中')
      expect(prompt).not.toContain('Travel dates')
    }
    if (fenceSection === 'minimal') {
      expect(prompt).toContain('conversation language')
      expect(prompt).toContain('validate_dsh_ui')
      expect(prompt).toContain('panel:true')
    }
  })

  it('updates the reference as the real skill tool is registered and removed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(GenUI)
    await installSkillToolServices(ctx)
    expect(renderPrompt(await ctx.systemPrompt.assemble({}))).toContain('## 组件词汇（只允许这些 type）')
    const skills = await ctx.plugin(SkillRegistry)
    expect(renderPrompt(await ctx.systemPrompt.assemble({}))).toContain('## 组件词汇（只允许这些 type）')
    const skillTool = await ctx.plugin(ToolSkill)
    const withSkills = renderPrompt(await ctx.systemPrompt.assemble({}))
    expect(withSkills).not.toContain('## 组件词汇（只允许这些 type）')
    expect(withSkills).toContain('call the skill tool to load `genui`')
    await skillTool.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble({}))).toContain('## 组件词汇（只允许这些 type）')
    await skills.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble({}))).toContain('## 组件词汇（只允许这些 type）')
  })

  it('respects the current scope when the skill tool is restricted', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillRegistry)
    await installSkillToolServices(ctx)
    await ctx.plugin(ToolSkill)
    await ctx.plugin(GenUI)
    const key = {}
    let scope!: ReturnType<typeof createScope>
    await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) }, { inject: ['tools'] }))
    scope.ctx.tools.restrict({ deny: ['skill'] })
    const restricted = renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))
    expect(restricted).toContain('## 组件词汇（只允许这些 type）')
    expect(restricted).not.toContain('call the skill tool to load `genui`')
    expect(renderPrompt(await ctx.systemPrompt.assemble({}))).toContain('call the skill tool to load `genui`')
    await scope.dispose()
  })

  it.each([true, false])('keeps the reference for a scoped skill tool with host tool=%s', async (hostTool) => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillRegistry)
    await installSkillToolServices(ctx)
    if (hostTool) await ctx.plugin(ToolSkill)
    await ctx.plugin(GenUI)
    const key = {}
    let scope!: ReturnType<typeof createScope>
    await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) }, { inject: ['tools'] }))
    scope.ctx.tools.register(defineTool({
      name: 'skill', description: 'Return the requested documentation.',
      parameters: { name: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async ({ name }) => readFileSync(name, 'utf8'),
    }))
    const prompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))
    expect(prompt).toContain('## 组件词汇（只允许这些 type）')
    expect(prompt).not.toContain('call the skill tool to load `genui`')
    await scope.dispose()
  })

  it('preserves scoped prompt sections with the same names', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(GenUI)
    const key = {}
    let scope!: ReturnType<typeof createScope>
    await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) }, { inject: ['systemPrompt'] }))
    scope.ctx.systemPrompt.section({ name: 'genui:reference', order: 1, text: 'scoped reference' })
    scope.ctx.systemPrompt.section({ name: 'genui:fence', order: 2, text: 'scoped fence' })
    const prompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))
    expect(prompt).toContain('scoped reference')
    expect(prompt).toContain('scoped fence')
    expect(prompt).not.toContain('## 组件词汇（只允许这些 type）')
    await scope.dispose()
  })

  it('detects the real skill tool through the PTC SDK', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillRegistry)
    await installSkillToolServices(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalSandboxProvider)
    await ctx.plugin(SandboxPolicyService)
    await ctx.plugin(NodePtcRuntime)
    await ctx.plugin(ToolSkill)
    await ctx.plugin(GenUI)
    const key = {}
    let scope!: ReturnType<typeof createScope>
    await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) }, { inject: ['tools', 'systemPrompt'] }))
    scope.ctx.tools.presentAs('ptc')
    const assembly = await ctx.systemPrompt.assemble({ scope: key })
    expect(assembly.tools.map(tool => tool.name)).toContain('run_code')
    expect(assembly.tools.map(tool => tool.name)).not.toContain('skill')
    expect(renderPrompt(assembly)).toContain('call the skill tool to load `genui`')
    expect(renderPrompt(assembly)).not.toContain('## 组件词汇（只允许这些 type）')
    expect(renderPrompt(assembly).length).toBeLessThanOrEqual(12000)
    await scope.dispose()
  })

  it('supplies the reference when the scoped genui skill forbids model invocation', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillRegistry)
    await installSkillToolServices(ctx)
    await ctx.plugin(ToolSkill)
    await ctx.plugin(GenUI)
    const key = {}
    let scope!: ReturnType<typeof createScope>
    await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) }, { inject: ['skills'] }))
    scope.ctx.skills.register({ name: 'genui', description: 'restricted', source: 'runtime', content: 'restricted', invocation: { modelInvocable: false, userInvocable: true } })
    const prompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))
    expect(prompt).toContain('## 组件词汇（只允许这些 type）')
    expect(prompt).not.toContain('call the skill tool to load `genui`')
    expect(renderPrompt(await ctx.systemPrompt.assemble({}))).toContain('call the skill tool to load `genui`')
    await scope.dispose()
  })

  it('omits component reference when the fence and render_ui are disabled', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(GenUI, { fenceSection: false, renderUiTool: false })
    const prompt = renderPrompt(await ctx.systemPrompt.assemble({}))
    expect(prompt).not.toContain('## 组件词汇（只允许这些 type）')
    expect(prompt).not.toContain('```dsh-ui')
  })

  it('keeps the assembled tool schemas within a separate budget', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(GenUI, { fenceSection: false })
    const assembly = await ctx.systemPrompt.assemble({})
    expect(assembly.tools.map(tool => tool.name).sort()).toEqual(['render_ui', 'validate_dsh_ui'])
    expect(JSON.stringify(assembly.tools).length).toBeLessThanOrEqual(4000)
    expect(JSON.stringify(assembly.tools)).not.toContain('GenUI system-prompt section')
    expect(JSON.stringify(assembly.tools)).not.toContain('≥3 parallel points')
    expect(JSON.stringify(assembly.tools)).not.toMatch(/fence|围栏/i)
  })

  it('carries a judgment, not a component quota', async () => {
    // The quota ("默认就该出 UI", "≥3 条要点就出 list", "一条回答 3–8 个组件")
    // shaped every answer into the same skeleton. The replacement is one
    // question; a reintroduced count is a regression, so it is asserted here.
    const assembly = await assemble()
    const section = assembly.sections.find(s => s.name === 'genui:fence')
    const text = typeof section!.text === 'string' ? section!.text : ''
    expect(text).toContain('删掉这个组件，读者会不会更费劲')
    for (const quota of ['默认就该出 UI', '3–8 个组件', '最后自检一次']) {
      expect(text).not.toContain(quota)
    }
  })

  it('keeps the skill a reference instead of a menu', async () => {
    const skill = readFileSync('SKILL.md', 'utf8')
    expect(skill).toContain('删掉这个组件，读者会不会更费劲')
    expect(skill).toContain('没有配额，也没有硬触发')
    expect(skill).toContain('根据组件是否能帮助读者理解或操作来决定是否使用')
    expect(skill).not.toContain('内容类型命中就上对应组件')
    for (const quota of ['硬触发（出现就至少出一个围栏', '从成套结构出发']) {
      expect(skill).not.toContain(quota)
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
