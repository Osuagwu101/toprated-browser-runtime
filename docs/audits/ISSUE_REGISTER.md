# Self-Hosted Browser Issue Register

Material issues use IDs `SB-PHASE-SEQUENCE`. Critical and High issues block phase advancement until fixed and regression-tested. Historical failures remain recorded after closure.

# Earlier phases

### SB-001-001 — Standalone repository topology was not being used as the verified source of truth

Severity: High.

Underlying cause: repository continuity/evidence handling had allowed verified work to remain under the main website repository instead of the standalone runtime repository.

Corrective action: migrated the verified Phase 1-3 runtime to `Osuagwu101/toprated-browser-runtime`, promoted it to standalone `main`, and passed combined Phase 1-3 run `33857323898`, job `100973530886`.

Status: **FIXED / CLOSED**.

### SB-003-001 — Earlier Phase 3 conversational state was not persisted in the verified source branch

Severity: High.

Corrective action: rebuilt Phase 3 from the verified Phase 2 head and fully revalidated it instead of relying on conversational status.

Status: **FIXED / CLOSED**.

### SB-003-002 — Phase 3 generic-runtime grep included a negative test fixture

Severity: Medium.

Corrective action: narrowed the generic-runtime scan to production source directories and revalidated Phase 3.

Status: **FIXED / CLOSED**.

# Phase 4 issues

### SB-004-001 — Worker lifecycle endpoints could bypass Laravel ownership

Severity: High.

Underlying cause: Phase 3 worker lifecycle endpoints remained directly callable when the Laravel ownership layer was first added.

Corrective action: added a separate `WORKER_CONTROL_SECRET`, required it on `/browser/*`, configured Laravel to supply it, retained public health only, and added unauthenticated lifecycle rejection coverage.

Evidence: runs `33867076595`, `33867803222`, `33868000840`, final Phase 4 `main` run `33869763531`.

Status: **FIXED / CLOSED**.

### SB-004-002 — Inherited Phase 1-3 regression hard-coded the old API phase

Severity: Medium.

Observed: Phase 4 run `33866819180`, job `101003454022`, failed because the inherited harness asserted Laravel health must remain Phase 3.

Corrective action: retained browser/viewer behavioral regression while removing the stale historical phase assertion.

Status: **FIXED / CLOSED**.

### SB-004-003 — Worker control secret was not wired into CI in the same change

Severity: Medium.

Observed: run `33866993636`, job `101003995956`, failed after `WORKER_CONTROL_SECRET` became mandatory but the workflow environment had not yet been updated.

Corrective action: added the CI-only worker-control secret and retained worker-control bypass coverage.

Status: **FIXED / CLOSED**.

### SB-004-004 — Worker still presented stale Phase 3 ownership metadata and minted legacy viewer grants

Severity: Medium.

Corrective action: worker health was updated for Laravel lifecycle ownership/grant issuance; `/browser/start` stopped minting production viewer grants. Laravel became the sole operational grant issuer.

Evidence: runs `33867803222`, `33868000840`, `33869763531`.

Status: **FIXED / CLOSED**.

### SB-004-005 — Control-plane health could be falsely green for invalid launch-critical configuration

Severity: High.

Corrective action: added explicit service-auth, worker-control, viewer configuration and Phase 4 capacity readiness checks, including fail-fast viewer validation before Chromium launch.

Evidence: runs `33868000840`, `33869763531`.

Status: **FIXED / CLOSED**.

### SB-004-006 — Inherited Phase 1-3 workflow became stale after Phase 4 promotion

Severity: High.

Observed: Phase 4 run `33869416309` passed on `main`, but inherited run `33869416366` failed because the old workflow expected worker-side viewer-grant metadata and lacked current control-plane secrets.

Corrective action: kept the inherited workflow active, updated it to the Laravel-owned grant model, added current CI configuration, and revalidated rather than suppressing the failure.

Evidence: fix head `a58e5eea2ce8377429fc8f843f75e26e342a5f94` passed `33869567556` and `33869567509`; corrected `main` `984378c78fea4dd5c3624ed43eca997e1aff845f` passed `33869763521` and `33869763531`.

Status: **FIXED / CLOSED**.

## Phase 4 closure

Phase 4 is **GREEN / COMPLETE / APPROVED**. Final Phase 4 closure commit: `156372e912b4792baab471263202c5d867131ec4`.

# Phase 5 issues

### SB-005-001 — Worker singleton prevented simultaneous isolated writer sessions

Severity: High / Gate blocker.

Observed: approved Phase 4 stored one browser in `this.current` and rejected a second browser with HTTP 409.

