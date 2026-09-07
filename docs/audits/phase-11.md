# Phase 11 — Security Hardening Audit

Status: **TECHNICALLY GREEN / AWAITING OWNER APPROVAL**

Date opened: 2026-09-07  
Branch: `phase11-security-hardening`  
Approved baseline: `main` at `0ed34da59138be76c5130e713dfccf932f30ee90`  
Blueprint: Master Blueprint v1.1  
Last completed phase: Phase 10 — COMPLETE / OWNER APPROVED  
Production Browser Use: outside scope and unchanged.

## Blueprint objective and exit gate

Phase 11 hardens every exposed boundary of the standalone runtime and must prove that unauthorized paths fail closed.

Exit gate:

> Security tests reject unauthorized paths.

Required Phase 11 validation matrix:

- forged and expired viewer tokens;
- writer A attempting to operate writer B's session;
- replayed signed service requests;
- no public raw CDP, Docker socket, or host-network exposure;
- bounded rate limiting;
- deterministic malformed-request handling; and
- complete browser/process/profile/session cleanup after adversarial tests.

## Baseline audit

The Phase 10 baseline already provided strong inherited controls:

- HMAC-SHA256 service authentication with timestamp, nonce, body hash and writer identity;
- replayed-nonce rejection in SQLite;
- separate timing-safe worker and operator secrets;
- signed, short-lived, session-bound viewer grants;
- writer-owned Laravel session records;
- loopback host publication for API and worker;
- loopback, dynamic Chromium CDP;
- no Docker socket mount, host networking, privileged container, or added capabilities;
- credential and OTP rejection on writer launch;
- restrictive viewer browser headers; and
- deterministic cleanup inherited from Phases 2, 5 and 6.

The Phase 11 audit found two gate blockers and two hardening gaps:

1. no API or worker request-rate limiter existed;
2. malformed Laravel API requests could rely on framework negotiation rather than a mandatory JSON failure contract;
3. protected query strings were not signed and were not explicitly forbidden; and
4. several operation bodies accepted ignored fields, weakening the reject-unknown-input boundary.

## Remediation

### API boundary

- Added a protected-route policy middleware before service/operator authentication.
- Protected query strings are rejected, eliminating unsigned query ambiguity.
- Request bodies are bounded, must be `application/json`, must contain valid JSON objects, and are forbidden on protected GET/DELETE methods.
- API exceptions are forced to JSON for all `/api/*` requests.
- Service and operator request rates use independent fixed one-minute SQLite-backed buckets and return HTTP 429 with `Retry-After`.
- Signed writer identifiers now require the same bounded identifier grammar at every service route.
- Launch requests reject unknown fields after preserving the stronger credential-specific rejection.
- heartbeat, activity and viewer-grant operations reject non-empty request objects.

### Worker and viewer boundary

- Added independent fixed-window control-plane and viewer rate limiters.
- Browser and viewer query strings are rejected.
- Worker JSON handling now bounds bytes, validates media type, rejects malformed JSON and rejects non-object top-level values.
- Browser start and navigation reject unsupported fields.
- Rate-limit and malformed-request failures use safe stable codes; production 5xx details remain suppressed.
- Existing HMAC viewer verification, tool-auth checks, restrictive viewer headers, and loopback-only dynamic CDP remain unchanged.

### Deployment boundary

Compose continues to publish only:

- API `127.0.0.1:18080 -> 8080`;
- worker/viewer `127.0.0.1:18081 -> 8081`.

The Phase 11 workflow rejects Docker socket mounts, host networking, privileged containers, added capabilities, fixed/public CDP patterns, non-loopback published ports, and runtime inspect drift.

## Adversarial test matrix

`tests/phase11-security-e2e.py` covers:

- missing, malformed, stale and invalid signed service identities;
- single-use service nonces and replay rejection;
- forged, expired, future-dated, overlong and cross-session viewer tokens;
- writer B attempting status, heartbeat, activity, viewer-grant and close against writer A;
- malformed JSON, non-JSON media types, array payloads, oversize payloads, query ambiguity and unknown fields;
- missing worker/operator authorization;
- independent service, operator, worker-control and viewer rate limits with `Retry-After`;
- two simultaneous isolated writer sessions;
- runtime Chromium command-line proof of loopback/dynamic CDP; and
- zero active/starting worker sessions after owned cleanup.

## Verification record

Local pre-commit checks:

- Node syntax checks: PASS.
- `browser-worker/test/security-boundary.test.mjs`: 3 tests, 3 PASS, 0 FAIL.
- Phase 11 Python E2E syntax compilation: PASS.
- Phase 11 workflow YAML parse: PASS.
- PHP lint was unavailable in the orchestration environment and is therefore not claimed; repository CI performs the authoritative PHP syntax/type gate in the API container/toolchain.

RED history:

- Phase 11 run `34083042244` on `933cc5a4588b888b9754550157c6d69d4b7e684b`: the runtime correctly returned HTTP 429 / `RATE_LIMITED`, but the Python harness read `Retry-After` with a case-sensitive dictionary key and raised `KeyError`. This was a test-harness defect, not a failed limiter. Corrective action: use case-insensitive HTTP header lookup and retain the `Retry-After >= 1` assertion.

- Phase 11 run `34083201724` on `f46b08ce49301f28a4d90bcc80a8430e6c392812`: the API limiter returned the correct 429 / `RATE_LIMITED` but serialized fractional remaining seconds as `Retry-After: 55.98489`. Corrective action: ceiling the remaining fixed-window duration to a positive integer, as required by HTTP retry semantics; the strict integer assertion remains.

Implementation head `3944b8e9ea6bb243ca2eb1c6ebd66c93b0e56f42` passed all eleven authoritative workflows:

- Verified Through Phase 3 — run `34083419750`;
- Phase 4 Laravel Session API — run `34083419755`;
- Phase 5 Session Isolation — run `34083419794`;
- Phase 6 Lifecycle Management — run `34083419791`;
- Phase 7 Generic Tool Profiles — run `34083419806`;
- Phase 8 Phrasly Reference Implementation — run `34083419778`;
- Phase 9 Authentication-Failure Behaviour — run `34083419765`;
- Phase 10 Second-Tool Validation — run `34083419795`; and
- Phase 11 Security Hardening — run `34083419803`.

All runs completed with `success`. The Phase 10 composite also re-executed its inherited browser, ownership, isolation, lifecycle, generic-profile, shared-state, authentication-failure and multi-tool matrices.

## Gate status

Phase 11 is not complete until:

1. the dedicated Phase 11 workflow passes on the exact documented branch head;
2. every inherited Phase 1–10 workflow passes on that same head;
3. any RED run is preserved here and in the issue register with root cause and corrective action;
4. the final documentation-only head is revalidated if the head changes; and
5. the owner explicitly approves Phase 11 completion.

Current gate: **TECHNICALLY GREEN / FINAL DOCUMENTED-HEAD REVALIDATION IN PROGRESS / OWNER APPROVAL PENDING**.
