# Phase 10 Audit — Second-tool validation (SneakWrite)

Status: **IN TEST**.

## Phase anchor

- Current phase: **Phase 10 — Second-tool validation**.
- Last phase marked COMPLETE: **Phase 9 — Authentication-Failure Behaviour**.
- Blueprint: **Master Blueprint v1.1**.
- Verified Phase 10 baseline: standalone `main` at `4cf9966adc4d38ca5695311bc39540e1f281b6a0`.
- Isolated implementation branch: `phase10-second-tool-validation`.

Blueprint exit gate:

> **Provider is demonstrably general-purpose, not Phrasly-only.**

The roadmap label says “Steno Writer”, but no `Steno Writer` entity exists in the verified repositories. The current customer-facing catalogue contains **SneakWrite**, slug `sneakwrite`, domain `sneakwrite.net`, alongside Phrasly and Stealthwriter. The production settings identify `https://sneakwrite.net` as its official login URL, with one-click authentication disabled, and the old ticket-based SneakWrite SSO route is an inert 404 tombstone. Phase 10 therefore uses SneakWrite as the verified second-tool target. This is a naming correction within the tool-agnostic Phase 10 gate, not a change to provider architecture or production integration.

Phase 15 remains the owner of production provider integration. Phase 10 does not modify the production site, introduce SneakWrite credentials/SSO, or make Browser Use coexistence changes.

## Audit findings

### SB-010-001 — Standalone runtime had no configured real second external tool

Severity: **BLOCKER / gate blocker**.

Observed baseline: the generic tool registry supported arbitrary profiles, but the only enabled real external customer tool was Phrasly (plus the Phrasly administrator bootstrap profile). Other profiles were deterministic regressions.

Underlying cause: Phase 7 proved generic configuration mechanics and Phase 8/9 intentionally concentrated on Phrasly; a second real customer tool was deliberately deferred to Phase 10.

Correction: add a server-owned `sneakwrite` profile pointing at the verified official `https://sneakwrite.net` destination. The profile neither requires nor accepts a new writer credential path; authentication remains unset because the current product setting has one-click authentication disabled.

Status: **FIXED / VERIFIED** by complete composite run `34029854074` on implementation head `b17e73aef011903f7e0e74bf041b947c798eb262`; final promotion-head revalidation remains required.

### SB-010-002 — No deterministic second-tool provider acceptance existed

Severity: **BLOCKER / gate blocker**.

Observed baseline: Phase 7 proved a generic configured data-URL tool and Phase 8/9 proved Phrasly-state semantics, but no acceptance test exercised a named non-Phrasly customer tool through session creation, restricted viewer, reuse, ownership and cleanup.

Underlying cause: second-tool portability validation is Phase 10 scope.

Correction: add a deterministic SneakWrite fixture used only by Phase 10 CI. CI copies the committed profile set and substitutes only the SneakWrite network destination with the loopback fixture. The production/default profile remains `https://sneakwrite.net`. The test then launches the `sneakwrite` slug through the unchanged generic runtime, verifies the restricted viewer, same-writer reuse, cross-tool ownership, credential rejection, a subsequent different profile launch and zero remaining browser sessions.

Status: **FIXED / VERIFIED** by complete composite run `34029854074` on implementation head `b17e73aef011903f7e0e74bf041b947c798eb262`; final promotion-head revalidation remains required.

### SB-010-003 — Docker runtime did not propagate the already-supported tool-profile path override

Severity: **MAJOR / deterministic-verification support**.

Observed baseline: Laravel configuration supported `TOOL_PROFILES_PATH`, but `docker-compose.yml` did not pass that environment variable into the API or lifecycle-reaper containers.

Underlying cause: profile-path configurability existed at application level but was omitted from the container environment contract.

Correction: propagate `TOOL_PROFILES_PATH` with the existing default `/srv/runtime-api/config/tool-profiles.json` into both API and lifecycle-reaper services. No production path changes unless an operator explicitly overrides the variable.

Status: **FIXED / VERIFIED** by readiness plus inherited lifecycle/reaper execution in run `34029854074`; final promotion-head revalidation remains required.

## First complete composite evidence

Implementation head `b17e73aef011903f7e0e74bf041b947c798eb262` passed Phase 10 Second-Tool Validation run `34029854074` end to end.

Verified in that run:

- deterministic Phase 10 profile preparation — PASS;
- repository type/syntax and static/unit gates — PASS;
- real container build/readiness — PASS;
- inherited Phase 1–3 browser/viewer regression — PASS;
- inherited Phase 4 ownership regression — PASS;
- inherited Phase 5 isolation regression — PASS;
- inherited Phase 7 generic-profile regression — PASS;
- inherited Phase 8 shared-state/no-viewer regression — PASS;
- inherited Phase 9 admin-only authentication-failure regression — PASS;
- metadata-only auth persistence / sensitive-log scan — PASS;
- deterministic SneakWrite fixture — PASS;
- `tests/phase10-e2e.py` second-tool provider path — PASS;
- SneakWrite credential-marker log scan — PASS;
- clean worker boundary — PASS;
- autonomous Phase 6 reaper — PASS;
- permanent 12-iteration orphan/reaper race stress — PASS;
- unchanged Phase 6 lifecycle/restart regression — PASS;
- browser/profile residue scan — PASS;
- durable terminal-record check — PASS;
- teardown — PASS.

This is strong implementation evidence, but it is not yet the final branch/main promotion evidence required by the engineering contract.

## Verification requirements

Phase 10 is not green merely because the profile exists. The authoritative Phase 10 workflow must prove on real containers that:

1. the committed default `sneakwrite` profile retains the real `https://sneakwrite.net` destination;
2. the deterministic CI substitution changes only test-time network reachability, not generic runtime code;
3. a `sneakwrite` session reaches the restricted viewer through the same generic API/worker path;
4. writers cannot submit SneakWrite passwords/OTP/verification material;
5. caller launch-URL override remains rejected;
6. same-writer/profile reuse and cross-tool ownership rules remain intact;
7. the same runtime can subsequently launch another profile without restart or tool-specific branching;
8. no `phrasly` or `sneakwrite` branching appears in reusable runtime core;
9. inherited Phase 1–9 regressions remain green;
10. Phase 6 race/lifecycle, terminal-record and residue cleanup gates remain green.

## Standing invariant check after first execution

1. Browser Use preserved — **PASS / production repository inspected read-only only**.
2. Separation maintained — **PASS**.
3. Generic core — **PASS**: production source scan rejects both `phrasly` and `sneakwrite` names in generic core.
4. Credentials never reach writers — **PASS**: second-tool credential submission is rejected and marker absent from logs.
5. No raw CDP / unrestricted DevTools — **PASS**.
6. Portability — **PASS**.
7. Fixed-cost architecture — **PASS**.
8. Logging policy — **PASS**.
9. Spend discipline — **PASS**.
10. Session isolation — **PASS / inherited Phase 5 regression green**.
11. Active sessions protected — **PASS / inherited Phase 6 regression green**.
12. Abandoned sessions die — **PASS / orphan-race stress and lifecycle regressions green**.
13. Capacity configurable — **PASS; empirical capacity remains Phase 18**.
14. Rollback preserved — **N/A — FUTURE PHASE 15/19**.

## Current gate status

The implementation has passed one complete composite execution. The documentation update changes the branch head, so the Phase 10 workflow must pass again on the resulting exact branch SHA before promotion. After promotion, all authoritative workflows must pass on the resulting `main` head. Phase 10 remains **IN TEST** until those gates are complete.

**STATUS: IN TEST**
