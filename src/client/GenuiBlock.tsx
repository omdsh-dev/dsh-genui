/**
 * GenuiBlock: renders a declarative GenUI spec (from a ```dsh-ui fence in an
 * assistant reply) as real interactive components inline in the conversation.
 * The component tree is white-listed and mapped to DOM directly — no raw HTML.
 * The block shell holds the shared interaction state (answers registry,
 * durable localStorage persistence, action debounce); the per-family
 * components live in src/client/blocks/*.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGenuiAction } from './action-context.ts'
import css from './GenuiBlock.module.css'
import { loadBlockState, saveBlockState } from './interaction-store.ts'
import { recordFence, recordInteraction } from './achievement-store.ts'
import { renderNode } from './blocks/render-node.tsx'
import type { AnswersState, GenuiBlockProps, QuestionMeta } from './blocks/state.ts'
import type { GenuiSpec } from './spec.ts'

export const GENUI_ACTION_DEBOUNCE_MS = 300

/**
 * Wrap the harness action callback with the per-action trailing debounce.
 * Absent provider = v1 behavior (components are display-only, callback
 * stays undefined). Pending timers are cleared on unmount so a click that
 * never fired does not leak into the next mount.
 */
function useDebouncedAction(onAction: GenuiBlockProps['onAction'] | undefined): GenuiBlockProps['onAction'] {
  const pending = useRef<Map<string, ReturnType<typeof setTimeout>> | null>(null)
  useEffect(() => {
    return () => {
      const timers = pending.current
      if (timers === null) return
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])
  return useMemo(() => {
    if (onAction === undefined) return undefined
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    pending.current = timers
    return (action: string, payload: Record<string, unknown>): void => {
      const existing = timers.get(action)
      if (existing !== undefined) clearTimeout(existing)
      timers.set(action, setTimeout(() => {
        timers.delete(action)
        onAction(action, payload)
      }, GENUI_ACTION_DEBOUNCE_MS))
    }
  }, [onAction])
}

/**
 * Structural spec equality for the memo comparator: the fence path re-parses
 * the body on every streaming chunk and produces a FRESH object even when the
 * repaired content is unchanged (a chunk that closed no new component). The
 * default shallow memo would then re-render the whole tree per chunk — up to
 * ~200 full-tree renders for a max-size fence. Stringify equality makes the
 * memo skip renders whose content did not actually change; the cost is one
 * JSON.stringify per chunk (≤200 nodes, negligible next to a React tree
 * reconciliation). `stateKey` already embeds the content fingerprint, so when
 * both keys are equal and non-undefined the specs necessarily stringify
 * equal — the stringify branch matters for the streaming path (stateKey
 * undefined).
 */
function specEquivalent(a: GenuiSpec, b: GenuiSpec): boolean {
  if (a === b) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Render a GenUI spec as an inline block. Falls back to nothing when the spec
 * carries no items (the fence renderer already refused non-specs before us).
 */
export const GenuiBlock = memo(function GenuiBlock({ spec, stateKey }: GenuiBlockProps) {
  const gap = spec.gap ?? 16
  const onAction = useDebouncedAction(useGenuiAction())
  // v2.5/v2.6 answers registry: grouped radios record selections + question
  // metadata here; `submit` nodes grade locally (locked until 重新作答) or
  // collect into one action. Block-local state survives re-renders (streaming
  // settle, panel updates) — selections persist while the block is mounted.
  // v2.7 durability: with a stateKey the state ALSO survives refresh/reopen —
  // loaded once at mount (seed for re-renders of the same content) and saved
  // on every change.
  const [persisted] = useState(() => (stateKey === undefined ? null : loadBlockState(stateKey)))
  const [answers, setAnswers] = useState<Record<string, string>>(persisted?.answers ?? {})
  const [fields, setFields] = useState<Record<string, string>>(persisted?.fields ?? {})
  const [meta, setMeta] = useState<Record<string, QuestionMeta>>({})
  const [locked, setLocked] = useState(persisted?.locked === true)
  const [round, setRound] = useState(0)
  // Secret (password) field ids: their values never persist and never join
  // submit collection — the input itself stays masked and its own action
  // still delivers the value on explicit user submit.
  const [secretFields, setSecretFields] = useState<ReadonlySet<string>>(new Set())
  const setAnswer = useCallback((group: string, choice: string) => {
    setAnswers(prev => (prev[group] === choice ? prev : { ...prev, [group]: choice }))
  }, [])
  const setField = useCallback((id: string, value: string) => {
    // Field invariant: a blank (trim-empty) value leaves the shared registry.
    setFields(prev => {
      if (value.trim() === '') {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      }
      return prev[id] === value ? prev : { ...prev, [id]: value }
    })
  }, [])
  const registerSecretField = useCallback((id: string) => {
    setSecretFields(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])
  const registerMeta = useCallback((group: string, m: QuestionMeta) => {
    setMeta(prev => {
      const existing = prev[group]
      if (existing !== undefined && existing.label === m.label && existing.answer === m.answer
        && existing.explanation === m.explanation) return prev
      return { ...prev, [group]: m }
    })
  }, [])
  const clear = useCallback(() => {
    setAnswers({})
    setLocked(false)
    setRound(r => r + 1) // radios remount (key carries the round) with clean selections
  }, [])
  const answersState = useMemo<AnswersState>(
    () => ({
      answers, fields, secretFields, meta, locked, round,
      setAnswer, setField, registerSecretField, registerMeta, clear, setLocked,
    }),
    [answers, fields, secretFields, meta, locked, round, setAnswer, setField, registerSecretField, registerMeta, clear],
  )
  // Achievement telemetry: every emitted action counts as one interaction
  // (the debounced emit fires once per real user action).
  const trackedAction = useMemo(() => {
    if (onAction === undefined) return undefined
    return (action: string, payload: Record<string, unknown>): void => {
      recordInteraction()
      onAction(action, payload)
    }
  }, [onAction])
  // Durable save (debounced 300ms — typing in a field fires per keystroke).
  // Secret field values are stripped before writing: passwords never persist.
  useEffect(() => {
    if (stateKey === undefined) return
    const timer = setTimeout(() => {
      const safeFields = Object.fromEntries(
        Object.entries(fields).filter(([id]) => !secretFields.has(id)),
      )
      saveBlockState(stateKey, {
        answers,
        locked,
        ...(Object.keys(safeFields).length > 0 ? { fields: safeFields } : {}),
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [stateKey, answers, locked, fields, secretFields])
  // Achievement telemetry (0.9.5): the store dedupes by spec fingerprint, so
  // streaming re-renders and replays count once per distinct content.
  useEffect(() => {
    recordFence(spec)
  }, [spec])
  return (
    <div className={css.block} data-genui>
      {spec.title !== undefined && <div className={css.banner}>{spec.title}</div>}
      <div className={css.col} style={{ gap: `${gap}px` }}>
        {spec.items.map((c, i) => (
          // Staggered reveal: each root item fades/slides in after its
          // predecessors, so the block assembles piece by piece instead of
          // popping in as one slab. Delay capped so long specs still settle
          // quickly; prefers-reduced-motion disables it (see CSS).
          <div
            key={i}
            className={css.reveal}
            style={{ animationDelay: `${Math.min(i * 90, 720)}ms` }}
          >
            {renderNode(c, i, trackedAction, 0, answersState)}
          </div>
        ))}
      </div>
    </div>
  )
}, (prev, next) => prev.stateKey === next.stateKey && specEquivalent(prev.spec, next.spec))
