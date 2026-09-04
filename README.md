# Top Rated Browser Runtime

Standalone, Docker-portable self-hosted browser runtime for Top Rated SEO Tools.

## Verified source of truth

This private repository is now the verified standalone home of the self-hosted browser provider through **Phase 3**.

Standalone `main` was promoted through pull request #1 from the fully validated `verified-through-phase3` migration branch. The promoted runtime passed the combined Phase 1-3 workflow on `main` in GitHub Actions run `33857323898`, job `100973530886`.

Verified status:

- Phase 1 — isolated Laravel + Node + Chromium + Docker runtime foundation: GREEN.
- Phase 2 — repeated Chromium start/control/stop lifecycle with cleanup checks: GREEN.
- Phase 3 — restricted signed-token viewer with mouse, keyboard, scroll and reconnect support, without writer-facing raw CDP/DevTools exposure: GREEN.
- Phase 4 — NOT STARTED.

The existing Browser Use production path remains untouched.

## Architecture

- `api/` — Laravel control-plane foundation. Phase 4 session orchestration is not implemented yet.
- `browser-worker/` — Node.js Chromium worker, internal loopback-only CDP control, secure viewer frame capture and restricted input handling.
- `docker-compose.yml` — portable Linux + Docker topology with localhost-only host publication for the current development/CI environment.
- `docs/audits/` — migration, issue and phase-gate evidence.

The runtime core is intentionally generic and is not hardcoded to Phrasly or another tool.

## Phase 3 security model

- HMAC-SHA256 session-bound viewer grants.
- Signing secret minimum: 32 bytes.
- Viewer token TTL bounded to 900 seconds maximum.
- Initial token transport uses the URL fragment, then Bearer authorization.
- Missing, forged, expired and cross-session authorization is rejected.
- Viewer HTML does not contain the viewer token.
- Restrictive CSP, no-store, no-referrer, frame denial and related security headers.
- Restricted mouse/scroll/text/key input contract only.
- No writer-facing shell, DevTools UI, raw CDP URL or published CDP port.
- Chromium CDP remains internal to the worker and binds to `127.0.0.1` on a dynamic port.

## Local bootstrap

```bash
cp .env.example .env
# Replace VIEWER_SIGNING_SECRET with a random value of at least 32 bytes.
docker compose build
docker compose up -d
curl http://127.0.0.1:18080/api/health
curl http://127.0.0.1:18081/health
docker compose down -v --remove-orphans
```

## Financial rule

Final production capacity must run on predictable fixed-price Linux VPS infrastructure. The design must not introduce per-browser-hour, per-minute, per-session, per-request, or other usage-metered browser infrastructure.

## Production safety

This standalone repository is still pre-production. Nothing through Phase 3 switches the live application from Browser Use. Provider integration happens only in the later Blueprint integration phase after the standalone runtime passes its subsequent gates.
