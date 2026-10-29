import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      { find: /^react$/, replacement: resolve(__dirname, 'node_modules/react/index.js') },
      { find: /^react\/jsx-runtime$/, replacement: resolve(__dirname, 'node_modules/react/jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js') },
      { find: /^react-dom$/, replacement: resolve(__dirname, 'node_modules/react-dom/index.js') },
      { find: /^react-dom\/client$/, replacement: resolve(__dirname, 'node_modules/react-dom/client.js') },
    ],
  },
  test: {
    environment: 'jsdom',
    // Measured on an M-series laptop under full-suite parallelism: heavy DOM
    // tests (fence bursts, the gallery render, the map type-check) take 5–11s
    // there while finishing in ~1s alone. The 5s default made local runs fail
    // where CI passes, which quietly devalues local verification. Individual
    // hangs are still caught — just 15s later.
    testTimeout: 20_000,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.spec.{ts,tsx}'],
    server: {
      deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives'] },
    },
  },
})
