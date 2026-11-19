# Step marker browser regression (#410)

Run `BROWSER_BIN=chromium node scripts/check-steps-marker-browser.mjs` with the
locked dependencies installed. Like the existing blocks-theme check, this uses
installed Chromium over loopback CDP and Vite, without an extra browser package,
model, credentials, or host service. CI runs the export palette checks.

The real `GenuiBlock` renders the issue's four completed steps and a numbered
sequence (`current: 0`, including the active and pending states). It covers host
content font tokens of 14, 17 and 20px, inherited body line heights of 1.45 and
2.1, 390px and 1100px viewports, and light/dark themes. Wrapped CJK titles and
descriptions must remain clear of the marker and within the viewport.
The long title includes Latin text so narrow-view wrapping is still exercised
on CI images with different CJK font availability; the wrapping assertion stays
required. This does not certify glyph coverage for missing system fonts.

The rule is that each 24px marker has its own one-em line box: changing body
leading must not move its text. Browser Range geometry checks containment in
the marker and approximate centering, independently of computed line height.
A Range contains font ascent/descent, not raster ink; these are not pixel-scan
measurements of the reporter's checkmark. Title and description leading retain
their existing 1.45 and 1.55 ratios. Screenshots wait for fonts and finite
animations; `*-20px.png` captures the enlarged/high-leading workflow, and the
other PNG captures the full page. JSON retains the measured geometry.

Set `GENUI_HOST_THEME_CSS` to a real host base **and** design token stylesheet
to additionally check the embedded palette and host font stack. For DSH
`0.2.1-rc.5`, extract `base_css_default` and `design_platform_css_default` from
the official `@deepseek-ai/dsh-client-ui-theme` npm tarball's `lib/client.js`
as JSON strings; do not execute the bundle. Their SHA-256 hashes are:

- base: `77d5487e7f9cf7597d8b15f1b598598658d970f0cdb4a513c9a93c2f450aa77e`
- design: `f04a03df7d266e4859959ceddcff12c5a58ff9c9972e80c8b10d2184376a833e`

For before/after evidence, keep the fixture, host sheet and browser fixed:

```sh
git show e00bdcfbf7d4492afc95d5e52af350d6b68882c6:src/client/GenuiBlock.module.css > /tmp/steps-before.css
GENUI_HOST_THEME_CSS=/path/to/host-rc5.css GENUI_STEPS_CSS=/tmp/steps-before.css GENUI_BROWSER_OUT=.e2e-artifacts/steps-before node scripts/check-steps-marker-browser.mjs
GENUI_HOST_THEME_CSS=/path/to/host-rc5.css GENUI_BROWSER_OUT=.e2e-artifacts/steps-after node scripts/check-steps-marker-browser.mjs
```

The baseline must fail the new leading/geometry checks while retaining its
screenshots and JSON. CSS substitution happens before the same Vite CSS Modules
transform. This is Linux Chromium embedded verification with official host
tokens, not a live DSH session or native Windows 11/Edge acceptance. `export`
cases use the standalone fallback palette and font stack through the same real
renderer; packed runtime contents are checked separately by the build gates.
