# Self-Hosted Browser Issue Register

Material issues use IDs `SB-PHASE-SEQUENCE`. Critical and High issues block phase advancement until fixed and regression-tested. Historical failures remain recorded after closure.

# Earlier phases

### SB-001-001 — Standalone repository topology was not being used as the verified source of truth

Severity: High.

Underlying cause: repository continuity/evidence handling had allowed verified work to remain under the main website repository instead of the standalone runtime repository.

Corrective action: migrated the verified Phase 1-3 runtime to `Osuagwu101/toprated-browser-runtime`, promoted it to standalone `main`, and passed combined Phase 1-3 run `33857323898`, job `100973530886`.

Status: **FIXED / CLOSED**.

### SB-003-001 — Earlier Phase 3 conversational state was not persisted in the verified source branch

Severity: High.

Corrective action: rebuilt Phase 3 from the verified Phase 2 head and fully revalidated it instead of relying on conversational status.

Status: **FIXED / CLOSED**.

### SB-003-002 — Phase 3 generic-runtime grep included a negative test fixture

Severity: Medium.

Corrective action: narrowed the generic-runtime scan to production source directories and revalidated Phase 3.

Status: **FIXED / CLOSED**.

# Phase 4 issues

### SB-004-001 — Worker lifecycle endpoints could bypass Laravel ownership

Severity: High.

Underlying cause: Phase 3 worker lifecycle endpoints remained directly callable when the Laravel ownership layer was first added.

Corrective action: added a separate `WORKER_CONTROL_SECRET`, required it on `/browser/*`, configured Laravel to supply it, retained public health only, and added unauthenticated lifecycle rejection coverage.

Evidence: runs `33867076595`, `33867803222`, `33868000840`, final Phase 4 `main` run `33869763531`.

Status: **FIXED / CLOSED**.

### SB-004-002 — Inherited Phase 1-3 regression hard-coded the old API phase

Severity: Medium.

Observed: Phase 4 run `33866819180`, job `101003454022`, failed because the inherited harness asserted Laravel health must remain Phase 3.

Corrective action: retained browser/viewer behavioral regression while removing the stale historical phase assertion.

Status: **FIXED / CLOSED**.

### SB-004-003 — Worker control secret was not wired into CI in the same change

Severity: Medium.

Observed: run `33866993636`, job `101003995956`, failed after `WORKER_CONTROL_SECRET` became mandatory but the workflow environment had not yet been updated.

Corrective action: added the CI-only worker-control secret and retained worker-control bypass coverage.

Status: **FIXED / CLOSED**.

### SB-004-004 — Worker still presented stale Phase 3 ownership metadata and minted legacy viewer grants

Severity: Medium.

Corrective action: worker health was updated for Laravel lifecycle ownership/grant issuance; `/browser/start` stopped minting production viewer grants. Laravel became the sole operational grant issuer.

Evidence: runs `33867803222`, `33868000840`, `33869763531`.

Status: **FIXED / CLOSED**.

### SB-004-005 — Control-plane health could be falsely green for invalid launch-critical configuration

Severity: High.

Corrective action: added explicit service-auth, worker-control, viewer configuration and Phase 4 capacity readiness checks, including fail-fast viewer validation before Chromium launch.

Evidence: runs `33868000840`, `33869763531`.

Status: **FIXED / CLOSED**.

### SB-004-006 — Inherited Phase 1-3 workflow became stale after Phase 4 promotion

Severity: High.

Observed: Phase 4 run `33869416309` passed on `main`, but inherited run `33869416366` failed because the old workflow expected worker-side viewer-grant metadata and lacked current control-plane secrets.

Corrective action: kept the inherited workflow active, updated it to the Laravel-owned grant model, added current CI configuration, and revalidated rather than suppressing the failure.

Evidence: fix head `a58e5eea2ce8377429fc8f843f75e26e342a5f94` passed `33869567556` and `33869567509`; corrected `main` `984378c78fea4dd5c3624ed43eca997e1aff845f` passed `33869763521` and `33869763531`.

Status: **FIXED / CLOSED**.

## Phase 4 closure
Phase 4 is **GREEN / COMPLETE / APPROVED**. Final Phase 4 closure commit: `156372e912b4792baab471263202c5d867131ec4`.

# Phase 5 issues

### SB-005-001 — Worker singleton prevented simultaneous isolated writer sessions

Severity: High / Gate blocker.

Observed: approved Phase 4 stored one browser in `this.current` and rejected a second browser with HTTP 409.

Underlying cause: the Phase 4 design deliberately implemented one effective slot because multi-session isolation belonged to Phase 5.

Corrective action: replaced the singleton with a session-keyed collection. Every session receives its own Chromium process/process group, loopback CDP endpoint/client and temporary user-data directory. Lifecycle, viewer and cleanup operations are scoped to opaque worker session IDs.

