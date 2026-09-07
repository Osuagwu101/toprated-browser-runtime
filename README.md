# Top Rated Browser Runtime

Standalone, Docker-portable self-hosted browser runtime for Top Rated SEO Tools.

## Verified source of truth

This private repository is the standalone source of truth for the self-hosted browser provider.

Verified status:

- Phase 1 — isolated Laravel + Node + Chromium + Docker runtime foundation: GREEN.
- Phase 2 — repeated Chromium start/control/stop lifecycle with cleanup checks: GREEN.
- Phase 3 — restricted signed-token viewer with mouse, keyboard, scroll and reconnect support, without writer-facing raw CDP/DevTools exposure: GREEN.
- Phase 4 — Laravel Session API & Ownership: **GREEN / COMPLETE / APPROVED**.
- Phase 5 — writer/browser isolation and session ownership: **GREEN / COMPLETE / APPROVED**.
- Phase 6 — lifecycle management: **GREEN / COMPLETE / APPROVED**.
- Phase 7 — generic tool-profile framework: **GREEN / COMPLETE / APPROVED**.
- Phase 8 — Phrasly reference implementation: **GREEN / COMPLETE / APPROVED**.
- Phase 9 — authentication-failure behaviour: **GREEN / COMPLETE / APPROVED**.
- Phase 10 — generic multi-tool validation with SneakWrite, StealthWriter and ChatGPT: **GREEN / COMPLETE / OWNER APPROVED 2026-09-07**.

The existing Browser Use production path remains untouched.

## Phase 6 closure evidence

Phase 6 was developed from approved Phase 5 standalone `main` commit `e2778c394d40565453e3ed45f991f2f3030cc625`.

The implementation provides:

- renewable 90-minute leases renewed by genuine activity rather than heartbeat alone;
- configurable idle timeout, disconnect grace, startup grace and reaper interval;
- reconnect within disconnect grace while preserving the same browser;
- autonomous cleanup of expired, idle, disconnected, crashed and orphaned sessions;
- restart reconciliation between durable Laravel records and live worker sessions;
- independent worker process-exit cleanup without affecting another writer's browser; and
- preservation of Phase 1-5 ownership, viewer security and browser-state isolation guarantees.

Production defaults remain the Blueprint values: 5400-second lease, approximately 900-second idle timeout and approximately 180-second disconnect grace. CI uses valid accelerated values to exercise the same policy within bounded test time.

The exact final documented Phase 6 branch head `c708ee10016c2012fb400a25351f8afdf18e7847` passed all four authoritative workflows on the same SHA:

- Verified Through Phase 3 — run `33909732417`;
- Phase 4 Laravel Session API — run `33909732370`;
- Phase 5 Session Isolation — run `33909732414`; and
- Phase 6 Lifecycle Management — run `33909732404`.

That tested head was promoted through PR #7 to standalone `main` commit `20a81157554e70386be3291ee564fe39514a5041`. The resulting `main` head then passed the same four authoritative workflows again:

- Verified Through Phase 3 — run `33910146825`;
- Phase 4 Laravel Session API — run `33910146517`;
- Phase 5 Session Isolation — run `33910146434`; and
- Phase 6 Lifecycle Management — run `33910146416`.

The final Phase 6 audit is recorded in `docs/audits/phase-6.md`. `docs/audits/ISSUE_REGISTER.md` preserves `SB-006-001` through `SB-006-004`, including the RED-run history and corrective actions; all four findings are **FIXED / CLOSED**. The production website/Browser Use repository was rechecked after promotion and remained at `ea5d39b79d7c3fac9c004ae3dfd6b55ff75df084`.

Owner approval for Phase 6 was received on 2026-09-04. Phase 6 is therefore **GREEN / COMPLETE / APPROVED**.

## Phase 7 closure evidence

Phase 7 was developed from approved Phase 6 standalone `main` commit `304753b3b7ac8c654adf263edbee8d56a9619148` on branch `phase7-tool-profiles`.

The implementation provides:

- a generic, Laravel-owned tool-profile registry and configurable JSON profile source;
- server-side resolution of `tool_slug` to a configured launch target;
- fail-closed handling for missing, disabled or malformed profiles;
- rejection of caller attempts to replace a configured launch destination;
- health validation for the launch-critical tool-profile configuration;
- a generic worker launch primitive with no Phrasly-specific branch in core infrastructure; and
- dedicated Phase 7 E2E coverage while preserving all inherited Phase 1-6 gates.

During inherited verification, Phase 6 run `33919958668` exposed a transient API-restart worker-read race. The runtime was fixed with bounded retry only for idempotent worker reads; session creation remains non-retried to avoid duplicate browser creation. The inherited lifecycle test was retained unchanged as a required gate and passed after the correction.

The exact final documented Phase 7 branch head `a6a17e43c1109533a1230c719b2524455837a8d4` passed all five authoritative workflows on the same SHA:

