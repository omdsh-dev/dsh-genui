/**
 * Session GenUI panel store: folds stable per-source panel operations into
 * one read-only snapshot per session. The toolview and the settled-fence
 * publisher submit operations (`replace`/`append`) carrying a stable
 * sourceId and a three-part order; the store deduplicates by source, sorts
 * by order, applies a deterministic fold under a node/append budget, and
 * notifies subscribers only when the folded snapshot actually changes.
 *
 * Ordering: no "last caller wins", no Infinity. Operations from DIFFERENT
 * sources always both apply; replays of the same source are idempotent; a
 * later replace resets everything earlier; an append beyond the budget is
 * remembered as an overflow barrier so an out-of-order earlier replace can
 * re-fold deterministically. A local `/panel` override (default panel or
 * clear) is the fold base and blocks every replay at/below the highest
 * message seq seen so far — old history can never resurrect the panel.
 *
 * Scale limits live in `PANEL_LIMITS` (adjustable defaults, not law — see
 * docs/plans/2026-08-12-dsh-genui-design-optimization.md). Budget
 * rejections are DETERMINISTIC (no LRU eviction: eviction would make the
 * fold depend on arrival order).
 *
 */
import type { GenuiSpec } from './spec.ts'
import { countGenuiNodes, isRenderableProcess, processGenuiSpec } from './guard.ts'
import { obj } from './genui-runtime/value-utils.ts'
import { GENUI_LIMITS } from './genui-runtime/index.ts'
import { fingerprint } from './interaction-store.ts'
import { mergePanelSpecs } from '../shared/panel-merge.ts'
export { mergePanelSpecs } from '../shared/panel-merge.ts'

/** Panel scale limits — adjustable defaults (design doc: scale limits are
 *  configurable, not law). Folds read the CURRENT limits, so tuning applies
 *  from the next operation on. */
export const PANEL_LIMITS = {
  /** Max nodes in the folded panel snapshot. */
  maxNodes: 200,
  /** Max append operations kept after the latest replace. */
  maxAppends: 200,
} as const

type PanelLimits = { maxNodes: number; maxAppends: number }

let limits: PanelLimits = { ...PANEL_LIMITS }

/** Override the panel limits (operator tuning / tests). Applied at the next fold. */
export function setPanelLimits(next: Partial<PanelLimits>): void {
  limits = { ...limits, ...next }
}

/** Three-part stable order: [messageSeq, textBlockIndex, fenceIndex]. */
export type PanelOrder = readonly [number, number, number]

/** One persistent panel operation from a settled source. */
export interface PanelOperation {
  /** Stable source identity (fence source id or `['render_ui', callId]`). */
  sourceId: string
  order: PanelOrder
  mode: 'replace' | 'append'
  spec: GenuiSpec
}

/** Outcome of a fold, committed atomically. */
interface FoldResult {
  snapshot: GenuiSpec | null
  stateIdentity: string | null
  /** 按顺序保存的操作，也包含等待更早基项的追加操作。 */
  kept: PanelOperation[]
  invalid: Map<string, string>
  /** First append rejected by the budget, or null. */
  overflow: PanelOperation | null
  /** Highest message seq among the candidate ops. */
  maxSeenSeq: number
}

interface SessionPanelState {
  baseIdentity: string | null
  stateIdentity: string | null
  ops: Map<string, PanelOperation>
  invalid: Map<string, string>
  /** Every sourceId ever processed (kept or dropped) — the replay dedup
   * register. `ops` only keeps the ops in the current fold, so a consumed op
   * dropped by a later replace used to be indistinguishable from a first
   * arrival and re-folded on history scroll; `seen` makes replays idempotent
   * without breaking genuine out-of-order first arrivals. */
  seen: Map<string, PanelOrder>
  overflow: PanelOperation | null
  /** Local /panel override base; null = cleared. */
  local: GenuiSpec | null
  /** Replays at/below this seq are dead (blocked by the local override). */
  localBarrier: number
  /** Replays at/below this seq are dead (persisted-session hydration barrier;
   * live sessions keep -1 — the seen register covers them). */
  replayBarrier: number
  maxSeenSeq: number
  snapshot: GenuiSpec | null
}

const sessions = new Map<string, SessionPanelState>()
const listeners = new Set<() => void>()

