// @vitest-environment jsdom
import { Fragment, createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { fileAddressFor, sessionFileAddress } from '../src/client/file-address.ts'
import { classifyLinkTarget, parseFileLink } from '../src/client/file-link.ts'
import { createFileLinkAvailability, withFileLinkContext, type FileLinkCordisContext } from '../src/client/file-link-context.tsx'
import { renderInline } from '../src/client/inline.ts'
import { renderGenuiFence } from '../src/client/fence-render.tsx'
import { installDomFenceRenderer } from '../src/client/dom-fence.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const available: Parameters<typeof withFileLinkContext>[1] = {
  subscribe: () => () => {},
  getSnapshot: () => true,
}

/** Create a mock host context with controllable session and sidebar services. */
function sessionContext(sessionId = 'session-1', cwd = '/workspace/app') {
  let current = sessionId
  let service: { openResource: ReturnType<typeof vi.fn> } | undefined
  let onProvide: ((scope: {
    get(name: 'sidebarRight'): { openResource: (address: string, options?: { params: { line: number } }) => void } | undefined
    effect(callback: () => void | (() => void)): unknown
  }) => void) | undefined
  let serviceCleanup: (() => void) | undefined
  const ctx = {
    get: vi.fn((name: 'sidebarRight') => name === 'sidebarRight' ? service : undefined),
    sessions: { list: { getSnapshot: () => ({
      current,
      byId: {
        [sessionId]: { id: sessionId, cwd, retainedBy: { mainView: 1 } },
        'session-2': { id: 'session-2', cwd: '/other', retainedBy: { mainView: current === 'session-2' ? 1 : 0 } },
      },
    }) } },
    inject: vi.fn((_names: ['sidebarRight'], callback: typeof onProvide) => { onProvide = callback })
  } as unknown as FileLinkCordisContext
  const availability = createFileLinkAvailability(ctx)
  return {
    ctx,
    availability,
    setCurrent(value: string) { current = value },
    service() { return service },
    provide(openResource = vi.fn()) {
      service = { openResource }
      onProvide?.({
        get: () => service,
        effect(callback) {
          serviceCleanup = callback() ?? undefined
          return serviceCleanup
        },
      })
      return openResource
    },
    remove() {
      serviceCleanup?.()
      serviceCleanup = undefined
      service = undefined
    },
  }
}

/** Render a GenUI spec inside the shared file-link context. */
function renderSpec(items: unknown[], session = sessionContext()) {
  const spec = repairGenuiSpec({ items })!
  const action = vi.fn()
  const view = render(withFileLinkContext(
    session.ctx,
    session.availability,
    'session-1',
    false,
    createElement(GenuiActionContext.Provider, { value: action }, createElement(GenuiBlock, { spec })),
  ))
  return { ...view, action, session }
}

describe('parseFileLink', () => {
  it('accepts relative, POSIX absolute, and Windows drive paths', () => {
    expect(parseFileLink('src/main/Foo.java')).toEqual({ path: 'src/main/Foo.java' })
    expect(parseFileLink('/workspace/src/Foo.java')).toEqual({ path: '/workspace/src/Foo.java' })
    expect(parseFileLink('C:\\work\\Foo.java')).toEqual({ path: 'C:\\work\\Foo.java' })
  })

  it('decodes path escapes and uses the first line of an accepted range', () => {
    expect(parseFileLink('src/My%20File%23part%3Fname.ts#L108')).toEqual({ path: 'src/My File#part?name.ts', line: 108 })
    expect(parseFileLink('src/File.ts#L108-L110')).toEqual({ path: 'src/File.ts', line: 108 })
    expect(parseFileLink('C%3A%5Cwork%5CFoo.java#L24')).toEqual({ path: 'C:\\work\\Foo.java', line: 24 })
  })

  it.each([
    'javascript:alert(1)', 'file:///tmp/a', 'dsh-resource://file/session/s/a', 'https://example.com',
    '//server/share/a', '\\\\server\\share\\a', 'src/File.ts?raw=1', 'src/%ZZ.ts',
    'src/Bad\nName.ts', '#L12', 'src/File.ts#L0', 'src/File.ts#L9007199254740992',
    'src/File.ts#L12-L11', 'src/File.ts#L12-Lx', 'src/File.ts#L12?raw=1', 'x'.repeat(2049),
  ])('rejects invalid destination %s', (value) => {
    expect(parseFileLink(value)).toBeUndefined()
  })

  it('classifies external links, file links, and invalid targets', () => {
    expect(classifyLinkTarget('https://example.com')).toEqual({ type: 'external', href: 'https://example.com' })
    expect(classifyLinkTarget('mailto:a@example.com')).toEqual({ type: 'external', href: 'mailto:a@example.com' })
    expect(classifyLinkTarget('src/File.ts#L3')).toEqual({ type: 'file', file: { path: 'src/File.ts', line: 3 } })
    expect(classifyLinkTarget('javascript:alert(1)')).toEqual({ type: 'invalid' })
  })
})

