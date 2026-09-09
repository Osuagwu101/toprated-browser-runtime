# Audit — Persistent Browser Identity Hardening

Verified starting baseline: `phase14-contabo-deployment` at `507cccee8c7992e90ab3701347085ca2d12e9370`.

Blueprint in force: Master Blueprint v1.1. This is a backward-compatible correction to the completed Phase 8/9 authentication guarantees while Phase 14 remains in progress. It does not integrate or modify the production Browser Use provider.

## Findings

| # | Severity | Finding | Underlying cause | Resolution |
| --- | --- | --- | --- | --- |
| PBI-001 | BLOCKER | Approved state was supplied per launch and was not persisted by the runtime | Phase 8 proved ephemeral state injection but deliberately left durable storage outside its gate | Dedicated encrypted identity vault keyed per tool |
| PBI-002 | MAJOR | Operator restore could clear the outage latch without capturing refreshed state | Phase 9 modeled authorization separation, not state lifecycle ownership | Production restore now requires verified administrator recapture |
| PBI-003 | MAJOR | Administrator capture depended on host scripts and the private worker secret | Temporary Phase 8/10 acceptance harnesses preceded a first-class operator workflow | Operator-only start/approve/cancel API using restricted viewer and private worker internally |
| PBI-004 | MAJOR | The launch contract allowed caller-supplied raw browser state | The signed service path was the original state transport | Production default rejects raw state and loads the encrypted identity internally |
| PBI-005 | MINOR | Administrator login destinations were duplicated as special bootstrap profiles | The generic profile schema lacked an administrator login URL | Optional `admin_login_url` added and constrained to allowed hosts |

## Intended verification matrix

| Requirement | Automated evidence |
| --- | --- |
| Admin persistence | Operator session, manual-equivalent fixture interaction, verified capture, encrypted row, restart, reuse |
| Writer access | Launch contains only writer/tool identifiers and reaches authenticated tool |
| Expiry recovery | Live auth loss latches outage; old restore fails; fresh capture increments version and restores access |
| Multiple tools | Two authenticated tools use configuration only and the same generic implementation |
| Isolation/security | Separate sessions, writer state input rejection, secret-free API/log checks, no raw CDP, encrypted payload inspection |
| Reliability | API/worker restart recovery, existing lifecycle regressions, final zero-session/profile residue checks |

## Gate status

Implementation is **IMPLEMENTED, UNVERIFIED** until the new workflow and every inherited authoritative workflow pass on the exact branch head. Phase 14 remains **IN PROGRESS** and still requires live Contabo deployment/external acceptance plus owner approval.

## Red-run history

- Remote head `aa4aecd6011c4de77bcb1eb0a173b971ad146aff`: new Persistent Browser Identity push run `34330466780` passed, but inherited Phase 8 run `34330466457` and Phase 9 run `34330466485` failed at the unchanged Phase 8 missing-state assertion. The compatibility flag permitted legacy state input, but the new controller still converted a missing legacy payload into the production `TOOL_REAUTH_REQUIRED` response. The correction preserves the historical `BROWSER_STATE_REQUIRED` response only when the explicit CI compatibility flag is enabled; production defaults retain automatic vault loading and the administrator-required failure latch.
- Remote head `a17996f0ce49bf5872b3e27c021e9875f00ca8e1`: 12/13 exact-head runs passed. Phase 10 run `34330886426` failed readiness because its deterministic CI rewrite changed authenticated tool launch/allowed hosts to `127.0.0.1` but left the newly required administrator login URLs on the real vendor hosts. The generic registry correctly failed closed. The harness correction rewrites the administrator URLs to the same deterministic allowed host; no production validation was weakened.
