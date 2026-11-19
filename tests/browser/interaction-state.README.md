# Native interaction state regression

Run `BROWSER_BIN=chromium node scripts/check-interaction-state-browser.mjs` with
Node 22+ and Chromium (CI sets `BROWSER_BIN=google-chrome`). The runner uses the
real renderer, a local Vite server, and Chrome DevTools Protocol; it closes both
processes and removes its temporary browser profile when finished.

The test checks:

- Hovering a Popover while editing an input preserves focus and emits no action.
- Clicking a Popover transfers focus; Escape and the close button dismiss it.
- Changing `enableWhen` to false removes the open portal.
- Editor and Date Picker default values display and submit for `constructor`,
  `toString`, and `__proto__` field IDs.
- Year-zero dates stay blank and cannot be submitted.
- Expanding a date bound submits the valid date currently visible in the input.

The script uses real pointer events for Popover clicks: programmatic `.click()`
can exercise different focus-visible behavior. Date value changes dispatch native
input events; native input sanitization is still exercised. Unit tests cover date
ranges, schema rejection, hidden/restored values, and streaming replacements.

Evidence is retained under `.e2e-artifacts/interaction-state/` (override with
`GENUI_BROWSER_OUT`). This fixture checks behavior with standalone tokens; it
is not native Windows or complete DSH host acceptance.