describe('file resource addresses', () => {
  it('preserves path segment encoding, session identity, and Windows drive colons', () => {
    expect(sessionFileAddress('s 1', './src/A #?.ts')).toBe('dsh-resource://file/session/s%201/src/A%20%23%3F.ts')
    expect(fileAddressFor('s1', '/workspace/app', '/workspace/app/src/A #?.ts')).toBe('dsh-resource://file/session/s1/src/A%20%23%3F.ts')
    expect(fileAddressFor('s1', 'C:\\workspace\\app', 'C:\\workspace\\app\\src\\A.ts')).toBe('dsh-resource://file/session/s1/src/A.ts')
    expect(fileAddressFor('s1', '/workspace/app', 'D:\\outside\\A.ts')).toBe('dsh-resource://file/session/s1/D:/outside/A.ts')
  })
})

describe('file links in GenUI rendering', () => {
  it('renders links from text, list, and callout content through the shared button', () => {
    const host = sessionContext()
    host.provide()
    const view = renderSpec([
      { type: 'text', content: '[Text](src/text.ts#L4)' },
      { type: 'list', items: ['[List](src/list.ts#L5)'] },
      { type: 'callout', content: '[Callout](src/callout.ts#L6)' },
    ], host)
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(view.container.querySelectorAll('button button')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Text (src/text.ts)' }))
    expect(view.action).not.toHaveBeenCalled()
  })

  it('renders table text, badge, delta, and detail text links without nesting controls', () => {
    const host = sessionContext()
    host.provide()
    const view = renderSpec([{
      type: 'table', columns: ['路径', '标记', '变化'], types: ['text', 'badge', 'delta'],
      rows: [
        ['[Alpha](src/alpha.ts#L7)', '[Badge](src/badge.ts#L8)', '+1 [Delta](src/delta.ts#L10)'],
        ['[Beta](src/beta.ts#L9)', '[Badge Two](src/badge-two.ts#L9)', '-2 [Delta Two](src/delta-two.ts#L10)'],
      ],
      details: [[{ type: 'text', content: '[Detail](src/detail.ts#L11)' }], null],
    }], host)
    expect(view.container.querySelectorAll('tbody button')).toHaveLength(7)
    expect(view.container.querySelectorAll('button button, a button, button a')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '展开 Alpha 的明细' }))
    const detailLink = screen.getByRole('button', { name: 'Detail (src/detail.ts)' })
    expect(detailLink.getAttribute('type')).toBe('button')
    expect(detailLink.title).toBe('src/detail.ts')
    fireEvent.click(screen.getByRole('button', { name: 'Alpha (src/alpha.ts)' }))
    expect(screen.getByText('Detail')).toBeTruthy()
    fireEvent.click(view.container.querySelector('thead th button')!)
    fireEvent.click(screen.getByRole('button', { name: 'Alpha (src/alpha.ts)' }))
    expect(view.action).not.toHaveBeenCalled()
  })

  it('keeps sorting, group collapse, and detail expansion controls independently operable', () => {
    const host = sessionContext()
    host.provide()
    const view = renderSpec([{
      type: 'table', columns: ['组', '路径'], types: ['group', 'text'],
      rows: [['[第一组](src/group.ts#L3)', ''], ['[Alpha](src/a.ts)', '第一组'], ['第一组', '[Beta](src/b.ts)'], ['普通明细行', '普通值']],
      details: [null, [{ type: 'text', content: '文件明细内容' }], null, [{ type: 'text', content: '普通明细内容' }]],
    }], host)
    fireEvent.click(view.container.querySelector('thead th button')!)
    fireEvent.click(view.getByText('普通明细行'))
    expect(screen.getByText('普通明细内容')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '收起 普通明细行 的明细' }))
    expect(screen.queryByText('普通明细内容')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开 Alpha 的明细' }))
    expect(screen.getByText('文件明细内容')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '第一组 (src/group.ts)' }))
    expect(screen.getByRole('button', { name: '收起 Alpha 的明细' })).toBeTruthy()
    const group = screen.getByRole('button', { name: '收起分组 第一组' })
    fireEvent.click(group)
    expect(screen.queryByRole('button', { name: 'Alpha (src/a.ts)' })).toBeNull()
    expect(view.container.querySelectorAll('button button')).toHaveLength(0)
  })

  it('keeps HTTP(S) and mailto anchors, disables links by mode, and shows invalid or unavailable files as text', () => {
    const disabled = render(createElement(Fragment, null,
      renderInline('[External](https://example.com) [File](src/file.ts)', false),
      renderInline('[External](https://example.com) [File](src/file.ts)', 'file'),
      renderInline('[Mail](mailto:a@example.com)'),
    ))
    expect(disabled.container.querySelectorAll('a')).toHaveLength(1)
    expect(disabled.container.querySelectorAll('button')).toHaveLength(0)
    expect(disabled.container.textContent).toContain('External File')
    expect(disabled.container.textContent).toContain('Mail')
    cleanup()

    const unavailable = renderSpec([{ type: 'link', label: '本地文件', href: 'src/only-text.ts#L12' }])
    expect(unavailable.queryByRole('button')).toBeNull()
    expect(unavailable.getByText('本地文件')).toBeTruthy()
  })

  it('retains independent link component navigation and renders standalone content as text', () => {
    const host = sessionContext()
    const openResource = host.provide()
    const view = renderSpec([{ type: 'link', label: '打开文件', href: 'src/Main.ts#L31' }], host)
    fireEvent.click(screen.getByRole('button', { name: '打开文件 (src/Main.ts)' }))
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/session-1/src/Main.ts', { params: { line: 31 } })
    cleanup()

    const standalone = render(createElement(GenuiBlock, { spec: repairGenuiSpec({ items: [{ type: 'text', content: '[Standalone](src/main.ts)' }] })! }))
    expect(standalone.queryByRole('button')).toBeNull()
    expect(standalone.getByText('Standalone')).toBeTruthy()
  })
})

