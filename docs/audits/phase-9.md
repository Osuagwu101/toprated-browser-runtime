# Phase 9 Audit — Authentication-Failure Behaviour

Status: **IN TEST**

## Phase anchor

- Current phase: **Phase 9 — Authentication-Failure Behaviour**
- Last phase marked COMPLETE: **Phase 8 — Phrasly Reference Implementation**, owner-approved and final exact-head closure verified 2026-09-06
- Blueprint: **Master Blueprint v1.1**
- Verified Phase 9 baseline: standalone `main` at `3eeb19c8ed4dea682b985908ea5e18a35303ae47`
- Implementation branch: `phase9-auth-failure-behaviour`

Blueprint exit gate:

> **Failure behaviour matches the admin-only authentication model.**

Phase 9 owns what happens when already-authorized shared tool state is no longer accepted. It does not own Phase 15 production-provider integration, a production admin dashboard, or any mechanism that gives writers credentials, OTPs, raw saved state, service secrets or operator secrets.

## Admin-only authentication model being enforced

When an authentication-required tool no longer accepts the saved state:

1. the failed browser receives no usable writer viewer;
2. the tool is latched `reauth_required` in metadata-only runtime state;
3. later writer launches for that tool fail fast before another Chromium is created;
4. writers receive only a safe temporary-unavailability response;
5. writers cannot submit passwords, OTPs or verification codes;
6. an already-open restricted viewer that loses authentication stops returning status/frame/input content before a writer can interact with a login or verification page;
7. only the private runtime operator boundary can acknowledge that administrator reauthentication has restored the upstream saved state; and
8. a fresh stateful launch must still pass the normal Phase 8 authentication verification before writer access resumes.

The operator restore control accepts no tool credential, OTP, verification code or browser state. Actual account authentication remains an administrator action; Phase 9 only controls failure/recovery state in the standalone runtime.

## Audit findings

### SB-009-001 — Authentication failure had no durable shared outage latch

Severity: **BLOCKER**

Observed baseline behaviour: Phase 8 correctly rejected a syntactically valid state that did not reach the configured authenticated indicator and returned `TOOL_AUTH_NOT_VERIFIED`, but the rejection was request-local. A later writer could attempt the same stale shared state again and spawn another browser.

Underlying cause: the standalone runtime had durable browser-session lifecycle state but no metadata-only authentication availability state keyed by tool profile.

Correction implemented:

- `tool_auth_states` stores only tool slug, status, safe reason code and timestamps;
- authentication-required launches consult the latch before browser capacity or Chromium creation;
- initial authentication verification failure sets `reauth_required` and returns `TOOL_REAUTH_REQUIRED` / HTTP 423;
- subsequent writers fail fast with the same safe response until operator restoration;
- successful verified launch records the tool ready/verified again.

Status: **IMPLEMENTED / EXECUTION VERIFICATION IN PROGRESS**.

### SB-009-002 — An already-open viewer could outlive tool authentication

Severity: **BLOCKER**

Observed baseline behaviour: Phase 8 verified authentication before the first viewer grant, but later viewer frame/status/input requests checked only viewer-token authorization. If the upstream website invalidated the saved account session after launch, the worker could navigate to a login or verification page while the writer viewer remained interactive.

Underlying cause: authentication verification was a launch-time predicate, not a continuing writer-viewability predicate.

Correction implemented:

- the worker keeps the normalized generic authentication policy for each stateful worker session;
- private worker status refreshes the current authentication result for Laravel without exposing login content;
- restricted viewer status, frame and input paths re-evaluate the configured authentication indicators before returning content or accepting input;
- live authentication loss returns `TOOL_REAUTH_REQUIRED` / HTTP 423 before a frame or input operation;
- the viewer removes the frame and displays only the safe administrator-refresh message;
- Laravel observes `authentication.verified=false`, latches the tool outage and terminates the exact failed browser.

Status: **IMPLEMENTED / EXECUTION VERIFICATION IN PROGRESS**.

### SB-009-003 — No separate administrator/operator recovery boundary existed

Severity: **BLOCKER**

