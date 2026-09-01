/**
 * The dsh-ui fence render pipeline, shared by both render channels:
 *
 * - **Registry channel** (contract hosts): the host's MarkdownText resolves
 *   ```dsh-ui fences through the fence-registry extension point and calls
 *   {@link renderGenuiFence} with a session-scoped context (sessionId + the
 *   settled source identity). An unrepairable body renders {@link FenceFallback}.
 * - **DOM channel** (pristine hosts, no extension point): the DOM observer
 *   (`dom-fence.ts`) finds stock code blocks labelled `dsh-ui` and mounts
 *   {@link renderResolvedFenceNode} into its own React root, wrapped in the
 *   plugin-owned action context. An unrepairable body returns `null` so the
 *   stock code block stays visible.
 *
 * Structural types are declared locally on purpose: the context contract is
 * a data shape, and pristine hosts do not export the host-side type names.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Key, type ReactNode } from 'react'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { GenuiBlock } from './GenuiBlock.tsx'
import { repairGenuiSpec } from './guard.ts'
import { fenceStateKey } from './interaction-store.ts'
import { parsePartialGenuiSpec } from './parse-partial.ts'
import { applyPanelOperation, diagnosePanelBudget, type PanelOperationStatus } from './panel-store.ts'
import type { GenuiSpec } from './spec.ts'
import { completeFenceJson, describeJsonFailure, isCompleteJson, repairFenceJson } from '../shared/fence-repair.ts'
import { validateRenderableChartSemantics } from '../plugin/chart-contract.ts'

/** Settled fence source identity (data shape, host-independent). */
export interface GenuiFenceSource {
  /** Stable structural id, e.g. `['assistant', seq, block, fence]` or `dom:<anchor>:<i>`. */
  readonly id: string
  /** Three-part order: [messageSeq, textBlockIndex, fenceIndex]. */
  readonly order: readonly [number, number, number]
}

/** Context a fence renderer receives beside the raw source and React key. */
export interface GenuiFenceContext {
  /** Owning session route; absent outside a session-scoped render. */
  readonly sessionId?: string
  /** Present only for settled/interrupted renders with a stable identity. */
  readonly source?: GenuiFenceSource
}

const FENCE_ERROR_STYLE: CSSProperties = {
  margin: '0 0 6px',
  padding: '6px 10px',
  borderRadius: 6,
  background: 'rgba(239, 68, 68, 0.14)',
  border: '1px solid rgba(239, 68, 68, 0.4)',
  color: '#f87171',
  fontSize: 12,
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
}

/** Return a chart-semantic diagnostic for parseable raw fence content. */
function chartSemanticFailure(raw: string): string | null {
  const parsed = parsePartialGenuiSpec(raw)
  if (parsed === null) return null
  const errors = validateRenderableChartSemantics(parsed)
  return errors.length === 0 ? null : errors.join('；')
}

/**
 * Fallback for a ```dsh-ui fence whose body has no finished component yet.
 * Two very different situations land here and they must not be conflated:
 *
 * 1. **Streaming partial** — the reply is still being written and the JSON
 *    simply is not complete. The host marks the streaming message with
 *    `[data-streaming]` on the AssistantMarkdown root, which is an ancestor
 *    of every fence. While that marker is present, a plain code block is the
 *    correct rendering (partial JSON must never look like an error).
 *
 * 2. **Settled defect** — the message is finished but the body still does
 *    not parse as JSON (a malformed fence like a missing `}`) or violates the
 *    native chart contract. This used to fail silently: the fence degraded to
 *    a code block with no hint, and the author had no way to know the UI never
 *    rendered. Once the streaming marker is gone, surface a compact diagnostic
 *    so the defect is visible instead of silent.
 */
function FenceFallback({ raw, fenceKey }: { raw: string; fenceKey: Key }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [settled, setSettled] = useState(false)
  useLayoutEffect(() => {
    const node = ref.current
    if (node !== null && node.closest('[data-streaming]') === null) setSettled(true)
  })
  const chartDiagnostic = settled ? chartSemanticFailure(raw) : null
  const parseDiagnostic = settled && chartDiagnostic === null && raw.trim() !== '' ? describeJsonFailure(raw) : null
  return (
    <div ref={ref}>
      {chartDiagnostic !== null && (
        <div style={FENCE_ERROR_STYLE} role="alert">
          ⚠️ dsh-ui chart 字段验证失败：{chartDiagnostic} —— 围栏保持为代码块；请修正 chart 字段后重发。
        </div>
      )}
      {chartDiagnostic === null && parseDiagnostic !== null && (
        <div style={FENCE_ERROR_STYLE} role="alert">
          ⚠️ dsh-ui fence JSON 解析失败{parseDiagnostic} —— 围栏保持为代码块；请让模型检查并修复 JSON 后重发。
        </div>
      )}
      <CodeBlock key={fenceKey} code={`${raw}\n`} lang="dsh-ui" />
    </div>
  )
}

/**
 * Keyed publisher for a settled `panel:true` fence: submits ONE panel
 * operation from the host-provided stable source (id + order), in an
 * effect — never inside the render function. StrictMode's duplicate effects
 * are absorbed by the operation map's per-source dedup, so the panel folds
 * and notifies exactly once per source. Renders nothing.
 */
