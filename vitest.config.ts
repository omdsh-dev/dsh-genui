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
    // jsdom only exposes `localStorage` for a non-opaque origin. vitest's default URL is
    // environment-dependent, and on Node 26 + jsdom 25 it comes out opaque — every spec that
    // touches storage then dies on `localStorage.clear()` (218 tests locally, 0 on CI's Node 20).
    // Naming the origin makes the suite independent of which Node happens to run it.
    environmentOptions: { jsdom: { url: 'http://localhost:3000' } },
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.spec.{ts,tsx}'],
    server: {
      deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives'] },
    },
  },
})
