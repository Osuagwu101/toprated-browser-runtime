# Self-Hosted Browser Issue Register

Material issues use IDs `SB-PHASE-SEQUENCE`. Critical and High issues block phase advancement until fixed and regression-tested. Historical failures remain recorded even after a phase closes.

## Earlier phases

### SB-001-001 — Standalone repository topology was not being used as the verified source of truth

Severity: High.

Underlying cause: repository continuity and evidence handling were inconsistent across earlier work, so the verified implementation was still being developed under the main website repository instead of the existing standalone runtime repository.

Corrective action: migrated the verified Phase 1-3 runtime into `Osuagwu101/toprated-browser-runtime`, promoted it to standalone `main`, and passed the combined Phase 1-3 gate in run `33857323898`, job `100973530886`.

Status: FIXED / CLOSED.

### SB-003-001 — Earlier Phase 3 conversational state was not persisted in the verified source branch

Severity: High.

Corrective action: rebuilt Phase 3 from the verified Phase 2 head and fully revalidated it rather than relying on conversational status.

Status: FIXED / CLOSED.

### SB-003-002 — Phase 3 generic-runtime grep included a negative test fixture

Severity: Medium.

Corrective action: narrowed the generic-runtime scan to production source directories and revalidated Phase 3.

Status: FIXED / CLOSED.

# Phase 4 issues

### SB-004-001 — Worker lifecycle endpoints could bypass Laravel ownership

Severity: High.

Underlying cause: Phase 3 worker lifecycle endpoints remained directly callable when the first Laravel ownership layer was added.

Corrective action: added a separate `WORKER_CONTROL_SECRET`, required it on every `/browser/*` lifecycle request, configured Laravel to supply it, retained public health only, and added a 401 regression for unauthenticated lifecycle access.

Regression evidence: runs `33867076595`, `33867803222`, `33868000840` and final Phase 4 `main` run `33869763531`.

Status: FIXED / CLOSED.

### SB-004-002 — Inherited Phase 1-3 regression hard-coded the old API phase

Severity: Medium.

Observed: Phase 4 CI run `33866819180`, job `101003454022`, failed because the inherited harness asserted that Laravel API health must remain Phase 3.

Corrective action: retained the browser/viewer behavioral regression while removing the stale historical phase assertion.

Status: FIXED / CLOSED.

### SB-004-003 — Worker control secret was not wired into CI in the same change

Severity: Medium.

Observed: Phase 4 CI run `33866993636`, job `101003995956`, failed after `WORKER_CONTROL_SECRET` became mandatory but the workflow environment had not yet been updated.

Corrective action: added the CI-only worker-control secret and retained worker-control bypass coverage.

Status: FIXED / CLOSED.

### SB-004-004 — Worker still presented stale Phase 3 ownership metadata and minted legacy viewer grants

Severity: Medium.

Corrective action: worker health was updated to reflect Laravel lifecycle ownership and Laravel grant issuance; `/browser/start` stopped minting production viewer grants. Laravel became the sole operational viewer-grant issuer.

Regression evidence: runs `33867803222`, `33868000840` and `33869763531`.

Status: FIXED / CLOSED.

### SB-004-005 — Control-plane health could be falsely green for invalid launch-critical configuration

Severity: High.

Corrective action: added explicit service-auth, worker-control, viewer configuration and Phase 4 capacity readiness checks, including fail-fast viewer configuration validation before Chromium launch.

Regression evidence: runs `33868000840` and `33869763531`.

Status: FIXED / CLOSED.

### SB-004-006 — Inherited Phase 1-3 workflow became stale after Phase 4 promotion

Severity: High.

Observed: Phase 4 workflow run `33869416309` passed on `main`, but inherited run `33869416366` failed because the old workflow still expected worker-side viewer-grant transport metadata and lacked the current control-plane secrets.

Corrective action: kept the inherited workflow active, updated its assertions to the Laravel-owned grant model, added current CI configuration, and revalidated instead of suppressing the failure.

Regression evidence: fix head `a58e5eea2ce8377429fc8f843f75e26e342a5f94` passed runs `33869567556` and `33869567509`; corrected `main` at `984378c78fea4dd5c3624ed43eca997e1aff845f` passed runs `33869763521` and `33869763531`.

Status: FIXED / CLOSED.

## Phase 4 closure

Phase 4 is **GREEN / COMPLETE / APPROVED**. The final Phase 4 closure commit is `156372e912b4792baab471263202c5d867131ec4`. Its closure documentation retained the full Phase 4 failure/fix history, and Phase 5 began only from that approved baseline.

# Phase 5 issues

### SB-005-001 — Worker singleton prevented simultaneous isolated writer sessions

Severity: High / Gate blocker.

Observed: the approved Phase 4 worker stored one browser in `this.current` and rejected a second browser with HTTP 409.