function FencePanelPublisher({ sessionId, sourceId, order, spec }: {
  sessionId: string
  sourceId: string
  order: readonly [number, number, number]
  spec: GenuiSpec
}) {
  useEffect(() => {
    const status: PanelOperationStatus = applyPanelOperation(sessionId, {
      sourceId,
      order,
      mode: spec.append === true ? 'append' : 'replace',
      spec,
    })
    if (status === 'overflow') diagnosePanelBudget(sessionId, sourceId)
  }, [sessionId, sourceId, order, spec])
  return null
}

/** Repair one parsed value only when its native charts are actually renderable. */
function repairRenderableSpec(value: unknown): GenuiSpec | null {
  if (validateRenderableChartSemantics(value).length > 0) return null
  return repairGenuiSpec(value)
}

/**
 * Resolve a raw fence body to a guarded spec.
 *
 * - Tier-1 repair (quote escape + trailing commas): safe at any time —
 *   adopted only when the whole body parses, so a still-growing streaming
 *   half keeps falling back to the code block, never flashing a banner.
 * - Tier-2 completion (missing quotes/brackets): settled renders only —
 *   `context.source` exists exclusively once the message finished, so
 *   streaming halves are never completed early.
 * - Native chart semantics are checked before repair on every candidate so
 *   aliases, empty collections, or line/donut series cannot repair into a
 *   default/blank chart.
 */
export function resolveGenuiSpec(raw: string, context?: GenuiFenceContext): GenuiSpec | null {
  const parsed = parsePartialGenuiSpec(raw)
  let spec = parsed === null ? null : repairRenderableSpec(parsed)
  if (spec === null) {
    const repaired = repairFenceJson(raw)
    if (repaired !== null) {
      const reparsed = parsePartialGenuiSpec(repaired.text)
      spec = reparsed === null ? null : repairRenderableSpec(reparsed)
    }
    if (spec === null && context?.source !== undefined) {
      const completed = completeFenceJson(raw)
      if (completed !== null) {
        const reparsed = parsePartialGenuiSpec(completed.text)
        spec = reparsed === null ? null : repairRenderableSpec(reparsed)
      }
    }
  }
  return spec
}

/** The inline GenuiBlock tree for a resolved non-panel spec. */
function renderInlineFence(key: Key, context: GenuiFenceContext | undefined, spec: GenuiSpec): ReactNode {
  const sessionId = context?.sessionId
  return (
    // React key carries the stable source identity when present (atomic
    // remount at streaming→settled), falling back to the document key.
    // Repaired specs render SILENTLY: once the UI renders, no amber note
    // tells the user something was wrong — only an unrecoverable body keeps
    // the red diagnostic.
    <ErrorBoundary key={context?.source?.id ?? key} label="该界面">
      <GenuiBlock
        spec={spec}
        // v2.7 durable state: session + stable source + content fingerprint —
        // replaying the same content restores answers/lock/field values; new
        // content (换题, edited spec) gets a fresh key. Without a stable
        // source (streaming / non-conversation surfaces) state is not
        // persisted.
        stateKey={sessionId === undefined
          ? undefined
          : fenceStateKey(sessionId, context?.source?.id ?? String(key), JSON.stringify(spec))}
      />
    </ErrorBoundary>
  )
}

/**
 * The resolved fence render for the DOM channel: `null` when the body is
 * unrepairable (the stock code block stays visible), otherwise the panel
 * publisher (`panel:true`; renders nothing in the flow — mounted as an empty
 * root so the taken-over block is hidden) or the inline GenuiBlock tree.
 * Shared verbatim by both channels.
 */
export function renderResolvedFenceNode(raw: string, key: Key, context?: GenuiFenceContext): ReactNode | null {
  const spec = resolveGenuiSpec(raw, context)
  if (spec === null) return null
  if (spec.panel === true) {
    // Publish only with a settled stable source — streaming/identity-less
    // renders keep the panel untouched. Appends additionally gate on a
    // complete body (a settled-but-malformed append never merges partial
    // content).
    if (context !== undefined && context.sessionId !== undefined && context.source !== undefined) {
      if (spec.append === true && !isCompleteJson(raw)) return <Fragment key={key} />
      return (
        <FencePanelPublisher
          key={key}
          sessionId={context.sessionId}
          sourceId={context.source.id}
          order={context.source.order}
          spec={spec}
        />
      )
    }
    return <Fragment key={key} />
  }
  return renderInlineFence(key, context, spec)
}

/**
 * Registry-channel fence renderer (contract hosts): like the resolved node,
 * but an unrepairable body renders the fallback code block + settled
 * diagnostic — the host replaced its own block with our output — and an
 * unpublishable `panel:true` fence renders `null` (nothing in the flow).
 */
export function renderGenuiFence(raw: string, key: Key, context?: GenuiFenceContext): ReactNode {
  const spec = resolveGenuiSpec(raw, context)
  if (spec === null) return <FenceFallback key={key} fenceKey={key} raw={raw} />
  if (spec.panel === true) {
    if (context !== undefined && context.sessionId !== undefined && context.source !== undefined) {
      if (spec.append === true && !isCompleteJson(raw)) return null
      return (
        <FencePanelPublisher
          key={key}
          sessionId={context.sessionId}
          sourceId={context.source.id}
          order={context.source.order}
          spec={spec}
        />
      )
    }
    return null
  }
  return renderInlineFence(key, context, spec)
}
