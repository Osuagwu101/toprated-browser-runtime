# Phase 13 — Select and Purchase Contabo Plan

## Phase anchor

- Status: IN PROGRESS
- Blueprint: Master Blueprint v1.1
- Verified baseline: `main` at `1e12108cbd812cbf8a78d8266adc03847190e804`
- Last accepted phase: Phase 12
- Exit gate: VPS exists; access is available for deployment

## Audit report

Finding: No VPS existence, order, or deployment-access evidence is present at the verified baseline.

Severity: BLOCKING for the Phase 13 exit gate.

Evidence: The baseline contains the completed Phase 12 sizing record, but no Phase 13 audit record or VPS inventory.

Underlying cause: Phase 13 had not started and no server purchase had been authorized.

Blueprint impact: Phase 14 cannot deploy or run external health checks until a suitable VPS exists and secure administrative access is available.

Finding: The selected Cloud VPS uses shared virtual CPUs, whose real performance cannot be proven from its advertised core count.

Severity: OBSERVATION.

Evidence: Phase 12 measured the runtime on a four-logical-CPU GitHub runner, not on the selected Contabo host.

Underlying cause: Virtual CPU performance depends on the provider host and contention.

Blueprint impact: Phase 13 may select from measured sizing evidence, but Phase 18 must establish safe concurrency on the purchased VPS.

## Verified sizing basis

The corrected Phase 12 evidence measured a five-session browser-worker peak of 1,689 MiB plus approximately 60 MiB for the API container on a four-logical-CPU runner. Five-session frame p95 was 102–107 ms, and every run ended with zero Chromium, profile, and database-session residue.

## Owner-authorized selection

| Item | Selection |
| --- | --- |
| Provider | Contabo |
| Product | Cloud VPS 4 |
| Billing commitment | Monthly |
| CPU | 4 vCPU |
| Memory | 8 GB RAM |
| Storage | 100 GB SSD |
| Operating system | Ubuntu 24.04 LTS, 64-bit |
| Preferred region | Germany |
| Hostname | `browser-runtime-01` |
| Paid add-ons | None for initial validation unless required at checkout |
| Authentication | Owner-controlled SSH key; private key must never enter the repository or chat |

The owner selected Cloud VPS 4 and monthly billing on 2026-09-08 after reviewing the Phase 12 measurements. This selection is not a Phase 18 safe-concurrency claim.

## Purchase verification checklist

Phase 13 remains open until all of the following are verified:

- The final checkout page still identifies Cloud VPS 4, monthly billing, 4 vCPU, 8 GB RAM, and 100 GB SSD.
- The owner reviews and accepts the actual recurring charge, any tax, setup charge, region charge, and renewal terms.
- The order is paid and Contabo reports the instance as running.
- The instance has a public IP address and Ubuntu 24.04 LTS.
- Administrative SSH access is available using an owner-controlled key or a temporary credential that will be rotated during Phase 14.
- No password, private SSH key, recovery code, payment detail, or Contabo API credential is committed or sent to writers.

## Evidence ledger

- Repository selection record: implemented on `phase13-vps-selection`; inherited regression evidence pending.
- Owner-only purchase and access evidence: pending.
