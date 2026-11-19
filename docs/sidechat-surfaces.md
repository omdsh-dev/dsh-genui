# Sidechat surface adapter

GenUI renders settled `dsh-ui` fences from a provider-declared sidechat surface. Each provider owns the original Markdown, durable message identity and child-thread prompt route. GenUI owns fence recognition and rendering through its existing resolver and block renderer. This explicit boundary keeps sidechat DOM outside the main-conversation renderer.

## Optional Cordis service

Providers expose the optional `genuiSidechat` service with `registerSidechatSurfaceAdapter(adapter)`. GenUI also registers with the existing `betterSidebar` service for BetterSidebar installations. The service method receives `{ id: 'dsh-genui', mount(surface) }`; registration and each mounted surface return cleanup functions. The public `SidechatSurface` and `SidechatSurfaceService` types are exported from `@changfenhuang/dsh-genui/client`.

A provider surface supplies:

- `root`: the real Markdown `HTMLElement`, marked `data-genui-surface` with the same value as `source`.
- `source`: a stable, provider-owned namespace such as `dsh-better-sidebar/sidechat` or `dsh-native/sidechat`.
- `threadId`: the owning child thread, never the parent UI session.
- `eventSeq` and `contentBlockIndex`: safe nonnegative integers from the durable assistant message and its original content array. Empty and non-text blocks must not renumber later text blocks.
- `text`: the original Markdown, before presentation-only rewriting.
- `sendPrompt(text)`: the owning view's live child-thread callback. It reports errors in that view and rejects stale or unmounted bindings.

Providers opt in only visible, settled assistant text rows. They keep the root marker while streaming or while no adapter is registered, so GenUI's main-chat observer never takes over those rows. Providers do not fabricate main-conversation `data-chat-*` attributes. Optional Cordis injection lets GenUI and the provider load in either order or run independently.

The provider enables rendering for each surface by registering its adapter and supplying the required identity and route. This keeps admission at the surface boundary without changing the main DOM scan rules. Changing or removing the root's `data-genui-surface` marker closes its actions and restores the original Markdown. A separate GenUI marker keeps the main DOM renderer from taking over while the sidechat root remains in the document.

## Rendering and lifecycle

GenUI pairs all Markdown AST code nodes with all original host code-block surfaces by ordinal, then checks body equality. It claims only explicitly labelled `dsh-ui` inline specs. Duplicate content is not used as identity. Missing identity, incomplete DOM shape, body mismatch, invalid specs, `panel:true`, SVG and unlabelled code retain the original Markdown. Streaming remains Markdown until the durable message arrives; temporary stream sequence numbers never become storage keys.

Rendering uses the existing GenUI resolver, block renderer, export wrapper, action context and bounded interaction store. The source/thread/event/text-block/fence tuple forms the state identity. State is flushed under its captured key before a root is replaced or disposed. Password fields follow the existing non-persistence rule. Actions are invalidated before deferred React teardown and never use a main-session route.

The observer is limited to the supplied root, ignores its own output and adds no polling. A root can have one active GenUI mount; overlapping mount attempts are ignored, and a stale disposer cannot remove a newer mount's exclusion marker. Removing the adapter or surface restores the original code blocks while the sidechat exclusion boundary remains in place.

The DSH native Side Chat provider must expose `genuiSidechat` to enable this integration. A GenUI provider-neutral adapter contract does not by itself add that service to a separate DSH provider package.

## Required release validation

- Both normal package builds and pack lifecycles, plus type checks and focused/full regression suites.
- Real DSH `0.2.1-rc.3` in a fresh keyless profile with both actual plugin packages, not a standalone gallery or callback spy.
- Identical forms in the main conversation and two side threads: isolated state, multiple original text blocks and mixed/repeated fences, rapid hide/reopen and DOM replacement.
- Real control actions reach the owning child's prompt route and events/inbox, while the main conversation and other child remain unchanged. Synthetic replay/provider data must be labelled as such.
- Existing mount invariants, plugin removal/late arrival, no page errors, and original Markdown fallback.

Component/jsdom tests do not establish the real-host gate. Released BetterSidebar 0.28.0 has no surface capability; the coordinated provider change is required.
