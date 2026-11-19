# Copy text previews

A `copy` component remains a one-click clipboard chip by default. It does not display its text or add a preview control unless `expandable` is explicitly `true`.

```json
{
  "type": "copy",
  "label": "Copy constraints",
  "text": "Use synthetic fixtures.\nReview changes before sending.",
  "expandable": true,
  "previewLines": 1
}
```

## Optional fields

- `expandable`: a boolean, default `false`. Adds a separate **View text / Hide text** button. Opening the preview does not copy anything; the original copy button still copies the component text.
- `previewLines`: a finite number, default `0`. Shows the first N logical lines while collapsed. The guard truncates fractions toward zero and clamps the result to 0–30. Zero or a negative number leaves the preview fully collapsed. This field has no visible effect unless `expandable` is `true`.

Incorrect field types are validation errors, not implicit opt-ins. Existing text aliases such as `content`, `code`, and `value` remain supported by the normal canonicalization path.

## Content and limits

The preview is plain text, not Markdown or HTML. It preserves whitespace and logical line endings, uses the existing monospace font token, wraps long lines, and scrolls within a maximum height of 240px. The preview contains at most 2,000 Unicode code points. A localized truncation notice appears whenever a visible preview omits text, including when the collapsed line count shortens it.

Preview limits never shorten the clipboard value. Copying still uses the component's guarded `text` field, including all of its available lines. The pre-existing guard limit of 12,000 UTF-16 code units for copy text remains unchanged; this feature does not promise to copy content discarded by that guard.

## Interaction and state

The preview toggle is a native button with `aria-expanded` and a unique `aria-controls` target, so it supports the platform's standard Enter/Space activation. Visible previews are keyboard-focusable for scrolling. Copy success continues to use the separate live status region and is announced only after a successful clipboard write.

Expansion is tracked by structural node path within the reply. It survives ordinary spec updates, the streaming-to-settled transition, and switching away from and back to a tab or accordion section. Separate paths and separate reply identities do not share expansion state. Removing or disabling a preview clears its state. Expansion is not persisted to local storage or restored after a page reload.

All added interface text follows the existing English/Chinese locale selection.

## Verification boundaries

The synthetic regression suite covers canonicalization, schema validation, guards, actual React rendering in jsdom, clipboard calls, reply/container state, and locale changes. CSS limits are also checked as a static contract. These checks do not establish browser-painted geometry, real keyboard default actions, or integration with a live DSH desktop or model response.
