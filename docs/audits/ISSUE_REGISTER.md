# Self-Hosted Browser Issue Register

Material issues use IDs `SB-PHASE-SEQUENCE`. Critical and High issues block phase advancement until fixed and regression-tested.

## SB-001-001 — Standalone repository topology was not being used as the verified source of truth

Severity: High.

Observed:
The required private repository `Osuagwu101/toprated-browser-runtime` already existed and contained earlier Phase 1-3 attempts, but the latest verified Phase 1-3 implementation and green Phase 3 branch-head evidence were still being developed under `self-hosted-browser-runtime/` on branches in the main Top Rated SEO Tools repository.

Expected:
The Master Blueprint requires the self-hosted runtime to live and validate independently in its own repository before Phase 4 adds the Laravel session API.

Underlying cause:
Repository continuity and evidence handling were inconsistent across earlier phase work. The repository itself was not absent; the earlier audit language incorrectly treated repository creation as the unresolved blocker instead of checking the existing standalone repository and its validation state.

Corrective action completed so far:
1. Verified the existing private standalone repository and preserved its historical Phase 1-3 branches.
2. Created `verified-through-phase3` from standalone `main`.
3. Migrated the repository-verified Phase 1-3 runtime to the standalone repository root.
4. Added a combined Phase 1-3 standalone regression workflow.
5. Passed GitHub Actions run `33856736920` on migration commit `cf098191fbaaa9304714613ae6ad127b408c60b8`.
6. Extended the validation workflow to run on standalone `main` after promotion.

Regression result:
Migration-branch gate is GREEN. The combined CI validated unit/syntax checks, Docker build/boot, health contracts, generic runtime behavior, localhost-only worker publication, no raw CDP publication, repeated Chromium lifecycle cleanup, restricted viewer authorization/security, JPEG frame capture, mouse/keyboard/scroll interaction, reconnect to the same session/PID, viewer invalidation after stop, independent Chromium cleanup, and Docker teardown.

Status: FIX IN PROGRESS — migration implementation and branch regression are GREEN; closure requires promotion of the validated tree to standalone `main` and a fresh GREEN CI run on that final `main` head. Phase 4 remains blocked until that final gate passes.

## SB-003-001 — Earlier Phase 3 conversational state was not persisted in the verified source branch

Severity: High.

Status: FIXED in the source implementation by rebuilding Phase 3 from the verified Phase 2 head and rerunning CI.

## SB-003-002 — Phase 3 generic-runtime grep included a negative test fixture

Severity: Medium.

Status: FIXED. The scan was narrowed to production source directories and the corrected source Phase 3 CI passed.
