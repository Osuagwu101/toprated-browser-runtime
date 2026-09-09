# Phase 14 — Deploy Standalone Runtime to Contabo

## Phase anchor

- Status: COMPLETE / OWNER APPROVED
- Blueprint: Master Blueprint v1.1
- Verified baseline: `main` at `fbfe54d86fa44bcd66125d38a4a9a689dcd73bf0`
- Deployed branch head: `6cdb1fb3f167f726bb669c900fa882b2137066e1`
- Last accepted phase: Phase 13
- Exit gate: Standalone Contabo runtime passes external functional and health checks
- Runtime hostname: `runtime.topratedseotools.com`

## Audit findings

### SB-014-001 — No production deployment bundle

- Severity: BLOCKER
- Underlying cause: deployment was intentionally deferred until Phase 14.
- Corrective action: added the production Caddy ingress, production Compose overlay, Ubuntu bootstrap, operator documentation, and external acceptance harness.
- Status: FIXED / LIVE VERIFIED / CLOSED.

### SB-014-002 — Existing host publications are loopback-only

- Severity: BLOCKER
- Underlying cause: this was the correct development/CI boundary through Phase 13, but Phase 14 required a separate public ingress.
- Corrective action: preserved the loopback API and worker publications and added an allowlisted HTTPS Caddy ingress.
- Status: FIXED / LIVE VERIFIED / CLOSED.

### SB-014-003 — Publishing the worker port would widen the attack surface

- Severity: MAJOR
- Corrective action: the worker remains private; ingress exposes only approved health, signed service lifecycle, and restricted viewer routes.
- Status: FIXED / LIVE VERIFIED / CLOSED.

### SB-014-004 — Live deployment required owner-only access and DNS actions

- Severity: BLOCKER until performed.
- Corrective action: the owner configured DNS, completed the first SSH connection, deployed the exact branch head, and rotated the initially disclosed root password. No password, SSH private key, or runtime secret was committed.
- Status: RESOLVED / CLOSED.

### SB-014-005 — Initial readiness workflow referenced staging-only paths

- Severity: MAJOR / CI blocker.
- RED evidence: run `34225639108`, job `102058965528`.
- Underlying cause: the first repository commit retained the local staging-directory prefix.
- Corrective action: changed workflow, bootstrap, and operator-document paths to the committed repository paths.
- Status: FIXED / CLOSED.

### SB-014-006 — Compose isolation assertion depended on display formatting

- Severity: MAJOR / CI blocker.
- RED evidence: run `34225926344`, job `102059914824`.
- Underlying cause: Docker Compose rendered published ports as structured YAML rather than the compact string assumed by the test.
- Corrective action: validate Compose JSON using exact target, published-port, and host-IP assertions.
- Status: FIXED / CLOSED.

### SB-014-007 — Secret scanner treated a documented placeholder as a secret

- Severity: MAJOR / CI blocker.
- RED evidence: run `34226248226`, job `102060981096`.
- Corrective action: exclude only the required placeholder template and synthetic fixture while retaining scanning for real tracked secrets.
- Status: FIXED / CLOSED.

### SB-014-008 — Inherited workflows omitted the Phase 14 branch trigger

- Severity: MAJOR / regression-gate blocker.
- Corrective action: added `phase14-contabo-deployment` to every inherited workflow without weakening any test.
- Status: FIXED / VERIFIED / CLOSED.

### SB-014-009 — Final completion-ledger Phase 10 composite exposed reconnect test timing race

- Severity: MAJOR / inherited-regression blocker.
- RED evidence: final-ledger run `34417335128`, job `102685005693`, step `Preserve Phase 6 lifecycle and restart regression`.
- Observed symptom: the reconnect fixture received HTTP 409 `SESSION_NOT_ACTIVE` while requesting a fresh viewer grant.
- Underlying cause: the test aged the heartbeat to only two seconds inside the disconnect boundary while the one-second autonomous reaper was active. Scheduling load could consume that margin before the reconnect call.
- Corrective action: retain the deliberately aged reconnect case but use a ten-second scheduling margin inside the same configured grace window.
- Security/lifecycle effect: no production timeout, reaper policy, assertion, or runtime behavior was weakened.
- Status: FIXED / FINAL EXACT-HEAD VERIFICATION REQUIRED.

## Live deployment evidence — 2026-09-09

- Ubuntu VPS reachable through owner-controlled SSH.
- Docker `29.1.3`, Docker Compose `2.40.3`, and Git `2.43.0` installed; Docker service active.
- Exact deployment source observed at `6cdb1fb3f167f726bb669c900fa882b2137066e1`.
- Bootstrap generated mode-0600 external secrets, enabled UFW, and exposed only SSH, HTTP, and HTTPS.
- API and browser-worker containers reported healthy; ingress and lifecycle reaper were running.
- `https://runtime.topratedseotools.com/api/health` returned `status: ok` both from the VPS and from the owner's separate Windows network.
- The approved `scripts/phase14-external-acceptance.py` harness ran from that external Windows network and returned `result: PASS`, exit code `0`.
- Passed checks: health, TLS/HSTS, unsigned API rejection, worker-control privacy, real Chromium creation with restricted viewer, and exact cleanup.
- The runtime service secret was transferred only over SSH into process memory, removed after the test, and was not printed.
- The initially disclosed root password was replaced successfully before closure.
- Owner explicitly approved Phase 14 closure on 2026-09-09.

## Invariants

1. Production Browser Use default untouched — PASS.
2. Standalone repository/deployment boundary — PASS.
3. Generic runtime core — PASS.
4. No writer access to privileged material — PASS.
5. No writer-facing raw CDP/DevTools or host escape — PASS.
6. Portable Linux/Docker implementation — PASS.
7. Fixed-cost VPS architecture — PASS.
8. No secrets in ordinary logs or source — PASS.
9. Spending sequence respected — PASS.
10. Per-writer/session Chromium isolation — PASS via inherited Phase 5 regression.
11. Renewable active-session lifecycle — PASS via inherited Phase 6 regression.
12. Abandoned/orphan cleanup — PASS via inherited Phase 6 regression and live cleanup.
13. Configurable concurrency retained — PASS; empirical ceiling remains Phase 18.
14. Provider rollback — N/A, future Phase 15/19.

## Verification status

- Repository readiness and inherited exact-head CI: PASS on the deployed source head.
- Live external acceptance: PASS.
- Owner approval: RECEIVED.
- PR #16 merged to `main` at `778efa353aed5c75c5f9a0ecee9d4fef42ec26c6`.
- All 12 authoritative workflows passed on that exact merged commit: `34416889598`, `34416889593`, `34416889637`, `34416889595`, `34416889606`, `34416889630`, `34416889592`, `34416889596`, `34416889670`, `34416889624`, `34416889700`, and `34416889612`.
- Phase 14 is COMPLETE / OWNER APPROVED. Phase 15 remains NOT STARTED.
