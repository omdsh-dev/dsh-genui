# Real Map acceptance in existing CI

The existing Linux host matrix runs `scripts/e2e.mjs --smoke --map --install
tarball --tarball … --tarball-sha256 …`. It reuses the verified package, pinned
DSH host and that host's Playwright. No new job, service, permission, credential,
model subscription or browser dependency is introduced.

This mode deliberately refuses local execution, non-Linux GitHub runners,
root, live-model mode, unverified installation, and `--sidechat` combination.
Do not work around a browser, socket or sandbox denial. The existing Gallery,
Sidechat and text-newline tests remain separate and unchanged.

## Browser constraints

Use installed official Chrome with `chromiumSandbox: true`. GPU-less runners
use Chromium's supported ANGLE/SwiftShader OpenGL ES driver:
`--use-gl=angle --use-angle=swiftshader`. This is not the unsafe WebGL fallback.
No `--no-sandbox`, `--disable-gpu`, `--disable-web-security`,
`--enable-unsafe-swiftshader`, CSP bypass or system security change is allowed.
The running browser command line is inspected for forbidden flags. Browser or
driver failure fails the job; there is no alternate channel or unsafe retry.

References:
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/swiftshader.md
- https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-chromium-sandbox

## What a successful CI run establishes

- Actual WebGL context and composited route pixels, corroborated by a real
  blob worker. The 80×32 central screenshot crop excludes the same-blue DOM
  markers, so markers alone cannot pass a broken GeoJSON worker.
- Keyboard list → marker, marker → list, clear, zoom geometry, reset, ordinary
  wheel non-zoom behavior, and local selection without implicit actions.
- On rc.3 only: a real isolated session via official APIs and ReplayAdapter;
  exactly one initial prompt, zero additional calls during navigation, then
  one explicit submit carrying `fields.destination = "east"`, one fresh input
  request, and the second real assistant acknowledgment. rc.1 explicitly gets
  DOM-fence visual/interaction coverage, not host action-routing credit.
- Public `./embed` source and engine assets extracted from the exact verified
  tarball. Fixtures use public props/context/snapshot APIs, never internal
  stores or Map instances. Streaming IDs, removal, theme/style changes,
  worker cleanup and a narrow touch context are checked through actual UI.
- A real UI-triggered public HTML export opened from the saved file in a fresh
  browser context that is offline before first navigation, then reloaded.
  Original CSP remains intact; no HTTP(S) or WebSocket dependency is allowed.
  The exported selection is restored; local controls work; model submit stays
  disabled. This file navigation is on CI, never a cloud CUA/file workaround.
- A negative fixture adds `worker-src 'none'` without changing product CSP.
  Worker rejection must produce an honest usable list fallback and preserve
  explicit submit behavior; expected CSP evidence is recorded separately.

## Evidence and limits

`.e2e-artifacts/map/map-browser-results.json` records identity, phase, renderer,
pixel measurements, action verdicts, sanitized network/CSP/errors and cleanup.
Named PNGs show host, embed, touch, offline and blocked-worker states. A failure
keeps `map-failure.png` when possible; launch/outer failures write
`map-runner-error.json`. The archive contains only synthetic JSON/PNGs and the
synthetic exported HTML, not profiles, host logs, tokens or raw session audit.

Local pure contract tests and fixture compilation are not browser acceptance.
Until the new CI step actually runs successfully, real browser acceptance is
pending. A software-GPU pass does not establish physical GPU/device coverage,
all third-party host styles, or every worker crash/recovery path.
