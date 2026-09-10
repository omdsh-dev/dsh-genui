/**
 * The recursive render dispatcher: maps the white-listed GenuiNode union to
 * concrete components. Leaf cases render inline; compound families live in
 * the sibling block modules. Depth-guarded against pathological specs.
 * @module @changfenhuang/dsh-genui/client/blocks/render-node
 */
import { type ReactNode, type ComponentType } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import css from '../GenuiBlock.module.css'
import { GENUI_LIMITS } from '../genui-runtime/index.ts'
import type { GenuiList, GenuiNode } from '../spec.ts'
import type { AnswersState, GenuiBlockProps } from './state.ts'
import { AudioNode, avatarColor, ClickFeedbackButton, VideoNode } from './basic.tsx'
import { ChartNode, TableNode } from './charts.tsx'
import {
  InputNode, RadioNode, SelectNode, SliderNode, SubmitNode, SwitchNode, TextareaNode,
} from './forms.tsx'
import { CheckboxNode } from './checkbox.tsx'
import {
  AccordionNode, BreadcrumbNode, CalloutNode, CodeNode, CopyNode, DiffNode, FileTreeNode, JsonNode, KeyValueNode,
  MermaidNode, PlotNode, QuizNode, Scene3DNode, StepsNode, TabsNode, TimelineNode,
} from './advanced.tsx'
import { DiagramNode } from './diagram/index.tsx'
import { ImageNode } from './image.tsx'

import { EChartNode } from '../EChartNode.tsx'

/** Custom node data shape (declared locally: pristine hosts export no type). */
interface GenuiCustomNode {
  type: string
  [key: string]: unknown
}

/** Props a registered custom renderer receives. */
interface GenuiCustomProps {
  node: GenuiCustomNode
  onAction?: GenuiBlockProps['onAction']
  renderChildren: (nodes: unknown[], keyBase: string) => unknown
}

/** Custom-component registry lookup, feature-detected (contract hosts only). */
type HostGenuiExt = {
  getGenuiComponent?: (type: string) => ComponentType<GenuiCustomProps> | undefined
}
const getGenuiComponent = (primitives as unknown as HostGenuiExt).getGenuiComponent

function isListItemNode(item: GenuiList['items'][number]): item is GenuiNode {
  return typeof item === 'object' && item !== null && 'type' in item
}

/**
 * Split a stat value into its numeric core and unit suffix so the unit can
 * render at half size on the same baseline (`99.96%` → `99.96` + `%`,
 * `6.8 GB` → `6.8` + `GB`). Values that do not start with a number are left
 * whole.
 */
function splitStatValue(value: string): { num: string; unit: string } {
  const match = /^([+\-−]?[\d.,]+(?:[eE][+\-]?\d+)?)\s*(.*)$/.exec(value.trim())
  if (match === null || match[1] === undefined) return { num: value, unit: '' }
  return { num: match[1], unit: match[2] ?? '' }
}

/**
 * Micro trend line for `stat.spark`: a 96×24 box stretched to the card width,
 * with an area wash under the line and a constant-size end dot (a zero-length
 * round-capped path with non-scaling stroke, so the stretched viewBox cannot
 * turn the dot into an ellipse).
 */
