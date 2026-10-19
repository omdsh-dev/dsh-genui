/**
 * GenUI spec language: the declarative component tree a model emits inside a
 * ```dsh-ui fence in its reply, which GenuiBlock renders as real interactive
 * UI inline in the conversation. The vocabulary is a white list — the renderer
 * maps each node to DOM directly, with no arbitrary-HTML path (same
 * untrusted-output stance as MarkdownText).
 *
 * v1 interactivity is client-side only: buttons, tabs, checkboxes, and inputs
 * are operable, but events do NOT flow back to the model.
 */
import { COMPONENT_SCHEMAS, GENUI_NATIVE_TYPES } from './genui-runtime/schema.ts'

/** One node in the component tree. */
/** Layout hints accepted by every node: `span` is how many columns the node
 *  occupies as a direct child of a `grid` (bento layouts). */
export interface GenuiLayoutHints {
  span?: number
}

export type GenuiNode = (
  | GenuiText
  | GenuiRow
  | GenuiCol
  | GenuiGrid
  | GenuiCard
  | GenuiButton
  | GenuiInput
  | GenuiSelect
  | GenuiCheckbox
  | GenuiLink
  | GenuiImage
  | GenuiAudio
  | GenuiVideo
  | GenuiBadge
  | GenuiStat
  | GenuiHero
  | GenuiProgress
  | GenuiDivider
  | GenuiList
  | GenuiTable
  | GenuiChart
  | GenuiTabs
  | GenuiAvatar
  | GenuiSpacer
  | GenuiPlot
  | GenuiCallout
  | GenuiSteps
  | GenuiKeyValue
  | GenuiDiff
  | GenuiJson
  | GenuiCode
  | GenuiRadio
  | GenuiSubmit
  | GenuiSwitch
  | GenuiSlider
  | GenuiTextarea
  | GenuiAccordion
  | GenuiCopy
  | GenuiMermaid
  | GenuiSvg
  | GenuiScene3D
  | GenuiTimeline
  | GenuiFileTree
  | GenuiBreadcrumb
  | GenuiQuiz
  | GenuiDiagram
  | GenuiIcon
  | GenuiBlocks
  | GenuiArrow
) & GenuiLayoutHints

  | GenuiEChart

export interface GenuiSpec {
  /** Short title shown as the card banner. */
  title?: string
  /** Vertical gap between root items in px. */
  gap?: number
  /** Panel-only flag: `true` routes the fence to the session panel dock
   * instead of the message flow (rendered by the same block, updated in
   * place on every publish). */
  panel?: boolean
  /** Panel APPEND flag (meaningful only with `panel: true`): instead of
   * replacing the session panel, merge this spec INTO the existing one —
   * same-labelled tabs get their items appended, new tabs are added, plain
   * item lists are appended to the tail. Lets the model grow a panel
   * incrementally without resending (or truncating) the accumulated content.
   * Applies only when the fence body is fully complete, so a streaming
   * partial parse never double-merges. */
  append?: boolean
  /** Root component list. */
  items: GenuiNode[]
}

/* ---------------- leaf nodes ---------------- */

export interface GenuiText {
  type: 'text'
  size?: 'display' | 'h1' | 'h2' | 'h3' | 'body' | 'muted' | 'caption'
  content: string
  /** Legacy boolean shorthand; `align: 'center'` is the canonical form. */
  center?: boolean
  /** Semantic colour for the run (danger renders red without a badge). */
  tone?: 'danger' | 'success' | 'warning' | 'info' | 'muted'
  /** Monospace run — hex, binary, identifiers — without the inline-code pill. */
  mono?: boolean
  /** Horizontal alignment; `center?: true` normalizes to `align: 'center'`. */
  align?: 'left' | 'center' | 'right'
}

export interface GenuiButton {
  type: 'button'
  label: string
  tone?: 'primary' | 'danger' | 'success' | 'ghost'
  full?: boolean
  small?: boolean
  icon?: string
  /** v2: when set, clicking sends this action back to the model. */
  action?: string
}

export interface GenuiInput {
  type: 'input'
  label?: string
  placeholder?: string
  value?: string
  inputType?: 'text' | 'email' | 'password' | 'color'
  /** v2: when set, interaction sends this action back to the model. */
  action?: string
  /**
   * v2.7: stable field id — the value is persisted across refresh/re-render
   * and collected by a sibling `submit` node (`fields: {id: value}`).
   */
  id?: string
}