function emptyState(): SessionPanelState {
  return { baseIdentity: null, stateIdentity: null, ops: new Map(), invalid: new Map(), seen: new Map(), overflow: null, local: null, localBarrier: -1, replayBarrier: -1, maxSeenSeq: -1, snapshot: null }
}

/* ---------------- localStorage persistence ---------------- */

const STORAGE_KEY = 'dsh.genui.panel'
/** Max persisted sessions; LRU-evicted on write (the deterministic fold is
 * unaffected — hydration only seeds the fold base, history replays rebuild
 * anything evicted). */
const MAX_PERSISTED_SESSIONS = 50

/** What survives a page reload: the folded snapshot, the local /panel
 * override, and the barriers that keep old replays from resurrecting either. */
interface PersistedPanel {
  stateIdentity?: string | null
  snapshot: GenuiSpec | null
  local: GenuiSpec | null
  localBarrier: number
  maxSeenSeq: number
  /** 未解决的追加项仍需更早历史，不应阻止后续重放。 */
  pending?: { ops: PanelOperation[]; overflow: PanelOperation | null; replayBarrier: number; baseIdentity: string | null }
}

interface PanelStorageShape {
  order: string[]
  sessions: Record<string, PersistedPanel>
}

function readPanelStorage(): PanelStorageShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { order: [], sessions: {} }
    const parsed = JSON.parse(raw) as Partial<PanelStorageShape>
    if (!Array.isArray(parsed.order) || typeof parsed.sessions !== 'object' || parsed.sessions === null) {
      return { order: [], sessions: {} }
    }
    return {
      order: parsed.order.filter(k => typeof k === 'string'),
      sessions: parsed.sessions as Record<string, PersistedPanel>,
    }
  } catch {
    return { order: [], sessions: {} }
  }
}

function writePanelStorage(sessionId: string, entry: PersistedPanel): void {
  try {
    const store = readPanelStorage()
    const order = store.order.filter(k => k !== sessionId)
    order.unshift(sessionId)
    const sessions = { ...store.sessions, [sessionId]: entry }
    while (order.length > MAX_PERSISTED_SESSIONS) {
      const evicted = order.pop()
      if (evicted !== undefined) delete sessions[evicted]
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ order, sessions }))
  } catch {
    // Quota / privacy-mode failures are non-fatal: the panel stays live in
    // memory, only cross-restart persistence is lost.
  }
}

/** Lazy session state: hydrate from localStorage once per session when the
 * in-memory record is absent (first access after a reload). The persisted
 * snapshot + barriers restore the panel instantly; replays at/below the
 * persisted maxSeenSeq are dead, so history scrolling can never resurrect or
 * duplicate content. */