Evidence: Phase 5 isolation runs `33879050804`, `33883567965`, final promoted-main run `33885089493`.

Status: **FIXED / CLOSED**.

### SB-005-002 — Laravel lifecycle orchestration assumed one global worker slot

Severity: High / Gate blocker.

Observed: Phase 4 `SessionManager`/`BrowserWorkerClient` used global status/start/stop semantics and forced `MAX_BROWSER_SESSIONS=1`.

Corrective action: made worker calls session-scoped, reconciled tracked worker session IDs independently, and changed capacity to validated configuration from 1 through the blueprint ceiling of 15. Phase 5 correctness CI uses 3 slots; load proof remains later work.

Evidence: typecheck-enabled technical runs `33883568115` and `33883567965`; promoted-main Phase 4/5 runs `33885089684` and `33885089493`.

Status: **FIXED / CLOSED**.

### SB-005-003 — No executable proof of same-origin browser-state and crash isolation

Severity: High / Gate blocker.

Corrective action: added `browser-worker/test/isolation-fixture.mjs` and `tests/phase5-e2e.py`. The test creates writers A/B simultaneously, checks independent cookie/local/session storage, rejects cross-writer lifecycle actions and cross-session viewer tokens, kills A's Chromium while B stays usable, then verifies independent cleanup and zero open records.

Evidence: run `33883567965`, job `101057797632`; documentation-head run `33884697831`; promoted-main run `33885089493`.

Status: **FIXED / CLOSED**.

### SB-005-004 — Worker health could report OK when Chromium was unavailable

Severity: Medium.

Corrective action: worker health is `ok` only when capacity configuration is valid and Chromium is installed; otherwise it reports `degraded`.

Evidence: exact-head workflows `33883567911`, `33883568115`, `33883567965`, plus promoted-main workflows `33885089657`, `33885089684`, `33885089493`.

Status: **FIXED / CLOSED**.

### SB-005-005 — Repository had no single executable type/syntax gate across its current toolchain

Severity: Medium.

Corrective action: added `scripts/typecheck.sh` and made current workflows execute it before behavioral tests. It validates Node `.mjs`, non-vendor PHP, Python tests, JSON manifests and Docker Compose configuration. The repository is plain Node ESM/PHP/Python rather than TypeScript, so no `tsc` result is fabricated.

Evidence: exact typecheck-enabled head `ea00b239e20382125e53ad317acf52ea1a071f29` passed runs `33883567911`, `33883568115`, `33883567965`; final documentation head `c4f5a006b763bab471fcd7bb73608606146ab67f` passed `33884697611`, `33884697657`, `33884697831`; promoted `main` `4530352a46aad31f295231813f024a120acd021b` passed `33885089657`, `33885089684`, `33885089493`.

Status: **FIXED / CLOSED**.

## Phase 5 closure

Phase 5 is **GREEN / COMPLETE / APPROVED**. Its exit gate — **“Writer/browser isolation passes”** — is satisfied. Pull request #5 promoted the tested Phase 5 head to standalone `main`; final Phase 5 closure was recorded through PR #6. The production website/Browser Use repository remained at `ea5d39b79d7c3fac9c004ae3dfd6b55ff75df084`.

# Phase 6 issues

### SB-006-001 — Accelerated lifecycle CI initially violated runtime configuration bounds

Severity: Medium.

Observed: the first Phase 6 CI policy used lifecycle values below the runtime's own accepted minimums.

Corrective action: changed accelerated CI policy to valid values (`70s` lease, `60s` idle, `30s` disconnect, `5s` startup, `1s` reaper) and made the reconnect fixture configuration-relative.

Evidence: exact corrected implementation head `0da7b5b9b9da008d2a3d73ef8b96ce38f0212540` later passed the dedicated Phase 6 gate.

Status: **FIXED / CLOSED**.

### SB-006-002 — Authoritative workflows were vulnerable to transient external container/package retrieval failures

Severity: Medium.

Observed: repository-local gates could pass, then image builds fail because external registries or package mirrors were temporarily unavailable. Examples: run `33902499847`, job `101119604708` (Composer/GitHub HTTP 504), and run `33902328749`, job `101119058078` (Debian name-resolution failure). Early runs also encountered Docker Hub HTTP 429 throttling.

Corrective action: all four then-authoritative workflows received a bounded three-attempt `docker compose build` retry with increasing delay. Persistent application, typecheck, unit, E2E or repeated build failures still fail the gate.

Evidence / RED history: failed runs including `33902499847`, `33902328749`, `33902328523`, `33902328488`, `33902328695`, `33902296862` and `33902296868` remain in Actions history.

Status: **FIXED / CLOSED**.

### SB-006-003 — Shared GitHub Actions concurrency group cancelled required inherited gates

Severity: Medium.

