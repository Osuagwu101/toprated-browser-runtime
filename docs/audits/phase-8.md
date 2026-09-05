# Phase 8 Audit — Phrasly Reference Implementation

Status: **IN TEST — REAL PHRASLY SHARED-STATE PROOF PENDING**

Phase anchor:

- Current phase: **Phase 8 — Phrasly reference implementation**
- Last completed phase: **Phase 7 — Generic Tool-Profile Framework**, owner-approved 2026-09-05
- Blueprint: **Master Blueprint v1.1**
- Approved Phase 7 standalone baseline: `f92d5f5b2e44905e977bca14ed12a5db44823738`
- Phase 8 branch: `phase8-phrasly-reference`

Blueprint exit gate:

> **One self-hosted Chromium reaches authenticated Phrasly from shared state.**

Phase 8 owns the first real Phrasly tool profile, injection of already-authorized shared browser state into a fresh isolated Chromium, navigation to Phrasly, and verification that the target is authenticated before viewer access. Phase 9, not Phase 8, owns the later login/OTP/admin-reauth-required failure experience.

## Baseline audit

The approved Phase 7 runtime already had a generic server-owned tool-profile registry, isolated per-writer Chromium, signed Laravel ownership, restricted viewer grants and Phase 6 lifecycle enforcement. It intentionally had no real Phrasly profile and no shared authenticated-state injection path.

The production site's existing shared Phrasly state was inspected read-only to establish the source shape. Its `tool_account_sessions` records expose `authenticated_cookies`, `session_tokens` and `auth_headers`; the current capture path stores browser cookies plus local/session Web Storage under `session_tokens.storage`. Phase 8 does not modify or depend on the production Browser Use runtime itself.

## Phase 8 findings

### SB-008-001 — No real Phrasly reference profile

Severity: High / gate blocker.

Underlying cause: Phase 7 deliberately proved only a generic profile framework.

Correction: add a `phrasly` profile in `api/config/tool-profiles.json` with server-owned launch URL, browser-state requirement/allowed-host policy and a generic authenticated URL indicator. Phrasly appears only in tool configuration, never as a core runtime branch.

Status: **IMPLEMENTED / LOCALLY CI-VERIFIED; REAL PHRASLY PROOF PENDING**.

### SB-008-002 — No authorized shared-state transport or injection path

Severity: High / gate blocker.

Underlying cause: Phase 1-7 launch creation passed only a URL into Chromium.

Correction:

- `AuthorizedBrowserState` validates the production-shaped state at the Laravel boundary;
- only cookies plus `localStorage`/`sessionStorage` are accepted for Phase 8;
- reusable request authentication headers are rejected;
- cookie domains are constrained to profile-approved hosts;
- the normalized state crosses only the signed service API -> authenticated private worker path;
- the worker injects cookies with CDP and Web Storage via a new-document bootstrap before protected navigation;
- the bootstrap is removed after navigation and the temporary Chromium profile is removed on browser cleanup.

Status: **IMPLEMENTED / CI-VERIFIED**.

### SB-008-003 — Viewer could otherwise be granted before tool authentication was proved

Severity: High / gate blocker.

Underlying cause: prior phases had no tool-authentication state concept.

Correction: generic profile authentication indicators are evaluated in the worker after state injection/navigation and before Laravel marks the session active. An unverified state fails with `TOOL_AUTH_NOT_VERIFIED`; the failed browser is cleaned and no viewer grant is returned.

Status: **IMPLEMENTED / CI-VERIFIED**.

### SB-008-004 — Raw shared state must not become a second durable credential store

Severity: High / security blocker.

Underlying cause: adding shared-state launch support creates a risk of persisting raw cookies/tokens in durable session records or logs.

Correction: state is request/session-ephemeral only. No `browser_sessions` column or migration stores cookies, session tokens, auth headers or the raw browser-state object. CI scans durable schema paths and runtime logs for fixture secret markers. Health exposes only safe configuration metadata.

Status: **IMPLEMENTED / CI-VERIFIED**.

### SB-008-005 — Real Phrasly proof requires a live authorized state source

Severity: High / exit-gate blocker.

Underlying cause: deterministic CI can prove the generic mechanism but cannot manufacture or commit a real authenticated Phrasly session. The Blueprint requires actual Phrasly, not only a fixture.