function stateOf(sessionId: string): SessionPanelState {
  const existing = sessions.get(sessionId)
  if (existing !== undefined) return existing
  let state = emptyState()
  try {
    const stored = readPanelStorage().sessions[sessionId]
    if (stored !== undefined && obj(stored) !== undefined) {
      const snapshot = stored.snapshot === null ? null : checkedPanelSpec(stored.snapshot)
      const local = stored.local == null ? null : checkedPanelSpec(stored.local)
      // An invalid snapshot must not keep a barrier that prevents valid history
      // from rebuilding it. An explicit user clear does keep its barrier.
      if (snapshot === null && stored.snapshot !== null) {
        console.warn('[genui] Invalid saved panel ignored; valid history can rebuild this session.')
        if (local !== null) {
          state.local = state.snapshot = local
          state.baseIdentity = state.stateIdentity = fingerprint(JSON.stringify(local))
          state.localBarrier = state.replayBarrier = state.maxSeenSeq = storedSeq(stored.localBarrier)
        }
        sessions.set(sessionId, state)
        return state
      }
      const stateIdentity = snapshot === null ? null : typeof stored.stateIdentity === 'string'
        ? stored.stateIdentity : fingerprint(JSON.stringify(snapshot))
      const maxSeenSeq = storedSeq(stored.maxSeenSeq)
      const restoredState: SessionPanelState = {
        baseIdentity: stateIdentity,
        stateIdentity,
        ops: new Map(),
        invalid: new Map(),
        seen: new Map(),
        overflow: null,
        local: snapshot,
        localBarrier: storedSeq(stored.localBarrier),
        replayBarrier: maxSeenSeq,
        maxSeenSeq,
        snapshot,
      }
      const pending = stored.pending
      if (obj(pending) !== undefined && Array.isArray(pending?.ops)
        && pending.ops.every(isStoredOperation)
        && (pending.overflow === null || isStoredOperation(pending.overflow))
        && Number.isSafeInteger(pending.replayBarrier) && pending.replayBarrier >= -1
        && (pending.baseIdentity === null || typeof pending.baseIdentity === 'string')
        && (stored.local == null || local !== null)) {
        const pendingState: SessionPanelState = {
          ...restoredState, local, baseIdentity: pending.baseIdentity,
          ops: new Map(pending.ops.map(op => [op.sourceId, op])),
          seen: new Map(pending.ops.map(op => [op.sourceId, op.order])),
          replayBarrier: pending.replayBarrier, overflow: pending.overflow,
        }
        const restored = fold(pendingState, null)!
        // Shape-valid but incomplete history must not erase a valid snapshot.
        if (samePanelSpec(restored.snapshot, snapshot)) {
          Object.assign(restoredState, pendingState, {
            snapshot: restored.snapshot, stateIdentity: restored.stateIdentity,
            invalid: restored.invalid, ops: new Map(restored.kept.map(op => [op.sourceId, op])),
            overflow: restored.overflow,
          })
          if (restoredState.overflow !== null) restoredState.seen.set(restoredState.overflow.sourceId, restoredState.overflow.order)
        }
      }
      // Commit only a completely constructed state. Malformed pending data
      // falls back to the valid snapshot as the next append's base.
      state = restoredState
    }
  } catch {
    // storage unreadable: behave like a fresh session
  }
  sessions.set(sessionId, state)
  return state
}

function storedSeq(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= -1 ? value : -1
}

/** Preserve identity for already-canonical inputs; never publish raw aliases. */
function canonicalPanelSpec(original: unknown, canonical: GenuiSpec): GenuiSpec {
  return samePanelSpec(original, canonical) ? original as GenuiSpec : canonical
}

function samePanelSpec(a: unknown, b: unknown): boolean {
  const sortedKeys = (_key: string, value: unknown) => obj(value) === undefined ? value
    : Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
  return JSON.stringify(a, sortedKeys) === JSON.stringify(b, sortedKeys)
}

function checkedPanelSpec(value: unknown): GenuiSpec | null {
  const processed = processGenuiSpec(value)
  return processed.errors.length === 0 && processed.spec !== null && !exceedsPanelBudget(processed.spec)
    ? canonicalPanelSpec(value, processed.spec) : null
}

function isStoredOperation(value: unknown): value is PanelOperation {
  const op = obj(value)
  if (op === undefined || typeof op.sourceId !== 'string' || op.sourceId === ''
    || !Array.isArray(op.order) || op.order.length !== 3
    || !op.order.every(n => typeof n === 'number' && Number.isSafeInteger(n))
    || (op.mode !== 'replace' && op.mode !== 'append')) return false
  return isRenderableProcess(processGenuiSpec(op.spec, { panelOperation: op.mode }))
}

function compareOrder(a: PanelOrder, b: PanelOrder): number {
  for (let i = 0; i < 3; i++) {
    const d = a[i]! - b[i]!
    if (d !== 0) return d
  }
  return 0
}

/**
 * Deterministic candidate fold. Returns null when the candidate changes
 * nothing (idempotent replay, replay blocked by the local barrier, or an
 * append later than the overflow barrier); otherwise the state to commit.
 * Never mutates the session state.
 */