Underlying cause: the Phase 4 design deliberately implemented one effective slot because multi-session isolation belonged to Phase 5.

Corrective action: replaced the singleton with a session-keyed collection. Every session receives its own Chromium process/process group, loopback CDP endpoint/client and temporary user-data directory. Lifecycle, viewer and cleanup operations are scoped to opaque worker session IDs.

Evidence: Phase 5 isolation runs `33879050804`, `33883567965`, final promoted-main run `33885089493`.

Status: **FIXED / CLOSED**.

### SB-005-002 — Laravel lifecycle orchestration assumed one global worker slot

Severity: High / Gate blocker.

Observed: Phase 4 `SessionManager`/`BrowserWorkerClient` used global status/start/stop semantics and forced `MAX_BROWSER_SESSIONS=1`.

Corrective action: made worker calls session-scoped, reconciled tracked worker session IDs independently, and changed capacity to validated configuration from 1 through the blueprint ceiling of 15. Phase 5 correctness CI uses 3 slots; load proof remains later work.

Evidence: typecheck-enabled technical runs `33883568115` and `33883567965`; promoted-main Phase 4/5 runs `33885089684` and `33885089493`.

Status: **FIXED / CLOSED**.

### SB-005-003 — No executable proof of same-origin browser-state and crash isolation

Severity: High / Gate blocker.

Corrective action: added `browser-worker/test/isolation-fixture.mjs` and `tests/phase5-e2e.py`. The test creates writers A/B simultaneously, checks independent cookie/local/session storage, rejects cross-writer lifecycle actions and cross-session viewer tokens, kills A's Chromium while B stays usable, then verifies independent cleanup and zero open records.

Evidence: run `33883567965`, job `101057797632`; documentation-head run `33884697831`; promoted-main run `33885089493`.

Status: **FIXED / CLOSED**.

### SB-005-004 — Worker health could report OK when Chromium was unavailable

Severity: Medium.

Corrective action: worker health is `ok` only when capacity configuration is valid and Chromium is installed; otherwise it reports `degraded`.

Evidence: exact-head workflows `33883567911`, `33883568115`, `33883567965`, plus promoted-main workflows `33885089657`, `33885089684`, `33885089493`.

Status: **FIXED / CLOSED**.

### SB-005-005 — Repository had no single executable type/syntax gate across its current toolchain

Severity: Medium.

Corrective action: added `scripts/typecheck.sh` and made current workflows execute it before behavioral tests. It validates Node `.mjs`, non-vendor PHP, Python tests, JSON manifests and Docker Compose configuration. The repository is plain Node ESM/PHP/Python rather than TypeScript, so no `tsc` result is fabricated.

Evidence: exact typecheck-enabled head `ea00b239e20382125e53ad317acf52ea1a071f29` passed runs `33883567911`, `33883568115`, `33883567965`; final documentation head `c4f5a006b763bab471fcd7bb73608606146ab67f` passed `33884697611`, `33884697657`, `33884697831`; promoted `main` `4530352a46aad31f295231813f024a120acd021b` passed `33885089657`, `33885089684`, `33885089493`.

Status: **FIXED / CLOSED**.

## Phase 5 closure

Phase 5 is **GREEN / COMPLETE / APPROVED**. Its exit gate — **“Writer/browser isolation passes”** — is satisfied. Pull request #5 promoted the tested Phase 5 head to standalone `main`; final Phase 5 closure was recorded through PR #6. The production website/Browser Use repository remained at `ea5d39b79d7c3fac9c004ae3dfd6b55ff75df084`.

# Phase 6 issues

### SB-006-001 — Accelerated lifecycle CI initially violated runtime configuration bounds

Severity: Medium.

Observed: the first Phase 6 CI policy used lifecycle values below the runtime's own accepted minimums.

Corrective action: changed accelerated CI policy to valid values (`70s` lease, `60s` idle, `30s` disconnect, `5s` startup, `1s` reaper) and made the reconnect fixture configuration-relative.

Evidence: exact corrected implementation head `0da7b5b9b9da008d2a3d73ef8b96ce38f0212540` later passed the dedicated Phase 6 gate.

Status: **FIXED / CLOSED**.

### SB-006-002 — Authoritative workflows were vulnerable to transient external container/package retrieval failures

Severity: Medium.

Observed: repository-local gates could pass, then image builds fail because external registries or package mirrors were temporarily unavailable. Examples: run `33902499847`, job `101119604708` (Composer/GitHub HTTP 504), and run `33902328749`, job `101119058078` (Debian name-resolution failure). Early runs also encountered Docker Hub HTTP 429 throttling.

