/**
 * GenUI spec guard: resource limits, structural validation, and deterministic
 * repair for ```dsh-ui fence specs.
 *
 * The renderer path runs every fence body through `repairGenuiSpec` before
 * rendering, so a pathological or hostile spec — deep nesting, thousands of
 * nodes, oversized strings, out-of-range numbers — degrades gracefully instead
 * of stalling the UI. Repair is deterministic and prefix-stable: a component
 * that survives repair of a partial stream keeps its position when later
 * chunks arrive, so streaming re-renders stay consistent.
 *
 * Policy:
 * - Unknown node `type`s pass through untouched (plugin-registered custom
 *   components via `registerGenuiComponent` are opaque to this package).
 * - Known types: required fields must have the right type or the node is
 *   dropped; numbers are clamped into range; strings truncated; arrays
 *   sliced to their caps; containers recursed with a depth budget.
 * - The whole spec carries a node budget; once exhausted, remaining siblings
 *   are elided.
 */
import type { GenuiSpec } from './spec.ts';
/** Hard resource limits enforced by repair (and mirrored at render time). */
export declare const GENUI_LIMITS: {
    /** Maximum nesting depth of the component tree. */
    readonly maxDepth: 8;
    /** Maximum total nodes across the whole spec. */
    readonly maxNodes: 200;
    /** Maximum length of any plain string field. */
    readonly maxString: 2000;
    /** Maximum length of a `code` body. */
    readonly maxCode: 12000;
    /** Maximum length of a mermaid source. */
    readonly maxMermaid: 8000;
    /** Maximum `grid` columns. */
    readonly maxGridCols: 12;
    /** Maximum `tabs` count. */
    readonly maxTabs: 12;
    /** Maximum `accordion` items. */
    readonly maxAccordionItems: 24;
    /** Maximum `list` items. */
    readonly maxListItems: 50;
    /** Maximum `select`/`radio` options. */
    readonly maxOptions: 50;
    /** Maximum `table` rows / columns. */
    readonly maxTableRows: 50;
    readonly maxTableCols: 12;
    /** Maximum `chart` data points per series. */
    readonly maxChartPoints: 60;
    /** Maximum `plot` series and per-series parameters. */
    readonly maxPlotSeries: 8;
    readonly maxPlotParams: 6;
    /** Maximum `scene3d` meshes. */
    readonly maxMeshes: 5;
    /** Maximum `quiz` options. */
    readonly maxQuizOptions: 8;
    /** Maximum `steps` / `timeline` / `breadcrumb` / `keyvalue` entries. */
    readonly maxSteps: 24;
    readonly maxTimelineItems: 24;
    readonly maxBreadcrumbItems: 12;
    readonly maxKeyValuePairs: 24;
    /** Maximum `file-tree` nesting. */
    readonly maxTreeDepth: 6;
};
/** Result of `validateGenuiSpec`. */
export interface GenuiValidation {
    ok: boolean;
    /** Human-readable problems, empty when `ok`. */
    errors: string[];
}
/**
 * Deterministically repair a raw spec value into a renderable GenuiSpec.
 * Returns null only when the root is not an object with an `items` array
 * (a bare component root is wrapped into a col first — the documented fence
 * vocabulary allows single-component bodies); every other defect is healed by
 * dropping/clamping/truncating. Idempotent: repairing a repaired spec is a
 * no-op.
 */
export declare function repairGenuiSpec(value: unknown): GenuiSpec | null;
/**
 * Count the nodes of a spec tree (every item, descending into tabs /
 * accordion / file-tree containers — the same descent `validateGenuiSpec`
 * walks). Shared by the panel fold (node-budget gate) and validation, so
 * the panel never runs a second, divergent traversal. `cap` bounds the walk
 * for hostile inputs; the panel passes `PANEL_LIMITS.maxNodes + 1` to detect
 * overflow without counting the whole tree.
 */
export declare function countGenuiNodes(value: unknown, cap?: number): number;
/**
 * Validate a raw spec value against the white list and limits, collecting
 * human-readable problems. Unlike repair this never mutates: it is a
 * diagnostic for tests and tooling. Unknown `type`s are reported (a plugin
 * custom type is valid only when a renderer is registered — the guard cannot
 * know, so it flags them as warnings).
 */
export declare function validateGenuiSpec(value: unknown): GenuiValidation;
