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
- Phase 7 — generic tool-profile framework: **TECHNICALLY GREEN / AWAITING OWNER APPROVAL**.

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

Each authoritative workflow runs `scripts/typecheck.sh`, which checks all Node `.mjs` files with `node --check`, all non-vendor PHP files with `php -l`, Python tests with `py_compile`, JSON manifests with `json.tool`, and Docker Compose configuration with `docker compose config --quiet`.

The final Phase 6 audit is recorded in `docs/audits/phase-6.md`. `docs/audits/ISSUE_REGISTER.md` preserves `SB-006-001` through `SB-006-004`, including the RED-run history and corrective actions; all four findings are **FIXED / CLOSED**. The production website/Browser Use repository was rechecked after promotion and remained at `ea5d39b79d7c3fac9c004ae3dfd6b55ff75df084`.

Owner approval for Phase 6 was received on 2026-09-04. Phase 6 is therefore **GREEN / COMPLETE / APPROVED**.

## Phase 7 technical evidence

Phase 7 was developed from approved Phase 6 standalone `main` commit `304753b3b7ac8c654adf263edbee8d56a9619148` on branch `phase7-tool-profiles`.

The implementation provides:

- a generic, Laravel-owned tool-profile registry and configurable JSON profile source;
- server-side resolution of `tool_slug` to a configured launch target;
- fail-closed handling for missing, disabled or malformed profiles;
- rejection of caller attempts to replace a configured launch destination;
- health validation for the launch-critical tool-profile configuration;
- a generic worker launch primitive with no Phrasly-specific branch in core infrastructure; and
- dedicated Phase 7 E2E coverage while preserving all inherited Phase 1-6 gates.

The exact Phase 7 implementation head `d1d9269b7f1dda161ac1c72f9eae7884b4d59266` passed all five authoritative workflows on the same SHA:

- Verified Through Phase 3 — run `33926255081`;
- Phase 4 Laravel Session API — run `33926255136`;
- Phase 5 Session Isolation — run `33926255038`;
- Phase 6 Lifecycle Management — run `33926255036`; and
- Phase 7 Generic Tool Profiles — run `33926255054`.

During inherited verification, Phase 6 run `33919958668` exposed a transient API-restart worker-read race. The runtime was fixed with bounded retry only for idempotent worker reads; session creation remains non-retried to avoid duplicate browser creation. The inherited lifecycle test was retained unchanged as a required gate and passed on the corrected implementation head.

The Phase 7 audit is recorded in `docs/audits/phase-7.md`. `docs/audits/ISSUE_REGISTER.md` preserves the Phase 7 findings and corrective actions. Phase 7 is technically green but remains **AWAITING OWNER APPROVAL**; it is not marked COMPLETE until the owner explicitly approves it.

## Architecture

- `api/` — Laravel control plane: signed service API, persistent session records, writer ownership, generic tool-profile policy, capacity, lifecycle orchestration, lifecycle reaper/reconciliation and viewer-grant issuance.
- `browser-worker/` — generic Node.js Chromium worker: authenticated session-scoped lifecycle control, loopback-only CDP, isolated Chromium profiles, restricted frame/input viewer, signed-grant verification and per-session process-exit cleanup.
- `docker-compose.yml` — portable Linux + Docker topology with persistent runtime DB storage and localhost-only host publication for the current development/CI environment.
- `scripts/typecheck.sh` — repository-wide executable type/syntax/configuration gate for the current language/toolchain.
- `docs/audits/` — phase gates, issue history and regression evidence.

The runtime core is intentionally generic and is not hardcoded to Phrasly or another tool.

## Generic tool-profile model

Phase 7 launch requests identify a writer and `tool_slug`; Laravel resolves the configured profile before any browser is created. The caller does not control the destination URL.

Current Phase 7 profile fields are deliberately minimal:

- `enabled`
- `launch_url`

`{writer_id}` is the supported launch template placeholder. Unknown/disabled profiles and unsupported profile fields/placeholders fail closed. The broader Blueprint profile concept — saved browser-state requirements, authenticated/logged-out/OTP indicators and optional navigation/validation rules — is introduced only as the later reference/adapter phases require it rather than being hardcoded into the common browser layer.

Phrasly itself is not configured in Phase 7. The first real Phrasly profile and saved authenticated-state injection are Phase 8 work.

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

`MAX_BROWSER_SESSIONS` is validated configuration from 1 through the blueprint design ceiling of 15. Broader 5/10/15 concurrency proof remains Phase 18 work rather than a Phase 7 claim.

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
- Viewer tokens are HMAC-SHA256 signed and contain browser session ID, writer ID, issue/expiry time and random token ID.
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

Required launch-critical configuration includes a valid Laravel `APP_KEY`, `RUNTIME_SERVICE_AUTH_SECRET`, `WORKER_CONTROL_SECRET`, `VIEWER_SIGNING_SECRET`, viewer TTL/base URL, valid `MAX_BROWSER_SESSIONS`, valid lifecycle policy values and a valid tool-profile configuration source.

## Blueprint sequencing

Not implemented or claimed in Phase 7:

- Phase 8 Phrasly saved-state injection and authenticated reference implementation;
- Phase 9 authentication-failure/admin-reauth behavior;
- Phase 10 second-tool proof;
- Phase 11 security hardening beyond the inherited controls already required for current gates;
- Phase 12/18 empirical resource and concurrency measurements;
- Phase 14 production-host deployment;
- Phase 15 production provider integration.

These remain later Blueprint gates. Phase 8 must not start until Phase 7 receives explicit owner approval.

## Financial rule

Final production capacity must run on predictable fixed-price Linux VPS infrastructure. The design must not introduce per-browser-hour, per-minute, per-session, per-request or other usage-metered browser infrastructure.

## Production safety

This standalone repository is still pre-production. Phase 7 does not switch the live application from Browser Use and does not add a production Phrasly integration. Provider integration happens only in the later Blueprint integration phase after the standalone runtime passes its subsequent gates.