Correction prepared: `scripts/phase8-phrasly-acceptance.py` reads the shared state from a local permission-restricted JSON file, submits it through the signed service API, verifies that the self-hosted browser remains on an authenticated Phrasly dashboard, proves viewer access occurs only after authentication verification, closes the browser, and never prints the raw state.

Status: **OPEN — owner-controlled live state evidence required before Phase 8 can reach AWAITING APPROVAL**.

## Security boundary

The Phase 8 state contract deliberately remains narrower than the production saved-state row:

- `authenticated_cookies` are accepted only when their domains fit the configured tool-host allowlist;
- `session_tokens.storage.localStorage` and `.sessionStorage` are accepted and injected only on the approved tool hosts;
- non-empty `auth_headers` are rejected in Phase 8 rather than forwarding arbitrary reusable headers into the worker;
- writer launch requests containing passwords, OTPs or verification-code fields are rejected;
- raw state is not returned in writer responses, viewer grants or health output;
- state is not written to ordinary logs or durable runtime tables.

The runtime still owns one isolated Chromium profile per writer session, retains loopback-only CDP, and does not expose DevTools/raw CDP to writers.

## Deterministic implementation verification

Exact first complete implementation head: `edd8306f27d1d9302da1f783a5fd1fef35dad456`.

All six authoritative workflows passed on that same SHA:

- Verified Through Phase 3 — run `33941292711` — **SUCCESS**;
- Phase 4 Laravel Session API — run `33941292710` — **SUCCESS**;
- Phase 5 Session Isolation — run `33941292709` — **SUCCESS**;
- Phase 6 Lifecycle Management — run `33941292708` — **SUCCESS**;
- Phase 7 Generic Tool Profiles — run `33941292701` — **SUCCESS**;
- Phase 8 Phrasly Reference Implementation — run `33941292707` — **SUCCESS**.

The dedicated Phase 8 workflow proves with a deterministic authenticated-state fixture that:

- cookie state is injected before navigation;
- `localStorage` and `sessionStorage` are injected before page scripts execute;
- state outside the configured host policy is rejected;
- writer credential/OTP fields are rejected;
- non-empty reusable authentication headers are rejected;
- authentication indicators must pass before a viewer grant is returned;
- a healthy existing writer/tool session can be reused without retransmitting raw state;
- invalid/unverified state creates no viewer grant and leaves no live worker browser;
- raw fixture state is not present in durable browser-session schema or API/worker logs;
- inherited Phase 1-7 behavioral and cleanup gates remain green.

A later documentation/harness head must rerun all six workflows before promotion; the SHA above is implementation evidence, not the eventual final Phase 8 closure SHA.

## Public Phrasly route sanity check

An unauthenticated request to `https://phrasly.ai/dashboard` currently redirects to `/login`. That makes remaining on a `/dashboard` path a useful generic authenticated indicator for the reference profile, but the real acceptance harness still requires the self-hosted browser to prove the Phrasly host/path and the runtime's `authentication.verified` result using an actual saved session.

## Standing invariant check

1. **Browser Use untouched — PASS so far.** Phase 8 changes are confined to the standalone repository; production baseline must be rechecked again before promotion/sign-off.
2. **Separation maintained — PASS.** No Phase 15 production integration is introduced.
3. **Generic core — PASS.** Phrasly appears in the tool profile/acceptance material, not in common Laravel/worker branching.
4. **Credentials never reach writers — PASS in deterministic tests.** Credential/OTP request fields are rejected and state is never returned to the writer.
5. **No raw CDP/DevTools — PASS.** Existing static/viewer gates remain active.
6. **Session isolation — PASS.** Phase 5 regression remains green.
7. **Active sessions protected — PASS.** Phase 6 lifecycle regression remains green.
8. **Abandoned sessions die — PASS.** Phase 6 cleanup/reconciliation remains green.
9. **Capacity is configuration — PASS.** Existing 1..15 design is unchanged; empirical capacity proof remains Phase 18.
10. **Portability — PASS.** No host-specific application dependency introduced.
11. **Fixed-cost model — PASS.** No usage-metered browser provider introduced.
12. **Logging policy — PASS in deterministic test.** Sensitive fixture markers are absent from runtime logs.
13. **Rollback preserved — PASS.** Production Browser Use is not switched or modified.
14. **Spend discipline — PASS.** No hosting purchase introduced before measurement phases.

