# Phase 6 Audit — Lifecycle Management

Status: **TECHNICALLY GREEN / AWAITING OWNER APPROVAL after final promotion validation**

Blueprint exit gate: **Active browsers survive; abandoned browsers disappear automatically.**

## Scope verified

Phase 6 adds lifecycle enforcement to the Laravel-owned multi-session runtime without moving tool profiles, Phrasly integration, production provider routing, VPS deployment, or capacity benchmarking forward.

The implementation provides:

- renewable session leases; genuine activity renews the lease while heartbeat alone does not;
- configurable idle timeout, disconnect grace, startup grace and autonomous reaper interval;
- reconnect/heartbeat within disconnect grace without replacing the browser;
- explicit close with exact-session worker identity checks and cleanup proof;
- autonomous stale/abandoned session reaping;
- worker process-exit cleanup/watchdog behavior;
- restart reconciliation between durable Laravel session records and live worker sessions;
- orphan worker cleanup without terminating a different tracked writer session; and
- preservation of Phase 1-5 ownership, viewer security, state isolation and crash isolation.

Production defaults remain the Blueprint values: 90-minute lease (`5400s`), approximately 15-minute idle timeout (`900s`) and approximately 3-minute disconnect grace (`180s`). CI uses valid accelerated values only to exercise the same policy within bounded test time.

## Material findings and corrections

### SB-006-001 — Accelerated lifecycle CI initially violated runtime configuration bounds

Severity: Medium.

The first Phase 6 CI policy shortened lifecycle values below the runtime's own accepted minimums. That made the workflow configuration invalid rather than testing lifecycle behavior. The workflow was corrected to valid accelerated values (`70s` lease, `60s` idle, `30s` disconnect, `5s` startup, `1s` reaper), and the reconnect fixture now derives its near-timeout timestamp from configured disconnect grace.

Status: **FIXED / CLOSED**.

### SB-006-002 — Container builds were vulnerable to transient external registry/package failures

Severity: Medium.

Historical RED runs were inspected rather than ignored. Examples include:

- run `33902499847`, job `101119604708`: repository type/syntax and Node tests passed, then Composer/GitHub dependency retrieval failed with HTTP 504 while building the API image;
- run `33902328749`, job `101119058078`: repository type/syntax and Node tests passed, then Debian package retrieval failed because `deb.debian.org` could not be resolved during the image build;
- other inherited/Phase 6 runs on the early Phase 6 heads failed in the same build stage under transient registry/network pressure, including Docker Hub HTTP 429 throttling.

The four authoritative workflows now perform bounded `docker compose build` retries (three attempts, exponential delay) before boot. Application/typecheck failures are still hard failures; retrying does not suppress a persistent defect.

Status: **FIXED / CLOSED**.

### SB-006-003 — A single shared Actions concurrency group cancelled required inherited gates

Severity: Medium.

A hardening attempt used one concurrency group across all four workflows. GitHub Actions keeps only one running plus one pending item in a concurrency group, so required inherited gates were cancelled rather than queued. This configuration was removed immediately. All four workflows are allowed to execute, while bounded build retries remain in place.

Status: **FIXED / CLOSED**.

### SB-006-004 — Reaper could issue a redundant second stop from its same-pass worker snapshot

Severity: Medium.

The reaper snapshots live worker sessions before processing durable records. When it terminated an expired/closing browser, the original snapshot still contained that worker ID; the later orphan sweep could therefore issue a redundant second stop. Missing/gone was tolerated, so this did not normally terminate another session, but it was unnecessary control traffic and weakened audit clarity.

The reaper now removes a worker session ID from the in-memory snapshot immediately after successful same-pass termination. The orphan sweep therefore considers only worker sessions that still remain after tracked-record processing.

Status: **FIXED / CLOSED**.

## Exact-head implementation verification

Exact implementation head: `0da7b5b9b9da008d2a3d73ef8b96ce38f0212540`.

All required workflows completed successfully on that same SHA:

- Verified Through Phase 3 — run `33907235930`, job `101133666315` — **SUCCESS**;
- Phase 4 Laravel Session API — run `33907235955`, job `101133666625` — **SUCCESS**;
- Phase 5 Session Isolation — run `33907235924`, job `101133666571` — **SUCCESS**;
- Phase 6 Lifecycle Management — run `33907235859`, job `101133667125` — **SUCCESS**.

Every workflow ran `bash scripts/typecheck.sh` successfully. The gate checks all current Node `.mjs` syntax, non-vendor PHP syntax, Python test compilation, JSON manifests and Docker Compose configuration. The repository is plain Node ESM/PHP/Python; no TypeScript compiler result is claimed.

The Phase 6 workflow additionally passed:

- static and unit gates;
- full container build/boot and health checks;
- autonomous reaper startup;
- lifecycle and restart-reconciliation E2E;
- lease/activity/disconnect/idle/explicit-close behavior;
- abandoned/orphan cleanup;
- zero Chromium/profile residue;
- zero durable open session records at teardown; and
- clean Compose teardown.

## Inherited regression gate

Phase 6 preserves the earlier guarantees rather than replacing their tests:

- Phase 1-3 repeated Chromium lifecycle, restricted viewer, localhost-only publication, no raw CDP and cleanup remain green;
- Phase 4 signed service ownership, replay protection, Laravel viewer-grant ownership and persistence remain green;
- Phase 5 simultaneous writer isolation, same-origin cookie/localStorage/sessionStorage isolation, cross-writer rejection, cross-session viewer-token rejection and one-browser-crash isolation remain green.

## Phase boundary / deferred work

Not claimed by Phase 6:

- Phase 7 generic tool-profile framework;
- Phase 8 Phrasly saved-state/authenticated reference implementation;
- Phase 11/14 deployment hardening;
- Phase 15 production provider integration;
- Phase 18 empirical 5/10/15 safe-concurrency measurement.

The production Browser Use path remains outside this standalone repository and is not changed by Phase 6.

## Promotion rule

The documentation commit is not itself treated as final promotion evidence. Before owner sign-off, this exact documented head must be re-run through all four workflows, promoted by controlled PR/merge to standalone `main`, and the resulting `main` head must pass those same four workflows. The production website baseline must then be rechecked unchanged.

No Critical or High Phase 6 issue is known open at this point.
