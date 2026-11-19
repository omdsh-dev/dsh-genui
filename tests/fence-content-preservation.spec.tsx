// #418: renderable JSON must not authorize hiding the rest of the reply.
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import { installDomFenceRenderer } from '../src/client/dom-fence.tsx'
import { extractDshUiFences, fenceFailures, planFenceFeedback } from '../src/plugin/fence-feedback.ts'
import { resolveFence } from '../src/shared/fence-resolve.ts'
import { completeFenceJson } from '../src/shared/fence-repair.ts'
import { createValidateDshUiTool } from '../src/plugin/tool.ts'
import { renderResolvedFenceNode } from '../src/client/fence-render.tsx'

const spec = '{"items":[{"type":"callout","content":"闭包保留外部变量的访问能力"}]}'
const explanation = '这里还需要解释：函数返回后，内部函数依然通过词法环境访问 count。';
afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.restoreAllMocks() })

it.each(['closed', 'missing-close', 'late-close'] as const)('tracks prose at the fence boundary: %s', async kind => {
  const markdown = kind === 'closed' ? '```dsh-ui\n' + spec + '\n```\n' + explanation
    : '```dsh-ui\n' + spec + '\n' + explanation + (kind === 'late-close' ? '\n```' : '');
  const fences = extractDshUiFences(markdown);
  const row = document.createElement('div');
  row.dataset.chatAnchorKey = 'sample'; row.dataset.chatNodeKey = 'sample'; row.dataset.chatFlowKind = 'assistant-step';
  const block = document.createElement('div'); block.className = 'md-code-block';
  const banner = document.createElement('div'); const label = document.createElement('div'); label.textContent = 'dsh-ui'; banner.append(label);
  const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = fences[0]!.raw; pre.append(code); block.append(banner, pre); row.append(block);
  if (kind === 'closed') { const prose = document.createElement('p'); prose.textContent = explanation; row.append(prose) }
  if (kind === 'missing-close') row.dataset.streaming = '';
  document.body.append(row);
  const ctx = { sessions: { list: { getSnapshot: () => ({ ids: ['s'] }) }, retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: 1 } }) }) } } as unknown as Context;
  const dispose = installDomFenceRenderer(ctx, () => {});
  try {
    if (kind === 'missing-close') {
      await waitFor(() => expect(block.style.display).toBe('none'))
      row.removeAttribute('data-streaming')
    }
    if (kind === 'closed') {
      await waitFor(() => expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('闭包保留'))
      expect(block.style.display).toBe('none')
      expect(fenceFailures(markdown)).toEqual([])
    } else {
      await waitFor(() => expect(row.querySelector('[role=alert]')).not.toBeNull())
      expect(block.style.display).not.toBe('none')
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
      expect(fenceFailures(markdown)[0]?.detail).toContain('error=unconsumed_content')
      const plan = planFenceFeedback({text: markdown, turn: 1, correctedSpec: new Set(), validatedThisTurn: true, deliveredThisTurn: true, aborted: false})
      expect(plan?.text).toContain('next=resend_corrected_fence_and_preserved_text')
    }
    const visibleProse = [...row.children].filter(e => (e as HTMLElement).style.display !== 'none').map(e => e.textContent).join('')
    expect(visibleProse).toContain(explanation)
    if (kind !== 'closed') {
      expect(row.querySelector('[data-genui-export]')).toBeNull()
      code.textContent = spec
      const prose = document.createElement('p')
      prose.textContent = explanation
      block.after(prose)
      await waitFor(() => expect(block.style.display).toBe('none'))
      expect(prose.isConnected).toBe(true)
      expect(prose.style.display).not.toBe('none')
      expect(row.querySelector('[role=alert]')).toBeNull()
    }
  } finally { dispose() }
});

it.each([
  spec,
  '[{"type":"text","content":"quoted } ] and \\\"word\\\""}]',
  '{"items":[{"type":"text","content":"say "hello" now"}]}',
  '{"items":[{"type":"text",["content"]:"text"}]}',
])('refuses a lossy validator replacement: %s', async root => {
  const raw = `${root}\n${explanation}\n<script>window.tailExecuted=true</script>`
  expect(completeFenceJson(raw)?.unconsumedText).toContain(explanation)
  const resolution = resolveFence(raw, { settled: true })
  expect(resolution.spec).toBeNull()
  expect(resolution.unconsumedText).toContain(explanation)
  const result = String(await createValidateDshUiTool().execute({ spec: raw }))
  expect(result).toContain('error=unconsumed_content')
  expect(result).toContain('preserve_unconsumed_content=true')
  expect(result).not.toContain('repaired_json:')
  expect(result).not.toContain('next=emit_repaired_fence')
})

it('does not publish or export a panel whose tail would be hidden', () => {
  const raw = spec.replace('{"items"', '{"panel":true,"items"') + explanation
  expect(renderResolvedFenceNode(raw, 'panel', {
    sessionId: 's', source: { id: 'sample', order: [1, 0, 0] },
  })).toBeNull()
})

it('keeps normal unclosed JSON, whitespace, and full-body syntax repair renderable', () => {
  for (const raw of [spec, `${spec}\n  `, spec.replace('}]}', '},]}')]) {
    expect(resolveFence(raw, { settled: true }).spec).not.toBeNull()
    expect(fenceFailures(`\`\`\`dsh-ui\n${raw}`)).toEqual([])
  }
})
