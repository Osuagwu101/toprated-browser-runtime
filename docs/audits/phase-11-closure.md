# Phase 11 Technical Closure Certificate

Status: **IN TEST / OWNER APPROVAL WITHDRAWN**

Date: 2026-09-07  
Canonical branch: `phase11-security-hardening`  
Diagnostic repair branch: `phase11-security-hardening-v2`  
Approved Phase 10 baseline: `0ed34da59138be76c5130e713dfccf932f30ee90`  
Blueprint: Master Blueprint v1.1  
Production Browser Use: unchanged and outside Phase 11 scope.

## Historical technical evidence

Phase 11 previously passed its dedicated adversarial matrix and all inherited Phase 1–10 workflows on implementation SHA `3944b8e9ea6bb243ca2eb1c6ebd66c93b0e56f42` and again on documented SHA `936af7e3f5a7122aea96aa2af7668bd7faafc470`.

Documented-head run IDs on `936af7e3f5a7122aea96aa2af7668bd7faafc470`:

- Phase 1–3: `34083781953` — SUCCESS
- Phase 4: `34083781887` — SUCCESS
- Phase 5: `34083781982` — SUCCESS
- Phase 6: `34083781926` — SUCCESS
- Phase 7: `34083781923` — SUCCESS
- Phase 8: `34083781893` — SUCCESS
- Phase 9: `34083781915` — SUCCESS
- Phase 10: `34083781920` — SUCCESS
- Phase 11: `34083781908` — SUCCESS

Those results remain valid historical evidence but are no longer sufficient for closure because a fresh owner-requested security diagnosis found additional defects after the initial approval.

## Approval withdrawal

The owner explicitly withdrew the earlier Phase 11 approval on 2026-09-07 and requested a fresh diagnosis and underlying fixes. The prior approval-record commit `2eb76e8d92378de0759bf8be2fe181df9dc42013` remains preserved as historical evidence, but it no longer authorizes completion, promotion, merge, or Phase 12.

## Fresh audit findings

### SB-011-006 — viewer rate-limit subject rotation and unbounded bucket state

The viewer limiter was keyed by `client address + session UUID` before session existence was established. A caller could rotate UUID-shaped session IDs so each request received a fresh bucket. The in-process limiter also retained every unique subject for the life of the worker process. Together these created a rate-limit bypass and an avoidable memory-exhaustion path.

Corrective implementation on `phase11-security-hardening-v2`:

- fixed-window buckets are bounded;
- expired buckets are pruned;
- new-subject churn fails closed when the bucket ceiling is reached;
- viewer traffic has an independent per-client budget in addition to the per-session budget; and
- the Phase 11 E2E rotates fake viewer UUIDs and requires HTTP 429 with positive `Retry-After`.

Status: **IMPLEMENTED / VERIFICATION REQUIRED**.

### SB-011-007 — crash cleanup could leave stale authentication-policy metadata

Authentication policy metadata was maintained in a second server-side map while browser lifecycle cleanup was owned by `BrowserSessionController`. Unexpected browser exit removed the browser session but did not synchronously remove the separate policy entry.

Corrective implementation on `phase11-security-hardening-v2`:

- policy metadata is reconciled against the live session inventory on worker requests and on a bounded periodic prune;
- explicit stop still deletes the session policy immediately; and
- shutdown clears the reconciliation timer and policy map after browser cleanup.

Status: **IMPLEMENTED / VERIFICATION REQUIRED**.

### SB-011-008 — Phase 11 verification fan-out was operationally fragile

Every historical workflow was configured to run on the canonical Phase 11 branch, while later composite workflows already re-execute substantial inherited behavior. A documentation-only approval commit therefore launched nine workflows and multiplied identical setup/build work.

On approval-record SHA `2eb76e8d92378de0759bf8be2fe181df9dc42013`, the nine jobs failed before normal workflow execution. Inspected jobs had no steps and no assigned GitHub-hosted runner. The exact account-level scheduler/billing/entitlement cause is **UNVERIFIED** because the available repository connector cannot read private account billing state.

Corrective process:

- repairs are isolated on `phase11-security-hardening-v2`, which is intentionally absent from historical workflow branch triggers;
- only the dedicated Phase 11 workflow is enabled on the repair branch;
- once the repaired Phase 11 gate is green, the canonical `phase11-security-hardening` branch will be advanced deliberately to that exact head, triggering the complete inherited Phase 1–11 matrix once;
- coverage is preserved; no inherited regression is disabled or weakened.

Status: **IMPLEMENTED / VERIFICATION REQUIRED**.

### SB-011-009 — worker server startup syntax regression

Repair head `ab85a27b0cb86010400a19254638c20a7897cdb9` contained a missing closing parenthesis in `browser-worker/src/server.mjs`, so the worker entrypoint could not parse. The 24 unit tests passed because they do not import the side-effectful server entrypoint, but the repository-wide syntax gate would reject the file before container execution.

Commit `0ab0edf3527eaf5588dce6e94d3d7cb0a4ceeec7` restored the missing parenthesis. Independent local validation passed the worker syntax check, 24/24 Node tests, workflow YAML parsing, and Python/JSON validation. GitHub run `34100837088` still failed before runner assignment with empty steps, `runner_id: 0`, zero billable milliseconds, and no generated log.

Status: **FIXED / LOCALLY VERIFIED / AUTHORITATIVE CI BLOCKED**.

## Preserved RED history

- `34083042244`: Phase 11 harness used case-sensitive `Retry-After` lookup; harness corrected.
- `34083201724`: API emitted fractional `Retry-After`; runtime corrected to a positive integer.
- approval-record SHA `2eb76e8d92378de0759bf8be2fe181df9dc42013`: nine workflow runs failed before runner acquisition; no test step executed. These failures remain blockers until the repair branch can execute and the canonical full matrix is green.
- `34100837088` on syntax-fix SHA `0ab0edf3527eaf5588dce6e94d3d7cb0a4ceeec7`: dedicated Phase 11 workflow again failed before runner acquisition; zero steps and zero billable milliseconds.

No RED evidence is discarded or relabeled green.

## Remaining closure conditions

Phase 11 is not technically green and cannot be presented for approval until all of the following are satisfied:

1. the dedicated Phase 11 workflow executes successfully on the exact `phase11-security-hardening-v2` repair head;
2. the canonical `phase11-security-hardening` branch is advanced to that repaired head and every authoritative Phase 1–11 workflow passes on that exact SHA;
3. the production Browser Use baseline is rechecked as unchanged;
4. any additional red result is diagnosed, fixed and preserved; and
5. only after a fresh technically-green completion certificate may the owner choose whether to approve Phase 11 again.

Phase 12 remains locked.