Observed: a CI-hardening attempt put all required workflows in one shared Actions concurrency group, causing pending inherited gates to be cancelled rather than serialized.

Corrective action: removed the shared cross-workflow concurrency group and retained bounded build retries instead.

Status: **FIXED / CLOSED**.
### SB-006-004 — Reaper could issue a redundant second stop from its same-pass worker snapshot

Severity: Medium.

Corrective action: after successful tracked-session termination, the reaper removes that worker session ID from its in-memory snapshot before the orphan sweep.

Evidence: exact implementation head `0da7b5b9b9da008d2a3d73ef8b96ce38f0212540` passed Verified Through Phase 3 `33907235930`, Phase 4 `33907235955`, Phase 5 `33907235924` and Phase 6 `33907235859`.

Status: **FIXED / CLOSED**.

## Phase 6 closure

The Phase 6 exit gate — **“Active browsers survive; abandoned browsers disappear automatically”** — is satisfied. Final documented branch head `c708ee10016c2012fb400a25351f8afdf18e7847` passed runs `33909732417`, `33909732370`, `33909732414` and `33909732404`. PR #7 promoted it to `main` commit `20a81157554e70386be3291ee564fe39514a5041`, which passed runs `33910146825`, `33910146517`, `33910146434` and `33910146416`. Owner approval was recorded on 2026-09-04 through the Phase 6 closure sequence. Phase 6 is **GREEN / COMPLETE / APPROVED**.

# Phase 7 issues

### SB-007-001 — Approved Phase 6 launch path had no authoritative generic tool-profile model

Severity: High / Gate blocker.

Observed: approved Phase 6 owned browser lifecycle and writer/session isolation, but the launch destination still came directly through the session launch request. There was no server-owned `tool_slug` -> configured profile resolution layer.

Underlying cause: tool-profile configuration was deliberately deferred by the Blueprint until Phase 7.

Corrective action: added `ToolProfileRegistry`, a configurable JSON profile source, server-side profile validation, enabled/disabled policy and profile-owned launch destination resolution. `SessionController` resolves the signed writer/tool request through the registry before Chromium creation. Unknown and disabled profiles fail closed, and a caller cannot replace the configured destination.

Evidence: implementation commits beginning with `44148a1547e41c2504097fc67c6845d521a77012`, `72f693143a4f4faed7ffe5c48a610837830c93a5` and `5575b3afca29d91d7e8df20973541af4ab61ffd5`; corrected implementation head `d1d9269b7f1dda161ac1c72f9eae7884b4d59266` passed the complete authoritative gate set.

Status: **FIXED / CLOSED**.

### SB-007-002 — Autonomous lifecycle reaper could interfere with inherited pre-reaper regression sequencing

Severity: Medium.

Observed: the initial Phase 7 verification stack started the Phase 6 autonomous reaper while inherited Phase 4/5 fixtures were still running their historical setup sequence.

Underlying cause: the new Phase 7 workflow composed inherited suites without preserving the reaper boundary used by their authoritative lifecycle workflow.

Corrective action: run inherited Phase 4/5 regressions before starting the autonomous reaper, then make the reaper mandatory for the inherited Phase 6 lifecycle/restart regression and final cleanup checks. Production lifecycle behavior was not weakened.

Evidence: corrective commit `7727cf0255f8edcf02ea4ed9e6a6792f3f8b9fdd` and later full-green Phase 7 heads.

Status: **FIXED / CLOSED**.

### SB-007-003 — API restart could expose a transient worker-read connection refusal

Severity: Medium.

Observed: inherited Phase 6 run `33919958668`, job `101175779193`, failed after `docker compose restart api`; an immediate idempotent API-to-worker session-status read briefly surfaced `WORKER_UNAVAILABLE`.

Underlying cause: control-plane readiness and Docker-internal worker reachability can converge over a short interval after API restart, while `BrowserWorkerClient` treated the first connection-level read failure as final.

Corrective action: added a bounded four-attempt, 100 ms connection retry only to idempotent worker reads (`health`, session list and session status). Session creation is intentionally not retried, preventing duplicate Chromium launch risk if a POST is processed but its response is lost. Permanent worker failure and worker HTTP errors still propagate normally. The inherited Phase 6 test was not weakened or skipped.

Evidence / RED history: Phase 6 Lifecycle Management run `33919958668`, job `101175779193` — FAILURE. Corrected head `d1d9269b7f1dda161ac1c72f9eae7884b4d59266` passed Phase 6 run `33926255036` and all other authoritative workflows on the same SHA.

Status: **FIXED / CLOSED**.

## Phase 7 closure

The Phase 7 exit gate — **“The runtime can launch a generic configured tool without Phrasly-specific branching in core infrastructure”** — is satisfied.
Final documented Phase 7 branch head: `a6a17e43c1109533a1230c719b2524455837a8d4`.

All five authoritative workflows passed on that exact branch SHA:

