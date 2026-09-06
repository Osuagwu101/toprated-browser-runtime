# Phase 9 Audit — Authentication-Failure Behaviour

Status: **TECHNICALLY GREEN / AWAITING OWNER APPROVAL**, subject to the final documentation-head exact-CI validation described below.

## Phase anchor

- Current phase: **Phase 9 — Authentication-Failure Behaviour**
- Last phase marked COMPLETE: **Phase 8 — Phrasly Reference Implementation**
- Blueprint: **Master Blueprint v1.1**
- Phase 9 implementation baseline: standalone `main` at `3eeb19c8ed4dea682b985908ea5e18a35303ae47`
- Final tested implementation branch head: `71b0d1852a073a9e5a258abde1116abcaa7c3bac`
- Promoted technical `main` head: `71b0d1852a073a9e5a258abde1116abcaa7c3bac`

Blueprint exit gate:

> **Failure behaviour matches the admin-only authentication model.**

Phase 9 owns what happens when already-authorized shared tool state is no longer accepted. It does not own Phase 15 production-provider integration, a production admin dashboard, or any mechanism that gives writers credentials, OTPs, raw saved state, service secrets or operator secrets.

## Admin-only authentication model verified

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

Underlying cause: the standalone runtime had durable browser-session lifecycle state but no metadata-only authentication availability state keyed by tool profile. Phase 8 rejection was request-local, so a later writer could attempt the same stale shared state and spawn another browser.

Correction: `tool_auth_states` stores only tool slug, status, safe reason code and timestamps; authentication-required launches consult the latch before browser capacity or Chromium creation; initial authentication failure sets `reauth_required` and returns `TOOL_REAUTH_REQUIRED` / HTTP 423; later writers fail fast until operator restoration; a later verified launch records the tool ready again.

Status: **FIXED / VERIFIED / CLOSED**.

### SB-009-002 — An already-open viewer could outlive tool authentication

Severity: **BLOCKER**

Underlying cause: Phase 8 authentication verification was a launch-time predicate, not a continuing writer-viewability predicate.

Correction: the worker retains the normalized generic authentication policy for stateful sessions; private status refreshes the current authentication result for Laravel; restricted viewer status/frame/input paths re-evaluate configured authentication indicators; live loss returns `TOOL_REAUTH_REQUIRED` / HTTP 423 before content or input; the viewer removes the frame and shows only the safe administrator-refresh state; Laravel latches the outage and terminates the exact failed browser.

Status: **FIXED / VERIFIED / CLOSED**.

### SB-009-003 — No separate administrator/operator recovery boundary existed

Severity: **BLOCKER**

Underlying cause: Phase 8 intentionally stopped at verifying supplied authorized state and deferred administrator reauthentication failure/recovery behavior to Phase 9.

Correction: a distinct `RUNTIME_OPERATOR_AUTH_SECRET` protects `/api/operator/tool-auth/...`; service/writer HMAC authorization does not grant operator authority; missing/wrong operator authorization is rejected; restore requests must have an empty body and reject password/OTP/verification payloads; operator status exposes safe metadata only.

Status: **FIXED / VERIFIED / CLOSED**.

### SB-009-004 — Phase 8 inherited failure assertion exposed a lower-level code that Phase 9 intentionally replaces

Severity: **MAJOR / regression-harness compatibility**

Underlying cause: Phase 8 correctly expected `TOOL_AUTH_NOT_VERIFIED` / HTTP 409 before Phase 9 owned the safe administrator-reauth behavior. Retaining that exact public error would contradict Phase 9 while the underlying Phase 8 security invariant remained required.

Correction: the inherited Phase 8 test still requires invalid state to receive no viewer and leave no live worker browser, but now expects `TOOL_REAUTH_REQUIRED` / HTTP 423. No authentication, cleanup or state-secrecy assertion was removed.

Status: **FIXED / VERIFIED / CLOSED**.

## Deterministic verification

