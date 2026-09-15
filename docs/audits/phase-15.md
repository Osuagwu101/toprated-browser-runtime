# Phase 15 — Add Self Hosted Provider to Main App

## Phase anchor

- Status: IN TEST
- Blueprint: Master Blueprint v1.1
- Exit gate: Browser Use and Self Hosted coexist without corrupting grants or saved tool state
- Standalone runtime verified baseline: `main` at `92b37369ab48d456dd1ed43e3108b2c0b639121a`
- Main app verified baseline: `main` at `81198c2f834d015766c95a577f41abe7f2a93cab`
- Phase 15 integration PR: `Osuagwu101/topratedseotools-0bc24c5f#26`
- Phase 15 merge commit: `8f125e97bb437372f19e129dad65435989c1ed4e`
- Current objective: close Phase 15 with exact-head CI, live database coexistence evidence, and one real website-to-Contabo launch.

## Verified implementation evidence — 2026-09-15

### Provider coexistence and rollback

- Browser Use remains the global default.
- Phrasly, Stealthwriter, and ChatGPT currently have explicit `self_hosted` per-tool provider overrides in the live Supabase project.
- Clearing a per-tool override resolves back to Browser Use in the provider policy regression.
- The Phase 15 migration adds `self_hosted` as an allowed provider without changing the global default.

### Secure website-to-runtime communication

- The main app signs `POST /api/sessions` with HMAC-SHA256 using method, path, timestamp, nonce, writer identity, and body hash.
- The standalone runtime verifies the same canonical request, enforces timestamp skew, nonce format, writer binding, and replay protection.
- The runtime signing secret is server-only and is not exposed to writers.

### Viewer boundary

- Browser Use viewer URLs are restricted to the official Browser Use host.
- Self Hosted viewer URLs are restricted to `https://runtime.topratedseotools.com/viewer/...` and must carry the signed URL fragment.
- Lookalike runtime hosts and unsigned viewer URLs are rejected by regression tests.

### Grants and saved-auth isolation

- The Self Hosted path is regression-guarded against reading or writing `tool_account_sessions` (website-managed saved authentication state).
- The Self Hosted path is regression-guarded against updating or deleting `tool_access_grants`.
- Live Supabase verification on 2026-09-15 found 3 active shared grants each for ChatGPT, Phrasly, and Stealthwriter (9 active grants total).
- The same verification found no website `tool_account_sessions` rows and no `browser_auth_sessions` rows for those three tools, so there is no existing website-saved session row currently available to compare before/after.

## CI evidence

Current main-app head `81198c2f834d015766c95a577f41abe7f2a93cab` passed Production Build run `34914822608`.

The exact run passed:

1. SneakWrite SSO regression test
2. Phrasly shared-auth regression tests
3. Multi-tool browser viewer regression tests
4. Self-hosted runtime signing regression tests
5. Browser provider coexistence policy tests
6. Phase 15 grant and saved-auth invariants
7. Custom payment gateway regression tests
8. TypeScript typecheck
9. Production build

The original Phase 15 PR #26 was merged after its exact head `5c325c7a144164867515585986714b69dcdecf16` passed Production Build run `34664567126`.

## Phase 14 dependency evidence

The standalone runtime repository has not changed its application runtime after the accepted Phase 14 deployment boundary. Phase 14 records live external acceptance for `runtime.topratedseotools.com`, including HTTPS health, unsigned API rejection, private worker control, real Chromium creation through the restricted viewer, and exact cleanup. Phase 14 is recorded COMPLETE / OWNER APPROVED.

A fresh external DNS probe could not be obtained from the current assistant execution environment because that environment could not resolve `runtime.topratedseotools.com`; this is recorded as an evidence-access limitation, not as a runtime failure.

## Audit findings

### SB-015-001 — Main-app integration missing before Phase 15

- Severity: BLOCKER (historical)
- Corrective action: added signed Self Hosted runtime client, provider coexistence policy, per-tool provider selection, viewer routing, provider migration, rollback behavior, and regressions in PR #26.
- Status: FIXED / MERGED / EXACT-HEAD CI GREEN.

### SB-015-002 — Need proof that Browser Use remains default and rollback remains simple

- Severity: BLOCKER
- Corrective action: provider policy regression locks Browser Use as the default and proves clearing an override resolves back to Browser Use. Live database global provider is `browser_use`.
- Status: VERIFIED / CLOSED.

### SB-015-003 — Need proof Self Hosted cannot corrupt grants or website-saved auth

- Severity: BLOCKER
- Corrective action: Phase 15 invariant regression rejects Self Hosted code paths that read/write website saved auth or mutate grants. Live database grants remain present and active.
- Status: VERIFIED / CLOSED.

### SB-015-004 — Need live website-to-Contabo launch evidence

- Severity: BLOCKER
- Requirement: perform at least one authenticated writer launch from the deployed website while the eligible tool is configured `self_hosted`, and observe a valid restricted viewer served by `runtime.topratedseotools.com`.
- Current evidence: code, CI, database configuration, signing compatibility, and Phase 14 runtime deployment are verified; a real production writer launch has not yet been observed in this Phase 15 closeout session.
- Status: OPEN — OWNER-ONLY UI ACTION / OBSERVATION REQUIRED.

## Invariant check

1. Browser Use preserved/default — PASS.
2. Standalone runtime separation maintained — PASS.
3. Generic runtime core — PASS via inherited Phase 14/earlier runtime evidence; Phase 15 adds no tool-specific runtime branch.
4. Credentials never reach writers — PASS for the Self Hosted integration path; request carries writer/tool identity only.
5. No raw CDP / unrestricted DevTools exposure — PASS via restricted viewer contract and inherited runtime security gate.
6. Portability — PASS; no Contabo-specific application logic introduced by Phase 15.
7. Fixed-cost architecture — PASS; Self Hosted targets the existing VPS runtime.
8. Logging policy — PASS by code/architecture review; no secret logging introduced by Phase 15.
9. Spend discipline — PASS; no new purchase introduced.
10. Session isolation — PASS via inherited runtime gate; Phase 15 does not alter it.
11. Active sessions protected — PASS via inherited runtime gate; Phase 15 does not alter it.
12. Abandoned sessions die — PASS via inherited runtime gate; Phase 15 does not alter it.
13. Capacity configurable / measurement later — PASS for architecture; empirical safe level remains Phase 18.
14. Rollback preserved — PASS in code/CI; live rollback drill belongs to Phase 19.

## Deferred / future-phase items

- Phase 16 owns 3/3 writer end-to-end validation.
- Phase 17 owns reliable global provider selection across eligible one-click tools. The current Phase 15 per-tool selector is therefore not treated as a reason to pull Phase 17 work forward.
- Phase 18 owns empirical safe concurrency determination.
- Phase 19 owns failure/restart/rollback drills beyond the Phase 15 code-level rollback guarantee.

## Gate status

- Code and exact-head CI: PASS.
- Live database coexistence state: PASS.
- Phase 14 runtime dependency: PASS from preserved deployment evidence; current-session external probe unavailable due assistant DNS resolution failure.
- Real deployed website -> Contabo Self Hosted launch: UNVERIFIED.

STATUS: IN TEST

Phase 15 must not be marked TECHNICALLY GREEN or COMPLETE until SB-015-004 is evidenced. After a successful live launch, update this audit to TECHNICALLY GREEN / AWAITING OWNER APPROVAL. Only explicit owner approval may mark Phase 15 COMPLETE.