- Verified Through Phase 3 — run `33926867078` — SUCCESS;
- Phase 4 Laravel Session API — run `33926867092` — SUCCESS;
- Phase 5 Session Isolation — run `33926867099` — SUCCESS;
- Phase 6 Lifecycle Management — run `33926867114` — SUCCESS;
- Phase 7 Generic Tool Profiles — run `33926867048` — SUCCESS.

PR #9 promoted that exact tested head to standalone `main` commit `67281ba8815f2a407d4f2e6904ce1d7c38880d1d`.

All five authoritative workflows passed again on the promoted `main` SHA:

- Verified Through Phase 3 — run `33939565151` — SUCCESS;
- Phase 4 Laravel Session API — run `33939565157` — SUCCESS;
- Phase 5 Session Isolation — run `33939565153` — SUCCESS;
- Phase 6 Lifecycle Management — run `33939565173` — SUCCESS;
- Phase 7 Generic Tool Profiles — run `33939565154` — SUCCESS.

The Phase 7 workflow proves configured generic launch, unknown/disabled profile rejection, caller launch-URL override rejection, same-writer/profile reuse, no Phrasly-specific reference in core runtime paths, no raw CDP exposure pattern, clean browser/profile teardown and zero durable open session records. All inherited Phase 1-6 behavioral gates remain active.

The production website/Browser Use repository was rechecked after promotion and remained at `ea5d39b79d7c3fac9c004ae3dfd6b55ff75df084`.

Owner approval was explicitly received on **2026-09-05**. No Critical, High or gate-blocking Phase 7 issue remains open.

Phase 7 is **GREEN / COMPLETE / APPROVED**.

Phase 8 — Phrasly reference implementation — is **NOT STARTED** and must begin only on explicit later instruction.

# Phase 8 issues

### SB-008-001 through SB-008-005 — Phrasly profile, shared-state injection, pre-viewer authentication verification, ephemeral state handling and live-proof requirement

Severity: High / gate blockers.

Underlying causes and corrections are recorded in `docs/audits/phase-8.md`. The deterministic mechanism was CI-verified and the real Phrasly gate was subsequently owner-operated and live-verified.

Status: **FIXED / LIVE-VERIFIED / CLOSED**.

### SB-008-006 — Cloud browser could not establish the real Phrasly state because Cloudflare verification did not complete

Severity: High / exit-gate blocker.

Observed: the connected cloud browser remained on Phrasly's Cloudflare security-verification page and could not legitimately create the live shared-state artifact.

Underlying cause: the remote test browser was not accepted through Phrasly's human-verification boundary. Bypassing or weakening that boundary is prohibited.

Owner-approved amendment: on 2026-09-05 the owner approved a temporary operator-only Phase 8 authentication harness. The harness starts Phrasly inside the self-hosted Chromium, exposes only the existing restricted viewer through a protected one-time link file, allows the owner to complete Phrasly/Cloudflare verification directly, captures only the active Phrasly origin's cookies and Web Storage through the authenticated private worker control plane, immediately proves the captured state in a fresh Chromium session, and removes temporary state/link files.

Security controls: runtime operator service and worker-control secrets are required; writers receive neither secret nor raw captured state; the state-export route rejects unauthenticated calls; no password or OTP is accepted by the harness; captured state is not printed or durably stored.

Evidence: exact implementation head `57182a5f4cbcc654981fda7bbf565ad7b8d7ae03` passed all six authoritative workflows: Verified Through Phase 3 `33945655810`, Phase 4 `33945655788`, Phase 5 `33945655813`, Phase 6 `33945655770`, Phase 7 `33945655773`, and Phase 8 `33945655774`. The owner-operated live gate later passed at `https://phrasly.ai/dashboard`.

Status: **FIXED / LIVE-VERIFIED / CLOSED**.

### SB-008-007 — Acceptance harness ignored the configured worker origin

Severity: High / exit-gate test blocker.

Observed: the first containerized live acceptance attempt created the self-hosted session but failed with `Authenticated viewer status could not be read from the self-hosted browser.`

Underlying cause: `scripts/phase8-phrasly-acceptance.py` accepted `WORKER_BASE` operationally but read the viewer grant's loopback URL unchanged. Inside the temporary acceptance container, `127.0.0.1:18081` addressed that container rather than the Windows-hosted browser worker.

Corrective action: commit `8a5a6ac35c2449d0e0ec77935077969d8755f0f9` preserves the signed viewer path/query/token and substitutes only the configured absolute worker origin. The corrected harness produced a live `PASS` at `https://phrasly.ai/dashboard`, with authentication verified before viewer grant and no raw state printed.

Status: **FIXED / LIVE-VERIFIED / CLOSED**.

### SB-008-008 — Session-creation/reaper race exposed by final Phase 7 composite validation

Severity: High / inherited-regression blocker.

