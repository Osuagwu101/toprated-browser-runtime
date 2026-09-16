# Phase 15 — Interactive authentication browser audit

Status: **IN TEST**  
Blueprint: Master Blueprint v1.1  
Verified PR baseline: `phase15-interactive-auth-browser` at `316ad7e6e1298330d6af9d074b74818248613c18`

## Evidence reviewed

- PR #21 head and diff against `main` (`7dc696d7af34285efe020db75afc748a1ad4d539`).
- Browser-worker interactive authentication, session, viewer, Compose, Laravel ToolAuthController, BrowserWorkerClient and SessionManager implementation.
- GitHub Actions run `35049148304`: **failure** at `Capture identities and launch without writer state`; run `35049148326`: **success**.

## Findings

1. **Blocker — profile handoff deleted the authenticated Chrome profile.** The human-auth worker closed a temporary UUID profile, reopened it only to export raw browser state, then removed it. This contradicts durable account Chrome profiles and caused the failing identity workflow.
2. **Major — writer launches had no durable profile identity.** The signed server-to-server contract carried browser state but not the configured tool/account scope needed to reopen the matching profile.
3. **Major — no cross-worker profile ownership lock existed.** Separate account profiles could run concurrently, but two processes could also contend for one profile after an interruption.

## Fix set

- Added deterministic, opaque SHA-256 profile directories under `/srv/account-browser-profiles`, keyed by configured tool plus account scope.
- Human authentication launches stable Google Chrome headed under Xvfb without CDP or automation switches. It retains its profile after clean close.
- Final verification reopens the exact profile with Google Chrome only after the human authentication stage. It verifies the configured auth policy and never exports cookies or browser storage.
- Writer sessions receive only tool/account scope over the existing authenticated internal contract, reopen the matching saved profile with Google Chrome, and retain restricted-viewer and session authorization controls.
- Added a bounded renewable profile lease. A second owner is rejected; expired stale leases remove only Chrome singleton artifacts, never the profile data.
- Existing encrypted browser-state identities remain a transition fallback. A successful new administrator authentication stores only a durable-profile approval marker in the application database.

## Verification

- **PASS:** Node syntax checks for changed worker modules.
- **PASS:** `node --test browser-worker/test/*.test.mjs` — 33 passing tests, including deterministic profile identity, concurrent different profiles, same-profile rejection, clean reopen, and stale lock/artifact recovery.
- **PASS:** `python3 tests/interactive-auth-contract.py`.
- **UNVERIFIED locally:** PHP syntax, Docker Compose validation/build and the full E2E workflow; this environment has neither `php` nor `docker` installed.
- **UNVERIFIED:** live Contabo/Phrasly control case. It requires the legitimate administrator to complete Cloudflare and login manually; no bypassing mechanism is implemented.

## Standing invariants

1. Browser Use default/fallback — **PASS (no production Browser Use change)**.
2. Separate runtime boundary — **PASS**.
3. Generic tool infrastructure — **PASS**.
4. Writer secret isolation — **PASS by contract/unit; E2E pending**.
5. No raw CDP exposure — **PASS by static contract**.
6. Linux/Docker portability — **PASS by Compose design; container build pending**.
7. Fixed-cost design — **PASS**.
8. Secret-free logs — **PASS by code/static contract; container log E2E pending**.
9. No new infrastructure purchase — **PASS**.
10. Writer isolation — **PASS by deterministic profile/lease unit tests; E2E pending**.
11. Active-session lease behaviour — **UNVERIFIED regression pending CI**.
12. Reaper/restart reconciliation — **UNVERIFIED regression pending CI**.
13. Configurable concurrency — **PASS for separate profiles; capacity measurement remains Phase 18**.
14. Browser Use rollback — **PASS by unchanged provider path; production integration regression pending**.

## Remaining gate

PR #21 must pass its PHP, container, E2E, security and inherited CI gates on the final commit. The live controlled Phrasly experiment then requires a human administrator at the restricted viewer. If normal Chrome fails Cloudflare there, record the result as Contabo/network/browser-environment evidence; do not add evasion techniques.