Corrective action: all four then-authoritative workflows received a bounded three-attempt `docker compose build` retry with increasing delay. Persistent application, typecheck, unit, E2E or repeated build failures still fail the gate.

Evidence / RED history: failed runs including `33902499847`, `33902328749`, `33902328523`, `33902328488`, `33902328695`, `33902296862` and `33902296868` remain in Actions history.

Status: **FIXED / CLOSED**.

### SB-006-003 — Shared GitHub Actions concurrency group cancelled required inherited gates

Severity: Medium.

Observed: a CI-hardening attempt put all required workflows in one shared Actions concurrency group, causing pending inherited gates to be cancelled rather than serialized.

Corrective action: removed the shared cross-workflow concurrency group and retained bounded build retries instead.

Status: **FIXED / CLOSED**.

### SB-006-004 — Reaper could issue a redundant second stop from its same-pass worker snapshot

Severity: Medium.

Corrective action: after successful tracked-session termination, the reaper removes that worker session ID from its in-memory snapshot before the orphan sweep.

Evidence: exact implementation head `0da7b5b9b9da008d2a3d73ef8b96ce38f0212540` passed Verified Through Phase 3 `33907235930`, Phase 4 `33907235955`, Phase 5 `33907235924` and Phase 6 `33907235859`.

Status: **FIXED / CLOSED**.

## Phase 6 closure

The Phase 6 exit gate — **“Active browsers survive; abandoned browsers disappear automatically”** — is satisfied. Final documented branch head `c708ee10016c2012fb400a25351f8afdf18e7847` passed runs `33909732417`, `33909732370`, `33909732414` and `33909732404`. PR #7 promoted it to `main` commit `20a81157554e70386be3291ee564fe39514a5041`, which passed runs `33910146825`, `33910146517`, `33910146434` and `33910146416`. Owner approval was recorded on 2026-09-04 through the Phase 6 closure sequence. Phase 6 is **GREEN / COMPLETE / APPROVED**.

# Phase 7 issues

### SB-007-001 — Approved Phase 6 launch path had no authoritative generic tool-profile model

Severity: High / Gate blocker.

Observed: approved Phase 6 owned browser lifecycle and writer/session isolation, but the launch destination still came directly through the session launch request. There was no server-owned `tool_slug` -> configured profile resolution layer.

Underlying cause: tool-profile configuration was deliberately deferred by the Blueprint until Phase 7.

Corrective action: added `ToolProfileRegistry`, a configurable JSON profile source, server-side profile validation, enabled/disabled policy and profile-owned launch destination resolution. `SessionController` resolves the signed writer/tool request through the registry before Chromium creation. Unknown and disabled profiles fail closed, and a caller cannot replace the configured destination.

Evidence: implementation commits beginning with `44148a1547e41c2504097fc67c6845d521a77012`, `72f693143a4f4faed7ffe5c48a610837830c93a5` and `5575b3afca29d91d7e8df20973541af4ab61ffd5`; corrected implementation head `d1d9269b7f1dda161ac1c72f9eae7884b4d59266` passed the complete authoritative gate set.

Status: **FIXED / CLOSED**.

### SB-007-002 — Autonomous lifecycle reaper could interfere with inherited pre-reaper regression sequencing

Severity: Medium.

Observed: the initial Phase 7 verification stack started the Phase 6 autonomous reaper while inherited Phase 4/5 fixtures were still running their historical setup sequence.

Underlying cause: the new Phase 7 workflow composed inherited suites without preserving the reaper boundary used by their authoritative lifecycle workflow.

Corrective action: run inherited Phase 4/5 regressions before starting the autonomous reaper, then make the reaper mandatory for the inherited Phase 6 lifecycle/restart regression and final cleanup checks. Production lifecycle behavior was not weakened.

Evidence: corrective commit `7727cf0255f8edcf02ea4ed9e6a6792f3f8b9fdd` and later full-green Phase 7 heads.

Status: **FIXED / CLOSED**.

### SB-007-003 — API restart could expose a transient worker-read connection refusal

Severity: Medium.

Observed: inherited Phase 6 run `33919958668`, job `101175779193`, failed after `docker compose restart api`; an immediate idempotent API-to-worker session-status read briefly surfaced `WORKER_UNAVAILABLE`.

Underlying cause: control-plane readiness and Docker-internal worker reachability can converge over a short interval after API restart, while `BrowserWorkerClient` treated the first connection-level read failure as final.

Corrective action: added a bounded four-attempt, 100 ms connection retry only to idempotent worker reads (`health`, session list and session status). Session creation is intentionally not retried, preventing duplicate Chromium launch risk if a POST is processed but its response is lost. Permanent worker failure and worker HTTP errors still propagate normally. The inherited Phase 6 test was not weakened or skipped.

