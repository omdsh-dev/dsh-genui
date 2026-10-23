# Carousel and image groups

These native GenUI nodes support the first slice of [#358](https://github.com/omdsh-dev/dsh-genui/issues/358): browse alternatives, inspect images, and make an explicit choice without turning every navigation gesture into a model request. They use the existing renderer, theme tokens, URL restrictions, and action channel. There is no new model/API dependency or external component library.

## Browse, inspect, then choose

The following example uses this repository's MIT-licensed icon and logo at a fixed commit. The two images need network access; no customer data is involved.

```dsh-ui
{"title":"Compare two layouts","items":[{"type":"carousel","title":"Layout choices","itemWidth":280,"items":[{"type":"card","title":"Compact","items":[{"type":"text","content":"Keep the summary visible."},{"type":"button","label":"Choose compact","action":"choose-compact"}]},{"type":"card","title":"Detailed","items":[{"type":"text","content":"Show supporting details."},{"type":"button","label":"Choose detailed","action":"choose-detailed"}]}]},{"type":"image-group","title":"Project artwork","items":[{"src":"https://raw.githubusercontent.com/omdsh-dev/dsh-genui/7301d8a8ec6d5a164beff75e5a8afd20e45f9518/assets/genui-icon.svg","alt":"GenUI icon","caption":"Square artwork"},{"src":"https://raw.githubusercontent.com/omdsh-dev/dsh-genui/7301d8a8ec6d5a164beff75e5a8afd20e45f9518/assets/genui-logo.svg","alt":"GenUI logo","caption":"Wide artwork"}]}]}
```

1. Scroll the cards or use the previous/next controls. When the track itself has focus, ArrowLeft/ArrowRight and Home/End navigate it. Keyboard events inside a form field are not intercepted.
2. Click an image. The native modal dialog starts with its close button focused. Previous/next, ArrowLeft/ArrowRight, and Home/End navigate images; Escape or Close returns focus to the opener.
3. Only an explicit card action such as `choose-compact` sends an action. Image navigation and carousel scrolling remain local. Existing input/submit collection works inside carousel cards.

For authored responses, prefer a small set of 3–8 visually consistent cards, short metadata, and one clear primary action per item, as recommended by the [OpenAI UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines#inline-carousel). The 24-item runtime cap is a defensive ceiling, not a recommendation to fill every response.

## Shape and limits

- `carousel`: `items` contains native GenUI nodes; optional `title`, `itemWidth` (80–640 pixels, default 240, capped at 85% of the track), and `gap` (a non-negative scale multiplied by 4 pixels; omitted means 12 pixels). Navigation buttons move 85% of the visible track and appear only when scrolling is possible. Touch devices use the scroll track directly. At most 24 slides render; nested nodes still consume the existing depth and total-node budgets. There is no autoplay.
- `image-group`: `items` contains `{src, alt?, caption?}` records, not arbitrary GenUI nodes; optional `title`. At most 24 images survive repair. Images wrap using their loaded aspect ratios and remain uncropped in the viewer. Supply meaningful `alt` text.
- Media uses the same HTTP(S) or relative URL policy as `image`. `file:`, `data:`, `javascript:` and protocol-relative URLs are not accepted. Captions use the existing safe inline renderer; caption links are not nested inside the thumbnail's button.
- Empty collections display an empty state. Failed images display an error placeholder rather than starting a model request.

## Streaming and state

Append carousel children at the end to preserve existing structural paths and field identity; reordering form cards is not a supported identity-preserving operation. Do not reuse field IDs between cards. Scroll position is local to the mounted carousel, not persisted in an exported artifact.

The image viewer identifies an entry by its source and occurrence number. Appending or reordering distinct sources preserves the current image. Removing it closes the viewer; if the opener was removed, focus returns to the group. Reordering indistinguishable duplicate URLs cannot express an identity beyond their occurrence order. Modal selection is local UI state, not a durable saved answer.

Standalone export retains galleries and reports image URLs as external media. It does not embed image bytes or make relative/remote URLs available offline. Nested model actions keep the normal standalone limitations. No OpenUI component source is copied; this is an independent implementation against the GenUI contract.

## Verification

Run `pnpm check` for the repository's type, test, build, and standalone checks. Focused tests cover schema/repair and resource accounting, streaming identity, nested submissions, action isolation, URL restrictions, image failures, keyboard handling, and focus restoration.

Real-browser acceptance must additionally verify narrow and wide chat panes, light/dark themes, pointer/touch scrolling and snap, actual image dimensions, native modal focus/inert background behavior, and the full browse → enlarge → switch → close → choose sequence. DOM simulation does not establish layout, touch behavior, native modal inerting, or host acceptance. The canonical component anthology includes both new nodes; its public assets still require network access.
