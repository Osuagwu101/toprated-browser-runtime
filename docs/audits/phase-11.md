# Phase 11 — Security Hardening Audit

Status: **TECHNICALLY GREEN / AWAITING OWNER APPROVAL**

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

Status: **FIXED / VERIFIED**.

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

Status: **FIXED / VERIFIED**.

### Finding 3 — exact-head verification topology amplified every patch

Severity: **MEDIUM / VERIFICATION BLOCKER**.

Observed:

- all historical Phase 1–10 workflows were configured to trigger on the canonical Phase 11 branch;
- later composite workflows already replay substantial inherited behavior; and
- the documentation-only approval-record SHA `2eb76e8d92378de0759bf8be2fe181df9dc42013` therefore launched nine workflows.

All nine approval-record workflows failed before normal step execution. Inspected jobs showed no steps and no assigned GitHub-hosted runner (`runner_id: 0`). A retry reproduced the same pre-run signature. The exact private account-level scheduler/billing/entitlement cause remains **UNVERIFIED** because the repository connector cannot inspect account billing state.

Underlying repository/process cause: development-time commits on the canonical branch were coupled to the entire historical fan-out rather than reserving the full matrix for deliberate gate checkpoints.

Corrective process and verified result:

- the repair branch isolated diagnosis until the dedicated Phase 11 gate could execute;
- after public visibility removed the billing restriction, run `34101080702` attempt 2 acquired a runner and passed;
- commit `93e380dad9b53f56bdca559cbf10f8a1864dfdc3` added the repair branch to all eight inherited workflow triggers;
- the resulting exact-head Phase 1–11 matrix passed without deleting or weakening any inherited assertion.

Status: **FIXED / VERIFIED**.

### Finding 4 — repaired worker entrypoint did not parse

Severity: **HIGH / GATE BLOCKER**.

Observed on repair head `ab85a27b0cb86010400a19254638c20a7897cdb9`: `node --check browser-worker/src/server.mjs` failed with `SyntaxError: missing ) after argument list` at the `server.listen(...)` startup statement. The dedicated workflow never exposed this result because GitHub failed the job before runner assignment.

Underlying cause: the earlier server-start log hardening edit removed one closing parenthesis. The unit suite did not import the side-effectful server entrypoint, so its 24 passing tests did not cover entrypoint parsing; the repository-wide syntax gate would have caught the defect if a runner had executed it.

Corrective action: commit `0ab0edf3527eaf5588dce6e94d3d7cb0a4ceeec7` restored the missing parenthesis without changing runtime behavior or weakening any test. Independent local evidence on the exact source: worker entrypoint syntax PASS; 24/24 Node tests PASS; workflow YAML PASS; Python and JSON validation PASS.

GitHub run `34100837088` preserved the pre-run failure signature. After public visibility removed the private-repository billing restriction, run `34101080702` attempt 2 and exact-head run `34183463821` both executed normally and passed the repository-wide syntax gate and complete Phase 11 security workflow. The correction is **FIXED / VERIFIED**.

## Fresh adversarial regression additions

The repaired Phase 11 tests now require:

- bounded fixed-window subject cardinality;
- expiry pruning before new bucket allocation;
- fail-closed behavior when active bucket capacity is exhausted;
- per-client viewer abuse limiting independent of attacker-selected session IDs; and
- rotating fake viewer UUIDs to reach HTTP 429 with positive `Retry-After` rather than bypass the limiter.

All previous Phase 11 attack cases remain required.

## Infrastructure recovery and exact-head validation

The repository is now public. This removed the private-repository billing path that had prevented GitHub-hosted runner allocation. Run `34101080702` attempt 2 proved recovery on repair SHA `0c2bdc9b2cf40161e833bfd8e5b704ed371ebb9a`.

Commit `93e380dad9b53f56bdca559cbf10f8a1864dfdc3` corrected inherited trigger coverage and passed the complete authoritative matrix:

- Phase 1–3: `34183463854`;
- Phase 4: `34183463822`;
- Phase 5: `34183463839`;
- Phase 6: `34183463886`;
- Phase 7: `34183463859`;
- Phase 8: `34183463875`;
- Phase 9: `34183463851`;
- Phase 10: `34183463893`; and
- Phase 11: `34183463821`.

Every job completed successfully with normal steps and no failed step. Production Browser Use remains in the separate `Osuagwu101/topratedseotools-0bc24c5f` repository; its current `main` head was rechecked at `ccd8b51a15bf564479ac8a3022f639011dcbb5d0` and was not modified by this work.

## Invariant check

1. Browser Use preserved — **PASS; separate production repository rechecked unchanged by Phase 11 work**.
2. Standalone separation maintained — **PASS**.
3. Generic core — **PASS; Phase 7, 10, and 11 exact-head workflows**.
4. Credentials never reach writers — **PASS; Phase 8–11 exact-head security regressions**.
5. No raw CDP/unrestricted DevTools — **PASS; Phase 1–3 and Phase 11 runtime checks**.
6. Linux + Docker portability — **PASS; all exact-head workflows built and booted the Docker runtime**.
7. Fixed-cost architecture — **PASS**.
8. Sensitive logging policy — **PASS; Phase 11 log-leak gate**.
9. Spend discipline — **PASS**.
10. Session isolation — **PASS; Phase 5 exact-head workflow**.
11. Active sessions protected — **PASS; Phase 6 exact-head workflow**.
12. Abandoned sessions die — **PASS; Phase 6 and Phase 10 exact-head workflows**.
13. Configurable capacity — **PASS architecturally; empirical capacity remains future Phase 18**.
14. Rollback — **N/A — FUTURE PHASE 15/19**.

## Gate status

The Phase 11 exit gate—security tests reject unauthorized paths—is satisfied on exact repair checkpoint `93e380dad9b53f56bdca559cbf10f8a1864dfdc3`. The dedicated security workflow and every inherited Phase 1–10 workflow passed.

Status: **TECHNICALLY GREEN / AWAITING OWNER APPROVAL**.

Phase 12 remains locked until the owner explicitly approves Phase 11 completion.