export interface GenuiSelect {
  type: 'select'
  label?: string
  options: string[]
  /** v2: when set, interaction sends this action back to the model. */
  action?: string
  /**
   * v2.8: default-selected option index (a placeholder option shows instead
   * when absent, so nothing is silently pre-registered).
   */
  selected?: number
  /**
   * v2.8: stable field id — the chosen option persists across refresh and is
   * collected by a sibling `submit` node (`fields: {id: value}`), like
   * input/textarea ids.
   */
  id?: string
}

export interface GenuiCheckbox {
  type: 'checkbox'
  label: string
  checked?: boolean
  /** v2: when set, interaction sends this action back to the model. */
  action?: string
  /**
   * Aggregation group name. When set, toggles stay local and update the
   * block-wide multi-answer registry instead of firing the per-click action;
   * a sibling `submit` collects the selected labels as a string array.
   */
  group?: string
}

export interface GenuiLink {
  type: 'link'
  label: string
  /**
   * Optional http(s)/mailto target. With `href` the node renders a REAL
   * anchor (target=_blank + noopener); without it the node renders as plain
   * styled text — never a dead clickable-looking control.
   */
  href?: string
}

/** User-controlled image from a browser-reachable URL. */
export interface GenuiImage {
  type: 'image'
  src: string
  /** Visible label line above the image and accessible description. */
  alt?: string
  /** Caption line below the image (source, reading, credit). */
  caption?: string
}

/** User-controlled audio from a browser-reachable URL. */
export interface GenuiAudio {
  type: 'audio'
  src: string
  /** Visible caption and accessible player name. */
  alt?: string
  loop?: boolean
}

/** User-controlled video from a browser-reachable URL. */
export interface GenuiVideo {
  type: 'video'
  src: string
  /** Visible caption and accessible player name. */
  alt?: string
  poster?: string
  loop?: boolean
  muted?: boolean
  aspectRatio?: '16:9' | '4:3' | '1:1' | '9:16'
}

export interface GenuiBadge {
  type: 'badge'
  label: string
  tone?: 'success' | 'warn' | 'danger' | 'accent'
  icon?: string
}

/** Cover band: the answer's focal point. One per fence — an eyebrow label, an
 *  oversized metric, a title and a subtitle on a soft tinted surface. */
export interface GenuiHero {
  type: 'hero'
  title: string
  subtitle?: string
  /** Oversized metric, e.g. "99.96%" / "3.2x". */
  value?: string
  /** Eyebrow label above the metric. */
  label?: string
  delta?: string
  spark?: number[]
  tone?: 'accent' | 'success' | 'warning' | 'danger'
}

export interface GenuiStat {
  type: 'stat'
  label: string
  value: string
  delta?: string
  /** Optional micro trend line (finite numbers, 2..60 points). */
  spark?: number[]
  /** `hero` renders one oversized number — use it once per fence as the anchor. */
  size?: 'hero'
}

export interface GenuiProgress {
  type: 'progress'
  value: number
  label?: string
  valueLabel?: string
  /** `bar` (default) draws a track; `ring` draws a circular gauge. */
  variant?: 'bar' | 'ring'
  /** Optional target marker on the bar track (0-100). */
  target?: number
}

export interface GenuiDivider {
  type: 'divider'
  /** Chapter separator: hairline + centered meta label (anthology program). */
  label?: string
}

export interface GenuiAvatar {
  type: 'avatar'
  name: string
  color?: string
}

export interface GenuiSpacer {
  type: 'spacer'
}

/* ---------------- v12: figure primitives ---------------- */

/**
 * `arrow`: a thin connector between two blocks of a figure.
 *
 * The text glyph `↓` was the only way to draw a flow before this: it sits on
 * the text baseline, inherits body size, and cannot hold a fixed gap. This node
 * draws a hairline with a chevron head at a fixed length, so a vertical flow
 * reads as a diagram instead of a paragraph.
 */
