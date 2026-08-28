import type { GenuiBlockProps } from './blocks/state.ts';
export declare const GENUI_ACTION_DEBOUNCE_MS = 300;
/**
 * Render a GenUI spec as an inline block. `stateKey` is also the durable
 * component identity: changing it remounts the stateful implementation so
 * state loaded for one block can never leak into or be saved under another
 * key. Identity-less streaming renders deliberately share one stable
 * volatile instance, preserving local interaction state as the spec grows.
 */
export declare const GenuiBlock: import("react").NamedExoticComponent<GenuiBlockProps>;
