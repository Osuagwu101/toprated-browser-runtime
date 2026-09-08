# Phase 12 — Performance Testing Before VPS

## Phase anchor

- Status: COMPLETE
- Blueprint: Master Blueprint v1.1
- Baseline: `main` at `5e6bd28ae3664b96b20b5f598fabe0ed9c3091ef`
- Last accepted phase: Phase 12 (owner approved 2026-09-08)
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

- Run 34188600086 on `6dd01c9202216709c1de97027ee1207e067c1dad` executed every Phase 12 step successfully and produced artifact `10041422225` (`sha256:2cd93deb9fe0437b6b0c00c6be280a07c4153e861b12df421db147ac53b47169`).
- Review of that artifact found that the p95 helper used a floor index. For small sample sets this understated tail latency, so those percentile summaries are superseded and are not accepted as sizing evidence.
- Run 34188867420 on `49709837b16b6ffdfc7b9ab05eb16f9a2be3e656` corrected the percentile calculation and passed every workflow step. Artifact `10041507818` has digest `sha256:d325f4f8eddf7f57f96ef4c5ac29b2973f6541a47413279fc3f49eee21fadb2b`.
- Raw corrected evidence is preserved in `docs/evidence/phase12-performance-49709837.json`.

## Corrected results

The GitHub runner exposed 4 logical CPUs and 15.61 GiB RAM. Values below are the range across two independent repetitions.

| Active sessions | Batch startup | Startup p95 | Frame p95 | Input p95 | Worker peak sample | Cleanup batch |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 702–729 ms | 701–727 ms | 51–53 ms | 65–66 ms | 361 MiB | 290–292 ms |
| 3 | 2,473–2,550 ms | 2,472–2,549 ms | 70–71 ms | 69–70 ms | 1,048 MiB | 860–868 ms |
| 5 | 4,348–4,401 ms | 4,345–4,398 ms | 102–107 ms | 75–77 ms | 1,689 MiB | 1,461–1,462 ms |

The API container remained approximately 60 MiB. Every repetition ended with zero Chromium PIDs, zero browser profiles, and zero open database sessions.

## Sizing interpretation

At the tested workload, browser-worker memory rose to approximately 0.36 GiB at one session, 1.02 GiB at three, and 1.65 GiB at five. The observed slope is about 0.33 GiB per active browser. Phase 13 should evaluate candidate server memory against the five-session 1.65 GiB worker observation plus the API, operating-system, Docker, monitoring, and safety headroom. This record intentionally does not select or purchase a VPS.

Session creation is intentionally serialized by `SessionManager::withCreationLock()` to protect global capacity and ownership invariants. The roughly linear concurrent-batch startup time is therefore an expected safety tradeoff, not proof of CPU saturation.

An exact-head run of the Phase 12 gate and every inherited Phase 1–11 regression is required immediately before owner approval. The immutable workflow run links are recorded in the Phase 12 pull request.

## Completion record

- Owner approval: explicitly provided in the project session on 2026-09-08.
- Promotion: PR #14 merged to `main` as `42f0d07856b5ed2b848f1c0f9952d6f760db4dd8`.
- Main promotion validation: all authoritative Phase 1–12 workflows completed successfully on the merge commit.
- Verified Through Phase 3: run 34191945046.
- Phase 4: run 34191944962.
- Phase 5: run 34191945134.
- Phase 6: run 34191945015.
- Phase 7: run 34191945079.
- Phase 8: run 34191944977.
- Phase 9: run 34191945019.
- Phase 10: run 34191945030.
- Phase 11: run 34191945005.
- Phase 12: run 34191945024.
- Closure rule: the documentation commit that records completion must itself pass the same exact-head workflow set.
