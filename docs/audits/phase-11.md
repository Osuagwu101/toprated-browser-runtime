# Phase 11 — Security Hardening Audit

Status: **IN TEST / OWNER APPROVAL WITHDRAWN**

Date opened: 2026-09-07  
Canonical branch: `phase11-security-hardening`  
Diagnostic repair branch: `phase11-security-hardening-v2`  
Approved baseline: `main` at `0ed34da59138be76c5130e713dfccf932f30ee90`  
Blueprint: Master Blueprint v1.1  
Last completed phase: Phase 10 — COMPLETE / OWNER APPROVED  
Production Browser Use: outside scope and unchanged.

## Blueprint objective and exit gate

Phase 11 hardens every exposed boundary of the standalone runtime.

Exit gate:

> Security tests reject unauthorized paths.

Required validation includes forged/expired viewer authorization, cross-writer attacks, service-request replay, malformed protected requests, bounded rate limiting, no public raw CDP/Docker-socket/host-network exposure, and complete cleanup after adversarial tests.

## Original baseline findings and corrections

The approved Phase 10 baseline already had HMAC service authentication, replay rejection, worker/operator secrets, signed short-lived viewer grants, writer ownership, loopback host publication, dynamic loopback CDP, credential rejection, restrictive viewer headers, and deterministic session cleanup.

The initial Phase 11 audit found:

1. no API or worker request-rate limiter;
2. no single deterministic protected-request parsing contract;
3. unsigned protected query-string ambiguity;
4. ignored/unsupported request fields on several operations; and
5. writer identifier grammar applied later than the HMAC boundary.

Corrections added protected API request-policy middleware, SQLite-backed service/operator rate limits, worker/viewer fixed-window limits, strict JSON/media/body/query rules, unknown-field rejection, bounded signed writer grammar, forced JSON API exceptions, worker-side request-security primitives, and explicit deployment/network exposure checks.

## Original verification record

Material RED history retained:

- `34083042244`: Phase 11 harness treated `Retry-After` header names as case-sensitive. Corrected without weakening the positive-header assertion.
- `34083201724`: API emitted fractional `Retry-After` duration. Corrected by ceiling to a positive integer.

Implementation SHA `3944b8e9ea6bb243ca2eb1c6ebd66c93b0e56f42` passed the dedicated Phase 11 workflow and all inherited Phase 1–10 workflows. Final documented SHA `936af7e3f5a7122aea96aa2af7668bd7faafc470` also passed all nine authoritative workflows:

- Phase 1–3 `34083781953`;
- Phase 4 `34083781887`;
- Phase 5 `34083781982`;
- Phase 6 `34083781926`;
- Phase 7 `34083781923`;
- Phase 8 `34083781893`;
- Phase 9 `34083781915`;
- Phase 10 `34083781920`; and
- Phase 11 `34083781908`.

Those are historical green results, not current closure evidence after reopening.

## Approval withdrawal and fresh diagnosis

The owner withdrew the earlier Phase 11 approval on 2026-09-07 and instructed a fresh diagnosis of underlying issues. The previous approval-record SHA `2eb76e8d92378de0759bf8be2fe181df9dc42013` is retained in history but no longer authorizes promotion.

The fresh audit found three additional material defects.

### Finding 1 — viewer rate-limit key was attacker-expandable

Severity: **HIGH / GATE BLOCKER**.

Observed implementation:

- viewer rate limiting used `${clientAddress}:${viewerRoute.sessionId}`;
- a UUID-shaped route matched before session existence or viewer authorization was established; and
- `FixedWindowRateLimiter` stored subjects in an unbounded `Map` with no expiry pruning.

Underlying cause: the limiter trusted an attacker-controlled session identifier as part of the only viewer abuse key and did not place a memory bound around subject cardinality.

Consequence: a caller could rotate fake UUID-shaped session IDs to avoid the per-session budget and allocate persistent limiter buckets until worker restart.

Corrective implementation on `phase11-security-hardening-v2`:

- limiter buckets now have a configured hard ceiling;
- expired buckets are pruned before allocation;
- subject-cardinality overflow fails closed with HTTP 429 and positive `Retry-After`;
- viewer requests consume a per-client budget before the per-client/per-session budget; and
- unit/E2E regressions explicitly exercise subject churn and rotating fake viewer UUIDs.

Status: **IMPLEMENTED, UNVERIFIED until execution evidence exists**.