function fold(state: SessionPanelState, extra: PanelOperation | null): FoldResult | null {
  if (extra !== null) {
    if (extra.order[0] <= state.localBarrier || extra.order[0] <= state.replayBarrier) return null // old replay under a barrier
    if (state.seen.has(extra.sourceId)) return null // idempotent replay (kept OR previously consumed)
    if (state.overflow !== null && state.overflow.sourceId === extra.sourceId) return null
    if (extra.mode === 'append' && state.overflow !== null && compareOrder(extra.order, state.overflow.order) > 0) {
      // Later than the overflow barrier: rejected without touching the fold.
      return null
    }
  }
  // Only live ops (strictly after both barriers) participate.
  const ops = [...state.ops.values()].filter(op => op.order[0] > state.localBarrier && op.order[0] > state.replayBarrier)
  if (state.overflow !== null && state.overflow.order[0] > state.localBarrier && state.overflow.order[0] > state.replayBarrier) ops.push(state.overflow)
  if (extra !== null) ops.push(extra)
  ops.sort((a, b) => compareOrder(a.order, b.order))
  const checked = new Map(ops.map(op => [op, processGenuiSpec(op.spec, { panelOperation: op.mode })]))
  // The latest VALID replace resets everything before it; start the fold
  // there. (A replace beyond the node budget — only reachable with
  // non-default limits — never becomes the base.)
  let start = 0
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!
    if (op.mode === 'replace' && checked.get(op)!.errors.length === 0 && !exceedsPanelBudget(op.spec)) start = i
  }
  let snapshot: GenuiSpec | null = state.local
  let stateIdentity = state.baseIdentity
  let overflow: PanelOperation | null = null
  let appendCount = 0
  const kept: PanelOperation[] = []
  const invalid = new Map<string, string>()
  let maxSeenSeq = state.maxSeenSeq
  for (let i = start; i < ops.length; i++) {
    const op = ops[i]!
    if (op.order[0] > maxSeenSeq) maxSeenSeq = op.order[0]
    const validation = checked.get(op)!
    if (!isRenderableProcess(validation)) {
      invalid.set(op.sourceId, validation.errors.join('；') || 'invalid panel spec')
      continue
    }
    const canonical = canonicalPanelSpec(op.spec, validation.spec!)
    if (op.mode === 'replace') {
      if (exceedsPanelBudget(op.spec)) {
        // Pathological replace beyond the node budget: rejected like any
        // over-budget op (remembered as the overflow barrier, fold kept).
        if (overflow === null || compareOrder(op.order, overflow.order) < 0) overflow = op
        continue
      }
      overflow = null
      snapshot = canonical
      stateIdentity = fingerprint(JSON.stringify(canonical))
      kept.length = 0
      appendCount = 0
      kept.push(op)
      continue
    }
    // Each append is gated independently against the current snapshot — a
    // rejection never retroactively drops ops that already fit.
    const merged = mergePanelSpecs(snapshot, canonical)
    if (appendCount >= limits.maxAppends
      || exceedsPanelBudget(op.spec)
      || exceedsPanelBudget(merged)) {
      if (overflow === null || compareOrder(op.order, overflow.order) < 0) overflow = op
      continue
    }
    appendCount += 1
    kept.push(op)
    // 检查完整文档，不单独检查追加增量。暂存未通过检查的操作，供迟到的较早基项重新计算；
    // 该操作不会改变当前有效内容。
    const mergedValidation = processGenuiSpec(merged)
    if (mergedValidation.errors.length > 0 || mergedValidation.spec === null) {
      invalid.set(op.sourceId, mergedValidation.errors.join('；') || 'invalid panel spec')
      continue
    }
    if (snapshot === null) stateIdentity = fingerprint(JSON.stringify(op.spec))
    snapshot = canonicalPanelSpec(merged, mergedValidation.spec)
  }
  if (extra !== null) {
    const sameSet = kept.length === state.ops.size
      && kept.every(op => state.ops.get(op.sourceId)?.mode === op.mode)
      && ((overflow === null && state.overflow === null)
        || (overflow !== null && state.overflow !== null && overflow.sourceId === state.overflow.sourceId))
    if (sameSet && invalid.size === state.invalid.size
      && [...invalid].every(([id, error]) => state.invalid.get(id) === error)) return null
  }
  return { snapshot, stateIdentity, kept, invalid, overflow, maxSeenSeq }
}

function commit(state: SessionPanelState, result: FoldResult, sessionId: string): void {
  state.snapshot = result.snapshot
  state.stateIdentity = result.stateIdentity
  state.invalid = result.invalid
  state.overflow = result.overflow
  state.maxSeenSeq = result.maxSeenSeq
  state.ops = new Map(result.kept.map(op => [op.sourceId, op]))
  // Every processed op joins the replay dedup register — kept or dropped,
  // accepted or overflow-rejected: a history-scroll replay must never
  // re-fold a source the fold already consumed.
  for (const op of result.kept) state.seen.set(op.sourceId, op.order)
  if (result.overflow !== null) state.seen.set(result.overflow.sourceId, result.overflow.order)
  writePanelStorage(sessionId, {
    stateIdentity: state.stateIdentity,
    snapshot: state.snapshot,
    local: state.local,
    localBarrier: state.localBarrier,
    maxSeenSeq: state.maxSeenSeq,
    ...(state.invalid.size === 0 ? {} : { pending: {
      ops: [...state.ops.values()], overflow: state.overflow, replayBarrier: state.replayBarrier, baseIdentity: state.baseIdentity,
    } }),
  })
}

