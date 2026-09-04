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
1. Thoroughly verified the existing private standalone repository and retained its historical Phase 1-3 branches/runs rather than rewriting history.
2. Created `verified-through-phase3` from standalone `main`.
3. Migrated the repository-verified Phase 1-3 runtime to the standalone repository root.
4. Added one combined standalone Phase 1-3 regression gate.
5. Passed migration CI run `33856736920`, job `100971677159`.
6. Updated the gate to validate both the migration branch and standalone `main`.
7. Passed final migration-branch-head CI run `33857108185`, job `100972852957`.
8. Promoted the validated tree through pull request #1 to standalone `main`, merge commit `5285c7a7a66e88215d5c7817c44b5e340f95f4c7`.
9. Passed the complete combined gate again on standalone `main` in run `33857323898`, job `100973530886`.
10. Rechecked the production application's `main` branch and confirmed it remained at `ea5d39b79d7c3fac9c004ae3dfd6b55ff75df084` during the migration.

Regression coverage:
The standalone CI validates unit/syntax checks, Docker build/boot, API and worker health, generic tool-agnostic runtime behavior, localhost-only worker publication, no raw CDP publication, repeated Chromium lifecycle cleanup, signed restricted viewer authorization/security, JPEG frame capture, mouse/keyboard/scroll interaction, reconnect to the same browser session/PID, unsupported shell input rejection, viewer invalidation after stop, independent Chromium cleanup and full Docker teardown.

Status: FIXED / CLOSED. The standalone repository is now the verified source of truth through Phase 3. Phase 4 may begin from standalone `main`.

## SB-003-001 — Earlier Phase 3 conversational state was not persisted in the verified source branch

Severity: High.

Status: FIXED. Phase 3 was rebuilt from the verified Phase 2 head and fully revalidated rather than relying on conversational status.

## SB-003-002 — Phase 3 generic-runtime grep included a negative test fixture

Severity: Medium.

Status: FIXED. The generic-runtime scan was narrowed to production source directories and the corrected Phase 3 validation passed.