Observed: on final `main` completion-ledger head `12060854c351232b9ed313e45c337030208af2a4`, Phase 7 Generic Tool Profiles run `34007830712` failed on attempts 1 and 2. In both attempts, repository syntax, Phase 7 static/unit gates, Phase 4 ownership, Phase 5 isolation and the Phase 7 configured-tool E2E passed. The unchanged inherited Phase 6 suite then received HTTP 500 instead of 201 while launching its untracked-worker cleanup fixture. Teardown still passed. The standalone Phase 6 workflow passed on the same SHA.

Failure-history note: the first cleanup correction required a private worker inventory assertion and browser-worker restart before inherited Phase 6. An implementation of that boundary initially used the wrong worker-control request header. Commit `58329bb80a7d5e675c39ca45142b1a3645340744` corrected the header to `x-toprated-worker-secret`; on that exact `main` head the five other authoritative workflows passed, while Phase 7 run `34011309486` still failed later inside the inherited Phase 6 orphan-worker fixture. This proved the header defect was real but not the root cause of SB-008-008.

Initial diagnosis: because standalone Phase 6 passed while the composite failed after earlier browser suites, the issue was first described broadly as cumulative composite worker-state leakage. That diagnosis was intentionally not treated as closure evidence.

Underlying cause: direct worker session creation and reaper inventory were not atomic with respect to each other. A `POST /browser/sessions` could make a newly created session visible to `GET /browser/sessions` while the create request was still completing. With the autonomous lifecycle reaper scanning every second, the reaper could classify that direct worker session as an untracked orphan and delete it before the POST completed, producing the intermittent HTTP 500 instead of the required 201.

Corrective action: worker session inventory now waits for in-flight session creation to settle before returning a set that the reaper may classify. The same creation barrier applies to the legacy `/browser/start` alias so the race is not left on a second creation path. The Phase 7 workflow still asserts zero active and zero starting worker sessions before restarting the worker for inherited Phase 6, then starts the autonomous reaper and executes the unchanged inherited lifecycle suite. No lifecycle assertion, ownership check, security rule or cleanup requirement was disabled or weakened.

Permanent regression: `tests/phase6-orphan-create-race.py` creates and reaps 12 direct orphan worker sessions consecutively against the active one-second lifecycle reaper before the unchanged inherited `tests/phase6-e2e.py` suite runs.

Stress evidence: exact branch head `9122e552744dea03c5662031646c30f47758af2d` passed three consecutive executions of Phase 7 workflow run `34017793483`, including job executions `101444599224`, `101445085357` and `101445524244`. Each passed the 12-iteration race stress gate, the unchanged inherited Phase 6 regression, browser/profile residue checks and teardown.

Cleaned-branch evidence: head `653153906c3569f2f13bd733ff9aaf7d2ea2b1c3` removed diagnostic-only scaffolding while retaining the runtime fix, permanent race regression and zero-session/restart boundary. Phase 7 run `34018317456` passed before promotion.

Exact technical `main` evidence on the same SHA `653153906c3569f2f13bd733ff9aaf7d2ea2b1c3`:

- Verified Through Phase 3 — run `34018473665` — SUCCESS;
- Phase 4 Laravel Session API — run `34018473673` — SUCCESS;
- Phase 5 Session Isolation — run `34018473708` — SUCCESS;
- Phase 6 Lifecycle Management — run `34018473693` — SUCCESS;
- Phase 7 Generic Tool Profiles — run `34018473683` — SUCCESS;
- Phase 8 Phrasly Reference Implementation — run `34018473674` — SUCCESS.

Status: **FIXED / CLOSED**. Final documentation-head exact-CI validation is still required by the repository engineering contract before the Phase 8 closure record becomes effective, but no SB-008-008 runtime defect remains open.

## Phase 8 closure

On 2026-09-06, the corrected acceptance harness used the active production-managed shared state to launch a fresh self-hosted Chromium. It returned `PASS` for Phrasly at `https://phrasly.ai/dashboard`, confirmed authenticated state, confirmed viewer access occurred after verification, and printed no raw state.

The Master Blueprint v1.1 Phase 8 exit gate — **“One self-hosted Chromium reaches authenticated Phrasly from shared state”** — is satisfied. Owner approval was received on 2026-09-06. PR #11 was merged to `main` at `31a4ac77fdc4851d4b8da32b2c9643b6c0979cef`; all six authoritative workflows passed on that exact promoted SHA.

The later final-ledger regression SB-008-008 is now fixed, stress-tested and green on corrected technical `main` head `653153906c3569f2f13bd733ff9aaf7d2ea2b1c3`, where all six authoritative workflows passed. The temporary fix-branch workflow trigger is removed in the final closure change while the permanent race regression remains active.

