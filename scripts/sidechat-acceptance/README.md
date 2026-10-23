# Dual-plugin sidechat acceptance

This test-only gate exercises packed GenUI and Better Sidebar through the real
DSH host and browser. It uses a fresh synthetic workspace and HOME, loopback
host authentication, and bounded deterministic replay. It does not use provider
keys, customer data, a shared DSH profile, or a substitute renderer.

## Existing CI smoke integration

The existing `check` job runs the pure contracts, then calls this gate from
`scripts/e2e.mjs --smoke --sidechat --install tarball` before smoke success and browser
closure. Without the explicit `--sidechat` option, all existing smoke/link/npm
modes are unchanged and do not build or fetch the companion. `--sidechat` requires
`--smoke --install tarball` before runtime setup. The gate reuses that caller-owned browser but creates and closes its own
isolated context. There is no additional workflow, job, runner, or release.

- Exact official source host `0.2.1-rc.2`: dual-plugin acceptance is mandatory in
  both the current Node 22 and Node 24 lanes. A missing/incomplete browser result,
  failed package installation, or failed cleanup fails the smoke job.
- Official `0.2.0-rc.1`: the existing minimum-host GenUI smoke still runs. The
  dual-plugin verdict is explicitly `not-applicable`, never a dual-plugin PASS.
- Any other host version fails closed until its coverage is deliberately reviewed.

The GenUI tarball and digest come from the existing normal verification/pack
step. The companion is fetched from the public
[`sunxiuguo/DSH-better-sidebar` fork](https://github.com/sunxiuguo/DSH-better-sidebar)
at immutable commit `34fbad8a75ca4e80af0375800378bcf7c4119d1d`
([draft companion PR](https://github.com/omdsh-dev/DSH-better-sidebar/pull/1033)).
A fresh owned checkout verifies that exact detached object, honors the pinned
repository's `pnpm@11.8.0`, and runs normal frozen install, typecheck, build, and
pack. Exactly one expected pack is accepted; its manifest and SHA-256 are checked
before the host's normal plugin-add path installs it. No script-skip, build
approval, peer-policy, dependency-age, or package-manager override is applied.

## What the gate proves

The host runner verifies the exact source-layout host graph, both packed plugin
names/digests and their installed file bytes, both actual browser boot entries,
persisted synthetic parent/child histories, and separate-process resume. The
mandatory browser helper checks real main/sidebar rendering, state isolation
across child switching and away/return, and four owning-child actions. Each
action requires a positive transport response and fresh durable replay receipts;
parent/away actions, duplicates, foreign routes and missing completed turns fail.
PASS requires the final durable quiet reread and owned cleanup.

The seed contains parent, A, B and one untouched empty root. Official rc.2 hides
non-current empty session rows, so the away/return scenario uses one normal
workspace **New session** click, not a lookup of the hidden seeded root. The
helper passively observes the correlated successful create response, verifies
that exact fresh ID is visibly selected, and binds it once to the durable oracle.
All subsequent reads include both empty roots. Both must retain zero relevant
messages, model calls, actions and turns; root/cwd/workspace ownership and the
exactly-one creation receipt are checked independently. No backend selection or
extra model action is used, and the original four child actions are unchanged.

Pure Node contracts cover these guards and negative controls. They do not prove
that a real browser or host invocation passed. Each actual CI run must establish
its own browser verdict; uploading evidence alone never counts as acceptance.

## Local commands and evidence

Run contracts without Git downloads, package installation, a host or browser:

```sh
node --test scripts/sidechat-acceptance/tests/*.test.mjs
```

To exercise real acceptance, first prepare the exact official source host and a
normal GenUI pack, then use the existing smoke command with `DSH_ROOT`, `DSH_BIN`,
`--sidechat --install tarball`, `--tarball` and `--tarball-sha256`. The current-host gate also
performs the ordinary companion build described above; it has no fallback to a
backend-only or artifact-only success.

The same CI job retains only these bounded synthetic files for seven days in a
Node/role-specific artifact:

- `.e2e-artifacts/sidechat/dsh354-thread-A-block2-fence1.png`
- `.e2e-artifacts/sidechat/dsh354-thread-B-block0-fence1.png`
- `.e2e-artifacts/sidechat/dsh354-main-unchanged.png`
- `.e2e-artifacts/sidechat/dsh354-thread-B-after-actions.png`
- `.e2e-artifacts/sidechat/dsh354-host-verdict.json`
- `.e2e-artifacts/sidechat/dsh354-browser-report.json`

No runtime HOME, session/config directory, raw host log, token, or build output is
included by this new artifact step. The existing unrelated failure-artifact step
is unchanged. Owned temporary checkout/profile/process resources are cleaned on
success and failure; the wrapper never closes the caller's browser itself.