export interface GenuiArrow {
  type: 'arrow'
  dir?: 'down' | 'right'
  /** Shaft length in px (16-96). Defaults to 26 (down) / 32 (right). */
  length?: number
  /** Optional caption beside/under the arrow. */
  label?: string
}

/** One glyph from the bundled (curated) icon catalogue. */
export interface GenuiIcon {
  type: 'icon'
  /** Canonical catalogue name, e.g. `Nodes`. See ICON_NAMES / SKILL.md. */
  name: string
  /** Accessible name. Omit when the icon is decorative beside a visible label. */
  label?: string
  tone?: 'default' | 'muted' | 'info' | 'success' | 'warning' | 'danger'
  /** Optical size in px; the renderer clamps to the nearest of 16/20/24/32. */
  size?: number
  /** Tinted rounded-square plate (figure / stage-card use). */
  tile?: boolean
}

/**
 * One cell of a `blocks` row.
 *
 * A bare string is the common case (a label in a filled cell). The object form
 * exists for figures that mark ONE cell out of many — a bit grid where the
 * sign bit is highlighted, a lane where the current step is active — and for
 * the small caption that hangs under a cell (`1` with `SF` beneath it).
 */
export type GenuiBlockCell = string | null | {
  text: string
  /** Per-cell fill (hex); overrides the row colour. */
  color?: string
  /** Per-cell semantic emphasis when no explicit hex is wanted. */
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'muted'
  /** Small caption under the cell (bit name, index, role…). */
  sub?: string
}

/** One row of a `blocks` figure: a label plus its cells. */
export interface GenuiBlocksRow {
  /** Row label rendered to the left of the cells. */
  label?: string
  /** Cells, left to right. `null` renders a blank (unpainted) slot; use the
   *  string `"—"` when a visible dash is wanted. */
  cells: GenuiBlockCell[]
  /** Fill for this row's cells (hex). Falls back to the accent wash. */
  color?: string
  /**
   * `fill` (default) paints every cell with the row colour.
   * `outline` leaves cells unfilled with a hairline border — matrices where
   * every cell is a box. `plain` removes the box entirely (a bit string like
   * `1 0 1 0 0 0 0 0` reads as digits, not as a table), so only a cell with an
   * explicit `tone`/`color` draws a surface.
   */
  variant?: 'fill' | 'outline' | 'plain'
}

/**
 * `blocks`: the declarative replacement for hand-written SVG block diagrams —
 * a grid of filled cells grouped into labelled rows.
 *
 * Covers the three shapes models kept reaching for SVG to draw: a recursion /
 * hierarchy ladder (each row divides its own width, 8 → 4 → 2 → 1), an equal
 * row of parts (4 × "块 0"), and a lane/timeline grid (`columns` fixes the
 * shared column count, `null` cells leave gaps).
 */
export interface GenuiBlocks {
  type: 'blocks'
  rows: GenuiBlocksRow[]
  /** Fixed column count shared by every row. Omit to let each row divide its
   *  own width equally. */
  columns?: number
  /** Figure caption rendered under the cells (the "每格代表…" line). */
  caption?: string
  title?: string
}

/* ---------------- container nodes ---------------- */

export interface GenuiRow {
  type: 'row'
  items: GenuiNode[]
  wrap?: boolean
  spacer?: boolean
  /** Main-axis alignment. `center` is what figure headers need (icon + title
   *  stacked over a caption); the default stays `start`. */
  justify?: 'start' | 'center' | 'end' | 'between'
}

export interface GenuiCol {
  type: 'col'
  items: GenuiNode[]
  gap?: number
  /** Width as a percentage of the row (1-100). Omit to size by content. */
  width?: number
}

export interface GenuiGrid {
  type: 'grid'
  cols: number
  items: GenuiNode[]
}

export interface GenuiCard {
  type: 'card'
  title?: string
  /** Meta overline above the title (chaptering for card groups; use sparingly). */
  eyebrow?: string
  /** Semantic tint for the card surface (default: neutral). */
  tone?: 'info' | 'success' | 'warning' | 'danger'
  /** Explicit accent (hex) driving the border, title and wash. */
  accent?: string
  /** Drop the elevation and use a faint neutral fill: figure panels read as
   *  printed blocks instead of floating cards. */
  flat?: boolean
  items: GenuiNode[]
}

