import type { AnswersState, GenuiBlockProps } from './state.ts';
import type { GenuiAccordion, GenuiBreadcrumb, GenuiCallout, GenuiCode, GenuiCopy, GenuiDiff, GenuiFileTree, GenuiJson, GenuiKeyValue, GenuiMermaid, GenuiPlot, GenuiQuiz, GenuiScene3D, GenuiSteps, GenuiTabs, GenuiTimeline } from '../spec.ts';
/** Callout: a tinted notice box with an optional heading. */
export declare const CalloutNode: import("react").NamedExoticComponent<{
    node: GenuiCallout;
}>;
/** Steps: a vertical progress checklist with an optional current index. */
export declare const StepsNode: import("react").NamedExoticComponent<{
    steps: GenuiSteps;
}>;
/** KeyValue: a definition list for configs and metadata. */
export declare const KeyValueNode: import("react").NamedExoticComponent<{
    node: GenuiKeyValue;
}>;
/** Plot: SVG function plot over the SafeMath evaluator. The series mapping
 * is memoized on the stable spec node so the memo boundary actually skips
 * sibling-state re-renders (a fresh mapped array would defeat it). */
export declare const PlotNode: import("react").NamedExoticComponent<{
    plot: GenuiPlot;
}>;
/** Diff: 收编 dsh DiffBlock (same path/oldText/newText shape as DiffHunk). */
export declare const DiffNode: import("react").NamedExoticComponent<{
    node: GenuiDiff;
}>;
/** Json: 收编 dsh JsonTree. */
export declare const JsonNode: import("react").NamedExoticComponent<{
    node: GenuiJson;
}>;
/** Code: 收编 dsh CodeBlock with explicit language. */
export declare const CodeNode: import("react").NamedExoticComponent<{
    node: GenuiCode;
}>;
/**
 * Table: LOCAL sorting (v2.9) — click a header to sort ascending, click
 * again for descending, a third click restores the spec order. Zero model
 * round trip. Numeric cells (numbers or numeric strings) compare numerically;
 * everything else compares as text.
 */
export declare function TabsNode({ tabs, onAction, depth, answers }: {
    tabs: GenuiTabs;
    onAction?: GenuiBlockProps['onAction'];
    depth?: number;
    answers?: AnswersState | undefined;
}): import("react").JSX.Element;
/** Radio: one option from a group; local selection state. The group name is
 * useId-based so sibling groups never collide (deterministic per mount).
 *
 * v2.5 aggregation: when `group` is set, the selection is recorded into the
 * block-wide answers registry instead of firing a per-click action — a
 * sibling `submit` node then grades the paper IN PLACE (v2.6, questions
 * carry `answer` data) or collects all groups in ONE action. Without
 * `group`, the legacy per-click action fires. After a local grading the
 * group locks until 重新作答 resets it. */
export declare function AccordionNode({ node, onAction, depth, answers }: {
    node: GenuiAccordion;
    onAction?: GenuiBlockProps['onAction'];
    depth?: number;
    answers?: AnswersState | undefined;
}): import("react").JSX.Element;
/** Copy: a one-click copy chip. The live region is a visually-hidden SIBLING
 * (not inside the button) — button content is atomic to screen readers, so a
 * live region inside it would never announce. */
export declare const CopyNode: import("react").NamedExoticComponent<{
    node: GenuiCopy;
}>;
/** Mermaid: lazily loaded diagram renderer. */
export declare const MermaidNode: import("react").NamedExoticComponent<{
    node: GenuiMermaid;
}>;
/** Scene3D: three.js WebGL canvas, lazily imported. */
export declare const Scene3DNode: import("react").NamedExoticComponent<{
    node: GenuiScene3D;
}>;
/** Timeline: vertical event list with time markers. */
export declare const TimelineNode: import("react").NamedExoticComponent<{
    node: GenuiTimeline;
}>;
/** FileTree: indented tree of files and folders. Directory rows are LOCAL
 * collapsible (spec.ts promised "collapsible children"; this makes it true)
 * — click a dir to fold/unfold, default fully open. Zero model round trip. */
export declare const FileTreeNode: import("react").NamedExoticComponent<{
    node: GenuiFileTree;
}>;
/** Quiz: a self-contained teaching question. Selecting an option marks it
 * correct/incorrect in place and reveals feedback + explanation. With
 * `action`, the chosen answer is ALSO sent back to the model
 * (`{type:'quiz', question, answer, correct}`) so the model can collect or
 * grade it — the in-place judging stays local (no round trip needed). */
export declare const QuizNode: import("react").NamedExoticComponent<{
    node: GenuiQuiz;
    onAction?: GenuiBlockProps["onAction"];
}>;
/** Breadcrumb: path-style navigation trail. */
export declare const BreadcrumbNode: import("react").NamedExoticComponent<{
    node: GenuiBreadcrumb;
}>;
/**
 * Trailing debounce window (ms) for one `[genui-action]` name: rapid
 * repeated interactions on one control (button mashing, switch flipping)
 * collapse into a single action with the LAST payload. Different action
 * names stay independent. The model round-trip takes seconds, so a few
 * hundred ms of trailing delay is imperceptible — and it stops bursts of
 * queued user turns.
 */ 
