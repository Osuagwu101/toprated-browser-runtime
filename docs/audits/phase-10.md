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

Status: **IMPLEMENTED, UNVERIFIED** until exact-head execution passes.

### SB-010-002 — No deterministic second-tool provider acceptance existed

Severity: **BLOCKER / gate blocker**.

Observed baseline: Phase 7 proved a generic configured data-URL tool and Phase 8/9 proved Phrasly-state semantics, but no acceptance test exercised a named non-Phrasly customer tool through session creation, restricted viewer, reuse, ownership and cleanup.

Underlying cause: second-tool portability validation is Phase 10 scope.

Correction: add a deterministic SneakWrite fixture used only by Phase 10 CI. CI copies the committed profile set and substitutes only the SneakWrite network destination with the loopback fixture. The production/default profile remains `https://sneakwrite.net`. The test then launches the `sneakwrite` slug through the unchanged generic runtime, verifies the restricted viewer, same-writer reuse, cross-tool ownership, credential rejection, a subsequent different profile launch and zero remaining browser sessions.

Status: **IMPLEMENTED, UNVERIFIED** until exact-head execution passes.

### SB-010-003 — Docker runtime did not propagate the already-supported tool-profile path override

Severity: **MAJOR / deterministic-verification support**.

Observed baseline: Laravel configuration supported `TOOL_PROFILES_PATH`, but `docker-compose.yml` did not pass that environment variable into the API or lifecycle-reaper containers.

Underlying cause: profile-path configurability existed at application level but was omitted from the container environment contract.

Correction: propagate `TOOL_PROFILES_PATH` with the existing default `/srv/runtime-api/config/tool-profiles.json` into both API and lifecycle-reaper services. No production path changes unless an operator explicitly overrides the variable.

Status: **IMPLEMENTED, UNVERIFIED** until exact-head execution passes.

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

## Standing invariant check before execution

1. Browser Use preserved — **PASS / read-only production inspection only**.
2. Separation maintained — **PASS**.
3. Generic core — **PASS by code audit; execution pending**.
4. Credentials never reach writers — **PASS by design; negative execution pending**.
5. No raw CDP / unrestricted DevTools — **PASS / inherited guard retained**.
6. Portability — **PASS**.
7. Fixed-cost architecture — **PASS**.
8. Logging policy — **PASS by design; execution scan pending**.
9. Spend discipline — **PASS**.
10. Session isolation — **PASS inherited baseline; Phase 10 rerun pending**.
11. Active sessions protected — **PASS inherited baseline; Phase 10 rerun pending**.
12. Abandoned sessions die — **PASS inherited baseline; Phase 10 rerun pending**.
13. Capacity configurable — **PASS; empirical capacity remains Phase 18**.
14. Rollback preserved — **N/A — FUTURE PHASE 15/19**.

## Current gate status

Implementation exists on the isolated branch but has not yet earned exact-head execution evidence.

**STATUS: IN TEST**