export type PanelOperationStatus = 'accepted' | 'idempotent' | 'blocked' | 'overflow' | 'invalid'

/**
 * Submit one panel operation. Idempotent per sourceId; ordering and budget
 * per the module doc. Returns the outcome so callers can diagnose once per
 * source (e.g. "panel at its node/appends budget — send a replace").
 */
export function applyPanelOperation(sessionId: string, op: PanelOperation): PanelOperationStatus {
  const state = stateOf(sessionId)
  const result = fold(state, op)
  if (result === null) {
    if (state.seen.has(op.sourceId) || state.overflow?.sourceId === op.sourceId) return 'idempotent'
    // A rejection may come from the replay/local barriers (dead old content
    // — worth one diagnostic) or from the budget overflow barrier (a later
    // append beyond the panel budget — the budget diagnostic covers it).
    const laterThanOverflow = state.overflow !== null
      && op.mode === 'append'
      && compareOrder(op.order, state.overflow.order) > 0
    if (!laterThanOverflow) diagnosePanelBlocked(sessionId, op, state)
    return 'blocked'
  }
  const status: PanelOperationStatus = result.overflow !== null && result.overflow.sourceId === op.sourceId
    ? 'overflow'
    : result.invalid.has(op.sourceId) ? 'invalid' : 'accepted'
  const changed = state.snapshot !== result.snapshot || state.invalid.size !== result.invalid.size
    || [...result.invalid].some(([sourceId, error]) => state.invalid.get(sourceId) !== error)
  commit(state, result, sessionId)
  state.seen.set(op.sourceId, op.order)
  if (changed) for (const fn of listeners) fn()
  return status
}

/* ---------------- barrier-rejection diagnostics ---------------- */

/** One diagnostic per blocked source per page session (replays stay quiet). */
const diagnosedBlocked = new Set<string>()

/**
 * Log one barrier-rejection diagnostic. Barrier kills are EXPECTED for
 * history replays (the persisted hydration barrier makes replays at/below
 * the persisted max seq dead), so this stays quiet on repeat visits — but a
 * NEW message's fence being blocked is a real defect (broken seq
 * derivation), and the one-time warning makes it observable instead of a
 * silent dock freeze (issue #4 asked for exactly this).
 */
function diagnosePanelBlocked(sessionId: string, op: PanelOperation, state: SessionPanelState): void {
  const key = `${sessionId}\u0000${op.sourceId}`
  if (diagnosedBlocked.has(key)) return
  diagnosedBlocked.add(key)
  console.warn(
    `[genui] 面板操作被重放屏障拒绝（source ${op.sourceId}，order[0]=${op.order[0]} ≤ replayBarrier ${state.replayBarrier} / localBarrier ${state.localBarrier}）。历史消息重放被拒是预期行为；若是刚发送的新消息，说明消息序号推导异常，请报告。`,
  )
}

/* ---------------- local /panel override ---------------- */

/**
 * Apply the local `/panel` override: `spec` (the default panel) or null
 * (clear) becomes the fold base, and every operation at/below the highest
 * message seq seen so far is dead — old history replays cannot resurrect
 * the panel. A later real operation (order[0] > barrier) replaces or merges
 * into the override as usual.
 */
export function setLocalPanel(sessionId: string, spec: GenuiSpec | null): void {
  if (spec !== null) {
    const checked = checkedPanelSpec(spec)
    if (checked === null) return
    spec = checked
  }
  const state = stateOf(sessionId)
  const barrier = state.maxSeenSeq
  // A clear when local is already null is still a change when the barrier
  // moves: the barrier is what kills old history replays.
  if (state.local === spec && state.localBarrier === barrier) return
  state.local = spec
  state.baseIdentity = spec === null ? null : fingerprint(JSON.stringify(spec))
  state.localBarrier = barrier
  // extra is null here, so fold never rejects the candidate (its null
  // returns live behind the `extra !== null` gate).
  const result = fold(state, null)!
  commit(state, result, sessionId)
  for (const fn of listeners) fn()
}