### Finding 2 — authentication-policy metadata had split lifecycle ownership

Severity: **MEDIUM / CLEANUP HARDENING**.

Observed implementation:

- browser sessions are owned and crash-reaped by `BrowserSessionController`;
- authentication policies were separately stored in `sessionAuthenticationPolicies` in the HTTP server; and
- explicit stop removed both, while unexpected browser exit removed only the controller-owned session.

Underlying cause: session-scoped metadata was duplicated outside the browser lifecycle owner without reconciliation on every cleanup path.

Corrective implementation on `phase11-security-hardening-v2`:

- policy metadata is reconciled against live session inventory on requests and on a bounded periodic timer;
- explicit close continues immediate deletion; and
- shutdown clears the timer and remaining metadata after browser cleanup.

Status: **IMPLEMENTED, UNVERIFIED until execution evidence exists**.

### Finding 3 — exact-head verification topology amplified every patch

Severity: **MEDIUM / VERIFICATION BLOCKER**.

Observed:

- all historical Phase 1–10 workflows were configured to trigger on the canonical Phase 11 branch;
- later composite workflows already replay substantial inherited behavior; and
- the documentation-only approval-record SHA `2eb76e8d92378de0759bf8be2fe181df9dc42013` therefore launched nine workflows.

All nine approval-record workflows failed before normal step execution. Inspected jobs showed no steps and no assigned GitHub-hosted runner (`runner_id: 0`). A retry reproduced the same pre-run signature. The exact private account-level scheduler/billing/entitlement cause remains **UNVERIFIED** because the repository connector cannot inspect account billing state.

Underlying repository/process cause: development-time commits on the canonical branch were coupled to the entire historical fan-out rather than reserving the full matrix for deliberate gate checkpoints.

Corrective process:

- repairs are being made on `phase11-security-hardening-v2`, which is not present in historical workflow branch triggers;
- only the dedicated Phase 11 workflow is enabled on the repair branch;
- once the dedicated gate is green, the canonical Phase 11 branch will be advanced to the exact repaired head, deliberately triggering the full inherited Phase 1–11 matrix once;
- no inherited assertion or workflow is deleted or weakened.

Status: **IMPLEMENTED, VERIFICATION REQUIRED**.

## Fresh adversarial regression additions

The repaired Phase 11 tests now require:

- bounded fixed-window subject cardinality;
- expiry pruning before new bucket allocation;
- fail-closed behavior when active bucket capacity is exhausted;
- per-client viewer abuse limiting independent of attacker-selected session IDs; and
- rotating fake viewer UUIDs to reach HTTP 429 with positive `Retry-After` rather than bypass the limiter.

All previous Phase 11 attack cases remain required.

## Invariant check

1. Browser Use preserved — **PASS / verified by repository separation; production integration not touched**.
2. Standalone separation maintained — **PASS**.
3. Generic core — **PASS by current source audit; full regression still required**.
4. Credentials never reach writers — **PASS by current source contract; execution regression still required**.
5. No raw CDP/unrestricted DevTools — **PASS by current source audit; runtime proof still required**.
6. Linux + Docker portability — **PASS by repository design; workflow proof still required on repaired head**.
7. Fixed-cost architecture — **PASS**.
8. Sensitive logging policy — **UNVERIFIED on repaired head pending execution**.
9. Spend discipline — **PASS**.
10. Session isolation — **UNVERIFIED on repaired canonical head pending inherited Phase 5 gate**.
11. Active sessions protected — **UNVERIFIED on repaired canonical head pending inherited Phase 6 gate**.
12. Abandoned sessions die — **UNVERIFIED on repaired canonical head pending inherited Phase 6 gate**.
13. Configurable capacity — **PASS architecturally; empirical capacity remains future Phase 18**.
14. Rollback — **N/A — FUTURE PHASE 15/19**.

## Gate status

Phase 11 is reopened. It is not technically green and is not approved.

Required sequence from here:

1. dedicated Phase 11 workflow must execute and pass on exact `phase11-security-hardening-v2` head;
2. canonical `phase11-security-hardening` must then advance to that exact repaired head;
3. all authoritative Phase 1–11 workflows must execute and pass on the canonical exact head;
4. production Browser Use baseline must be rechecked unchanged;
5. only then may a new `TECHNICALLY GREEN / AWAITING OWNER APPROVAL` certificate be issued.

Phase 12 remains locked.