The owner explicitly instructed this final verification/closure sequence to complete Phase 8 and unlock Phase 9. This closure becomes effective once all six authoritative workflows pass on the final `main` head containing the closure documentation and workflow cleanup. At that point Phase 8 is **GREEN / COMPLETE / APPROVED**, and Phase 9 — Authentication-Failure Behaviour — is **UNLOCKED / NOT STARTED**.

# Phase 9 issues

### SB-009-001 — Authentication failure had no durable shared outage latch

Severity: High / gate blocker.

Underlying cause: Phase 8 authentication rejection was request-local; the runtime had no metadata-only tool-auth availability state to stop later writers from repeatedly launching against known-stale shared state.

Corrective action: added metadata-only `tool_auth_states`; authentication-required launches consult the latch before browser capacity/creation; failed verification latches `reauth_required`; later writers receive safe `TOOL_REAUTH_REQUIRED` / HTTP 423 before Chromium; a later verified launch records readiness again.

Status: **FIXED / VERIFIED / CLOSED**.

### SB-009-002 — An already-open writer viewer could outlive upstream authentication

Severity: High / gate blocker.

Underlying cause: Phase 8 authentication verification occurred before the first viewer grant but was not a continuing predicate on restricted status/frame/input operations.

Corrective action: restricted viewer paths re-check the configured generic authentication indicators. Authentication loss blocks status/frame/input with `TOOL_REAUTH_REQUIRED` before login or verification content is exposed; Laravel latches the outage and cleans the failed browser.

Status: **FIXED / VERIFIED / CLOSED**.

### SB-009-003 — No separate administrator/operator recovery boundary existed

Severity: High / gate blocker.

Underlying cause: administrator recovery semantics were deliberately deferred from Phase 8 to Phase 9.

Corrective action: added a distinct operator-only boundary protected by `RUNTIME_OPERATOR_AUTH_SECRET`; writer/service HMAC does not grant restore authority; restore rejects credential/OTP/verification bodies; operator status exposes metadata only.

Status: **FIXED / VERIFIED / CLOSED**.

### SB-009-004 — Phase 8 inherited failure response needed to evolve without weakening its invariant

Severity: Medium / regression-harness compatibility.

Underlying cause: Phase 8 correctly exposed `TOOL_AUTH_NOT_VERIFIED` / HTTP 409 before Phase 9 owned the safe admin-reauth failure contract.

Corrective action: inherited Phase 8 still requires no viewer and full failed-browser cleanup, but now expects the Phase 9-safe `TOOL_REAUTH_REQUIRED` / HTTP 423. No Phase 8 security assertion was removed.

Status: **FIXED / VERIFIED / CLOSED**.

## Phase 9 closure evidence

Final tested branch SHA: `71b0d1852a073a9e5a258abde1116abcaa7c3bac`.

Exact branch-head authoritative runs — all SUCCESS:

- Verified Through Phase 3 `34026692384`;
- Phase 4 Laravel Session API `34026692353`;
- Phase 5 Session Isolation `34026692285`;
- Phase 6 Lifecycle Management `34026692336`;
- Phase 7 Generic Tool Profiles `34026692436`;
- Phase 8 Phrasly Reference Implementation `34026692265`;
- Phase 9 Authentication-Failure Behaviour `34026692343`.

The tested branch was promoted by controlled fast-forward to technical `main` SHA `71b0d1852a073a9e5a258abde1116abcaa7c3bac`.

Exact technical-main authoritative runs — all SUCCESS:

- Verified Through Phase 3 `34027018121`;
- Phase 4 Laravel Session API `34027018130`;
- Phase 5 Session Isolation `34027018106`;
- Phase 6 Lifecycle Management `34027018149`;
- Phase 7 Generic Tool Profiles `34027018132`;
- Phase 8 Phrasly Reference Implementation `34027018083`;
- Phase 9 Authentication-Failure Behaviour `34027018178`.

The Phase 9 composite explicitly includes the full Phase 1–3 browser/viewer behavioral regression and preserves the inherited Phase 4/5/6/7/8 gates, the Phase 6 12-iteration orphan/reaper stress regression, unchanged lifecycle/restart coverage, residue checks, metadata-only authentication persistence and sensitive-log scans.

The Master Blueprint v1.1 Phase 9 exit gate — **“Failure behaviour matches the admin-only authentication model”** — is technically satisfied. This register update is committed together with final workflow cleanup, including removal of the temporary Phase 9 branch trigger from inherited workflows. Under the repository engineering contract, the resulting documentation/closure `main` head must itself pass all seven authoritative workflows before the technical closure record becomes effective.

After that final exact-head validation, Phase 9 is **TECHNICALLY GREEN / AWAITING OWNER APPROVAL**. Phase 10 remains **NOT STARTED** until the owner explicitly approves Phase 9 completion.


# Phase 10 multi-tool deterministic E2E corrections

### SB-010-004 — Empty storage namespace failed across PHP-to-Node transport

Severity: High / gate blocker.