export interface GenuiList {
  type: 'list'
  /** Field id of an input/select: its value filters the items locally. */
  filter?: string
  items: Array<string | { title: string; desc?: string } | GenuiNode>
}

export interface GenuiTable {
  type: 'table'
  columns: string[]
  rows: Array<Array<string | number>>
  /** Per-column cell type; missing = auto (numeric right-align, signed delta). */
  types?: TableCellType[]
  /** Append a 合计 footer row (numeric columns are summed). */
  total?: boolean
  /** Show 复制 Markdown / 复制 CSV chips above the table. */
  export?: boolean
  /** Optional master-detail payload, positionally aligned with `rows`:
   *  `details[i]` is what row i expands into (omit / empty = not expandable). */
  details?: Array<GenuiNode[] | null>
  /** Field id of an input/select: its live value filters the rows locally
   *  (substring match), so the table is searchable without a model round trip. */
  filter?: string
  /** Restrict `filter` to one column index (default: every column). */
  filterColumn?: number
  /** Field id of a select whose value is a column header: sorts by it locally. */
  sortField?: string
}

/** How a table column's cells render.
 *  - `bar` / `ring`: the cell is read as 0-100
 *  - `spark`: the cell is a number list ("3,5,4,8") drawn as a mini trend
 *  - `index`: the 1-based row number (cell content is ignored)
 *  - `delta` / `num` / `badge` / `text`: text treatments. */
export type TableCellType = 'text' | 'num' | 'delta' | 'bar' | 'badge' | 'spark' | 'ring' | 'index' | 'group'

export interface GenuiChartDatum {
  label: string
  value: number
  color?: string
}

export interface GenuiChart {
  type: 'chart'
  /** Chart shape: bars (default), line (trend), donut (share). */
  kind?: 'bars' | 'line' | 'donut'
  data: GenuiChartDatum[]
  /** Multi-series: grouped bars, or one line per entry when kind is line. */
  series?: Array<{ label: string; color?: string; data: GenuiChartDatum[] }>
  /** Bars only: horizontal bars (rankings, long category labels). */
  horizontal?: boolean
  /** Bars + series: stack the series instead of grouping them. */
  stacked?: boolean
  /** Explicit categorical palette (hex) — overrides the host theme colours. */
  palette?: string[]
  /** Field id of an input/select: its value filters the categories locally. */
  filter?: string
}

export interface GenuiTab {
  label: string
  items: GenuiNode[]
}

export interface GenuiTabs {
  type: 'tabs'
  tabs: GenuiTab[]
}

/* ---------------- v1.1 additions: plot / callout / steps / keyvalue / 收编 ---------------- */

export interface GenuiPlotSeries {
  /** Math expression in x (safe evaluator: sin/cos/tan/pow/sqrt/log/exp/abs/floor/ceil/round/min/max/pi/e). */
  expr: string
  /** Legend label; defaults to the expression. */
  label?: string
  /** Stroke color. */
  color?: string
  /** v2.9 draw shape: line (default), area (fill to the baseline), scatter
   * (dots only). */
  kind?: 'line' | 'area' | 'scatter'
  /** v2: adjustable parameters (e.g. {a: 2} in "a*sin(x)") — one slider each, live re-render. */
  params?: Array<{
    name: string
    value: number
    min?: number
    max?: number
    step?: number
    /** v1.5: animate this parameter (auto-play) from `value` to `animateTo`. */
    animateTo?: number
    /** Animation duration in ms (default 4000). */
    durationMs?: number
    /** Loop the animation (default false). */
    loop?: boolean
  }>
}

export interface GenuiPlot {
  type: 'plot'
  /** Functions to draw, in draw order. */
  series: GenuiPlotSeries[]
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
  title?: string
}

export interface GenuiCallout {
  type: 'callout'
  tone?: 'info' | 'success' | 'warning' | 'error'
  /** Short heading above the body. */
  title?: string
  content: string
}

export interface GenuiStep {
  title: string
  desc?: string
}

export interface GenuiSteps {
  type: 'steps'
  /** Completed steps are rendered in the accent color, the rest muted. */
  current?: number
  steps: GenuiStep[]
}

export interface GenuiKeyValue {
  type: 'keyvalue'
  pairs: Array<{ key: string; value: string }>
}

