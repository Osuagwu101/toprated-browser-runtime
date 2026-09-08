# Phase 12 — Performance Testing Before VPS

## Phase anchor

- Status: IN TEST
- Blueprint: Master Blueprint v1.1
- Baseline: `main` at `5e6bd28ae3664b96b20b5f598fabe0ed9c3091ef`
- Last accepted phase: Phase 11
- Exit gate: measured evidence for server sizing, not assumptions

## Audit report

Finding: The accepted baseline had no Phase 12 benchmark harness or measurement artifact.

Severity: BLOCKING for the Phase 12 gate.

Evidence: Repository tree and workflows through Phase 11 at the baseline SHA contained no Phase 12 performance workflow, test, or audit record.

Underlying cause: Phase 12 had not yet been implemented.

Blueprint impact: VPS sizing could only be guessed, so Phase 13 purchasing/deployment decisions were not yet authorized by evidence.

## Measurement contract

The benchmark uses a deterministic, local, generic HTML workload inside the browser-worker container. It measures startup, restricted viewer status/frame/input responsiveness, container CPU and memory observations, shutdown, and residue at 1, 3, and 5 simultaneous browser sessions with two repetitions per level.

The CI-only tool profile is injected into the build workspace and is not added to the production tool catalogue. External tool/network latency is deliberately excluded from the sizing baseline.

The workflow fails if a browser operation fails, a measurement artifact is absent, configured capacity is inconsistent, or Chromium processes, browser profiles, or open database sessions remain after a run. It does not use invented pass/fail latency thresholds.

## Interpretation boundary

GitHub-hosted runner results provide a reproducible comparative baseline for Phase 13 server sizing. They do not prove safe production concurrency on a selected VPS. Phase 18 owns the maximum-safe-concurrency gate on the real deployed server.

## Evidence ledger

Pending first execution on the exact Phase 12 branch head.
