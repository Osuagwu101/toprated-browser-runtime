# Phase 14 — Deploy Standalone Runtime to Contabo

## Phase anchor

- Status: IN PROGRESS
- Blueprint: Master Blueprint v1.1
- Verified baseline: `main` at `fbfe54d86fa44bcd66125d38a4a9a689dcd73bf0`
- Last accepted phase: Phase 13
- Exit gate: Standalone Contabo runtime passes external functional and health checks

## Audit findings

### SB-014-001 — No production deployment bundle

- Severity: BLOCKER
- Evidence: the Phase 13 baseline contained portable development/CI Compose topology but no Contabo deployment, ingress, bootstrap, or external acceptance assets.
- Underlying cause: deployment was intentionally deferred until Phase 14.
- Blueprint impact: the Phase 14 exit gate could not be executed reproducibly.
- Status: FIX IMPLEMENTED, UNVERIFIED.

### SB-014-002 — Existing host publications are loopback-only

- Severity: BLOCKER
- Evidence: `docker-compose.yml` publishes API and worker ports only on `127.0.0.1`.
- Underlying cause: this was the correct development and CI security boundary through Phase 13; Phase 14 requires a separate production ingress.
- Blueprint impact: external health and viewer checks had no approved public route.
- Status: FIX IMPLEMENTED, UNVERIFIED.

### SB-014-003 — Publishing the worker port would widen the attack surface

- Severity: MAJOR
- Evidence: the worker listener serves both `/viewer/*` and private `/browser/*` control routes.
- Underlying cause: one private worker service intentionally owns both functions inside the Docker network.
- Blueprint impact: direct publication would expose unnecessary authenticated control endpoints and worker health to the Internet.
- Status: FIX IMPLEMENTED, UNVERIFIED; ingress allowlists only viewer routes.

### SB-014-004 — Live deployment requires owner-only access and DNS actions

- Severity: BLOCKER until performed.
- Evidence: the engineering workspace has no route to arbitrary public IPs and must not receive the owner's VPS password, SSH private key, or runtime secrets.
- Underlying cause: provider access, DNS control, and secrets are intentionally owner-controlled.
- Blueprint impact: repository validation alone cannot satisfy the external runtime gate.
- Status: OPEN.

### SB-014-005 — Initial readiness workflow referenced staging-only paths

- Severity: MAJOR / CI blocker.
- Evidence: run `34225639108`, job `102058965528`, failed in `Validate deployment files` because `phase14/scripts/bootstrap_ubuntu.sh` did not exist in the checkout.
- Underlying cause: the first repository commit retained the local staging-directory prefix even though files were committed at repository-root `scripts/` and `deploy/` paths.
- Corrective action: changed every workflow, bootstrap, and operator-document path to the exact committed repository path.
- Status: FIX IMPLEMENTED, UNVERIFIED pending corrected run.

## Verification required

- Deployment bundle static/config validation.
- Production container build and local health/security regression.
- All inherited Phase 1–13 workflows on the exact branch head.
- Owner-controlled first SSH/key hardening and DNS configuration.
- Live external acceptance from outside the VPS network, including real Chromium creation, restricted viewer use, negative authorization checks, and cleanup.
- Exact merged `main` validation after owner approval.

No production Browser Use integration is part of Phase 14.
