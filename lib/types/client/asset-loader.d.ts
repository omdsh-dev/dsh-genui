/**
 * Asset-bundle loader: fetches one of the plugin's lazy engine bundles
 * (`lib/assets/mermaid.js` / `lib/assets/three.js`) by script injection and
 * hands back the engine surface the bundle registered on
 * `window.__GenuiAssets__`.
 *
 * The bundles are served by the plugin's OWN node-half HTTP route
 * (`/plugins/@omdsh-dev/dsh-genui/assets/*`), registered through the host
 * webserver service — no host source change needed, and the longest-prefix
 * rule lets this route win over the generic `/plugins` bundle route. Each
 * file is loaded at most once per page (promise memoized); a rejection is
 * final for the page (the node's fallback UI takes over).
 *
 * The rev query rides the boot graph: the plugin's own row in
 * `window.__DSH_BOOT__` carries the client bundle rev, so a plugin rebuild
 * busts the asset cache together with the main bundle. Absent graph = no
 * query; the route serves no-cache anyway.
 * @module @omdsh-dev/dsh-genui/client/asset-loader
 */
/** Resolve an asset URL, appending the bundle rev for cache busting when the
 * boot graph exposes it. */
export declare function assetUrl(file: string): string;
/**
 * Load one asset bundle and return the engines it registered. Memoized per
 * file: repeated requests (several mermaid nodes, re-renders) share one
 * script load; a failed load stays failed for the page (the component shows
 * its fallback).
 * @param name - 'mermaid' or 'three'.
 * @returns the registered engine surface.
 */
export declare function loadGenuiAsset<T>(name: 'mermaid' | 'three' | 'echarts'): Promise<T>;