/** 收编 dsh DiffBlock: file mutations as an inline diff. */
export interface GenuiDiff {
  type: 'diff'
  diffs: Array<{
    path: string
    oldText: string | null
    newText: string
  }>
}

/** 收编 dsh JsonTree: a structured JSON value for inspection. */
export interface GenuiJson {
  type: 'json'
  /** Any JSON value to render as a tree. */
  value: unknown
}

/** 收编 dsh CodeBlock: syntax-highlighted code with an explicit language. */
export interface GenuiCode {
  type: 'code'
  lang?: string
  code: string
}

/* ---------------- v1.2: richer interactivity ---------------- */

export interface GenuiRadio {
  type: 'radio'
  label?: string
  options: string[]
  /** Default-selected option index. */
  selected?: number
  /** v2: when set, interaction sends this action back to the model. */
  action?: string
  /**
   * v2.5: aggregation group name. When set, the selection is recorded into
   * the block-wide answers registry instead of firing a per-click action — a
   * sibling `submit` node then collects ALL groups ("交卷" pattern). Without
   * `group`, the legacy per-click behavior applies.
   */
  group?: string
  /**
   * v2.6: correct option for LOCAL grading — the option index (number) or
   * its label (string). When the group's radio carries this, the `submit`
   * button grades IN PLACE on click (score + per-question right/wrong +
   * explanations, zero model round trip).
   */
  answer?: number | string
  /** v2.6: per-question explanation shown after local grading. */
  explanation?: string
}

/** 提交节点收集当前 block 的答案和字段值；纯 radio 范围可在本地判卷。 */
export interface GenuiSubmit {
  type: 'submit'
  label: string
  /**
   * 可选 action 名称。纯 radio 范围满足本地判卷条件时无需 action；其他提交
   * 通过 action 发送 `answers`、可选的 `fields`、`total` 和 `answered`。
   */
  action?: string
  /**
   * v2.6: optional action fired when the user clicks "重新作答" after a
   * local grading (e.g. to tell the model the paper was redone). Absent =
   * reset stays fully local.
   */
  resetAction?: string
  /**
   * `groups` 引用当前 block 中的 submission member key，来源为 radio.group、
   * checkbox.group 以及 input/textarea/select/slider.id。radio 需已选择，
   * checkbox 需至少选择一项，普通 field 需在 trim 后非空。`groups` 控制提交
   * 所需成员与完成进度；payload 仍收集当前 block 中已填写的表单状态。
   * 未设置时，只要存在至少一个已完成成员即可提交。
   */
  groups?: string[]
}

export interface GenuiSwitch {
  type: 'switch'
  label: string
  checked?: boolean
  /** v2: when set, interaction sends this action back to the model. */
  action?: string
}

/**
 * Slider: a range input for numeric form values (v2.9). The current value
 * shows next to the track; dragging fires the action (debounced by the
 * block) and, with an `id`, persists across refresh and joins the sibling
 * submit's `fields` collection (the value is the numeric string).
 */
export interface GenuiSlider {
  type: 'slider'
  label?: string
  min?: number
  max?: number
  step?: number
  /** Default value; defaults to `min` (or 0). */
  value?: number
  /** v2: when set, interaction sends this action back to the model. */
  action?: string
  /** v2.9: stable field id — durable value + submit collection. */
  id?: string
}

export interface GenuiTextarea {
  type: 'textarea'
  label?: string
  placeholder?: string
  rows?: number
  value?: string
  /** v2.5: when set, blurring the field sends this action with the value. */
  action?: string
  /**
   * v2.7: stable field id — the value is persisted across refresh/re-render
   * and collected by a sibling `submit` node (`fields: {id: value}`).
   */
  id?: string
}

export interface GenuiAccordionItem {
  title: string
  items: GenuiNode[]
}

export interface GenuiAccordion {
  type: 'accordion'
  items: GenuiAccordionItem[]
}

export interface GenuiCopy {
  type: 'copy'
  label?: string
  text: string
}

/* ---------------- v1.3: advanced ---------------- */

export interface GenuiSvg {
  type: 'svg'
  /** Standalone SVG document, displayed in an isolated image context. */
  code: string
  title?: string
  height?: number
}

