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
- Phase 6 — NOT STARTED.

The existing Browser Use production path remains untouched.

## Phase 5 closure evidence

Phase 5 was developed on `phase5-session-isolation` from approved Phase 4 standalone `main` commit `156372e912b4792baab471263202c5d867131ec4`.

The implementation proves:

- multiple simultaneous writer sessions using separate Chromium processes and separate temporary user-data directories;
- cookie, `localStorage` and `sessionStorage` isolation even when writers use the same origin;
- writer ownership enforcement for status, heartbeat, activity, viewer-grant renewal and close operations;
- viewer grants remain bound to the exact worker session and cross-session token use is rejected;
- killing one writer's Chromium does not terminate or corrupt another writer's active browser; and
- explicit cleanup removes Chromium process and profile residue.

The exact typecheck-enabled Phase 5 branch head `ea00b239e20382125e53ad317acf52ea1a071f29` passed:

- inherited Phase 1-3 regression run `33883567911`;
- Phase 4 Laravel ownership regression run `33883568115`; and
- Phase 5 multi-writer isolation run `33883567965`.

Each current workflow runs `scripts/typecheck.sh`, which checks all Node `.mjs` files with `node --check`, all non-vendor PHP files with `php -l`, Python tests with `py_compile`, JSON manifests with `json.tool`, and Docker Compose configuration with `docker compose config --quiet`.

## Architecture

- `api/` — Laravel control plane: signed service API, persistent session records, writer ownership, capacity, lifecycle orchestration and viewer-grant issuance.
- `browser-worker/` — generic Node.js Chromium worker: authenticated session-scoped lifecycle control, loopback-only CDP, isolated Chromium profiles, restricted frame/input viewer and signed-grant verification.
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

Phase 5 removes the deliberate Phase 4 one-slot limitation. `MAX_BROWSER_SESSIONS` is configuration, is validated, and supports the blueprint design ceiling of 15. Phase 5 correctness CI uses 3 slots; broader 5/10/15 concurrency and server sizing remain Phase 18 and Phase 12 work respectively.

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

Required launch-critical configuration includes a valid Laravel `APP_KEY`, `RUNTIME_SERVICE_AUTH_SECRET`, `WORKER_CONTROL_SECRET`, `VIEWER_SIGNING_SECRET`, viewer TTL/base URL and a valid `MAX_BROWSER_SESSIONS` value from 1 through 15.

## Blueprint sequencing

Not implemented or claimed in Phase 5:

- Phase 6 renewable 90-minute lease, genuine-activity renewal, idle/disconnect cleanup, watchdog/reaper and restart reconciliation;
- Phase 7 generic tool-profile framework;
- Phase 8 Phrasly saved-state injection and authenticated reference implementation;
- later production provider routing, deployment, hardening and measured capacity work.

These remain later Blueprint gates. Phase 6 has not been started.

## Financial rule

Final production capacity must run on predictable fixed-price Linux VPS infrastructure. The design must not introduce per-browser-hour, per-minute, per-session, per-request or other usage-metered browser infrastructure.

## Production safety

This standalone repository is still pre-production. Phase 5 does not switch the live application from Browser Use. Provider integration happens only in the later Blueprint integration phase after the standalone runtime passes its subsequent gates.