function Sparkline({ values }: { values: number[] }) {
  const W = 96
  const H = 24
  const pad = 2
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = values.length <= 1 ? 0 : (W - pad * 2) / (values.length - 1)
  const coords = values.map((v, i) => [
    pad + i * step,
    H - pad - ((v - min) / span) * (H - pad * 2),
  ] as const)
  const points = coords.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
  const last = coords[coords.length - 1]!
  const area = `M ${pad},${H - pad} L ${points.split(' ').join(' L ')} L ${last[0].toFixed(1)},${H - pad} Z`
  return (
    <svg className={css.statSpark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={area} fill="var(--dsl-g-accent)" opacity="0.14" />
      <polyline
        points={points}
        fill="none"
        stroke="var(--dsl-g-accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={`M ${last[0].toFixed(1)} ${last[1].toFixed(1)} L ${last[0].toFixed(1)} ${last[1].toFixed(1)}`}
        stroke="var(--dsl-g-accent)"
        strokeWidth={5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        fill="none"
      />
    </svg>
  )
}

export function renderNode(
  node: GenuiNode,
  key: number,
  onAction: GenuiBlockProps['onAction'] | undefined,
  depth = 0,
  answers?: AnswersState,
): ReactNode {
  // Depth guard: a pathological spec must never recurse past the limit
  // (stack overflow / DOM explosion). The fence path already repairs specs
  // against the same limit; this is the belt-and-suspenders for direct
  // GenuiBlock use and plugin-registered custom renderers.
  if (depth > GENUI_LIMITS.maxDepth) return null

  switch (node.type) {
    case 'text': {
      const size = node.size ?? 'body'
      return (
        <div key={key} className={`${css.text} ${css[size]}` + (node.center ? ` ${css.center}` : '')}>
          {node.content}
        </div>
      )
    }
    case 'row': {
      return (
        <div key={key} className={css.row + (node.wrap ? ` ${css.wrap}` : '')}>
          {node.items.map((c, i) => renderNode(c, i, onAction, depth + 1, answers))}
          {node.spacer && <div className={css.spacer} />}
        </div>
      )
    }
    case 'col': {
      return (
        <div key={key} className={css.col} style={node.gap !== undefined ? { gap: `${node.gap}px` } : undefined}>
          {node.items.map((c, i) => renderNode(c, i, onAction, depth + 1, answers))}
        </div>
      )
    }
    case 'grid': {
      return (
        <div key={key} className={css.grid} style={{ gridTemplateColumns: `repeat(${Math.max(1, node.cols)}, minmax(0, 1fr))` }}>
          {node.items.map((c, i) => renderNode(c, i, onAction, depth + 1, answers))}
        </div>
      )
    }
    case 'card': {
      const toneClass = node.tone === undefined ? '' : ` ${css[`card${node.tone[0]!.toUpperCase()}${node.tone.slice(1)}`] ?? ''}`
      return (
        <div key={key} className={`${css.card}${toneClass}`}>
          {node.title !== undefined && <div className={css.cardTitle}>{node.title}</div>}
          {node.items.map((c, i) => renderNode(c, i, onAction, depth + 1, answers))}
        </div>
      )
    }
    case 'button': {
      const tone = node.tone ?? ''
      const cls = `${css.button} ${css[tone] || ''}` + (node.full ? ` ${css.full}` : '') + (node.small ? ` ${css.small}` : '')
      const action = node.action
      // A button without an action (or without an action provider) is a
      // display-only control: render it DISABLED so the affordance is honest
      // — clickable-looking dead buttons were the top complaint in the field.
      const interactive = action !== undefined && onAction !== undefined
      return (
        <ClickFeedbackButton
          key={key}
          className={cls}
          disabled={!interactive}
          onClick={interactive ? () => onAction(action, { type: 'button', label: node.label }) : undefined}
        >
          {node.icon !== undefined && <span aria-hidden>{node.icon} </span>}
          {node.label}
        </ClickFeedbackButton>
      )
    }
    case 'input': return <InputNode key={key} node={node} onAction={onAction} answers={answers} />
    case 'select': return <SelectNode key={key} node={node} onAction={onAction} answers={answers} />
    case 'checkbox': return <CheckboxNode key={key} node={node} onAction={onAction} answers={answers} />
    case 'link': {
      // Honest affordance: with a whitelisted href this is a REAL anchor;
      // without one it is plain styled text (a dead clickable-looking button
      // was the same complaint class as the disabled-button fix).
      const href = node.href
      return href !== undefined
        ? <a key={key} className={css.link} href={href} target="_blank" rel="noopener noreferrer">{node.label}</a>
        : <span key={key} className={css.linkText}>{node.label}</span>
    }
    case 'image': return <ImageNode key={`${key}:${node.src}`} node={node} />
    case 'audio': return <AudioNode key={`${key}:${node.src}`} node={node} />
    case 'video': return <VideoNode key={`${key}:${node.src}`} node={node} />
    case 'badge': {
      const tone = node.tone ?? ''
      return (
        <span key={key} className={`${css.badge} ${css[tone] || ''}`}>
          {node.icon !== undefined && <span aria-hidden>{node.icon} </span>}
          {node.label}
        </span>
      )
    }
    case 'stat': {
      const down = node.delta !== undefined && node.delta.startsWith('-')
      const parts = splitStatValue(node.value)
      return (
        <div key={key} className={`${css.stat}${node.size === 'hero' ? ` ${css.statHero}` : ''}`}>
          <span className={css.statLabel}>{node.label}</span>
          <span className={css.statValue}>
            {parts.num}
            {parts.unit !== '' && <span className={css.statUnit}>{parts.unit}</span>}
          </span>
          {node.delta !== undefined && <span className={`${css.statDelta} ${down ? css.down : css.up}`}>{node.delta}</span>}
          {node.spark !== undefined && <Sparkline values={node.spark} />}
        </div>
      )
    }
    case 'progress': {
      const v = Math.max(0, Math.min(100, Number(node.value) || 0))
      if (node.variant === 'ring') {
        const R = 34
        const C = 2 * Math.PI * R
        const size = 92
        return (
          <div
            key={key}
            className={css.ring}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={v}
            aria-label={node.label ?? node.valueLabel ?? undefined}
          >
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
              <circle cx={size / 2} cy={size / 2} r={R} fill="none" strokeWidth={9} className={css.ringTrack} />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={R}
                fill="none"
                strokeWidth={9}
                strokeLinecap="round"
                className={css.ringFill}
                strokeDasharray={`${(v / 100) * C} ${C}`}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
              <text x={size / 2} y={size / 2 + 5} textAnchor="middle" className={css.ringValue}>{v}%</text>
            </svg>
            {(node.label !== undefined || node.valueLabel !== undefined) && (
              <div className={css.ringMeta}>
                {node.label !== undefined && <span className={css.ringLabel}>{node.label}</span>}
                {node.valueLabel !== undefined && <span className={css.ringSub}>{node.valueLabel}</span>}
              </div>
            )}
          </div>
        )
      }
      return (
        <div
          key={key}
          className={css.progress}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={v}
          aria-label={node.label ?? node.valueLabel ?? undefined}
        >
          {(node.label !== undefined || node.valueLabel !== undefined) && (
            <div className={css.progressRow}>
              <span>{node.label}</span>
              {node.valueLabel !== undefined && <span>{node.valueLabel}</span>}
            </div>
          )}
          <div className={css.track}>
            <div className={css.fill} style={{ width: `${v}%` }} />
            {node.target !== undefined && (
              <span className={css.targetMark} style={{ left: `${node.target}%` }} title={`目标 ${node.target}%`} />
            )}
          </div>
        </div>
      )
    }
    case 'divider': return <hr key={key} className={css.divider} />
    case 'list': {
      const items = node.items.slice(0, GENUI_LIMITS.maxListItems)
      return (
        <div key={key} className={css.list}>
          {items.map((item, i) => (
            <div key={i} className={css.li}>
              {isListItemNode(item)
                ? renderNode(item, i, onAction, depth + 1, answers)
                : <><span className={css.liTitle}>{typeof item === 'string' ? item : item.title}</span>{typeof item !== 'string' && item.desc !== undefined && <span className={css.liDesc}>{item.desc}</span>}</>}
            </div>
          ))}
        </div>
      )
    }
    case 'table':
      return (
        <TableNode
          key={key}
          node={node}
          renderDetail={items => items.map((child, i) => renderNode(child, i, onAction, depth + 1, answers))}
        />
      )
    case 'chart': return <ChartNode key={key} chart={node} />
    case 'tabs': return <TabsNode key={key} tabs={node} onAction={onAction} depth={depth + 1} answers={answers} />
    case 'avatar': {
      return (
        <div key={key} className={css.avatar} style={{ background: node.color ?? avatarColor(node.name) }}>
          {node.name.slice(0, 1).toUpperCase()}
        </div>
      )
    }
    case 'spacer': return <div key={key} className={css.spacer} />
    case 'plot': return <PlotNode key={key} plot={node} />
    case 'callout': return <CalloutNode key={key} node={node} />
    case 'steps': return <StepsNode key={key} steps={node} />
    case 'keyvalue': return <KeyValueNode key={key} node={node} />
    case 'diff': return <DiffNode key={key} node={node} />
    case 'json': return <JsonNode key={key} node={node} />
    case 'code': return <CodeNode key={key} node={node} />
    case 'radio': return <RadioNode key={`${key}:r${answers?.round ?? 0}`} node={node} onAction={onAction} answers={answers} />
    case 'submit': return <SubmitNode key={key} node={node} onAction={onAction} answers={answers} />
    case 'switch': return <SwitchNode key={key} node={node} onAction={onAction} />
    case 'slider': return <SliderNode key={key} node={node} onAction={onAction} answers={answers} />
    case 'textarea': return <TextareaNode key={key} node={node} onAction={onAction} answers={answers} />
    case 'accordion': return <AccordionNode key={key} node={node} onAction={onAction} depth={depth + 1} answers={answers} />
    case 'copy': return <CopyNode key={key} node={node} />
    case 'mermaid': return <MermaidNode key={key} node={node} />
    case 'scene3d': return <Scene3DNode key={key} node={node} />
    case 'timeline': return <TimelineNode key={key} node={node} />
    case 'file-tree': return <FileTreeNode key={key} node={node} />
    case 'breadcrumb': return <BreadcrumbNode key={key} node={node} />
    case 'quiz': return <QuizNode key={key} node={node} onAction={onAction} />
    case 'diagram': return <DiagramNode key={key} node={node} />

    case 'echart': return <EChartNode key={key} node={node} />
    default: {
      // Plugin-registered custom types: a plugin ships a renderer through
      // registerGenuiComponent; unregistered unknowns render nothing. The
      // spec union is exhaustive, so an unknown node arrives as a plugin
      // extension — treat it as a generic data node.
      const custom = node as unknown as GenuiCustomNode
      const Custom = getGenuiComponent?.(custom.type)
      if (Custom !== undefined) {
        return (
          <Custom
            key={key}
            node={custom}
            onAction={onAction}
            renderChildren={(nodes, base) => nodes.map((c, i) => renderNode(c as GenuiNode, Number(base) + i, onAction, depth + 1, answers))}
          />
        )
      }
      return null
    }
  }
}

/* ---------------- v1.1 nodes ---------------- */