Observed baseline behaviour: the temporary Phase 8 admin-authentication harness was narrowly approved for obtaining the live Phrasly state, but the standalone control plane had no durable operator-only recovery state for the general Phase 9 failure model.

Underlying cause: Phase 8 intentionally stopped at verifying supplied authorized state; administrator reauthentication behaviour was deferred to Phase 9.

Correction implemented:

- a separate `RUNTIME_OPERATOR_AUTH_SECRET` protects `/api/operator/tool-auth/...` controls;
- service/writer HMAC authorization does not grant operator recovery authority;
- missing/wrong operator authorization is rejected;
- restore requests must have an empty body and reject password/OTP/verification payloads;
- operator status exposes only safe metadata and never raw cookies, storage, headers or credentials.

Status: **IMPLEMENTED / EXECUTION VERIFICATION IN PROGRESS**.

### SB-009-004 — Phase 8 inherited failure assertion exposed a lower-level code that Phase 9 must intentionally replace

Severity: **MAJOR / regression-harness compatibility**

Observed baseline behaviour: `tests/phase8-e2e.py` required the unverified-state request to return `TOOL_AUTH_NOT_VERIFIED` / HTTP 409.

Underlying cause: that was correct while Phase 8 explicitly deferred the admin-reauth experience. Keeping that exact public error in Phase 9 would contradict the new safe admin-only failure contract even though the Phase 8 security invariant remains valid.

Correction implemented: the inherited Phase 8 test still requires the invalid state to receive no viewer and leave no live worker browser, but now expects `TOOL_REAUTH_REQUIRED` / HTTP 423. No Phase 8 authentication, cleanup or state-secrecy assertion was removed.

Status: **IMPLEMENTED / BRANCH VALIDATION REQUIRED**.

## Deterministic Phase 9 verification target

`tests/phase9-e2e.py` exercises both failure surfaces:

- stale saved state at session creation;
- shared outage latching;
- second writer blocked before Chromium;
- operator endpoint denied without the operator secret;
- operator restore rejecting an OTP-bearing request body;
- successful credential-free operator restore;
- authenticated browser launch after restore;
- forced mid-session navigation to an unauthenticated fixture path;
- viewer status and frame blocked with 423 before login content is exposed;
- normal service reuse observing live auth loss, latching the outage and cleaning the exact browser;
- refreshed-state recovery; and
- final zero open/worker sessions.

The Phase 9 workflow also preserves Phase 4 ownership, Phase 5 isolation, Phase 7 generic-profile behaviour, Phase 8 state-injection/no-viewer guarantees, the Phase 6 orphan-creation/reaper stress regression, the unchanged Phase 6 lifecycle suite, residue scans and terminal durable records.

## Standing invariant check — current implementation review

1. Browser Use preserved — **PASS**: work remains in standalone repository.
2. Separation maintained — **PASS**: no Phase 15 production-provider integration.
3. Generic core — **PASS by inspection; CI gate pending**: no Phrasly branch added to reusable runtime code.
4. Credentials never reach writers — **PASS by design; E2E pending**: writer credential fields remain rejected; viewer is blocked on auth loss.
5. No raw CDP / unrestricted DevTools — **PASS by inherited design; CI pending**.
6. Portability — **PASS by inspection; CI pending**: Linux + Docker configuration only.
7. Fixed-cost architecture — **PASS**: no usage-metered browser dependency added.
8. Logging policy — **IN TEST**: Phase 9 workflow scans runtime logs for state/OTP/operator-secret markers.
9. Spend discipline — **PASS**: no purchase recommendation or infrastructure spend introduced.
10. Session isolation — **INHERITED / CI PENDING**.
11. Active sessions protected — **INHERITED / CI PENDING**.
12. Abandoned sessions die — **INHERITED / CI PENDING**.
13. Capacity configurable — **PASS**: no concurrency model change; empirical capacity remains Phase 18.
14. Rollback preserved — **N/A — FUTURE PHASE 15/19** for provider coexistence/rollback; production Browser Use remains untouched now.

## Gate status

The Phase 9 implementation exists but is not yet technically green. Required real execution evidence is in progress. Phase 9 must not be marked COMPLETE or promoted merely from code inspection.