/** One diagnostic per over-budget source (replays stay silent). */
const diagnosedOverflow = new Set<string>()

/** Log one budget-overflow diagnostic per source (replays stay silent). */
export function diagnosePanelBudget(sessionId: string, sourceId: string): void {
  const key = `${sessionId}\u0000${sourceId}`
  if (diagnosedOverflow.has(key)) return
  diagnosedOverflow.add(key)
  console.warn(
    `[genui] 面板已到内容/操作上限（${limits.maxNodes} 节点、${GENUI_LIMITS.maxComputedFields} 个计算字段、${limits.maxAppends} 条追加），本次 append 被拒绝；请让模型发送 replace 更新面板。`,
  )
}

/** Tear down a session's panel state (session destroy / hard clear). Memory
 * only: drops the in-memory record, the session's expand token, and overflow
 * diagnostics, so a long-lived app never accumulates per-session state for
 * closed sessions. The localStorage entry SURVIVES — reopening the session
 * restores the panel instantly (that is the persistence feature); an explicit
 * user clear goes through setLocalPanel(null), which persists the cleared
 * state + barrier. */
export function clearSessionPanel(sessionId: string): void {
  const had = sessions.delete(sessionId)
  const hadToken = expandTokens.delete(sessionId)
  const prefix = `${sessionId}\u0000`
  for (const key of diagnosedOverflow) {
    if (key.startsWith(prefix)) diagnosedOverflow.delete(key)
  }
  for (const key of diagnosedBlocked) {
    if (key.startsWith(prefix)) diagnosedBlocked.delete(key)
  }
  if (!had && !hadToken) return
  for (const fn of listeners) fn()
  for (const fn of expandListeners) fn()
}

/* ---------------- reads / subscription ---------------- */

/** Current folded spec for a session (useSyncExternalStore getSnapshot).
 * Lazily hydrates from localStorage on first access after a reload. */
export function getPanelSpec(sessionId: string): GenuiSpec | null {
  return stateOf(sessionId).snapshot
}

/** 返回面板状态标识；追加沿用基项标识，替换操作使用自身内容标识。 */
export function getPanelStateKey(sessionId: string): string | undefined {
  const identity = stateOf(sessionId).stateIdentity
  return identity === null ? undefined : `p:${sessionId}:${identity}`
}

/** 返回追加操作的当前错误；较早操作解决依赖后会清除错误。 */
export function getPanelOperationError(sessionId: string, sourceId: string): string | null {
  return stateOf(sessionId).invalid.get(sourceId) ?? null
}

/** Subscribe to panel changes. Returns the disposer. */
export function subscribePanel(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/* ---------------- incremental append (pure merge) ---------------- */

/** 合并后的面板仍须遵守单份规格的节点和计算字段预算。 */
function exceedsPanelBudget(spec: GenuiSpec): boolean {
  return countGenuiNodes(spec, limits.maxNodes + 1) > limits.maxNodes
    || (spec.computed?.length ?? 0) > GENUI_LIMITS.maxComputedFields
}

/* ---------------- expand requests ---------------- */

/**
 * Per-session expand tokens: a monotone counter bumped by every explicit
 * expand request (the /panel slash command). The dock compares the token
 * against its own last-seen value so a fresh request expands the panel even
 * when the user collapsed it manually in between.
 */
const expandTokens = new Map<string, number>()

const expandListeners = new Set<() => void>()

/** Request the panel dock to expand for a session (e.g. the /panel command). */
export function requestPanelExpand(sessionId: string): void {
  expandTokens.set(sessionId, (expandTokens.get(sessionId) ?? 0) + 1)
  for (const fn of expandListeners) fn()
}

/** Current expand token for a session (useSyncExternalStore getSnapshot). */
export function getPanelExpandToken(sessionId: string): number {
  return expandTokens.get(sessionId) ?? 0
}

/** Subscribe to expand requests. Returns the disposer. */
export function subscribePanelExpand(listener: () => void): () => void {
  expandListeners.add(listener)
  return () => {
    expandListeners.delete(listener)
  }
}
