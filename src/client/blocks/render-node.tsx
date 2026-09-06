/**
 * The recursive render dispatcher: maps the white-listed GenuiNode union to
 * concrete block implementations. Rendering details live in sibling modules;
 * this file owns dispatch, recursion wiring, the depth guard, and custom
 * renderer fallback.
 * @module @changfenhuang/dsh-genui/client/blocks/render-node
 */
import { cloneElement, isValidElement, type ComponentType, type ReactNode } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { GENUI_LIMITS } from '../genui-runtime/index.ts'
import type { GenuiNode } from '../spec.ts'
import type { AnswersState, GenuiBlockProps } from './state.ts'
import {
  AudioNode,
  AvatarNode as renderAvatarNode,
  BadgeNode as renderBadgeNode,
  ButtonNode as renderButtonNode,
  LinkNode as renderLinkNode,
  ProgressNode as renderProgressNode,
  StatNode as renderStatNode,
  TextNode as renderTextNode,
  VideoNode,
} from './basic.tsx'
import { ChartNode, TableNode } from './charts.tsx'
import {
  CheckboxNode as renderCheckboxNode,
  InputNode,
  RadioNode,
  SelectNode,
  SliderNode,
  SubmitNode,
  SwitchNode,
  TextareaNode,
} from './forms.tsx'
import {
  CardNode as renderCardNode,
  ColNode as renderColNode,
  DividerNode as renderDividerNode,
  GridNode as renderGridNode,
  ListNode as renderListNode,
  RowNode as renderRowNode,
  SpacerNode as renderSpacerNode,
} from './layout.tsx'
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

/**
 * The renderer functions extracted from the old inline switch stay ordinary
 * function calls rather than becoming new React component boundaries. The key
 * is restored on their returned root element so reconciliation matches the
 * previous inline JSX tree.
 */
function withKey(node: ReactNode, key: number): ReactNode {
  return isValidElement(node) ? cloneElement(node, { key }) : node
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

  const renderChild = (child: GenuiNode, childKey: number): ReactNode =>
    renderNode(child, childKey, onAction, depth + 1, answers)
  // Preserve the existing tabs/accordion depth semantics: render-node used
  // to pass depth + 1 into those components and they added one more level.
  const renderNestedChild = (child: GenuiNode, childKey: number): ReactNode =>
    renderNode(child, childKey, onAction, depth + 2, answers)

  switch (node.type) {
    case 'text': return withKey(renderTextNode({ node }), key)
    case 'row': return withKey(renderRowNode({ node, renderChild }), key)
    case 'col': return withKey(renderColNode({ node, renderChild }), key)
    case 'grid': return withKey(renderGridNode({ node, renderChild }), key)
    case 'card': return withKey(renderCardNode({ node, renderChild }), key)
    case 'button': return withKey(renderButtonNode({ node, onAction }), key)
    case 'input': return <InputNode key={key} node={node} onAction={onAction} answers={answers} />
    case 'select': return <SelectNode key={key} node={node} onAction={onAction} answers={answers} />
    case 'checkbox': return withKey(renderCheckboxNode({ node, onAction }), key)
    case 'link': return withKey(renderLinkNode({ node }), key)
    case 'image': return <ImageNode key={`${key}:${node.src}`} node={node} />
    case 'audio': return <AudioNode key={`${key}:${node.src}`} node={node} />
    case 'video': return <VideoNode key={`${key}:${node.src}`} node={node} />
    case 'badge': return withKey(renderBadgeNode({ node }), key)
    case 'stat': return withKey(renderStatNode({ node }), key)
    case 'progress': return withKey(renderProgressNode({ node }), key)
    case 'divider': return withKey(renderDividerNode(), key)
    case 'list': return withKey(renderListNode({ node, renderChild }), key)
    case 'table': return <TableNode key={key} node={node} />
    case 'chart': return <ChartNode key={key} chart={node} />
    case 'tabs': return <TabsNode key={key} tabs={node} renderChild={renderNestedChild} />
    case 'avatar': return withKey(renderAvatarNode({ node }), key)
    case 'spacer': return withKey(renderSpacerNode(), key)
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
    case 'accordion': return <AccordionNode key={key} node={node} renderChild={renderNestedChild} />
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
            renderChildren={(nodes, base) => nodes.map((child, i) => renderNode(child as GenuiNode, Number(base) + i, onAction, depth + 1, answers))}
          />
        )
      }
      return null
    }
  }
}
