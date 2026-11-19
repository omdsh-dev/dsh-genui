# Map: local location selection and inline routes

`map` is a native GenUI node backed by MapLibre GL JS. It is a location picker,
not a geocoder, directions API, or navigation service. Markers and the always
available keyboard-operable location list share one stable-ID selection. Pan,
zoom, reset, and selection never send model actions. Use a separate `submit` to
send the chosen ID through the existing fields contract.

This interactive map is available in the web renderer, embed and standalone HTML.
The dsh-go native App does not provide the MapLibre canvas or map selector;
its native panel explicitly reports the unsupported map and any required map
submission. See [dsh-go capabilities](dsh-go.md).

```dsh-ui
{"title":"Choose a stop","items":[{"type":"map","id":"stop","title":"Synthetic itinerary","locations":[{"id":"museum","label":"Museum","coordinates":[12.49,41.89],"description":"Illustrative stop A"},{"id":"garden","label":"Garden","coordinates":[12.51,41.90],"description":"Illustrative stop B"}],"routes":[{"id":"walk","label":"Illustrative route, not directions","coordinates":[[12.49,41.89],[12.50,41.895],[12.51,41.90]]}]},{"type":"submit","label":"Use this stop","action":"choose_stop","groups":["stop"]}]}
```

## Contract and limits

- `locations`: required array, including an empty array. Up to 50 locations.
  Each has a unique non-empty `id` (up to 200 characters), `label`, optional
  `description`, and `coordinates: [longitude, latitude]` in WGS84 decimal degrees.
- Longitude must be finite and within [-180, 180], latitude within [-90, 90].
  Invalid coordinates are dropped, never clamped to a different place. Valid
  polar coordinates beyond ±85.051129° latitude remain in the list, with an
  explicit projection notice; their markers and affected routes are not drawn
  or used as camera centers. They are never moved to the Mercator boundary.
- `routes`: optional, up to 8 named `{id, label, coordinates}` records. Each
  holds an inline LineString with 2–500 coordinate pairs. A malformed or oversized
  route is dropped in full, not shortened into a misleading route. These are
  illustrative paths only: no routing, distance, safety, or travel-time claim.
- `id`: optional submission field name. Its value is a location ID, never label
  text or coordinates. `selected` is an optional initial location ID. A valid
  restored user selection takes priority. Removed choices clear the field and
  do not reappear if the location is later reintroduced.
- `center`: optional coordinate pair. `zoom`: 0–20. `height`: 200–640 px (320
  default). Reset returns to this view, or fits locations and routes using the
  shortest longitude interval across the antimeridian. Reset does not clear
  the selection; “Clear selection” is a separate local control.
- Data are updated in place; stable markers preserve focus. The component uses
  native buttons for list and markers, visible focus and pressed state, textual
  coordinates, and a route-coordinate disclosure. Wheel zoom is disabled so the
  map does not steal chat scrolling. Map drag, keyboard, and zoom buttons remain.
- Map `action`, style/source URLs, API tokens, HTML, geolocation and arbitrary
  GeoJSON are not part of the model-facing schema. Unknown fields are diagnosed
  and removed. A sibling submit sends the ordinary payload, for example
  `fields: {"stop":"museum"}`. Merely selecting does not contact the model.

## Offline default and trusted host configuration

The default is a real interactive coordinate map with markers and route lines
on a blank background. It has **no street basemap**, tile/glyph/sprite URLs,
geocoding calls, location permission requests, or external services. Do not
interpret it as an offline street-map database.

A trusted embedding application may wrap GenUI in `GenuiMapContext.Provider`
with `{style: reviewedInlineMapLibreStyle}`. The DSH client entry and embed entry
also export `setGenuiMapConfig(config)` for host integration before rendering;
pass `undefined` to return to the offline default. Prefer a stable, immutable
context value; replacing it recreates the map while preserving selection.
The setter is page-wide; an explicit provider overrides it. The public
`GenuiMapStyle` is a self-contained structural carrier for inline styles,
including extension fields; it does not require the engine package just for
types. Hosts may optionally type their style using MapLibre's full
`StyleSpecification`. MapLibre validates the style at runtime.

