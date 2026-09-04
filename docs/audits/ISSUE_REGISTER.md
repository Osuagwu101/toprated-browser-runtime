# Self-Hosted Browser Issue Register

Material issues use IDs `SB-PHASE-SEQUENCE`. Critical and High issues block phase advancement until fixed and regression-tested.

## SB-001-001 — Standalone repository topology was not being used as the verified source of truth

Severity: High.

Observed:
The required private repository `Osuagwu101/toprated-browser-runtime` already existed and contained earlier Phase 1-3 attempts, but the latest verified Phase 1-3 implementation and green Phase 3 branch-head evidence were still being developed under `self-hosted-browser-runtime/` on branches in the main Top Rated SEO Tools repository.

Expected:
The Master Blueprint requires the self-hosted runtime to live and validate independently in its own repository before Phase 4 adds the Laravel session API.

Underlying cause:
Repository continuity/evidence handling was inconsistent across earlier phase work. The repository itself was not absent; the previous audit language incorrectly treated repository creation as the unresolved blocker instead of checking the existing standalone repository and its validation state.

Corrective action:
Create `verified-through-phase3` from standalone `main`, migrate the verified Phase 3 runtime to repository root, retain historical branches, run a combined Phase 1-3 regression gate in the standalone repository, then merge the validated tree to standalone `main`.

Status: OPEN until the migration branch CI is green and the validated branch is promoted to standalone `main`.

## SB-003-001 — Earlier Phase 3 conversational state was not persisted in the verified source branch

Severity: High. Status: FIXED in the source implementation by rebuilding Phase 3 from the verified Phase 2 head and rerunning CI.

## SB-003-002 — Phase 3 generic-runtime grep included a negative test fixture

Severity: Medium. Status: FIXED. The scan was narrowed to production source directories and the corrected source Phase 3 CI passed.
