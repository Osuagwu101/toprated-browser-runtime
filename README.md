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
- Phase 7 — generic tool-profile framework: **NOT STARTED**.

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

Owner approval for Phase 6 was received on 2026-09-04. Phase 6 is therefore **GREEN / COMPLETE / APPROVED**. Phase 7 is eligible to start only on an explicit later instruction and has **not** been started automatically.

## Architecture

- `api/` — Laravel control plane: signed service API, persistent session records, writer ownership, capacity, lifecycle orchestration, lifecycle reaper/reconciliation and viewer-grant issuance.
- `browser-worker/` — generic Node.js Chromium worker: authenticated session-scoped lifecycle control, loopback-only CDP, isolated Chromium profiles, restricted frame/input viewer, signed-grant verification and per-session process-exit cleanup.
- `docker-compose.yml` — portable Linux + Docker topology with persistent runtime DB storage and localhost-only host publication for the current development/CI environment.
- `scripts/typecheck.sh` — repository-wide executable type/syntax/configuration gate for the current language/toolchain.
- `docs/audits/` — phase gates, issue history and regression evidence.

The runtime core is intentionally generic and is not hardcoded to Phrasly or another tool.

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

`MAX_BROWSER_SESSIONS` is validated configuration from 1 through the blueprint design ceiling of 15. Broader 5/10/15 concurrency proof remains Phase 18 work rather than a Phase 6 claim.

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

Required launch-critical configuration includes a valid Laravel `APP_KEY`, `RUNTIME_SERVICE_AUTH_SECRET`, `WORKER_CONTROL_SECRET`, `VIEWER_SIGNING_SECRET`, viewer TTL/base URL, valid `MAX_BROWSER_SESSIONS`, and valid lifecycle policy values.

## Blueprint sequencing

Not implemented or claimed in Phase 6:

- Phase 7 generic tool-profile framework;
- Phase 8 Phrasly saved-state injection and authenticated reference implementation;
- Phase 11/14 deployment hardening;
- Phase 15 production provider integration;
- Phase 18 empirical 5/10/15 safe-concurrency measurement.

These remain later Blueprint gates. Phase 7 has not been started.

## Financial rule

Final production capacity must run on predictable fixed-price Linux VPS infrastructure. The design must not introduce per-browser-hour, per-minute, per-session, per-request or other usage-metered browser infrastructure.

## Production safety

This standalone repository is still pre-production. Phase 6 does not switch the live application from Browser Use. Provider integration happens only in the later Blueprint integration phase after the standalone runtime passes its subsequent gates.
