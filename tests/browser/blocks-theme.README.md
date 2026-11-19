# Semantic blocks browser regression (#408)

Run `BROWSER_BIN=chromium node scripts/check-blocks-theme-browser.mjs` after
installing the locked dependencies. Node's built-in WebSocket drives an installed
Chromium over loopback CDP; no model, host service, credentials, or extra browser
package is required. Screenshots and computed colors go to
`.e2e-artifacts/blocks-theme/`. Capture waits for fonts and finite animations.

The fixture uses the real `GenuiBlock`, including a synthetic TP/FN/FP/TN matrix,
five semantic tones, fill/outline/plain variants, nested card and panel surfaces,
and explicit row/cell colors. It checks text contrast of at least 4.5:1, distinct
tones, visible dark washes and boundaries, and the preserved light/default
variant and shared focus/data-accent contracts. The 35/255 dark RGB channel-spread
floor is a regression guard for the default palettes, not an accessibility
standard or a guarantee for arbitrary skin colors.

By default this verifies the export fallback palette. To also check an embedded
host palette, set `GENUI_HOST_THEME_CSS` to a real host token stylesheet. For DSH
`0.2.1-rc.3`, the official `@deepseek-ai/dsh-client-ui-theme` npm tarball embeds
that stylesheet in `lib/client.js` as `design_platform_css_default`. Extract the
string as data with `JSON.parse` (do not execute the host bundle). This sheet
includes both light and dark `body` tokens. Its SHA-256 is
`f04a03df7d266e4859959ceddcff12c5a58ff9c9972e80c8b10d2184376a833e`.

For a faithful before/after comparison, keep the fixture and browser fixed:

```sh
git show c40c9ce9d72251668d147e6bf08b05f6b3aab7f0:src/client/GenuiBlock.module.css > /tmp/blocks-before.css
GENUI_HOST_THEME_CSS=/path/to/host-tokens.css GENUI_BLOCKS_CSS=/tmp/blocks-before.css GENUI_BROWSER_OUT=.e2e-artifacts/blocks-theme-before node scripts/check-blocks-theme-browser.mjs
GENUI_HOST_THEME_CSS=/path/to/host-tokens.css GENUI_BROWSER_OUT=.e2e-artifacts/blocks-theme-after node scripts/check-blocks-theme-browser.mjs
```

The old stylesheet is expected to fail the new dark-visibility checks while
still producing screenshots and measurements. `GENUI_BLOCKS_CSS` replaces only
the exact stylesheet input, before the same Vite CSS Modules processing.
This is embedded browser verification with host tokens, not an end-to-end DSH
instance or a native Windows visual test. The separately labeled `export` cases
verify the standalone palette through the real renderer, not the packed HTML
export loader.