Evidence / RED history: Phase 6 Lifecycle Management run `33919958668`, job `101175779193` — FAILURE. Corrected head `d1d9269b7f1dda161ac1c72f9eae7884b4d59266` passed Phase 6 run `33926255036` and all other authoritative workflows on the same SHA.

Status: **FIXED / CLOSED**.

## Phase 7 closure

The Phase 7 exit gate — **“The runtime can launch a generic configured tool without Phrasly-specific branching in core infrastructure”** — is satisfied.

Final documented Phase 7 branch head: `a6a17e43c1109533a1230c719b2524455837a8d4`.

All five authoritative workflows passed on that exact branch SHA:

- Verified Through Phase 3 — run `33926867078` — SUCCESS;
- Phase 4 Laravel Session API — run `33926867092` — SUCCESS;
- Phase 5 Session Isolation — run `33926867099` — SUCCESS;
- Phase 6 Lifecycle Management — run `33926867114` — SUCCESS;
- Phase 7 Generic Tool Profiles — run `33926867048` — SUCCESS.

PR #9 promoted that exact tested head to standalone `main` commit `67281ba8815f2a407d4f2e6904ce1d7c38880d1d`.

All five authoritative workflows passed again on the promoted `main` SHA:

- Verified Through Phase 3 — run `33939565151` — SUCCESS;
- Phase 4 Laravel Session API — run `33939565157` — SUCCESS;
- Phase 5 Session Isolation — run `33939565153` — SUCCESS;
- Phase 6 Lifecycle Management — run `33939565173` — SUCCESS;
- Phase 7 Generic Tool Profiles — run `33939565154` — SUCCESS.

The Phase 7 workflow proves configured generic launch, unknown/disabled profile rejection, caller launch-URL override rejection, same-writer/profile reuse, no Phrasly-specific reference in core runtime paths, no raw CDP exposure pattern, clean browser/profile teardown and zero durable open session records. All inherited Phase 1-6 behavioral gates remain active.

The production website/Browser Use repository was rechecked after promotion and remained at `ea5d39b79d7c3fac9c004ae3dfd6b55ff75df084`.

Owner approval was explicitly received on **2026-09-05**. No Critical, High or gate-blocking Phase 7 issue remains open.

Phase 7 is **GREEN / COMPLETE / APPROVED**.

Phase 8 — Phrasly reference implementation — is **NOT STARTED** and must begin only on explicit later instruction.


# Phase 8 issues

### SB-008-001 through SB-008-005 — Phrasly profile, shared-state injection, pre-viewer authentication verification, ephemeral state handling and live-proof requirement

Severity: High / gate blockers.

Underlying causes and corrections are recorded in `docs/audits/phase-8.md`. The deterministic mechanism is CI-verified; the real Phrasly gate remains pending owner-operated authentication.

Status: **IMPLEMENTED / CI-VERIFIED; LIVE PHRASLY PROOF PENDING**.

### SB-008-006 — Cloud browser could not establish the real Phrasly state because Cloudflare verification did not complete

Severity: High / exit-gate blocker.

Observed: the connected cloud browser remained on Phrasly's Cloudflare security-verification page and could not legitimately create the live shared-state artifact.

Underlying cause: the remote test browser was not accepted through Phrasly's human-verification boundary. Bypassing or weakening that boundary is prohibited.

Owner-approved amendment: on 2026-09-05 the owner approved a temporary operator-only Phase 8 authentication harness. The harness starts Phrasly inside the self-hosted Chromium, exposes only the existing restricted viewer through a protected one-time link file, allows the owner to complete Phrasly/Cloudflare verification directly, captures only the active Phrasly origin's cookies and Web Storage through the authenticated private worker control plane, immediately proves the captured state in a fresh Chromium session, and removes temporary state/link files.

Security controls: runtime operator service and worker-control secrets are required; writers receive neither secret nor raw captured state; the state-export route rejects unauthenticated calls; no password or OTP is accepted by the harness; captured state is not printed or durably stored.

Evidence: exact implementation head `57182a5f4cbcc654981fda7bbf565ad7b8d7ae03` passed all six authoritative workflows: Verified Through Phase 3 `33945655810`, Phase 4 `33945655788`, Phase 5 `33945655813`, Phase 6 `33945655770`, Phase 7 `33945655773`, and Phase 8 `33945655774`.

Status: **IMPLEMENTED / CI-VERIFIED; OWNER-OPERATED LIVE LOGIN STILL REQUIRED**.