/** Mermaid diagram: flowchart/sequence/class/gantt source rendered lazily. */
export interface GenuiMermaid {
  type: 'mermaid'
  /** Mermaid diagram source (whitelisted diagram kinds at render time). */
  code: string
}

/** One mesh in a 3D scene. */
export interface GenuiMesh {
  /** Primitive geometry, white-listed. */
  shape: 'box' | 'sphere' | 'cone' | 'cylinder' | 'torus'
  /** Mesh color. */
  color?: string
  /** [x, y, z] position. */
  position?: [number, number, number]
  /** [x, y, z] rotation in radians. */
  rotation?: [number, number, number]
  /** Uniform scale, or [sx, sy, sz]. */
  scale?: number | [number, number, number]
  /** Box size [w, h, d] or sphere/cone/cylinder radius. */
  size?: number | [number, number, number]
}

/** 3D scene rendered with three.js (lazily imported). */
export interface GenuiScene3D {
  type: 'scene3d'
  title?: string
  meshes: GenuiMesh[]
  /** Ambient light intensity (0..2). */
  ambient?: number
  /** Background color; default transparent. */
  background?: string
}

/* ---------------- v1.4: more content structure ---------------- */
export interface GenuiTimelineItem {
  /** Title of the event. */
  title: string
  /** Secondary description. */
  desc?: string
  /** Optional timestamp label. */
  time?: string
}

export interface GenuiTimeline {
  type: 'timeline'
  items: GenuiTimelineItem[]
}

export interface GenuiFileTreeNode {
  /** File or directory name. */
  name: string
  /** Directory when true (collapsible children). */
  type?: 'file' | 'dir'
  /** Child nodes (dirs only). */
  children?: GenuiFileTreeNode[]
}

export interface GenuiFileTree {
  type: 'file-tree'
  items: GenuiFileTreeNode[]
}

export interface GenuiBreadcrumb {
  type: 'breadcrumb'
  items: string[]
}

/* ---------------- v1.5: teaching ---------------- */

export interface GenuiQuizOption {
  label: string
  /** True when this option is the correct answer. */
  correct?: boolean
  /** Per-option feedback shown after selection. */
  feedback?: string
}

export interface GenuiQuiz {
  type: 'quiz'
  /** The question text. */
  question: string
  /** Answer options; exactly one should be correct. */
  options: GenuiQuizOption[]
  /** Shown after answering (either way). */
  explanation?: string
  /** Reset the quiz when this value changes (e.g. a question id). */
  id?: string
  /** v2.5: when set, answering sends this action with the chosen answer
   * (`{type:'quiz', question, answer, correct}`) so the model can collect
   * or grade it. */
  action?: string
}

/* ---------------- v2.10: editorial diagram (diagram-design port) ---------------- */

/** Editorial diagram kinds, ported from cathrynlavery/diagram-design (27 types). */
export const DIAGRAM_KINDS = [
  'architecture', 'it-state', 'flowchart', 'sequence', 'state', 'er', 'timeline',
  'swimlane', 'quadrant', 'radar', 'loop', 'nested', 'tree', 'org-chart', 'layers',
  'venn', 'pyramid', 'bar', 'line', 'gantt', 'scatter', 'high-level', 'process',
  'medallion', 'data-flow', 'dp-integration', 'dp-security-matrix',
] as const
export type GenuiDiagramKind = typeof DIAGRAM_KINDS[number]

/** Diagram surface variant: light / dark follow the host theme; editorial is the full skin. */
export type GenuiDiagramVariant = 'light' | 'dark' | 'editorial'

/** Node treatment classes (map to the diagram-design semantic fills/strokes). */
export type GenuiDiagramNodeType =
  | 'focal' | 'backend' | 'store' | 'external' | 'input' | 'optional' | 'security'

/** One positioned node in a coordinate-mode diagram. */
export interface GenuiDiagramNode {
  /** Stable node id referenced by edges. */
  id: string
  /** Human-readable label (Geist sans in the renderer). */
  label: string
  /** Optional technical sublabel (Geist mono in the renderer). */
  sub?: string
  /** Semantic treatment; `focal` is budgeted (max 2 per diagram). */
  type?: GenuiDiagramNodeType
  /** Position / size (coordinate-mode kinds only). 4px grid is enforced at render. */
  x?: number
  y?: number
  w?: number
  h?: number
  /** Optional rectangular type tag (e.g. `API`). */
  tag?: string
}