Expected: Phase 5 must prove multiple simultaneous writers, one isolated Chromium per writer, with no state crossing sessions.

Underlying cause: the Phase 4 design deliberately implemented one effective slot because multi-session isolation belonged to Phase 5.

Corrective action: replaced the single current browser with a session-keyed collection. Each session receives its own Chromium process, dynamic loopback CDP endpoint, CDP client and temporary user-data directory. Worker lifecycle, viewer frame/input/status and cleanup operations are scoped to an opaque worker session ID.

Regression evidence: Phase 5 isolation runs `33879050804` and typecheck-enabled run `33883567965` passed simultaneous writer isolation.

Status: FIXED / CLOSED.

### SB-005-002 — Laravel lifecycle orchestration assumed one global worker slot

Severity: High / Gate blocker.

Observed: Phase 4 `SessionManager` and `BrowserWorkerClient` used global worker status/start/stop semantics and forced `MAX_BROWSER_SESSIONS=1`.

Expected: Laravel must retain writer ownership while independently controlling multiple worker sessions.

Underlying cause: the Phase 4 ownership model intentionally matched the worker's one-session capability.

Corrective action: made Laravel worker calls session-scoped, reconciled tracked worker session IDs individually, and changed capacity from the Phase 4 singleton rule to validated configuration. Phase 5 correctness CI uses 3 simultaneous-capable slots; the application configuration supports values from 1 through the blueprint ceiling of 15. Scale/load proof remains Phase 18.

Regression evidence: Phase 4 ownership regression run `33883568115` and Phase 5 isolation run `33883567965` both passed on exact head `ea00b239e20382125e53ad317acf52ea1a071f29`.

Status: FIXED / CLOSED.

### SB-005-003 — No executable proof of same-origin browser-state and crash isolation

Severity: High / Gate blocker.

Observed: before Phase 5 there was no test proving two writers could use the same web origin without cookie, `localStorage` or `sessionStorage` crossover, nor that one Chromium crash left the other writer healthy.

Expected: the Phase 5 exit gate requires writer/browser isolation, not merely the ability to launch two processes.

Underlying cause: those isolation attack/failure cases were intentionally outside the Phase 4 single-session scope.

Corrective action: added a deterministic same-origin isolation fixture and `tests/phase5-e2e.py`. The test creates writers A and B simultaneously, verifies independent cookie/local/session storage, rejects cross-writer session operations, rejects cross-session viewer tokens, kills writer A's Chromium, confirms writer B remains usable, then verifies independent cleanup with no browser/profile residue.

Regression evidence: run `33883567965`, job `101057797632`, passed the same-origin fixture, multi-writer isolation/crash regression, Chromium/profile cleanup scan and zero-open-session check.

Status: FIXED / CLOSED.

### SB-005-004 — Worker health could report OK when Chromium was unavailable

Severity: Medium.

Observed: inherited worker health reported `status: ok` independently of whether the configured Chromium executable existed.

Expected: a launch-critical browser dependency must not be advertised as healthy when unavailable.

Underlying cause: earlier health metadata exposed Chromium installation state but did not include it in the top-level status calculation.

Corrective action: Phase 5 worker health now reports `ok` only when both capacity configuration is valid and Chromium is installed; otherwise it reports `degraded`.

Regression evidence: current worker health/unit coverage and exact-head workflows `33883567911`, `33883568115` and `33883567965` passed.

Status: FIXED / CLOSED.

### SB-005-005 — Repository had no single executable type/syntax gate across its current toolchain

Severity: Medium.

Observed: existing workflows ran Node tests and PHP linting, but there was no single repository-wide command proving every current Node `.mjs`, PHP source file, Python test, JSON manifest and Compose configuration parses or validates.

Expected: Phase closure should not permit an unparsed source/config file to bypass a workflow merely because that file is not executed by a particular test path.

Underlying cause: syntax checks had accumulated separately inside historical workflows as the repository grew.

Corrective action: added `scripts/typecheck.sh` and made all three current workflows run it. It executes `node --check` for all browser-worker `.mjs` files, `php -l` for all non-vendor API PHP files, `python3 -m py_compile tests/*.py`, JSON validation for the current manifests, and `docker compose config --quiet`.

Regression evidence: exact typecheck-enabled head `ea00b239e20382125e53ad317acf52ea1a071f29` passed inherited run `33883567911`, Phase 4 run `33883568115`, and Phase 5 run `33883567965`; in the Phase 5 job the `Repository-wide type and syntax gate` completed successfully before the behavioral suites.

Status: FIXED / CLOSED.

## Phase 5 closure status

No Critical or High Phase 5 issue remains open. Phase 5 implementation and type/syntax validation are technically green on the branch. Final closure still requires the documentation head to pass all three workflows, promotion through pull request #5, the resulting standalone `main` to pass all three workflows, and a final production Browser Use baseline recheck.