RED evidence: runs `34031829988`, `34031938360` and `34048255568`.

Underlying cause: an empty JSON object became an empty PHP array and later a JSON `[]`; both generic validators rejected the semantically empty Web Storage namespace.

Corrective action: accept only an empty array as the transport representation of an empty map at both boundaries; retain rejection of non-empty lists; add a worker unit regression.

Status: **FIXED / VERIFIED**.

### SB-010-005 — Worker HTTP timeout raced authentication verification

Severity: High / gate blocker.

RED evidence: run `34048427437`.

Underlying cause: both the client request and profile verification expired at 15 seconds, converting expected `AUTHENTICATION_NOT_VERIFIED` into `WORKER_UNAVAILABLE`.

Corrective action: derive the generic start-request timeout from the profile auth timeout plus bounded overhead, with a 60-second cap.

Status: **FIXED / VERIFIED**.

### SB-010-006 — Tool auth latch preceded cross-tool ownership rejection

Severity: High / gate blocker.

RED evidence: run `34048616454`.

Corrective action: reject cross-tool switching for an already-active writer before checking the requested tool latch; same-tool launches still enforce the latch before reuse.

Status: **FIXED / VERIFIED**.

## Phase 10 technical evidence

Corrected composite run `34048813657` passed on `7625483dbdccd9741408d92694fbe07786e1753b`.

Exact verification SHA `362e650b71bbf85c2a592431a3099989d0b76910` passed all authoritative workflows:

- Phase 1–3 `34049104655`;
- Phase 4 `34049104646`;
- Phase 5 `34049104643`;
- Phase 6 `34049104664`;
- Phase 7 `34049104642`;
- Phase 8 `34049104657`;
- Phase 9 `34049104660`;
- Phase 10 `34049104639`.

Phase 10 is **TECHNICALLY GREEN / AWAITING OWNER APPROVAL**. It is not merged or COMPLETE, and Phase 11 has not started.

### SB-010-007 — Requested live providers reject the self-hosted browser at their security-verification boundary

Severity: High / owner-required live exit-gate blocker.

Observed on 2026-09-07 at exact runtime head `3de398c3538509a1bee75dea8909dfd9f6a52160`:

- ChatGPT loaded in the protected viewer and accepted owner interaction, but its post-login authentication route received an HTML Cloudflare challenge and reported `Route Error (400 Invalid content type: text/html; charset=UTF-8)`; subsequent `auth.openai.com` human verification repeatedly failed.
- StealthWriter loaded its sign-in page in the protected viewer and accepted owner interaction, but its embedded Cloudflare control returned `Verification failed` after the owner entered credentials.
- Neither attempt produced captured authenticated state or a fresh-browser reuse proof.

Audit history preceding the final provider result:

- an initial local invocation selected an internal Python executable and returned `No pyvenv.cfg file`; selecting the installed top-level Python 3.12.10 executable corrected the harness invocation;
- stale multi-host ChatGPT state exposed allowed-domain cookie filtering and led to the generic multi-host state-export correction;
- `WORKER_ERROR` startup failures led to readiness-based navigation, safe stage logging and aligned navigation/request/startup timeouts;
- the initial 300-second administrator viewer grant expired during manual login and led to the bounded 900-second administrator-bootstrap grant while ordinary writer grants remained 300 seconds.

Exact-head deterministic evidence after those corrections: Phase 1–3 `34075450744`, Phase 4 `34075450739`, Phase 5 `34075450741`, Phase 6 `34075450753`, Phase 7 `34075450869`, Phase 8 `34075450748`, Phase 9 `34075450751`, and Phase 10 `34075450745` — all SUCCESS.

Disposition: the runtime reaches both real providers and the generic deterministic state machinery remains green, but the owner-required live authenticated-state capture/reuse criterion is not met. Provider challenges will not be bypassed, spoofed or weakened. Repeated retries are stopped.

Status: **OPEN / EXTERNALLY BLOCKED**.

## Phase 10 live-gate status

Phase 10 is **IN TEST**. Deterministic CI is technically green, but no real third-party account has completed authenticated-state capture and fresh-browser reuse for the strengthened owner-required live criterion. Owner approval and Phase 11 remain blocked.

# Phase 11 issues

### SB-011-009 — worker server startup syntax regression

Severity: High / Gate blocker.

Observed: repair head `ab85a27b0cb86010400a19254638c20a7897cdb9` failed `node --check browser-worker/src/server.mjs` because the `server.listen(...)` statement was missing one closing parenthesis. GitHub-hosted jobs did not reveal it because they failed before runner assignment.

Underlying cause: a server-start logging edit introduced a syntax error, while unit tests did not import the side-effectful server entrypoint. The existing repository-wide syntax gate was correct but could not execute during the Actions outage.

