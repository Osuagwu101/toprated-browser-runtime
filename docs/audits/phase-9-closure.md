# Phase 9 Completion Certificate — Authentication-Failure Behaviour

Exit gate (Master Blueprint v1.1):

> **Failure behaviour matches the admin-only authentication model.**

## Verified implementation heads

- Final tested branch head: `71b0d1852a073a9e5a258abde1116abcaa7c3bac`
- Promoted technical `main` head: `71b0d1852a073a9e5a258abde1116abcaa7c3bac`
- Final technical documentation/closure `main` head: `808d2411a34a26c438fc46d3e4b8fb6c45c16f39`

## Gate evidence

| Gate requirement | Verified evidence | Result |
| --- | --- | --- |
| Stale saved authentication state fails safely | `tests/phase9-e2e.py` returns safe `TOOL_REAUTH_REQUIRED` behavior and no writer viewer | PASS |
| Shared authentication outage is latched | later writers are blocked before another Chromium is created | PASS |
| Writers do not receive credentials or OTP handling | writer credential submission remains rejected; operator restore accepts no credential/OTP body | PASS |
| Live authentication loss fails closed | restricted viewer status/frame/input re-check authentication and block content/input with 423 | PASS |
| Recovery is administrator/operator only | distinct `RUNTIME_OPERATOR_AUTH_SECRET`; service/writer HMAC does not grant restore authority | PASS |
| Recovery still requires fresh authenticated state | post-restore stateful launch must pass normal Phase 8 authentication verification | PASS |
| Authentication state persistence is safe | `tool_auth_states` contains metadata only; runtime log scans reject state/OTP/operator-secret markers | PASS |
| Failed browsers are cleaned | Phase 8/9 E2E and final residue/terminal-record checks pass | PASS |

## Exact branch-head workflows

All seven authoritative workflows passed on branch SHA `71b0d1852a073a9e5a258abde1116abcaa7c3bac`:

- Verified Through Phase 3 — `34026692384` — SUCCESS
- Phase 4 Laravel Session API — `34026692353` — SUCCESS
- Phase 5 Session Isolation — `34026692285` — SUCCESS
- Phase 6 Lifecycle Management — `34026692336` — SUCCESS
- Phase 7 Generic Tool Profiles — `34026692436` — SUCCESS
- Phase 8 Phrasly Reference Implementation — `34026692265` — SUCCESS
- Phase 9 Authentication-Failure Behaviour — `34026692343` — SUCCESS

## Exact promoted technical-main workflows

All seven authoritative workflows passed again on technical `main` SHA `71b0d1852a073a9e5a258abde1116abcaa7c3bac`:

- Verified Through Phase 3 — `34027018121` — SUCCESS
- Phase 4 Laravel Session API — `34027018130` — SUCCESS
- Phase 5 Session Isolation — `34027018106` — SUCCESS
- Phase 6 Lifecycle Management — `34027018149` — SUCCESS
- Phase 7 Generic Tool Profiles — `34027018132` — SUCCESS
- Phase 8 Phrasly Reference Implementation — `34027018083` — SUCCESS
- Phase 9 Authentication-Failure Behaviour — `34027018178` — SUCCESS

## Exact final documentation/closure-head workflows

All seven authoritative workflows passed on final documentation/closure `main` SHA `808d2411a34a26c438fc46d3e4b8fb6c45c16f39`:

- Verified Through Phase 3 — `34027609813` — SUCCESS
- Phase 4 Laravel Session API — `34027609862` — SUCCESS
- Phase 5 Session Isolation — `34027609821` — SUCCESS
- Phase 6 Lifecycle Management — `34027609864` — SUCCESS
- Phase 7 Generic Tool Profiles — `34027609795` — SUCCESS
- Phase 8 Phrasly Reference Implementation — `34027609823` — SUCCESS
- Phase 9 Authentication-Failure Behaviour — `34027609792` — SUCCESS

The Phase 9 composite on the tested branch, promoted technical `main`, and final closure head includes the full Phase 1–3 browser/viewer behavioral regression, Phase 4 ownership, Phase 5 isolation, Phase 7 generic profile behavior, Phase 8 shared-state/no-viewer guarantees, Phase 9 negative authentication paths, the Phase 6 12-iteration orphan/reaper race stress test, unchanged Phase 6 lifecycle/restart behavior, browser/profile cleanup and terminal durable-record checks.

## Findings closed

- `SB-009-001` — authentication failure lacked a durable shared outage latch — FIXED / VERIFIED / CLOSED.
- `SB-009-002` — an already-open writer viewer could outlive upstream authentication — FIXED / VERIFIED / CLOSED.
- `SB-009-003` — no separate administrator/operator recovery boundary existed — FIXED / VERIFIED / CLOSED.
- `SB-009-004` — inherited Phase 8 failure response needed to evolve while preserving the same security invariant — FIXED / VERIFIED / CLOSED.

No material Phase 9 red application/runtime run is being hidden. The earlier first complete composite (`34023449980`) was green; later exact branch-head, promoted-main and final closure-head evidence above became authoritative closure evidence.

## Owner approval and final status

Owner approval for Phase 9 was explicitly received on **2026-09-06** after the final documentation/closure head `808d2411a34a26c438fc46d3e4b8fb6c45c16f39` passed all seven authoritative workflows.

This approval-record commit changes documentation only. Under the repository engineering contract, the resulting `main` approval-record head must itself pass all seven applicable authoritative workflows. That exact-head CI result is external evidence for this immutable certificate and does not require rewriting the certificate with its own run IDs.

Once that approval-record head is green:

**STATUS: GREEN / COMPLETE / APPROVED**

Phase 10 — Second-tool validation (Steno Writer) — is then **UNLOCKED / NOT STARTED** and must not begin until separately instructed.
