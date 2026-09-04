# Self-Hosted Browser Issue Register

Material issues use IDs `SB-PHASE-SEQUENCE`. Critical and High issues block phase advancement until fixed and regression-tested.

## SB-001-001 — Standalone repository topology was not being used as the verified source of truth

Severity: High.

Observed:
The required private repository `Osuagwu101/toprated-browser-runtime` already existed and contained earlier Phase 1-3 attempts, but the latest verified Phase 1-3 implementation and evidence were still being developed under `self-hosted-browser-runtime/` on isolated branches in the main Top Rated SEO Tools repository.

Expected:
The Master Blueprint requires the self-hosted runtime to live and validate independently in its own repository before Phase 4 adds the Laravel session API.

Underlying cause:
Repository continuity and evidence handling were inconsistent across the earlier phase work. The repository itself was not absent. Earlier audit language incorrectly treated repository creation as the unresolved blocker instead of checking the existing standalone repository and its actual validation state.

Corrective action:
The verified Phase 1-3 runtime was migrated into this standalone repository, promoted to `main`, and passed the combined Phase 1-3 gate on standalone `main` in run `33857323898`, job `100973530886`.

Status: FIXED / CLOSED.

## SB-003-001 — Earlier Phase 3 conversational state was not persisted in the verified source branch

Severity: High.

Status: FIXED. Phase 3 was rebuilt from the verified Phase 2 head and fully revalidated rather than relying on conversational status.

## SB-003-002 — Phase 3 generic-runtime grep included a negative test fixture

Severity: Medium.

Status: FIXED. The generic-runtime scan was narrowed to production source directories and the corrected Phase 3 validation passed.

# Phase 4 issues

## SB-004-001 — Worker lifecycle endpoints could bypass Laravel ownership

Severity: High.

Observed:
The initial Phase 4 implementation added Laravel session ownership, but the worker's `/browser/start`, `/browser/status`, `/browser/navigate` and `/browser/stop` endpoints were still callable directly on the loopback-published worker port. A local caller could therefore create or manipulate a browser without a Laravel-owned session record.

Expected:
The Phase 4 exit gate says Laravel reliably owns browser lifecycle. Worker lifecycle control must not provide an unauthenticated bypass around Laravel.

Underlying cause:
Phase 3 deliberately exposed worker lifecycle endpoints to its isolated test harness. The first Phase 4 implementation layered Laravel ownership on top without immediately converting those inherited endpoints into an authenticated internal control surface.

Corrective action:
Added a separate `WORKER_CONTROL_SECRET`, required it on every `/browser/*` request, configured Laravel's `BrowserWorkerClient` to supply it, retained public worker health only, and added regression coverage proving unauthenticated worker lifecycle access returns 401.

Regression evidence:
Runs `33867076595`, `33867803222`, `33868000840` and final `main` run `33869763531` passed with worker-control protection enabled.

Status: FIXED / CLOSED.

## SB-004-002 — Inherited Phase 1-3 regression hard-coded the old API phase

Severity: Medium.

Observed:
Phase 4 CI run `33866819180`, job `101003454022`, failed in the inherited Phase 1-3 regression step because the script asserted that Laravel API health must still report Phase 3.

Expected:
Regression coverage must preserve Phase 1-3 browser/viewer behavior without rejecting the deliberate Phase 4 control-plane contract.

Underlying cause:
The migration regression mixed behavioral invariants with a historical phase-number assertion.

Corrective action:
Updated the regression to validate the Phase 4 Laravel health contract while retaining prior Chromium lifecycle, viewer security, input, reconnect and cleanup checks.

Regression evidence:
Subsequent Phase 4 runs passed the inherited regression, including final `main` run `33869763531`.

Status: FIXED / CLOSED.

## SB-004-003 — Worker control secret was not wired into CI in the same change

Severity: Medium.

Observed:
Phase 4 CI run `33866993636`, job `101003995956`, failed during container build/configuration after worker lifecycle authentication was introduced.

Expected:
The Phase 4 runtime and CI environment must provide every required secret through environment configuration.

Underlying cause:
`WORKER_CONTROL_SECRET` was made mandatory in runtime/Docker configuration, but the workflow environment was not updated in the same commit.

Corrective action:
Added a CI-only worker control secret to the workflow and extended static/end-to-end checks around the control boundary.

