# Explicit BetterSidebar sidechat surfaces

This integration addresses [#354](https://github.com/omdsh-dev/dsh-genui/issues/354). BetterSidebar owns the original Markdown, durable transcript identity and child-thread prompt route. GenUI owns fence recognition and rendering through its existing spec resolver and block renderer. It is a narrow addition to the existing `ctx.betterSidebar` service, not a general rendering protocol or a runtime import of `/embed`.

## Optional contract

GenUI registers `{ id: 'dsh-genui', mount(surface) }` using `registerSidechatSurfaceAdapter`, when available. Registration and each mounted surface return cleanup functions. A surface supplies:

- `root`: the real Markdown `HTMLElement`, marked `data-genui-surface="dsh-better-sidebar/sidechat"`.
- `source`: exactly `dsh-better-sidebar/sidechat`.
- `threadId`: the owning child thread, never the parent UI session.
- `eventSeq` and `contentBlockIndex`: safe nonnegative integers from the durable assistant message and its original content array. Empty/non-text blocks must not renumber later text blocks.
- `text`: the original Markdown, before presentation-only link rewriting.
- `sendPrompt(text)`: the owning view's live child-thread callback. It reports errors in that view and rejects stale/hidden/unmounted bindings.

BetterSidebar opts in only visible, settled assistant text rows. It keeps the root marker while streaming or while no adapter is registered, so GenUI's main-chat observer never takes over those rows. No main-conversation `data-chat-*` attributes are fabricated. GenUI uses optional Cordis injection, so either plugin can be installed alone or loaded first.

## Rendering and lifecycle

All Markdown AST code nodes are paired with all original host code-block surfaces by ordinal, followed by a body equality check. Only explicitly labelled `dsh-ui` inline specs are claimed. Duplicate content is not used as identity. Missing identity, incomplete DOM shape, a body mismatch, invalid specs, `panel:true`, SVG and unlabelled code retain the original Markdown. Streaming stays Markdown until its durable message arrives; temporary stream sequence numbers never become storage keys.

Rendering uses the existing GenUI resolver, block renderer, export wrapper, action context and bounded interaction store. The source/thread/event/text-block/fence tuple is encoded without delimiter ambiguity; content changes use the existing content fingerprint. State is flushed under its captured key before a root is replaced, hidden or disposed. Password fields follow the existing non-persistence rule. Actions are invalidated before deferred React teardown and cannot fall back to a main-session lookup.

The observer is limited to the supplied root, ignores its own output and adds no polling. Removing the adapter or surface restores the original code blocks. A stale disposer cannot remove a newer service registration.

## Required release validation

- Both normal package builds and pack lifecycles, plus type checks and focused/full regression suites.
- Real DSH `0.2.1-rc.3` in a fresh keyless profile with both actual plugin packages, not a standalone gallery or callback spy.
- Identical forms in the main conversation and two side threads: isolated state, multiple original text blocks and mixed/repeated fences, rapid hide/reopen and DOM replacement.
- Real control actions reach the owning child's prompt route and events/inbox, while the main conversation and other child remain unchanged. Synthetic replay/provider data must be labelled as such.
- Existing mount invariants, plugin removal/late arrival, no page errors, and original Markdown fallback.

Component/jsdom tests do not establish the real-host gate. Released BetterSidebar 0.28.0 has no surface capability; the coordinated provider change is required.
