# Top Rated Browser Runtime

Standalone, Docker-portable self-hosted browser runtime for Top Rated SEO Tools.

## Verified source of truth

This private repository is the standalone source of truth for the self-hosted browser provider.

Verified status:

- Phase 1 — isolated Laravel + Node + Chromium + Docker runtime foundation: GREEN.
- Phase 2 — repeated Chromium start/control/stop lifecycle with cleanup checks: GREEN.
- Phase 3 — restricted signed-token viewer with mouse, keyboard, scroll and reconnect support, without writer-facing raw CDP/DevTools exposure: GREEN.
- Phase 4 — Laravel Session API & Ownership: **GREEN / COMPLETE / APPROVED**.
- Phase 5 — NOT STARTED.

Phase 4 closure evidence:

- documented Phase 4 branch head passed run `33868316708`;
- Phase 4 was promoted through pull request #2 to standalone `main`;
- the promoted Phase 4 implementation passed `main` run `33869416309`;
- a stale inherited Phase 1-3 workflow failure on `main` was treated as a blocker, fixed through pull request #3, and revalidated rather than ignored;
- final corrected `main` commit `984378c78fea4dd5c3624ed43eca997e1aff845f` passed the inherited Phase 1-3 baseline in run `33869763521` and the full Phase 4 gate in run `33869763531`; and
- the production Top Rated SEO Tools repository remained unchanged on `main` commit `ea5d39b79d7c3fac9c004ae3dfd6b55ff75df084` during Phase 4 closure.

The existing Browser Use production path remains untouched.

## Architecture

- `api/` — Laravel control plane: signed service API, persistent session records, writer ownership, capacity, lifecycle orchestration and viewer-grant issuance.
- `browser-worker/` — generic Node.js Chromium worker: authenticated internal lifecycle control, loopback-only CDP, restricted frame/input viewer and signed-grant verification.
- `docker-compose.yml` — portable Linux + Docker topology with persistent runtime DB storage and localhost-only host publication for the current development/CI environment.
- `docs/audits/` — phase gates, issue history and regression evidence.

The runtime core is intentionally generic and is not hardcoded to Phrasly or another tool.

## Phase 4 API

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

Phase 4 intentionally exposes one effective browser slot. Multi-session writer isolation belongs to Phase 5; setting `MAX_BROWSER_SESSIONS` above 1 is rejected rather than falsely advertising concurrency.

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
docker compose build
docker compose up -d
curl http://127.0.0.1:18080/api/health
curl http://127.0.0.1:18081/health
docker compose down -v --remove-orphans
```

Required launch-critical configuration includes a valid Laravel `APP_KEY`, `RUNTIME_SERVICE_AUTH_SECRET`, `WORKER_CONTROL_SECRET`, `VIEWER_SIGNING_SECRET`, viewer TTL/base URL and `MAX_BROWSER_SESSIONS=1` for Phase 4.

## Blueprint sequencing

Not implemented or claimed in Phase 4:

- Phase 5 multi-writer Chromium/session isolation;
- Phase 6 renewable lease, idle/disconnect cleanup, watchdog and restart reconciliation;
- tool profiles, Phrasly state injection, production routing or provider switching.

These remain later Blueprint gates. Phase 5 may now begin from the verified Phase 4 `main` baseline, but has not been started.

## Financial rule

Final production capacity must run on predictable fixed-price Linux VPS infrastructure. The design must not introduce per-browser-hour, per-minute, per-session, per-request or other usage-metered browser infrastructure.

## Production safety

This standalone repository is still pre-production. Phase 4 does not switch the live application from Browser Use. Provider integration happens only in the later Blueprint integration phase after the standalone runtime passes its subsequent gates.
