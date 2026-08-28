/**
 * Shared block-level state types: the block props contract and the answers
 * registry (grouped radios → submit grading). Lives OUTSIDE GenuiBlock.tsx so
 * the per-family block modules can import the types without a cycle back
 * into the block shell.
 * @module @changfenhuang/dsh-genui/client/blocks/state
 */
import type { GenuiSpec } from '../spec.ts'

export interface GenuiBlockProps {
  /** Parsed spec to render. */
  spec: GenuiSpec
  /**
   * v2: optional action callback. Interactive components carrying an
   * `action` field fire it (button click, switch toggle, form submit);
   * absent = components are display-only (v1 behavior).
   */
  onAction?: ((action: string, payload: Record<string, unknown>) => void) | undefined
  /**
   * v2.7: durable-state key (session + slot + content fingerprint). When set,
   * interaction state (radio answers, submit lock, field values) persists to
   * localStorage and restores on refresh / re-render of the same content.
   * Changing this key also starts a fresh in-memory interaction-state lifetime;
   * callers only provide stateKey — GenuiBlock owns the matching React identity.
   */
  stateKey?: string | undefined
}

/** Per-question metadata registered by grouped radios for local grading. */
export interface QuestionMeta {
  label: string
  options: string[]
  /** Correct option: index (number) or label (string); absent = no local grading. */
  answer?: number | string | undefined
  /** Shown after local grading. */
  explanation?: string | undefined
}

/** Block-wide answers registry (v2.5/v2.6): grouped radios record selections
 * and register their question metadata here; a sibling `submit` node either
 * grades IN PLACE (questions carry `answer` data) or collects everything
 * into ONE action. Lives in GenuiBlock state so re-renders keep the
 * selections, threaded down through the recursive render walk. Answers are
 * plain group → chosen-option-label strings (the display label lives in
 * QuestionMeta; localStorage stores the same string table — no migration). */
export interface AnswersState {
  answers: Record<string, string>
  /** Field values by id (input/textarea with an `id`), collected by submit. */
  fields: Record<string, string>
  /** Field ids whose value must never be persisted or collected (secrets). */
  secretFields: ReadonlySet<string>
  meta: Record<string, QuestionMeta>
  /** True after a local grading: questions are locked until 重新作答. */
  locked: boolean
  /** Bumped by every reset; radios use it as their remount key. */
  round: number
  setAnswer: (group: string, choice: string) => void
  setField: (id: string, value: string) => void
  registerSecretField: (id: string) => void
  registerMeta: (group: string, meta: QuestionMeta) => void
  clear: () => void
  setLocked: (locked: boolean) => void
}