Regression evidence:
Runs `33867076595`, `33867803222`, `33868000840` and `33869763531` passed afterward.

Status: FIXED / CLOSED.

## SB-004-004 — Worker still presented stale Phase 3 ownership metadata and minted legacy viewer grants

Severity: Medium.

Observed:
After Laravel session ownership was functional, worker health still reported Phase 3 and `/browser/start` still returned a worker-generated viewer grant inherited from Phase 3.

Expected:
Phase 4 architecture assigns lifecycle/session ownership and viewer-grant issuance to Laravel. The worker should remain the Chromium/control/viewer execution layer and verify grants rather than act as an alternative grant issuer.

Underlying cause:
Phase 3 responsibilities were preserved during the first Phase 4 implementation and had not yet been narrowed after the Laravel control plane became authoritative.

Corrective action:
Worker health now reports Phase 4, Laravel lifecycle ownership and Laravel viewer-grant issuance. The worker lifecycle start response no longer mints a viewer grant. The inherited viewer regression uses a test-only signed token while Phase 4 E2E verifies a real Laravel-issued writer-bound token.

Regression evidence:
Runs `33867803222`, `33868000840` and `33869763531` passed after the correction.

Status: FIXED / CLOSED.

## SB-004-005 — Control-plane health could be falsely green for invalid launch-critical configuration

Severity: High.

Observed:
Laravel health originally verified database and worker availability but did not validate the service signing secret, worker control secret, viewer-grant configuration or Phase 4 single-session capacity rule. An invalid viewer TTL could be detected only while issuing a grant after Chromium had already been started.

Expected:
A healthy Phase 4 control plane must be capable of authenticating control requests and issuing a usable viewer grant before it creates a browser.

Underlying cause:
Configuration validation initially lived only at the point where individual features consumed each setting.

Corrective action:
Added explicit viewer-grant configuration validation, checks it before session creation, and made health require valid service-auth, worker-control, viewer and Phase 4 capacity configuration in addition to database/worker health.

Regression evidence:
Runs `33868000840` and final `main` run `33869763531` passed with readiness checks enabled.

Status: FIXED / CLOSED.

## SB-004-006 — Inherited Phase 1-3 workflow became stale after Phase 4 promotion

Severity: High.

Observed:
After Phase 4 pull request #2 was promoted to standalone `main`, the full Phase 4 workflow passed in run `33869416309`, but inherited `Verified Through Phase 3` run `33869416366` failed at its static security gate. The old workflow still expected `url-fragment-to-bearer` inside `browser-worker/src/server.mjs` even though Phase 4 intentionally moved viewer-grant issuance to Laravel. Its environment also lacked the new control-plane and worker-control secrets required to boot the Phase 4 Docker topology.

Expected:
Advancing the architecture must not leave the repository with a permanently red historical regression workflow. The inherited gate should continue validating Phase 1-3 security and browser/viewer invariants under the current ownership model.

Underlying cause:
The Phase 4 workflow and E2E harness were updated, but the separate historical Phase 1-3 GitHub Actions workflow retained assumptions about the old grant-issuer location and pre-Phase-4 environment requirements.

Corrective action:
Kept the inherited gate rather than disabling it. Updated the static security assertions to verify loopback CDP, no raw CDP exposure, Laravel grant issuance, URL-fragment-to-bearer transport in `ViewerGrantService`, restrictive CSP, absence of worker-side grant issuance and tool-generic runtime behavior. Added the required Phase 4 CI-only service/worker/viewer configuration.

Regression evidence:
Fix branch head `a58e5eea2ce8377429fc8f843f75e26e342a5f94` passed inherited run `33869567556` and full Phase 4 run `33869567509`. Pull request #3 promoted the fix to `main` at `984378c78fea4dd5c3624ed43eca997e1aff845f`; inherited run `33869763521` and full Phase 4 run `33869763531` both passed, including cleanup and teardown.

Status: FIXED / CLOSED.

## Phase 4 closure

Phase 4 closure conditions are satisfied. The documented branch head passed, the implementation was promoted to standalone `main`, the Phase 4 workflow passed on `main`, the post-promotion inherited workflow defect was fixed and revalidated on `main`, and the production Browser Use baseline was rechecked unchanged at `ea5d39b79d7c3fac9c004ae3dfd6b55ff75df084`.

Status: **PHASE 4 GREEN / COMPLETE / APPROVED. Phase 5 NOT STARTED.**
