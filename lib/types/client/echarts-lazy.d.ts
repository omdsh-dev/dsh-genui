/** The ECharts instance surface (the subset the component uses). */
export interface EChartsInstance {
    setOption: (opt: unknown, notMerge?: boolean) => void;
    resize: () => void;
    dispose: () => void;
}
/**
 * Create an ECharts instance on `el` with the given option (engine loaded on
 * demand). The caller owns the returned instance and must dispose it.
 * @param el - the DOM node to host the chart canvas.
 * @param option - the ECharts option object.
 * @param opts - optional height override.
 * @returns the ECharts instance (setOption/resize/dispose).
 */
export declare function createChart(el: HTMLElement, option: unknown, opts?: {
    height?: number;
}): Promise<EChartsInstance>;
