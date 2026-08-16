import type { GenuiChart, GenuiTable } from '../spec.ts';
export declare const CHART_COLORS: string[];
export declare function TableNode({ node }: {
    node: GenuiTable;
}): import("react").JSX.Element;
/** Chart: bars (default), line (trend), or donut (share); multi-series bars via `series`. */
export declare function ChartNode({ chart }: {
    chart: GenuiChart;
}): import("react").JSX.Element;
/** Bars: one column per datum (grouped bars when `series` is present). */
export declare function BarsNode({ chart }: {
    chart: GenuiChart;
}): import("react").JSX.Element;
/** Line: polyline over a fixed-height plot area with a readable Y axis —
 * four evenly spaced gridlines + tick labels (design system v2 skeleton). */
export declare function LineChartNode({ chart }: {
    chart: GenuiChart;
}): import("react").JSX.Element;
/** Donut: share of total with a center total. Negative values contribute
 * zero arc (a negative dasharray segment used to produce an invalid
 * stroke-dasharray and the browser drew the FULL circle instead). */
export declare function DonutNode({ chart }: {
    chart: GenuiChart;
}): import("react").JSX.Element;
/** Tab strip with local active-tab state. Keyboard: ArrowLeft/Right to move,
 * Home/End to jump; ids wired via useId so `aria-controls` stays unique
 * across fences and sessions. */
