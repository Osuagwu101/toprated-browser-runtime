# Phase 15 — Interactive authentication browser audit

Status: **IN TEST**  
Blueprint: Master Blueprint v1.1  
Verified PR baseline: `phase15-interactive-auth-browser` at `9a7747d010f06b0e852bfddb615dad7f8a788c7e`

## Evidence reviewed

- PR #21 head and diff against `main` (`7dc696d7af34285efe020db75afc748a1ad4d539`).
- Browser-worker interactive authentication, session, viewer, Compose, Laravel ToolAuthController, BrowserWorkerClient and SessionManager implementation.
- GitHub Actions red-run history through `35056298366`, including durable-cookie loss, profile-handoff contention and an incorrectly required raw-state payload.
- Final exact-head workflows: Persistent Browser Identity run `35056499005` and Phase 14 Deployment Readiness run `35056498973`: **success**.

## Findings

1. **Blocker — profile handoff deleted the authenticated Chrome profile.** The human-auth worker closed a temporary UUID profile, reopened it only to export raw browser state, then removed it. This contradicts durable account Chrome profiles and caused the failing identity workflow.
2. **Major — writer launches had no durable profile identity.** The signed server-to-server contract carried browser state but not the configured tool/account scope needed to reopen the matching profile.
3. **Major — no cross-worker profile ownership lock existed.** Separate account profiles could run concurrently, but two processes could also contend for one profile after an interruption.
4. **Blocker — interactive shutdown could force-kill Chrome before its cookie store was durably flushed.** The bare-Xvfb shutdown requested a window-manager-mediated close, which was not a reliable normal Chrome quit. The fresh validation browser then lacked the login cookie.
5. **Blocker — validation success was sent before its Chrome cleanup completed.** The immediate writer launch raced the validation profile lease even after validation had succeeded.
6. **Blocker — a durable profile writer was still evaluated against the legacy raw browser-state requirement.** It had no copied state by design, so its valid profile-backed launch was rejected.

## Fix set

- Added deterministic, opaque SHA-256 profile directories under `/srv/account-browser-profiles`, keyed by configured tool plus account scope.
- Human authentication launches stable Google Chrome headed under Xvfb without CDP or automation switches. It retains its profile after clean close.
- Final verification reopens the exact profile with Google Chrome only after the human authentication stage. It verifies the configured auth policy and never exports cookies or browser storage.
- Writer sessions receive only tool/account scope over the existing authenticated internal contract, reopen the matching saved profile with Google Chrome, and retain restricted-viewer and session authorization controls.
- Added a bounded renewable profile lease. A second owner is rejected; expired stale leases remove only Chrome singleton artifacts, never the profile data.
- Existing encrypted browser-state identities remain a transition fallback. A successful new administrator authentication stores only a durable-profile approval marker in the application database.
- Replaced the unreliable Xvfb window-close request with a focused Chrome `Alt+F4` close, preserving the protocol close only as a fallback.
- The finalize endpoint now waits for the validation Chrome cleanup before returning approval. Its safe diagnostics record only exit/orphan/zombie counts.
- Every persistent-profile reopen now uses the same basic credential-store mode as authentication and validation; profile-backed launches do not require a copied raw browser-state payload.

## Verification

- **PASS:** Node syntax checks for changed worker modules.
- **PASS:** `node --test browser-worker/test/*.test.mjs` — 33 passing tests, including deterministic profile identity, concurrent different profiles, same-profile rejection, clean reopen, and stale lock/artifact recovery.
- **PASS:** `python3 tests/interactive-auth-contract.py`.
- **UNVERIFIED locally:** PHP syntax, Docker Compose validation/build and the full E2E workflow; this environment has neither `php` nor `docker` installed.
- **UNVERIFIED:** live Contabo/Phrasly control case. It requires the legitimate administrator to complete Cloudflare and login manually; no bypassing mechanism is implemented.
- **PASS:** final CI Persistent Browser Identity run `35056499005` — static/typecheck, container build, durable authenticated handoff, writer launch without copied state, encrypted marker storage, account isolation, restart recovery, expiry/reapproval, cleanup, and secret-free logs.
- **PASS:** final CI Phase 14 Deployment Readiness run `35056498973`.

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

The CI gate is green on the final branch head. The remaining Phase 15 evidence is the live controlled Phrasly experiment, which requires a human administrator at the restricted viewer. If normal Chrome fails Cloudflare there, record the result as Contabo/network/browser-environment evidence; do not add evasion techniques.
