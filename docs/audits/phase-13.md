# Phase 13 — Select and Purchase Contabo Plan

## Phase anchor

- Status: COMPLETE
- Blueprint: Master Blueprint v1.1
- Verified baseline: `main` at `1e12108cbd812cbf8a78d8266adc03847190e804`
- Last accepted phase: Phase 12
- Exit gate: VPS exists; access is available for deployment

## Audit report

Finding: No VPS existence, order, or deployment-access evidence was present at the verified baseline.

Severity: BLOCKING for the Phase 13 exit gate at phase start; resolved by the owner-only purchase and provisioning evidence recorded below.

Evidence: The baseline contained the completed Phase 12 sizing record, but no Phase 13 audit record or VPS inventory.

Underlying cause: Phase 13 had not started and no server purchase had been authorized.

Blueprint impact: Phase 14 could not deploy or run external health checks until a suitable VPS existed and secure administrative access was available.

Finding: The selected Cloud VPS uses shared virtual CPUs, whose real performance cannot be proven from its advertised core count.

Severity: OBSERVATION.

Evidence: Phase 12 measured the runtime on a four-logical-CPU GitHub runner, not on the selected Contabo host.

Underlying cause: Virtual CPU performance depends on the provider host and contention.

Blueprint impact: Phase 13 may select from measured sizing evidence, but Phase 18 must establish safe concurrency on the purchased VPS.

## Verified sizing basis

The corrected Phase 12 evidence measured a five-session browser-worker peak of 1,689 MiB plus approximately 60 MiB for the API container on a four-logical-CPU runner. Five-session frame p95 was 102–107 ms, and every run ended with zero Chromium, profile, and database-session residue.

## Purchased configuration

| Item | Verified selection |
| --- | --- |
| Provider | Contabo |
| Product | Cloud VPS 4 |
| Billing commitment | Monthly |
| Recurring service charge shown after purchase | EUR 5.50/month |
| CPU | 4 vCPU |
| Memory | 8 GB RAM |
| Storage | 100 GB SSD |
| Operating system | Ubuntu 24.04 LTS, 64-bit |
| Region | European Union |
| Planned hostname | `browser-runtime-01` |
| Paid add-ons | None observed in the service record |
| Authentication | Initial owner-controlled administrative credentials issued; replace or harden with owner-controlled SSH key during Phase 14 |
| Secret handling | No password, private key, recovery code, payment detail, customer identifier, server address, or Contabo API credential recorded in the repository |

The owner selected Cloud VPS 4 and monthly billing on 2026-09-08 after reviewing the Phase 12 measurements. The live checkout offered European Union rather than a Germany-specific option, and the owner selected the no-surcharge European Union region. This selection is not a Phase 18 safe-concurrency claim.

## Purchase and access evidence

Owner-only evidence supplied on 2026-09-08 established the following without preserving secret values:

- Card payment was reported successful.
- The Contabo service inventory lists Cloud VPS 4 on monthly billing.
- The provisioned service has public IPv4 and IPv6 addressing.
- The location is Hub Europe / European Union.
- The operating system is Ubuntu 24.04.
- The VPS-control page displays the provisioned VPS and its active status indicator.
- Contabo sent the `Ihre Logindaten!` server-access email.
- The owner confirmed that its VPS credential row is populated with server address, administrative username, and password.
- Sensitive credential values were deliberately not sent to the repository or writers.

A direct TCP/SSH probe from the engineering workspace could not be performed because that workspace cannot route to arbitrary public IP addresses. This is an environment limitation, not a VPS failure. The first authenticated SSH connection and credential rotation/key hardening remain Phase 14 deployment actions.

## Verification checklist

- [x] Cloud VPS 4, monthly billing, 4 vCPU, 8 GB RAM, and 100 GB SSD selected.
- [x] Actual recurring charge and renewal timing reviewed in the post-purchase service record.
- [x] Order paid and provisioned VPS shown in Contabo VPS control.
- [x] Public addressing and Ubuntu 24.04 verified.
- [x] Administrative access material issued to the owner without exposing it.
- [x] No secret value recorded in project evidence.
- [x] All inherited Phase 1–12 workflows passed on purchase-evidence head `3b7020e479ff4bddf902118899863addfb0a9f7d`.

## Exact-head inherited regression evidence

| Workflow | Run ID | Result |
| --- | ---: | --- |
| Verified Through Phase 3 | 34214919768 | SUCCESS |
| Phase 4 Laravel Session API | 34214919885 | SUCCESS |
| Phase 5 Session Isolation | 34214919751 | SUCCESS |
| Phase 6 Lifecycle Management | 34214919883 | SUCCESS |
| Phase 7 Generic Tool Profiles | 34214919822 | SUCCESS |
| Phase 8 Phrasly Reference Implementation | 34214919773 | SUCCESS |
| Phase 9 Authentication-Failure Behaviour | 34214919769 | SUCCESS |
| Phase 10 Second-Tool Validation | 34214919824 | SUCCESS |
| Phase 11 Security Hardening | 34214919753 | SUCCESS |
| Phase 12 Performance Evidence | 34214919952 | SUCCESS |

The technical-closure head `dac59feb8fd693552760f8210c5004e341fe87d9` also passed all 10 inherited workflows. Its immutable run IDs are recorded in PR #15. The approval-record commit produced by this update must pass the same inherited workflows before promotion.

## Gate assessment

The blueprint Phase 13 exit gate, “VPS exists; access available for deployment,” is satisfied by the verified provider record, active VPS indicator, issued public addressing, Ubuntu 24.04 installation, and owner-held administrative access material. The owner explicitly approved Phase 13 completion on 2026-09-08 after the closure-record head passed all inherited validation.

Known limitation carried to Phase 14: the first authenticated SSH connection cannot be tested from the current engineering workspace because direct arbitrary-IP routing is unavailable. Phase 14 must establish the live SSH session, rotate the initial credential, install an owner-controlled SSH key, and harden access before deployment.

## Owner approval

- Approval: explicit owner response, `Approved`, on 2026-09-08.
- Authorized action: mark Phase 13 COMPLETE and promote PR #15 after the exact approval-record branch head passes inherited validation.

## Evidence ledger

- Initial selection head: `2be5dfcacbcaa8f39ab6a92d680970d240a4d058`.
- Purchase-evidence head: `3b7020e479ff4bddf902118899863addfb0a9f7d`.
- Owner-only purchase/provisioning evidence: verified from safely redacted Contabo service, VPS-control, inbox, and credential-table screenshots plus the owner's confirmation that the access row is populated.
- Exact purchase-evidence-head regressions: 10/10 completed successfully; run IDs recorded above.
- Technical-closure head `dac59feb8fd693552760f8210c5004e341fe87d9`: 10/10 completed successfully; immutable run IDs recorded in PR #15.
