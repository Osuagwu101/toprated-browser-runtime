# Top Rated Browser Runtime

Standalone, Docker-portable self-hosted browser runtime for Top Rated SEO Tools.

## Verified baseline

This repository is the intended standalone home of the self-hosted browser provider. The `verified-through-phase3` migration branch is being rebuilt from the repository-verified implementation in `Osuagwu101/topratedseotools-0bc24c5f` branch `self-hosted-browser-phase3`, whose final branch-head CI passed on source commit `1e20dfdb529117f237ef021a53f13190f88def16`.

The migrated runtime currently represents the end of **Phase 3**:

- Phase 1 — isolated Laravel + Node + Chromium + Docker runtime foundation.
- Phase 2 — deterministic Chromium start/control/stop lifecycle with cleanup checks.
- Phase 3 — restricted signed-token viewer with mouse, keyboard, scroll and reconnect support, without writer-facing raw CDP/DevTools exposure.

**Phase 4 has not started.** The existing Browser Use production path remains untouched.

## Architecture

- `api/` — Laravel control-plane foundation. Phase 4 session orchestration is not implemented yet.
- `browser-worker/` — Node.js Chromium worker, internal loopback-only CDP control, secure viewer frame capture and restricted input handling.
- `docker-compose.yml` — portable Linux + Docker topology with localhost-only host publication for the current development/CI environment.
- `docs/audits/` — phase and migration audit evidence.

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

This standalone repository is still pre-production. Nothing in this migration switches the live application from Browser Use. Provider integration happens only in the later Blueprint integration phase after the standalone runtime passes its own gates.