describe('host file-link service lifecycle', () => {
  it('updates mounted links when sidebarRight arrives and removes the action when the service leaves', async () => {
    const host = sessionContext()
    const view = renderSpec([{ type: 'text', content: '[Open](src/main.ts)' }], host)
    expect(view.queryByRole('button')).toBeNull()
    expect(view.getByText('Open')).toBeTruthy()

    const openResource = host.provide()
    await waitFor(() => expect(view.getByRole('button', { name: 'Open (src/main.ts)' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'Open (src/main.ts)' }))
    expect(openResource).toHaveBeenCalledTimes(1)
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/session-1/src/main.ts')

    act(() => host.remove())
    await waitFor(() => expect(view.queryByRole('button')).toBeNull())
    expect(view.getByText('Open')).toBeTruthy()
  })

  it('opens same file rows at their requested lines and ignores a click after session switching', () => {
    const host = sessionContext()
    const openResource = host.provide()
    const view = renderSpec([
      { type: 'text', content: '[First](src/main.ts#L12)' },
      { type: 'text', content: '[Second](src/main.ts#L37-L40)' },
    ], host)
    fireEvent.click(screen.getByRole('button', { name: 'First (src/main.ts)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Second (src/main.ts)' }))
    expect(openResource.mock.calls).toEqual([
      ['dsh-resource://file/session/session-1/src/main.ts', { params: { line: 12 } }],
      ['dsh-resource://file/session/session-1/src/main.ts', { params: { line: 37 } }],
    ])
    host.setCurrent('session-2')
    fireEvent.click(screen.getByRole('button', { name: 'First (src/main.ts)' }))
    expect(openResource).toHaveBeenCalledTimes(2)
  })
})

describe('fence render channels', () => {
  it('opens a registry-rendered fence file through the provided session context', () => {
    const host = sessionContext()
    const openResource = host.provide()
    const raw = JSON.stringify({ items: [{ type: 'text', content: '[Registry](src/registry.ts#L22)' }] })
    const rendered = withFileLinkContext(
      host.ctx,
      host.availability,
      'session-1',
      false,
      renderGenuiFence(raw, 'registry', { sessionId: 'session-1', source: { id: 'registry', order: [1, 0, 0] } }),
    )
    render(rendered)
    fireEvent.click(screen.getByRole('button', { name: 'Registry (src/registry.ts)' }))
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/session-1/src/registry.ts', { params: { line: 22 } })
  })

  it('opens a DOM-rendered file and keeps streaming links as plain text until settled', async () => {
    const host = sessionContext()
    const openResource = host.provide()
    const row = document.createElement('div')
    row.setAttribute('data-chat-anchor-key', 'dom-file')
    row.setAttribute('data-chat-flow-kind', 'assistant-step')
    row.setAttribute('data-streaming', '')
    const fence = document.createElement('span')
    fence.textContent = '<dsh-ui>\n{"items":[{"type":"text","content":"[DOM](src/dom.ts#L17)"}]}\n</dsh-ui>'
    row.append(fence)
    document.body.append(row)

    const dispose = installDomFenceRenderer(host.ctx as never, () => {}, host.availability)
    try {
      await waitFor(() => {
        expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('DOM')
      })
      expect(row.querySelector('.genui-dom-fence button')).toBeNull()
      row.removeAttribute('data-streaming')
      await waitFor(() => expect(row.querySelector('.genui-dom-fence button')).not.toBeNull())
      fireEvent.click(row.querySelector('.genui-dom-fence button')!)
      expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/session-1/src/dom.ts', { params: { line: 17 } })

      row.querySelector('.genui-dom-fence')!.replaceChildren()
      await waitFor(() => expect(row.querySelector('.genui-dom-fence button')).not.toBeNull(), { timeout: 1800 })
      fireEvent.click(row.querySelector('.genui-dom-fence button')!)
      expect(openResource).toHaveBeenCalledTimes(2)
    } finally {
      dispose()
    }
  })
})
