import { useState, type ReactElement } from 'react'
import type { GenuiEntityCard } from '../spec.ts'
import { renderInline } from '../inline.ts'
import { classifyLinkTarget } from '../file-link.ts'
import { FileLink } from '../file-link-context.tsx'
import { GENUI_LIMITS } from '../genui-runtime/index.ts'
import { safeMediaSrc } from '../genui-runtime/value-utils.ts'
import { useT } from '../i18n/index.ts'
import { genuiMediaSrc } from '../media-overrides.ts'
import type { GenuiBlockProps } from './state.ts'
import { avatarColor } from './basic.tsx'
import css from './entity-card.module.css'

/** 显示实体概要、安全来源链接和操作入口。 */
export function EntityCardNode({ node, onAction }: { node: GenuiEntityCard; onAction?: GenuiBlockProps['onAction'] }): ReactElement {
  const t = useT()
  const target = classifyLinkTarget(node.href)
  const validatedImage = safeMediaSrc(node.image)
  const image = validatedImage === undefined ? undefined : genuiMediaSrc(validatedImage)
  const [failedImage, setFailedImage] = useState<string | undefined>()
  const showImage = image !== undefined && failedImage !== image
  const sourceLabel = node.sourceLabel ?? t('block.entitySource')
  const source = target.type === 'external'
    ? <a className={css.source} href={target.href} target="_blank" rel="noopener noreferrer">{sourceLabel}</a>
    : target.type === 'file'
      ? <span className={css.source}><FileLink path={target.file.path} label={sourceLabel} {...(target.file.line === undefined ? {} : { line: target.file.line })}>{sourceLabel}</FileLink></span>
      : null
  return (
    <article className={css.card} data-genui-entity-card aria-label={t('block.entityCard')}>
      {showImage
        ? <img className={css.image} src={image} alt={node.imageAlt ?? ''} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} />
        : <div className={css.avatar} aria-hidden="true" style={{ backgroundColor: avatarColor(node.name) }}>{Array.from(node.name)[0]?.toUpperCase()}</div>}
      <div className={css.body}>
        <h3 className={css.name}>{renderInline(node.name)}</h3>
        {node.description !== undefined && <p className={css.description}>{renderInline(node.description)}</p>}
        {node.metadata !== undefined && node.metadata.length > 0 && (
          <dl className={css.metadata}>
            {node.metadata.slice(0, GENUI_LIMITS.maxEntityMetadata).map((item, index) => (
              <div className={css.metaRow} key={`${item.label}:${index}`}>
                <dt>{renderInline(item.label, false)}</dt>
                <dd>{renderInline(item.value)}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className={css.footer}>
          {source}
          {node.actions?.slice(0, GENUI_LIMITS.maxEntityActions).map((item, index) => (
            <button
              className={css.action}
              data-tone={item.tone}
              type="button"
              key={`${item.action}:${index}`}
              disabled={onAction === undefined}
              onClick={onAction === undefined ? undefined : () => onAction(item.action, { type: 'entity-card', name: node.name, label: item.label })}
            >
              {renderInline(item.label, false)}
            </button>
          ))}
        </div>
      </div>
    </article>
  )
}
