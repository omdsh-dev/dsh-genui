/**
 * ECharts asset-bundle entry: registers the echarts engine on
 * `window.__GenuiAssets__.echarts`. Built as a standalone IIFE into
 * `lib/assets/echarts.js` and served by the plugin's node-half route; loaded
 * on demand by echarts-lazy when a spec contains an `echart` node.
 * @module @omdsh-dev/dsh-genui/client/asset-echarts
 */
import { type EChartsType, type EChartsCoreOption } from 'echarts';
/** The engine surface registered by the echarts asset bundle. */
export interface EChartsAssetApi {
    /** Create an ECharts instance on `el`, apply `option`, return the instance. */
    createChart: (el: HTMLElement, option: EChartsCoreOption, opts?: {
        height?: number;
    }) => EChartsType;
}
