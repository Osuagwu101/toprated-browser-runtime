# Phase 4 Audit — Laravel Session API & Ownership

Status: **BRANCH IMPLEMENTATION GREEN / PROMOTION PENDING**.

Phase 4 is not marked complete by this document. The verified branch must pass this audit/documentation head, be promoted through a pull request to standalone `main`, and pass the Phase 4 workflow again on `main`. Only then may the completion wording be changed to GREEN / COMPLETE.

## Blueprint scope

The Master Blueprint v1.1 defines Phase 4 as:

- implement create, status, heartbeat/activity, close, health and capacity responsibilities;
- add ownership, basic service authentication and persistent session records; and
- prove that Laravel reliably owns browser lifecycle.

Multi-writer Chromium isolation is Phase 5. Renewable lease, idle/disconnect cleanup, watchdog and restart reconciliation are Phase 6. They are deliberately not claimed here.

## Verified baseline

Standalone repository: `Osuagwu101/toprated-browser-runtime`

Phase 4 branch: `phase4-laravel-session-api`

Baseline: standalone `main` commit `bfb6a1404481d88541b5af16423478d54d501d2f`, verified through Phase 3.

The production Top Rated SEO Tools application repository was not modified as part of Phase 4 development.

## Implemented control plane

Laravel now owns the Phase 4 browser lifecycle through these routes:

- `POST /api/sessions`
- `GET /api/sessions/{id}`
- `POST /api/sessions/{id}/heartbeat`
- `POST /api/sessions/{id}/activity`
- `POST /api/sessions/{id}/viewer-grant`
- `DELETE /api/sessions/{id}`
- `GET /api/health`
- `GET /api/capacity`

The API persists browser-session records in SQLite on a named Docker volume. Records include opaque runtime session ID, writer ownership, tool slug, lifecycle status, worker session ID, heartbeat/activity timestamps, start/close timestamps and failure/termination metadata. Data-URL launch content is not persisted verbatim; the Phase 4 regression verifies the stored value is reduced to `data:text/html`.

## Ownership and lifecycle behavior

- A signed writer identity is bound to each session record.
- Status, heartbeat, activity, viewer-grant renewal and close enforce ownership.
- A different writer receives `SESSION_FORBIDDEN` when attempting to act on the session.
- The same writer/tool reuses the same healthy browser and receives a fresh short-lived viewer grant.
- A second writer is refused with `CAPACITY_FULL` while the deliberate Phase 4 single slot is occupied.
- Worker/session mismatches are not killed blindly; the record is failed rather than terminating an unrelated worker session.
- Explicit close verifies worker cleanup and then records terminal state.
- Session records survive a Laravel container restart.

## Service authentication

External service-to-Laravel control requests use HMAC-SHA256 signing over:

`METHOD + PATH + TIMESTAMP + NONCE + WRITER_ID + SHA256(BODY)`

The middleware validates bounded timestamp skew, signature format, writer identity participation in the signature, and one-time nonce use. Valid nonces are persisted and replayed requests are rejected.

Laravel-to-worker lifecycle control is separately protected by an internal `WORKER_CONTROL_SECRET`; direct unauthenticated calls to `/browser/*` are rejected. The worker remains host-published only on loopback in the current development/CI topology.

## Viewer authorization responsibility

Laravel is now the operational issuer of viewer grants. The writer-bound grant contains session ID, writer ID, issue/expiry times and a random token ID, and uses the existing HMAC viewer signing secret. The worker verifies signed bearer grants but no longer exposes a production lifecycle route that mints them.

The inherited Phase 3 viewer functionality remains regression-tested: JPEG frame capture, mouse, text/keyboard, scrolling, reconnect to the same Chromium process, restricted input contract, signed-token rejection behavior and viewer invalidation after browser close.

## Configuration readiness

Phase 4 health is not considered green unless:

- database access works;
- the worker is healthy and reports Laravel as lifecycle owner/viewer-grant issuer;
- runtime service-auth secret is at least 32 bytes;
- worker-control secret is at least 32 bytes;
- viewer signing secret, token TTL and public viewer base URL are valid; and
- `MAX_BROWSER_SESSIONS=1` while Phase 5 multi-session isolation is not yet implemented.

Viewer-grant configuration is checked before Chromium launch so a bad viewer configuration cannot first be discovered after a browser has already been created.

## CI history — failures retained

### Run 1 — RED

Run `33866819180`, job `101003454022`, head `62625472a95eed6a3e4d1aeaa7cad32632e3a611`.

The inherited Phase 1-3 regression script hard-asserted that the Laravel API health payload was still Phase 3. The Phase 4 API correctly reported Phase 4, so the inherited regression step failed before the new Phase 4 end-to-end tests executed. The harness was corrected to preserve old browser/viewer behavior while accepting the new control-plane phase contract. This failure remains part of the audit history.

### Run 2 — RED

Run `33866993636`, job `101003995956`, head `ec1788077af1c94617e8f201e9da4adb57240b84`.

During the source audit, worker lifecycle routes were hardened with `WORKER_CONTROL_SECRET`, but the CI environment was not updated in the same commit. Docker Compose therefore could not build/resolve the required configuration. The workflow was corrected and a regression assertion now verifies that unauthenticated worker lifecycle access is rejected.

### Run 3 — GREEN

Run `33867076595`, job `101004249308`, head `dee3771615a7723e2bca1eefc1806664f680046b`.

All Phase 4 workflow steps passed after worker lifecycle-control protection and the corrected regression harness.

### Run 4 — GREEN

Run `33867803222`, job `101006527699`, head `2976bcd44edad8ee29c6f02aa0c84d9252c6df09`.

All workflow steps passed after removing legacy worker-side viewer-grant issuance and making the worker health contract explicitly report Laravel as lifecycle owner and grant issuer.

### Run 5 — GREEN

Run `33868000840`, job `101007143931`, head `01a71d104e8535a51a64e8dc6b8c220497bf6636`.

All workflow steps passed after configuration-readiness checks were added. The run passed static/unit checks, Docker build/boot, Phase 4 health, inherited Phase 1-3 regression, signed Phase 4 API lifecycle and ownership checks, sensitive-state persistence checks, Laravel restart persistence, independent Chromium cleanup, container status and complete teardown.

## Material issues

See `docs/audits/ISSUE_REGISTER.md`. Phase 4 issues found during implementation/audit are retained there with their failure evidence and corrections.

## Deliberately deferred blueprint work

These are not Phase 4 completion claims:

- multiple simultaneous writer browsers, cookie/storage isolation and cross-session viewer attack testing — Phase 5;
- 90-minute renewable lease, idle timeout, disconnect grace, reaper/watchdog and restart reconciliation — Phase 6;
- generic tool-profile framework — Phase 7;
- Phrasly saved-state injection and authentication verification — Phase 8/9;
- broader security hardening/rate limiting/TLS deployment — later blueprint phases.

The current worker remains deliberately single-session and Phase 4 refuses `MAX_BROWSER_SESSIONS` values other than 1 rather than pretending unsupported concurrency exists.

## Phase 4 branch exit gate

The technical Phase 4 implementation is GREEN on run `33868000840`. Final Phase 4 closure still requires:

1. this audit/documentation head to pass the Phase 4 workflow;
2. promotion through a pull request into standalone `main`;
3. the same Phase 4 workflow to pass on the resulting `main` head; and
4. re-verification that the production application Browser Use baseline remains unchanged.

Until those conditions pass, Phase 4 remains **PROMOTION PENDING**, and Phase 5 must not begin.
