/**
 * Bundle source entry (plugin_check tool-bundle contract): the node-half
 * surface the host loader resolves through `package.json#main`.
 *
 * The `import type {}` line is NOT decorative: importing the dsh client
 * runtime's cordis Context augmentation BEFORE re-exporting the plugin keeps
 * TypeScript's global-augmentation ordering deterministic — without it,
 * TS 5.9 mis-resolves `ctx.sessions` in the client half when the plugin
 * module is first reached through this root entry.
 */
import type {} from '@deepseek-ai/dsh-client-runtime/client'
export * from './plugin/index'
