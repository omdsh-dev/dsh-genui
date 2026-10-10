import { useCallback, useEffect, useRef, useState } from 'react'
import type { BlockInteractionState } from '../interaction-store.ts'
import { useT } from '../i18n/index.ts'
import { GenuiBlock } from '../GenuiBlock.tsx'
import type { GenuiBlockProps } from '../blocks/state.ts'
import { analyzeGenuiPortability } from './portability.ts'
import { createGenuiArtifact } from './create.ts'
import { downloadGenuiArtifactHtml, downloadGenuiArtifactJson } from './download.ts'
import { GenuiExportError } from './types.ts'
import css from './ArtifactExport.module.css'

interface ArtifactExportMenuProps {
  getArtifact: () => ReturnType<typeof createGenuiArtifact>
}

/** 导出入口的图标字形：托盘 + 下箭头（“导出为文件”），14px 描边、随文字取色。 */
function ExportGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 2.2v7.1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M5 6.4 8 9.4l3-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.9 10.9v1.5a1 1 0 0 0 1 1h8.2a1 1 0 0 0 1-1v-1.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/** 提供 JSON 和 HTML 的本地化导出菜单。 */
function ArtifactExportMenu({ getArtifact }: ArtifactExportMenuProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const report = analyzeGenuiPortability(getArtifact().spec)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const closeEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeEscape)
    }
  }, [open])

  /** 执行用户选择的下载并更新辅助说明。 */
  const exportAs = async (format: 'html' | 'json'): Promise<void> => {
    setOpen(false)
    setErrorMessage('')
    try {
      const artifact = getArtifact()
      if (format === 'html') await downloadGenuiArtifactHtml(artifact)
      else downloadGenuiArtifactJson(artifact)
    } catch (error) {
      if (error instanceof GenuiExportError) {
        if (error.code === 'unsupported-custom-component') {
          console.warn('[dsh-genui] standalone export rejected:', error.message)
          setErrorMessage(t('artifact.unsupportedCustom', { types: report.customTypes.join(', ') }))
        } else {
          console.warn('[dsh-genui] artifact export failed:', error.code, error.message)
          setErrorMessage(t('artifact.exportFailed'))
        }
      } else {
        console.warn('[dsh-genui] artifact export failed:', error instanceof Error ? error.message : 'unknown error')
        setErrorMessage(t('artifact.exportFailed'))
      }
    }
  }

  return (
    <div className={css.chrome} ref={rootRef} data-genui-export>
      {report.externalMedia.length > 0 && <span className={css.notice}>{t('artifact.externalMediaNotice')}</span>}
      {errorMessage !== '' && <span className={css.statusError} aria-live="polite">{errorMessage}</span>}
      {/* 无边框图标入口：完成态内容不再多出一个描边按钮。图标按钮的 aria-label
          + title 组合与项目里的 panelTpl / panelToggle 一致。 */}
      <button
        type="button"
        className={css.trigger}
        aria-label={t('artifact.export')}
        title={t('artifact.export')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <ExportGlyph />
      </button>
      {open && (
        <div className={css.menu} role="menu">
          <button type="button" role="menuitem" className={css.item} disabled={report.customTypes.length > 0} onClick={() => void exportAs('html')}>{t('artifact.exportHtml')}</button>
          {report.customTypes.length > 0 && <span className={css.menuNotice}>{t('artifact.unsupportedCustom', { types: report.customTypes.join(', ') })}</span>}
          <button type="button" role="menuitem" className={css.item} onClick={() => void exportAs('json')}>{t('artifact.exportJson')}</button>
        </div>
      )}
    </div>
  )
}

export interface ExportableGenuiBlockProps extends GenuiBlockProps {
  exportEnabled?: boolean
}

/** 在完成态 GenUI 外层显示 artifact 导出菜单。 */
export function ExportableGenuiBlock(props: ExportableGenuiBlockProps) {
  const stateRef = useRef<BlockInteractionState | undefined>(undefined)
  const captureState = useCallback((state: BlockInteractionState) => {
    stateRef.current = state
  }, [])
  const getArtifact = useCallback(() => createGenuiArtifact(props.spec, stateRef.current), [props.spec])
  const { exportEnabled = true, ...blockProps } = props
  return (
    <div data-genui-artifact>
      <GenuiBlock {...blockProps} onStateSnapshot={captureState} />
      {exportEnabled && <ArtifactExportMenu getArtifact={getArtifact} />}
    </div>
  )
}