`tests/phase9-e2e.py` verifies stale saved state, shared outage latching, second-writer fast blocking before Chromium, operator authorization, rejection of OTP-bearing recovery, credential-free operator restore, authenticated launch after restore, forced mid-session authentication loss, viewer status/frame blocking, Laravel outage observation and exact browser cleanup, refreshed-state recovery, and final zero open/worker sessions.

The Phase 9 composite additionally executes the full Phase 1–3 browser/viewer behavioral regression, Phase 4 ownership, Phase 5 isolation, Phase 7 generic profiles, Phase 8 shared-state/no-viewer guarantees, the Phase 6 12-iteration orphan/reaper race stress test, the unchanged Phase 6 lifecycle/restart regression, browser/profile residue scans and terminal durable-record checks.

## Exact branch evidence

Final implementation branch SHA: `71b0d1852a073a9e5a258abde1116abcaa7c3bac`.

All seven authoritative workflows passed on that exact branch head:

- Verified Through Phase 3 — run `34026692384` — SUCCESS;
- Phase 4 Laravel Session API — run `34026692353` — SUCCESS;
- Phase 5 Session Isolation — run `34026692285` — SUCCESS;
- Phase 6 Lifecycle Management — run `34026692336` — SUCCESS;
- Phase 7 Generic Tool Profiles — run `34026692436` — SUCCESS;
- Phase 8 Phrasly Reference Implementation — run `34026692265` — SUCCESS;
- Phase 9 Authentication-Failure Behaviour — run `34026692343` — SUCCESS.

## Exact promoted technical-main evidence

The tested branch was promoted by controlled fast-forward, without force, to exact technical `main` SHA `71b0d1852a073a9e5a258abde1116abcaa7c3bac`.

All seven authoritative workflows passed again on that exact `main` head:

- Verified Through Phase 3 — run `34027018121` — SUCCESS;
- Phase 4 Laravel Session API — run `34027018130` — SUCCESS;
- Phase 5 Session Isolation — run `34027018106` — SUCCESS;
- Phase 6 Lifecycle Management — run `34027018149` — SUCCESS;
- Phase 7 Generic Tool Profiles — run `34027018132` — SUCCESS;
- Phase 8 Phrasly Reference Implementation — run `34027018083` — SUCCESS;
- Phase 9 Authentication-Failure Behaviour — run `34027018178` — SUCCESS.

## Standing invariant check

1. Browser Use preserved — **PASS**: work remains in the standalone repository; no Phase 15 production integration was introduced.
2. Separation maintained — **PASS**.
3. Generic core — **PASS**: generic-core CI scan remains green; no Phrasly branch was added to reusable infrastructure.
4. Credentials never reach writers — **PASS**: writer credential fields remain rejected; live viewer fails closed on auth loss.
5. No raw CDP / unrestricted DevTools — **PASS**.
6. Portability — **PASS**: Linux + Docker configuration only.
7. Fixed-cost architecture — **PASS**.
8. Logging policy — **PASS**: Phase 9 runtime log scans reject state/OTP/operator-secret markers.
9. Spend discipline — **PASS**.
10. Session isolation — **PASS / inherited Phase 5 regression green**.
11. Active sessions protected — **PASS / inherited Phase 6 regression green**.
12. Abandoned sessions die — **PASS / inherited Phase 6 stress and lifecycle regressions green**.
13. Capacity configurable — **PASS**; empirical capacity remains Phase 18.
14. Rollback preserved — **N/A — FUTURE PHASE 15/19**; production Browser Use remains untouched.

## Gate status

The Phase 9 exit gate is technically satisfied on the tested branch and promoted technical `main` head. This closure commit also removes the temporary Phase 9 branch trigger from inherited workflows while retaining their `main` triggers and the distinct CI-only operator secret. Under the engineering contract, the documentation/closure head must itself pass all applicable authoritative workflows before this record becomes the final technical closure state.

If that final exact-head validation is green, Phase 9 status is **TECHNICALLY GREEN / AWAITING OWNER APPROVAL**. Phase 10 remains **NOT STARTED** until explicit owner approval of Phase 9 completion.
