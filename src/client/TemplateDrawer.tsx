/**
 * TemplateDrawer — GenUI 模板中心（0.9.4 新手引导）。
 *
 * 分类浏览 → 点击卡片 → 内嵌预览（demo spec 由 GenuiBlock 直接渲染，
 * dogfooding）+「试用」插入输入框 /「复制指令」。用户先看到效果，
 * 再决定把指令发给模型——genui 能力说明书。
 */
import { useMemo, useRef, useState } from 'react'
import { GENUI_TEMPLATES, type GenuiTemplate } from './templates.ts'
import { GenuiBlock } from './GenuiBlock.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { panelStateKey } from './interaction-store.ts'
import css from './TemplateDrawer.module.css'

export interface TemplateDrawerProps {
  /** 试用：把模板指令插入当前输入框草稿。 */
  onUse: (instruction: string) => void
}

const CATEGORIES = ['全部', '仪表盘', '数据', '流程', '图表', '交互', '测验', '高级'] as const
type Category = (typeof CATEGORIES)[number]

/** Copy to clipboard with a legacy fallback (like GenuiCopy). */
function copyText(text: string): Promise<void> {
  if (navigator.clipboard !== undefined) return navigator.clipboard.writeText(text)
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
      resolve()
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export function TemplateDrawer({ onUse }: TemplateDrawerProps) {
  const [category, setCategory] = useState<Category>('全部')
  const [selected, setSelected] = useState<GenuiTemplate | null>(null)
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)

  const items = useMemo(
    () => (category === '全部' ? [...GENUI_TEMPLATES] : GENUI_TEMPLATES.filter(t => t.category === category)),
    [category],
  )

  const copy = async (text: string): Promise<void> => {
    try {
      await copyText(text)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard denied: the instruction stays in the drawer; nothing else
      // to do — the use flow does not depend on it.
    }
  }

  return (
    <div className={css.wrap} data-genui-templates>
      <div className={css.cats} role="tablist" aria-label="模板分类">
        {CATEGORIES.map(c => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={category === c}
            className={`${css.cat}${category === c ? ` ${css.catActive}` : ''}`}
            onClick={() => { setCategory(c); setSelected(null) }}
          >
            {c}
          </button>
        ))}
      </div>
      <div className={css.list}>
        {items.map(tpl => (
          <button
            key={tpl.id}
            type="button"
            className={`${css.card}${selected?.id === tpl.id ? ` ${css.cardActive}` : ''}`}
            onClick={() => setSelected(prev => (prev?.id === tpl.id ? null : tpl))}
          >
            <span className={css.cardName}>{tpl.name}</span>
            <span className={css.cardMeta}>{tpl.category}</span>
            <span className={css.cardDesc}>{tpl.description}</span>
          </button>
        ))}
      </div>
      {selected !== null && (
        <div className={css.detail} data-genui-template-preview>
          <div className={css.toolbar}>
            <span className={css.toolbarTitle}>{selected.name}</span>
            <button type="button" className={css.try} onClick={() => onUse(selected.instruction)}>
              试用：插入输入框
            </button>
            <button type="button" className={css.copy} onClick={() => void copy(selected.instruction)}>
              {copied ? '✓ 已复制' : '复制指令'}
            </button>
          </div>
          <div className={css.preview}>
            <ErrorBoundary label="模板预览">
              <GenuiBlock spec={selected.demo} stateKey={panelStateKey('genui-tpl', selected.id)} />
            </ErrorBoundary>
          </div>
        </div>
      )}
    </div>
  )
}