## Gate decision

The **mechanism is VERIFIED** on the deterministic Phase 8 fixture and every inherited gate is green. The **Blueprint exit gate is not yet fully satisfied**, because no live authorized Phrasly shared state has yet been exercised through the standalone runtime in this phase record.

Phase 8 remains **IN TEST**. Phase 9 is **NOT STARTED**.


## Approved temporary admin-authentication amendment

Owner approval was explicitly received on 2026-09-05 for a narrowly scoped, temporary operator-only Phase 8 authentication/capture harness.

The amendment exists solely to obtain the real shared Phrasly state needed by the Phase 8 exit gate after Phrasly's Cloudflare verification prevented the connected cloud browser from completing authentication. It does not authorize bypassing Cloudflare, expose authentication to writers, change production Browser Use, or implement the general Phase 9 admin-reauth experience.

Implementation:

- `phrasly-admin-bootstrap` is a tool-configuration-only launch target for the operator harness;
- `scripts/phase8-admin-auth-harness.py` requires both runtime operator secrets and never accepts or prints a Phrasly password or OTP;
- the one-time viewer URL is written to a permission-restricted local file instead of ordinary output;
- the owner completes Phrasly and any human verification directly in the restricted self-hosted viewer;
- `GET /browser/sessions/{id}/authorized-state` is private-worker-control authenticated;
- captured cookies are limited to the active Phrasly origin hierarchy;
- Web Storage is captured only from the active origin;
- the harness immediately launches a fresh `phrasly` session with the captured state and requires the configured authenticated result; and
- temporary state and viewer-link files plus both Chromium sessions are removed in final cleanup.

Exact verified implementation head: `57182a5f4cbcc654981fda7bbf565ad7b8d7ae03`.

Authoritative workflow evidence on that exact SHA:

- Verified Through Phase 3 — run `33945655810` — **SUCCESS**;
- Phase 4 Laravel Session API — run `33945655788` — **SUCCESS**;
- Phase 5 Session Isolation — run `33945655813` — **SUCCESS**;
- Phase 6 Lifecycle Management — run `33945655770` — **SUCCESS**;
- Phase 7 Generic Tool Profiles — run `33945655773` — **SUCCESS**; and
- Phase 8 Phrasly Reference Implementation — run `33945655774` — **SUCCESS**.

The Phase 8 workflow proves that state export fails without the private worker-control secret and succeeds only on the authenticated private control plane. The actual live Phrasly run remains required before the Blueprint exit gate can be declared technically green.

## CI incident retained — final documentation head

Final documentation head `c6285ac3e74dbbdc1c32ceab7c6c18a6ef5bd15e` initially produced a red Phase 8 workflow run `33945908128` (attempt 1). The deterministic Phase 8 state-injection/export checks passed, but the inherited Phase 6 E2E received HTTP 500 while directly launching its untracked-worker cleanup fixture. The failure is retained here and was not hidden or used to weaken the Phase 6 gate.

The same workflow job was rerun unchanged as attempt 2. Every step passed, including the exact Phase 6 lifecycle/restart regression, browser/profile residue scan, durable-record terminal check, and teardown. Together with the already-green standalone Phase 3–7 workflows on the same SHA, this demonstrates a transient runner/Chromium launch incident rather than a reproducible amendment regression.

Evidence on `c6285ac3e74dbbdc1c32ceab7c6c18a6ef5bd15e`:

- Verified Through Phase 3 — run `33945908151` — **SUCCESS**;
- Phase 4 Laravel Session API — run `33945908140` — **SUCCESS**;
- Phase 5 Session Isolation — run `33945908136` — **SUCCESS**;
- Phase 6 Lifecycle Management — run `33945908134` — **SUCCESS**;
- Phase 7 Generic Tool Profiles — run `33945908168` — **SUCCESS**; and
- Phase 8 Phrasly Reference Implementation — run `33945908128`, attempt 2 — **SUCCESS**.

This evidence clears the deterministic regression concern. It does not satisfy the live Phrasly exit gate.