- Verified Through Phase 3 — run `33926867078`;
- Phase 4 Laravel Session API — run `33926867092`;
- Phase 5 Session Isolation — run `33926867099`;
- Phase 6 Lifecycle Management — run `33926867114`; and
- Phase 7 Generic Tool Profiles — run `33926867048`.

PR #9 promoted that exact tested head to standalone `main` commit `67281ba8815f2a407d4f2e6904ce1d7c38880d1d`. The resulting `main` head passed all five authoritative workflows again:

- Verified Through Phase 3 — run `33939565151`;
- Phase 4 Laravel Session API — run `33939565157`;
- Phase 5 Session Isolation — run `33939565153`;
- Phase 6 Lifecycle Management — run `33939565173`; and
- Phase 7 Generic Tool Profiles — run `33939565154`.

The Phase 7 audit is recorded in `docs/audits/phase-7.md`; the final closure certificate is recorded in `docs/audits/phase-7-closure.md`. Owner approval for Phase 7 was received on 2026-09-05. Phase 7 is therefore **GREEN / COMPLETE / APPROVED**.

## Phase 8 implementation evidence

Phase 8 was opened explicitly from approved Phase 7 standalone `main` commit `f92d5f5b2e44905e977bca14ed12a5db44823738` on branch `phase8-phrasly-reference`.

The current implementation adds:

- the first real `phrasly` tool profile, kept in tool configuration rather than common browser code;
- a generic browser-state policy and authentication-indicator extension to the profile registry;
- signed, bounded delivery of authorized shared browser state from Laravel to the private worker;
- cookie injection plus `localStorage`/`sessionStorage` bootstrap before protected navigation;
- allowed-host validation for state/cookie injection;
- rejection of writer password, OTP and verification-code fields;
- rejection of non-empty reusable `auth_headers` in the Phase 8 state contract;
- generic authentication verification before Laravel activates the browser or issues the first viewer grant;
- cleanup of unverified browsers with no viewer grant;
- no raw browser-state persistence in durable session records; and
- a manual real-Phrasly acceptance harness that reads state only from a permission-restricted local file and never prints it.

The exact first complete implementation head `edd8306f27d1d9302da1f783a5fd1fef35dad456` passed all six authoritative workflows on the same SHA:

- Verified Through Phase 3 — run `33941292711` — SUCCESS;
- Phase 4 Laravel Session API — run `33941292710` — SUCCESS;
- Phase 5 Session Isolation — run `33941292709` — SUCCESS;
- Phase 6 Lifecycle Management — run `33941292708` — SUCCESS;
- Phase 7 Generic Tool Profiles — run `33941292701` — SUCCESS; and
- Phase 8 Phrasly Reference Implementation — run `33941292707` — SUCCESS.

The dedicated Phase 8 E2E uses a deterministic authenticated-state fixture to prove cookies, `localStorage` and `sessionStorage` are injected before page scripts, authentication is verified before viewer access, invalid state receives no viewer, state is not returned to the writer, state markers are absent from runtime logs, and failed/unverified browsers leave no residue.

On 2026-09-06, `scripts/phase8-phrasly-acceptance.py` used the active production-managed shared state to prove that a fresh self-hosted Chromium reached authenticated Phrasly at `https://phrasly.ai/dashboard`. Viewer access was issued only after authentication verification, and raw state was not printed. The Blueprint technical exit gate is satisfied; Phase 8 awaits final exact-head CI evidence and explicit owner approval.

Because the connected cloud browser could not pass Phrasly's Cloudflare verification, the owner approved a temporary operator-only authentication harness on 2026-09-05. `scripts/phase8-admin-auth-harness.py` opens Phrasly in the self-hosted Chromium, stores its one-time viewer link in a permission-restricted local file, allows the owner to complete verification directly, captures only the active Phrasly origin's authorized state over the private worker control plane, immediately proves that state in a fresh Chromium session, and removes temporary artifacts. The harness requires runtime operator secrets that writers do not possess and does not implement the broader Phase 9 re-authentication experience.

The current Phase 8 audit is recorded in `docs/audits/phase-8.md`.

## Architecture

- `api/` — Laravel control plane: signed service API, persistent session records, writer ownership, generic tool-profile/state policy, capacity, lifecycle orchestration, lifecycle reaper/reconciliation and viewer-grant issuance.
- `browser-worker/` — generic Node.js Chromium worker: authenticated session-scoped lifecycle control, loopback-only CDP, isolated Chromium profiles, ephemeral authorized-state injection, generic authentication verification, restricted frame/input viewer and exact per-session cleanup.
- `docker-compose.yml` — portable Linux + Docker topology with persistent runtime DB storage and localhost-only host publication for the current development/CI environment.
- `scripts/typecheck.sh` — repository-wide executable type/syntax/configuration gate for the current language/toolchain.
- `scripts/phase8-phrasly-acceptance.py` — manual safe acceptance harness for the real Phrasly Phase 8 exit gate.
- `docs/audits/` — phase gates, issue history and regression evidence.

