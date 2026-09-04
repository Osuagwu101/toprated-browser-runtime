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
- Phase 6 — lifecycle management: **TECHNICALLY GREEN / AWAITING OWNER APPROVAL after final promotion validation**.
- Phase 7 — NOT STARTED.

The existing Browser Use production path remains untouched.

## Phase 6 technical closure evidence

Phase 6 was developed from the approved Phase 5 standalone baseline and adds lifecycle enforcement without changing the production Browser Use path or introducing tool-specific behavior.

The implementation proves:

- a configurable 90-minute production lease that is renewed by genuine activity rather than heartbeat alone;
- configurable idle timeout, disconnect grace, startup grace and autonomous reaper interval;
- reconnect/heartbeat within disconnect grace without replacing the writer's browser;
- explicit close with exact-session worker identity checks and complete cleanup evidence;
- abandoned, stale and orphaned browsers are reconciled and removed automatically;
- restart reconciliation between persistent Laravel records and live worker sessions;
- worker process-exit cleanup/watchdog behavior; and
- Phase 1-5 browser lifecycle, ownership, viewer security and isolation guarantees remain intact.

The exact implementation head `0da7b5b9b9da008d2a3d73ef8b96ce38f0212540` passed:

- inherited Phase 1-3 regression run `33907235930`;
- Phase 4 Laravel ownership regression run `33907235955`;
- Phase 5 writer/session isolation run `33907235924`; and
- Phase 6 lifecycle/restart reconciliation run `33907235859`.

Every workflow runs `scripts/typecheck.sh`, which checks all Node `.mjs` files with `node --check`, all non-vendor PHP files with `php -l`, Python tests with `py_compile`, JSON manifests with `json.tool`, and Docker Compose configuration with `docker compose config --quiet`.

The Phase 6 audit and RED-run history are recorded in `docs/audits/phase-6.md` and `docs/audits/ISSUE_REGISTER.md`. The final documented head must still pass all four workflows on the branch and on resulting standalone `main` before the owner approval gate is presented.

## Architecture

- `api/` — Laravel control plane: signed service API, persistent session records, writer ownership, capacity, lifecycle orchestration and viewer-grant issuance.
- `browser-worker/` — generic Node.js Chromium worker: authenticated session-scoped lifecycle control, loopback-only CDP, isolated Chromium profiles, restricted frame/input viewer and signed-grant verification.
- `docker-compose.yml` — portable Linux + Docker topology with persistent runtime DB storage, autonomous lifecycle-reaper service and localhost-only host publication for the current development/CI environment.
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

`MAX_BROWSER_SESSIONS` is configuration, is validated, and supports the blueprint design ceiling of 15. Phase 5/6 correctness CI uses 3 slots; broader 5/10/15 concurrency and server sizing remain Phase 18 and Phase 12 work respectively.

## Lifecycle policy

Production defaults are configuration rather than constants embedded in lifecycle logic:

- `SESSION_LEASE_SECONDS=5400` — 90-minute renewable lease;
- `SESSION_IDLE_TIMEOUT_SECONDS=900` — approximately 15 minutes without genuine activity;
- `SESSION_DISCONNECT_GRACE_SECONDS=180` — approximately 3 minutes without heartbeat before disconnect cleanup;
- `SESSION_STARTUP_GRACE_SECONDS=30` — bounded startup reconciliation window; and
- `SESSION_REAPER_INTERVAL_SECONDS=30` — autonomous lifecycle scan cadence.

Genuine activity renews the lease. Heartbeat maintains connection presence but does not by itself extend the lease. The reaper reconciles durable records against exact live worker-session identities and removes expired, abandoned or orphaned browsers while preserving unrelated active sessions.

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

Required launch-critical configuration includes a valid Laravel `APP_KEY`, `RUNTIME_SERVICE_AUTH_SECRET`, `WORKER_CONTROL_SECRET`, `VIEWER_SIGNING_SECRET`, viewer TTL/base URL, a valid `MAX_BROWSER_SESSIONS` value, and valid lifecycle timeout values.

## Blueprint sequencing

Not implemented or claimed in Phase 6:

- Phase 7 generic tool-profile framework;
- Phase 8 Phrasly saved-state injection and authenticated reference implementation;
- later production provider routing, deployment, hardening and measured capacity work.

These remain later Blueprint gates. Phase 7 has not been started.

## Financial rule

Final production capacity must run on predictable fixed-price Linux VPS infrastructure. The design must not introduce per-browser-hour, per-minute, per-session, per-request or other usage-metered browser infrastructure.

## Production safety

This standalone repository is still pre-production. Phase 6 does not switch the live application from Browser Use. Provider integration happens only in the later Blueprint integration phase after the standalone runtime passes its subsequent gates.
