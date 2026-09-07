# Phase 10 Audit — Multi-tool validation

Status: **IN TEST — deterministic gates green; live authenticated portability externally blocked**.

## Phase anchor

- Current phase: **Phase 10 — Second-tool validation**.
- Last phase marked COMPLETE: **Phase 9 — Authentication-Failure Behaviour**.
- Blueprint: **Master Blueprint v1.1**.
- Verified Phase 10 baseline: standalone `main` at `4cf9966adc4d38ca5695311bc39540e1f281b6a0`.
- Initial implementation branch: `phase10-second-tool-validation`.
- Multi-tool verification branch: `phase10-multi-tool-one-click-auth`.

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


## Authenticated multi-tool portability extension

Phase 10 now validates three non-Phrasly tool profiles through the same generic runtime:

- SneakWrite proves a named external profile that does not require shared authenticated state.
- StealthWriter proves shared-state launch plus URL-based authentication verification.
- ChatGPT proves shared-state launch plus selector-based authentication verification.

StealthWriter and ChatGPT are Phase 10 validation profiles. Their inclusion proves that browser-state injection, authentication latching, operator recovery, writer ownership, viewer fail-closed behavior and cleanup are driven by profile configuration rather than Phrasly-specific runtime branches. This does not integrate the standalone provider into the production website; that remains Phase 15.

### SB-010-004 — Empty Web Storage namespaces failed across the PHP-to-Node transport boundary

Severity: **HIGH / deterministic gate blocker**.

Observed RED evidence:

- run `34031829988` on `e204a180449ec2ed3fd3de039996c9250ed40167`;
- run `34031938360` on `f5033015c573cb84fd3d19f8e434faf3fe565639`;
- run `34048255568` on `96f043cddaac6c94b96732284fee6eb13f09a791`.

The Phase 10 stale StealthWriter state was valid and intentionally localStorage-only. PHP represents an empty decoded JSON object as an empty array. The API first rejected that value as a list; after the API-side correction, its normalized empty array was serialized to the Node worker as `[]`, where the worker rejected it again.

Correction: both generic normalization boundaries now accept only the empty array transport representation as an empty storage map. Non-empty arrays remain invalid. A worker unit regression proves empty-array acceptance and non-empty-array rejection. Production validation was not weakened for non-empty lists.

Status: **FIXED / VERIFIED**.

### SB-010-005 — Worker start timeout raced the configured authentication timeout

Severity: **HIGH / failure-contract blocker**.

Observed RED evidence: run `34048427437` on `074b1c31852dc05e94f408807a9031b3e9e80ce4` returned `WORKER_UNAVAILABLE` after the worker spent the configured 15 seconds proving stale authentication.

Underlying cause: Laravel's generic worker HTTP timeout and the tool profile's authentication-verification timeout were both 15 seconds. The client timed out at the same boundary where the worker needed to return `AUTHENTICATION_NOT_VERIFIED`.

Correction: browser-start request timeout is now derived generically from the profile authentication timeout plus bounded startup/cleanup overhead, capped at 60 seconds. Ordinary worker reads retain the existing 15-second timeout.

Status: **FIXED / VERIFIED**.

### SB-010-006 — Authentication latch preceded cross-tool writer ownership

Severity: **HIGH / ownership-contract blocker**.

Observed RED evidence: run `34048616454` on `fab0c9ee92c8d35df232b2bdca96cffe03a2771a` returned the StealthWriter auth outage to a writer who already owned an active ChatGPT session, instead of rejecting the cross-tool switch with `WRITER_SESSION_ACTIVE`.

Correction: SessionManager now rejects an active writer's cross-tool switch before evaluating the requested tool's auth latch. Same-tool access still evaluates the latch before reuse, so an authentication outage cannot be bypassed and no second Chromium is started.

Status: **FIXED / VERIFIED**.

## Corrected implementation evidence

Candidate head `7625483dbdccd9741408d92694fbe07786e1753b` passed the full Phase 10 composite in run `34048813657`.

Exact verification head `362e650b71bbf85c2a592431a3099989d0b76910` then passed all eight authoritative workflows:

- Verified Through Phase 3 — `34049104655` — SUCCESS;
- Phase 4 Laravel Session API — `34049104646` — SUCCESS;
- Phase 5 Session Isolation — `34049104643` — SUCCESS;
- Phase 6 Lifecycle Management — `34049104664` — SUCCESS;
- Phase 7 Generic Tool Profiles — `34049104642` — SUCCESS;
- Phase 8 Phrasly Reference Implementation — `34049104657` — SUCCESS;
- Phase 9 Authentication-Failure Behaviour — `34049104660` — SUCCESS;
- Phase 10 Second-Tool Validation — `34049104639` — SUCCESS.