The runtime core remains generic. Tool-specific URLs, state requirements and authentication indicators live in tool profiles.

## Generic tool-profile and shared-state model

Launch requests identify a writer and `tool_slug`; Laravel resolves the configured profile before any browser is created. The caller does not control the destination URL.

Current profile fields are:

- `enabled`
- `launch_url`
- optional `browser_state.required`
- optional `browser_state.allowed_hosts`
- optional `authentication.required`
- optional `authentication.url_contains_any`
- optional `authentication.selectors_any`
- optional `authentication.timeout_seconds`

`{writer_id}` remains the supported launch template placeholder. Unknown/disabled profiles and unsupported profile fields/placeholders fail closed.

For stateful profiles, raw authorized state is accepted only on the signed service API and authenticated private worker control plane. Phase 8 accepts cookies and Web Storage, constrains them to the profile's allowed hosts, injects them into a fresh isolated Chromium, verifies the configured authenticated indicators, then returns viewer access. The raw state is not stored in the durable `browser_sessions` table.

Phrasly is the Phase 8 reference profile. Authentication-failure/admin-reauth behavior remains Phase 9 work and is not claimed here.

## Session API

Public health:

- `GET /api/health`

Signed service routes:

- `GET /api/capacity`
- `POST /api/sessions`
- `GET /api/sessions/{id}`
- `POST /api/sessions/{id}/heartbeat`
- `POST /api/sessions/{id}/activity`
- `POST /api/sessions/{id}/viewer-grant`
- `DELETE /api/sessions/{id}`

Service requests are HMAC-SHA256 signed with timestamp, nonce, writer identity and request-body hash. Replayed nonces are rejected. Worker lifecycle endpoints require a separate internal worker-control secret.

`MAX_BROWSER_SESSIONS` remains validated configuration up to the Blueprint design ceiling of 15. Empirical 5/10/15 concurrency proof remains Phase 18 work.

## Lifecycle model

- Genuine writer activity renews the renewable session lease.
- Heartbeat/reconnect updates connection liveness but does not fabricate genuine activity.
- Idle, disconnected, expired and abandoned sessions are reaped automatically.
- Worker crash/exit cleanup is exact-session scoped.
- Laravel restart reconciliation preserves live valid sessions and removes stale durable records.
- Worker restart reconciliation detects missing worker sessions, resolves stale records and restores usable capacity.
- The reaper tolerates temporary worker unavailability rather than destructively assuming a healthy writer browser is gone.

## Viewer security model

- Laravel is the viewer-grant issuer.
- Viewer tokens are HMAC-SHA256 signed and bound to browser session and writer identity.
- Signing secret minimum: 32 bytes.
- Viewer token TTL is bounded to 900 seconds maximum.
- Initial token transport uses the URL fragment, then Bearer authorization.
- Missing, forged, expired and cross-session authorization is rejected by the viewer layer.
- Viewer HTML does not contain the viewer token.
- Restrictive CSP, no-store, no-referrer, frame denial and related security headers remain in place.
- Restricted mouse/scroll/text/key input contract only.
- No writer-facing shell, DevTools UI, raw CDP URL or published CDP port.
- Chromium CDP remains internal to the worker and binds to `127.0.0.1` on a dynamic port.

## Local bootstrap

```bash
cp .env.example .env
# Replace all placeholder keys/secrets before startup.
bash scripts/typecheck.sh
docker compose build
docker compose up -d
curl http://127.0.0.1:18080/api/health
curl http://127.0.0.1:18081/health
docker compose down -v --remove-orphans
```

Required launch-critical configuration includes a valid Laravel `APP_KEY`, `RUNTIME_SERVICE_AUTH_SECRET`, `WORKER_CONTROL_SECRET`, `VIEWER_SIGNING_SECRET`, viewer TTL/base URL, valid `MAX_BROWSER_SESSIONS`, valid lifecycle policy values, `BROWSER_STATE_MAX_BYTES` and a valid tool-profile configuration source.

## Blueprint sequencing

Phase 8 is **GREEN / COMPLETE / APPROVED**. The following work remains later-phase work and is not claimed:

- Phase 9 authentication-failure/admin-reauth behavior;
- Phase 10 second-tool proof;
- Phase 11 security hardening beyond inherited/current controls;
- Phase 12/18 empirical resource and concurrency measurements;
- Phase 14 production-host deployment;
- Phase 15 production provider integration.

The Phase 8 live Phrasly exit gate is demonstrated and owner approval was received on 2026-09-06. Phase 9 is eligible but remains not started until explicit instruction.

## Financial rule

Final production capacity must run on predictable fixed-price Linux VPS infrastructure. The design must not introduce per-browser-hour, per-minute, per-session, per-request or other usage-metered browser infrastructure.

## Production safety

This standalone repository is still pre-production. Phase 8 does not switch the live application from Browser Use, does not modify production Browser Use behavior, and does not move Phrasly credentials or OTPs to writers. Provider integration happens only in the later Blueprint integration phase after the standalone runtime passes its subsequent gates.