/** One connector between two nodes. */
export interface GenuiDiagramEdge {
  /** Source node id. */
  from: string
  /** Target node id. */
  to: string
  /** Optional edge label (all-caps, <=14 chars in the renderer). */
  label?: string
  /** Stroke semantics: solid (default), dashed (optional/async), accent, link (HTTP/API). */
  kind?: 'solid' | 'dashed' | 'accent' | 'link'
  /** Route hint; `auto` (default) lets the renderer choose orthogonal routing. */
  route?: 'auto' | 'orthogonal' | 'straight'
}

/** Optional brand override; every key maps to a diagram-design semantic token. */
export interface GenuiDiagramTheme {
  paper?: string
  'paper-2'?: string
  ink?: string
  muted?: string
  soft?: string
  rule?: string
  accent?: string
  'accent-tint'?: string
  link?: string
}

/** Zone container: a labelled region grouping related nodes (max 3). */
export interface GenuiDiagramZone {
  /** Zone label (mono uppercase eyebrow in the renderer). */
  label: string
  /** Bounding box in the same canvas space as the nodes. */
  x?: number
  y?: number
  w?: number
  h?: number
}

/**
 * Editorial diagram (diagram-design port): a white-listed declarative diagram
 * rendered as inline SVG by the browser. `kind` selects the layout grammar
 * (coordinate kinds place nodes via x/y; rule kinds auto-layout from data),
 * `variant` selects the skin, and `theme` overrides semantic tokens. The
 * renderer enforces the editorial constraints — orthogonal connectors, 4px
 * grid, complexity budget, focal accent budget — so the model cannot emit
 * "AI slop" schematics.
 */
export interface GenuiDiagram {
  type: 'diagram'
  /** The 27-type editorial vocabulary. */
  kind: GenuiDiagramKind
  /** Surface skin; default follows the host theme. */
  variant?: GenuiDiagramVariant
  /** Optional diagram title (Instrument Serif in the renderer). */
  title?: string
  /** Nodes (coordinate kinds use x/y/w/h; rule kinds may omit positions). */
  nodes: GenuiDiagramNode[]
  /** Connectors. */
  edges?: GenuiDiagramEdge[]
  /** Optional labelled regions grouping nodes (max 3). */
  zones?: GenuiDiagramZone[]
  /** Optional semantic-token overrides. */
  theme?: GenuiDiagramTheme
}

/* ---------------- v1.6: ECharts ---------------- */

/** Preset chart kinds the `echart` node can build from `data`/`series` without
 * a full ECharts option. Each maps to a themed option template. */
export type EChartPreset =
  | 'bar' | 'line' | 'area' | 'pie' | 'scatter'
  | 'radar' | 'gauge' | 'funnel' | 'treemap' | 'sankey' | 'graph' | 'heatmap' | 'bigline' | 'wordCloud'

/** ECharts node: renders a full ECharts chart. Two modes:
 *
 * 1. **Full option** (`option` set): the model provides a standard ECharts
 *    `EChartsCoreOption` object directly. This is the escape hatch for
 *    custom chart types, complex series, or advanced features (dataZoom,
 *    visualMap, etc.).
 * 2. **Preset shorthand** (`preset` + `data`/`series`): the model provides
 *    the same simple `data`/`series` shape as the `chart` node, and the
 *    component builds a themed ECharts option automatically. This is the
 *    easy upgrade path: change `type: 'chart'` to `type: 'echart'` and add
 *    `preset`.
 *
 * The echarts engine is lazy-loaded (lib/assets/echarts.js) only when an
 * `echart` node appears in a spec. */
export interface GenuiEChart {
  type: 'echart'
  /** Optional title shown above the chart. */
  title?: string
  /** Chart height in pixels (default 300). */
  height?: number
  /** Preset: builds the ECharts option from `data`/`series` when `option`
   * is absent. */
  preset?: EChartPreset
  /** Simple data for preset mode (same shape as `chart.data`). */
  data?: GenuiChartDatum[]
  /** Multi-series for preset mode (same shape as `chart.series`). */
  series?: Array<{ label: string; color?: string; data: GenuiChartDatum[] }>
  /** Node/edge data for the `sankey` and `graph` presets. */
  links?: Array<{ from: string; to: string; value?: number }>
  /** Explicit categorical palette (hex) for preset mode. */
  palette?: string[]
  /** Full ECharts option object. When present, `preset`/`data`/`series` are
   * ignored. This is a pass-through to `echarts.setOption`. */
  option?: Record<string, unknown>
}