Corrective action: commit `0ab0edf3527eaf5588dce6e94d3d7cb0a4ceeec7` restored the parenthesis. Independent local syntax, 24/24 Node tests, YAML, Python, and JSON checks passed. GitHub run `34100837088` preserved the pre-run failure evidence. After the repository became public, run `34101080702` attempt 2 acquired a runner and passed every Phase 11 step. Exact-head run `34183463821` then passed again on `93e380dad9b53f56bdca559cbf10f8a1864dfdc3`.

Status: **FIXED / VERIFIED / CLOSED**.


### SB-011-010 — private-repository Actions billing restriction prevented runner allocation

Severity: High / external verification blocker.

Observed: approval-record SHA `2eb76e8d92378de0759bf8be2fe181df9dc42013` and later repair runs produced completed failures with no runner and no steps. GitHub displayed the account annotation that the job was not started because recent account payments had failed or the spending limit required attention.

Underlying cause: account-level billing/spending enforcement prevented GitHub-hosted runner allocation for the private repository. The local computer and application code were not involved because execution stopped before checkout.

Corrective action: the owner changed the standalone repository visibility to public. GitHub Actions then accepted run `34101080702` attempt 2, assigned a runner, and passed the complete Phase 11 workflow. Commit `93e380dad9b53f56bdca559cbf10f8a1864dfdc3` added the repair branch to the inherited workflow triggers; all nine authoritative workflows ran and passed on that exact SHA.

Status: **RESOLVED / VERIFIED / CLOSED**.


### SB-010-008 — Live harness was limited to the container browser rejected by requested providers

Severity: High / owner-required live exit-gate blocker.

Underlying cause: the Phase 10 live harness inherited Phase 8's worker-browser bootstrap assumption. That was valid for Phrasly after the administrator completed its human-in-the-loop challenge, but ChatGPT and StealthWriter reject the containerized Chromium before an authenticated state can be created. The backend already supports bounded allowlisted state ingestion and fresh-browser verification; the missing boundary was a legitimate normal-desktop-browser bootstrap.

Corrective action:

- add `scripts/phase10-desktop-live-account-validation.ps1`, which launches a dedicated normal Google Chrome profile under the current Windows administrator;
- keep all password, OTP and provider-verification input inside that normal browser;
- capture cookies and Web Storage only for the selected profile's configured host allowlist over an ephemeral loopback-only Chrome DevTools channel;
- store the captured state only in an ACL-restricted per-user temporary directory;
- extend `scripts/phase10-live-account-validation.py` with an operator-only imported-state mode that validates size/type, consumes and deletes the file immediately, and runs the unchanged fresh-container authentication, viewer, reuse, residue and sensitive-log proof;
- close the desktop Chrome tree and delete its dedicated profile/state on success or failure;
- add PowerShell syntax validation and Phase 10 workflow presence assertions.

This remediation does not automate, defeat or spoof the provider challenge. The administrator must complete the legitimate human verification in normal Chrome.

Status: **FIXED IN CODE / AWAITING OWNER-OPERATED LIVE VERIFICATION**.


# Phase 14 issues and closure

## Phase 14 closure evidence

The exact deployment source `6cdb1fb3f167f726bb669c900fa882b2137066e1` was deployed to the owner-controlled Contabo VPS at `runtime.topratedseotools.com` on 2026-09-09.

The production API and browser worker reported healthy, the Caddy ingress served valid HTTPS, and the lifecycle reaper was running. The public health endpoint passed from both the VPS and a separate Windows network.

The approved external acceptance harness ran from the separate Windows network and returned `PASS` with exit code `0`. It verified health, TLS/HSTS, rejection of unsigned service access, privacy of worker control routes, real Chromium launch, restricted viewer behavior, and cleanup. Runtime secrets were not printed or committed. The initially disclosed root password was rotated successfully before closure.

Owner approval was received on 2026-09-09. PR #16 merged to `main` at `778efa353aed5c75c5f9a0ecee9d4fef42ec26c6`, and all 12 authoritative workflows passed on that exact merged commit. Phase 14 is **GREEN / COMPLETE / OWNER APPROVED**. Phase 15 remains **NOT STARTED**.


### SB-014-009 — Final completion-ledger reconnect test timing race

Severity: Major / inherited-regression blocker.

RED evidence: Phase 10 run `34417335128`, job `102685005693`, failed the inherited Phase 6 lifecycle step when a reconnect viewer-grant request returned `SESSION_NOT_ACTIVE`.

Underlying cause: the fixture left only a two-second margin inside the disconnect grace boundary while a one-second reaper was active, allowing loaded-runner scheduling to consume the margin before the reconnect request.

Corrective action: retain the aged reconnect case with a ten-second scheduling margin inside the same configured grace window. No production lifecycle value, reaper behavior, or assertion was weakened.

Status: **FIXED / FINAL EXACT-HEAD VERIFICATION REQUIRED**.