The Phase 10 workflow proves SneakWrite, StealthWriter and ChatGPT through the same generic API/worker/viewer lifecycle, including shared-state requirements, rejection of writer credentials, independent per-tool auth outages, URL- and selector-based verification, reuse without state retransmission, cross-tool ownership, live-auth-loss fail-closed behavior, operator recovery, sensitive-log scans and zero browser/profile residue.

## Final technical gate

Blueprint exit gate: **“Provider is demonstrably general-purpose, not Phrasly-only.”**

Result under the repository's deterministic CI criterion: **SATISFIED / TECHNICALLY GREEN**.

The owner additionally requires a real third-party account to complete authenticated-state capture and reuse before Phase 10 can be approved. That stronger live criterion is not satisfied. Phase 10 is not COMPLETE, and Phase 11 has not started.

## Owner-operated live-account audit — 2026-09-07

Live validation was performed on branch head `3de398c3538509a1bee75dea8909dfd9f6a52160` after the following generic corrections were implemented and regression-tested:

- multi-host state export retained allowed-domain cookies required by profiles such as ChatGPT;
- headed virtual-display startup installed the required Xvfb authentication dependency;
- navigation became readiness-based with explicit safe failure stages and aligned request/startup time budgets;
- the live harness gained progress output and Windows viewer auto-open behavior;
- administrator bootstrap viewer grants received a bounded 900-second lifetime while ordinary writer grants remained 300 seconds.

All eight authoritative workflows passed on exact head `3de398c3538509a1bee75dea8909dfd9f6a52160`:

- Phase 1–3 `34075450744`;
- Phase 4 `34075450739`;
- Phase 5 `34075450741`;
- Phase 6 `34075450753`;
- Phase 7 `34075450869`;
- Phase 8 `34075450748`;
- Phase 9 `34075450751`;
- Phase 10 `34075450745`.

### ChatGPT live result

The protected viewer launched ChatGPT and accepted owner interaction. After account sign-in was attempted, the provider returned an HTML security challenge where the authentication route expected its normal response, including `Route Error (400 Invalid content type: text/html; charset=UTF-8)`. The subsequent `auth.openai.com` Cloudflare human-verification challenge repeatedly failed inside the self-hosted Chromium. No authenticated state was captured or reused.

Result: **BLOCKED BY PROVIDER SECURITY VERIFICATION**.

### StealthWriter live result

The protected viewer launched the StealthWriter sign-in page and accepted owner interaction. Its embedded Cloudflare challenge returned **Verification failed** after credentials were entered. No authenticated state was captured or reused.

Result: **BLOCKED BY PROVIDER SECURITY VERIFICATION**.

No challenge bypass, fingerprint spoofing, cookie extraction from an unrelated browser, credential logging or security-control weakening was attempted. Repeated retries are stopped because they cannot provide legitimate phase evidence and may increase provider risk scoring.

### Live gate disposition

- generic multi-tool architecture and deterministic authenticated-state behavior — **PASS**;
- unauthenticated live launch/viewer interaction for ChatGPT and StealthWriter — **PASS**;
- authenticated live state capture and fresh-browser reuse for ChatGPT — **NOT VERIFIED / EXTERNALLY BLOCKED**;
- authenticated live state capture and fresh-browser reuse for StealthWriter — **NOT VERIFIED / EXTERNALLY BLOCKED**.

### Desktop administrator bootstrap remediation

The live harness now has a generic Windows desktop-bootstrap companion for providers that reject containerized Chromium. It launches a dedicated normal Google Chrome profile on the administrator's desktop without an automation extension, permits the administrator to complete the legitimate provider login/challenge directly, and captures only cookies and Web Storage whose hosts match the configured tool allowlist. It never accepts account credentials or OTP values.

The captured state is written only to a per-user ACL-restricted temporary directory, is consumed and deleted immediately by the existing operator harness, and is then tested in a fresh self-hosted Chromium through the unchanged backend authentication, viewer, ownership, reuse and cleanup gates. The dedicated Chrome process/profile and any residual temporary state are removed on completion or failure. Raw state and runtime secrets are not printed.

This is a human-in-the-loop session bootstrap, not challenge automation or circumvention. It preserves the provider's requirement that the administrator personally completes verification.

Phase 10 remains **IN TEST** until this desktop bootstrap produces a successful fresh-container authenticated-state and reuse proof for at least one requested real provider. A deterministic-only exception is no longer the primary remediation path.

**STATUS: IN TEST — DESKTOP LIVE PROOF REQUIRED**
