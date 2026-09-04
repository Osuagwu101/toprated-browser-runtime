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

Underlying cause: the Phase 4 ownership model intentionally matched the worker's one-session capability.

Corrective action: made worker calls session-scoped, reconciled tracked worker session IDs independently, and changed capacity to validated configuration from 1 through the blueprint ceiling of 15. Phase 5 correctness CI uses 3 slots; load proof remains later work.

Evidence: typecheck-enabled technical runs `33883568115` and `33883567965`; promoted-main Phase 4/5 runs `33885089684` and `33885089493`.

Status: **FIXED / CLOSED**.

### SB-005-003 — No executable proof of same-origin browser-state and crash isolation

Severity: High / Gate blocker.

Observed: prior phases did not prove two writers could use the same origin without cookie, `localStorage` or `sessionStorage` crossover, or that one Chromium crash left the other session healthy.

Underlying cause: those attack/failure cases were outside Phase 4's deliberate single-session scope.

Corrective action: added `browser-worker/test/isolation-fixture.mjs` and `tests/phase5-e2e.py`. The test creates writers A/B simultaneously, checks independent cookie/local/session storage, rejects cross-writer lifecycle actions and cross-session viewer tokens, kills A's Chromium while B stays usable, then verifies independent cleanup and zero open records.

Evidence: run `33883567965`, job `101057797632`; documentation-head run `33884697831`; promoted-main run `33885089493`.

Status: **FIXED / CLOSED**.

### SB-005-004 — Worker health could report OK when Chromium was unavailable

Severity: Medium.

Observed: inherited health reported `status: ok` regardless of configured Chromium executable availability.

Underlying cause: installation state was metadata but not part of top-level health.

Corrective action: worker health is `ok` only when capacity configuration is valid and Chromium is installed; otherwise it reports `degraded`.

Evidence: exact-head workflows `33883567911`, `33883568115`, `33883567965`, plus promoted-main workflows `33885089657`, `33885089684`, `33885089493`.

Status: **FIXED / CLOSED**.

### SB-005-005 — Repository had no single executable type/syntax gate across its current toolchain

Severity: Medium.

Observed: syntax/config checks were scattered across historical workflows, leaving no single command that validated all current source/configuration formats.

Underlying cause: the repository accumulated Node, PHP, Python, JSON and Compose checks incrementally.

Corrective action: added `scripts/typecheck.sh` and made all three current workflows execute it before behavioral tests. It runs:

- `node --check` on all browser-worker `.mjs` files;
- `php -l` on all non-vendor API PHP files;
- `python3 -m py_compile tests/*.py`;
- JSON validation for current manifests; and
- `docker compose config --quiet`.

The repository is plain Node ESM/PHP/Python rather than TypeScript, so no `tsc` result is fabricated.

Evidence: exact typecheck-enabled head `ea00b239e20382125e53ad317acf52ea1a071f29` passed runs `33883567911`, `33883568115`, `33883567965`; final documentation head `c4f5a006b763bab471fcd7bb73608606146ab67f` passed `33884697611`, `33884697657`, `33884697831`; promoted `main` `4530352a46aad31f295231813f024a120acd021b` passed `33885089657`, `33885089684`, `33885089493`.

Status: **FIXED / CLOSED**.

## Phase 5 closure

Phase 5 is **GREEN / COMPLETE / APPROVED**.

The Phase 5 exit gate — **“Writer/browser isolation passes”** — is satisfied. Pull request #5 promoted the exact tested Phase 5 head to standalone `main` commit `4530352a46aad31f295231813f024a120acd021b`. That promoted `main` passed:

- Verified Through Phase 3 run `33885089657` — SUCCESS;
- Phase 4 Laravel Session API run `33885089684` — SUCCESS; and
- Phase 5 Session Isolation run `33885089493` — SUCCESS.

The production website/Browser Use repository was rechecked after promotion and remained at `ea5d39b79d7c3fac9c004ae3dfd6b55ff75df084`.

No Critical or High Phase 5 issue remains open. Phase 6 is **NOT STARTED**.