Configuration is application code, **not model JSON**. Never derive this object
from a fence. Hosts own provider consent, permissions, attribution, terms, billing
and request policy for every source, glyph or sprite in that style. External
providers can observe IP and viewed regions. Do not put credentials or private
location records into styles. Keep the `__genui_routes` source/layer ID reserved.
MapLibre attribution controls remain enabled for host basemaps.

## Loading, embedding, and standalone HTML

MapLibre 6.16.0 is pinned to the official npm package (BSD-3-Clause). Its ESM
main and self-contained worker replace the older CSP distributions. The
worker bytes are embedded in the existing flat asset, so no separate worker
file or external module import is needed by the offline default.
The ~1.67 MB engine, vendor CSS, and inert worker source live in the independent
`lib/assets/maplibre.js` IIFE, not the eager client/standalone runtime. The engine
is requested only when a map mounts, not by idle prefetch. CSS is injected then;
a Blob worker URL is created at first mount. HTTP(S) retains MapLibre's module
worker path; offline `file://` uses a classic worker as described below. The final unmount calls
`Map.remove()` and revokes the owned URL. The upstream 6.16.0 release includes
[the shared worker lifecycle fix](https://github.com/maplibre/maplibre-gl-js/pull/8491).
The real browser cleanup check still requires worker termination and has to pass
on the upgraded candidate before release. Source inspection, unit tests and
bundle checks do not establish that gate. No private worker-pool mutation or
security-policy relaxation is used to bypass it.

**File-origin compatibility adaptation.** Chromium rejects the Blob module
worker from a `file://` document. Merely marking the URL as `.cjs` makes the
vendor's file-origin branch fetch the Blob, which conflicts with our unchanged
`connect-src 'none'`. The build therefore compiles the official worker into a
single classic-compatible IIFE and applies a narrow local adaptation to the
6.16.0 worker factory: only the exact currently owned Blob URL, in a `file://`
document, is passed directly to the native classic `Worker` constructor. This
is a version-specific packaging adaptation, not a public MapLibre API. All
unowned URLs and non-file origins retain the original factory behavior. Native
Worker CSP/origin checks remain enforced; no global `Worker`, `fetch` or
`location` override is used. The build checks the version and SHA-256 of both
official main and worker distributions and fails closed if either changes;
an upgrade requires a fresh audit. The original browser offline/reload,
zero-network, CSP and worker-cleanup assertions remain the acceptance gate.

Bundler hosts should copy the **built** `@changfenhuang/dsh-genui/assets/maplibre`
IIFE alongside the other assets and call `setGenuiAssetBase` with that directory.
Do not rebuild `asset-maplibre.ts` without the repository's resource plugin:
plain source imports intentionally lack compiled worker/CSS resources and fall
back visibly rather than claiming a map is running.

HTML export embeds the same engine with its CSS and worker bytes. `connect-src
'none'` and all existing CSP directives remain unchanged. Workers inherit that
policy; the already-permitted script Blob source supplies the worker. Host
styles/configuration are **not** serialized: an export uses the offline blank
style, local markers, inline routes, and local selection. Model actions remain
unavailable in standalone, as for other components. JSON exports contain the
map data and non-secret durable field values, so review private locations before
sharing an artifact. Exporting does not authorize public sharing.

If an asset, WebGL, worker, or host source fails, the map reports its limitation;
the location list, selection and route-coordinate text remain available. A
successful mocked engine test is not a real browser/WebGL acceptance result.


### Initialization failure

Browser worker startup failures need not emit a Map error. The
renderer observes enforced `worker-src` CSP violations before constructing the
map, without changing the policy. An exact owned worker URL is matched when
available. CSP3 may redact a Blob URL to `blob`; that document-level denial is
conservatively applied only while this map is initializing. Report-only policy,
other resource directives, other complete URLs, and already-ready maps are not
affected. Startup listeners are removed on readiness, error, or unmount. An observed
matching CSP block is remembered by this private engine instance. Later mounts,
including host configuration replacements, immediately retain the list fallback
under the same blocked policy. Already-ready maps and separate engine instances
are unaffected. After correcting the host policy, reload the page to retry. The scheme-only case is a conservative document-level inference, not an
exact worker-UUID attribution.

A late load cannot restore controls after failure. Selecting a location still
changes only local state, and sending it still requires the separate explicit
submit action. This scoped CSP fallback does not fix other silent worker startup
failures; it does not impose a new time limit on trusted basemap loading.