/** Parse the raw fence body as a GenuiSpec, or null when it is not one. */
export function parseGenuiSpec(raw: string): GenuiSpec | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (isGenuiSpec(value)) return value
  // Single-component roots are part of the documented fence vocabulary
  // (e.g. {"type":"callout","tone":"info","title":"…","content":"…"} as the
  // whole body) — wrap them into a one-item spec so the items-gated pipeline
  // renders them. panel/append hoist onto the wrapper so panel routing keeps
  // working.
  return wrapSingleComponentRoot(value)
}

/**
 * Is `value` a bare component root rather than an envelope spec?
 *
 * A root object carrying a `type` is the documented single-component
 * shorthand. `items` alone cannot decide the root shape: for container
 * components it holds children (row/col/grid/card/accordion) and for data
 * components it holds records (steps/list/timeline/file-tree/breadcrumb), so
 * both readings are components. A whitelisted `type` therefore wins over the
 * envelope reading — `{"type":"steps","items":[{"title":"…"}]}` is a bare
 * steps node, never a spec whose `items` are the step records (issue #172).
 * A non-native `type` keeps the envelope reading, so a stray `type` field
 * (`{"type":"genui","items":[…]}`) cannot swallow a real spec root.
 */
export function isComponentRoot(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { type?: unknown; items?: unknown }
  if (typeof v.type !== 'string' || v.type === '') return false
  if (!Array.isArray(v.items)) return true
  return GENUI_NATIVE_TYPES.has(v.type)
}

/**
 * Wrap a bare component object into a one-item spec. Returns null when
 * `value` is not component-shaped (no usable `type`). Root-level spec fields
 * found on the component are hoisted onto the wrapper: `panel`/`append` (so
 * panel routing keeps working) and `title` when the component has no title of
 * its own (`{"type":"steps","title":"…"}` means a titled block, not a steps
 * field the schema would drop).
 *
 * The wrapper is a plain spec rather than a `col` node: a spec root is
 * already rendered as a column by GenuiBlock, and leaving the wrapper free of
 * a component `type` is what stops the guard from reading it as one more bare
 * component root and nesting every fence inside a second column (issue #172).
 */
export function wrapSingleComponentRoot(value: unknown): GenuiSpec | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { type?: unknown; title?: unknown; panel?: unknown; append?: unknown }
  if (typeof v.type !== 'string' || v.type === '') return null
  const definition = GENUI_NATIVE_TYPES.has(v.type) ? COMPONENT_SCHEMAS[v.type] : undefined
  const title = typeof v.title === 'string' && definition !== undefined && !('title' in definition.fields)
    ? v.title
    : undefined
  const node: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  // The hoisted title moves to the wrapper, so the component must not keep a
  // copy the schema would flag as an unknown field.
  if (title !== undefined) delete node.title
  return {
    items: [node as unknown as GenuiNode],
    ...(title !== undefined ? { title } : {}),
    ...(v.panel === true ? { panel: true } : {}),
    ...(v.append === true ? { append: true } : {}),
  }
}

/**
 * Basic structural guard: is this object a valid GenuiSpec?
 *
 * A bare component root is not a spec (it is wrapped instead), so
 * `{"type":"steps","items":[…]}` answers false and `parseGenuiSpec` routes it
 * through `wrapSingleComponentRoot` (issue #172).
 */
export function isGenuiSpec(value: unknown): value is GenuiSpec {
  if (typeof value !== 'object' || value === null) return false
  if (isComponentRoot(value)) return false
  const v = value as { items?: unknown; title?: unknown; gap?: unknown }
  if (!Array.isArray(v.items)) return false
  if (v.title !== undefined && typeof v.title !== 'string') return false
  if (v.gap !== undefined && typeof v.gap !== 'number') return false
  return true
}
