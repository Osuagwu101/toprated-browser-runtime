# Phase 7 Audit — Generic Tool-Profile Framework

Status: **GREEN / COMPLETE / APPROVED**

Owner approval date: **2026-09-05**

Phase anchor:

- Current phase: **Phase 7 — Generic Tool-Profile Framework**
- Last completed phase before Phase 7: **Phase 6 — Lifecycle Management**, approved 2026-09-04
- Blueprint: **Master Blueprint v1.1**
- Standalone Phase 6 baseline: `304753b3b7ac8c654adf263edbee8d56a9619148`
- Phase 7 implementation branch: `phase7-tool-profiles`
- Final documented Phase 7 head: `a6a17e43c1109533a1230c719b2524455837a8d4`
- Promoted standalone `main` head: `67281ba8815f2a407d4f2e6904ce1d7c38880d1d`

Blueprint exit gate:

> **The runtime can launch a generic configured tool without Phrasly-specific branching in core infrastructure.**

The Blueprint assigns Phase 7 four responsibilities: implement a generic tool configuration/profile model; separate common browser infrastructure from tool-specific authenticated/login/OTP indicators; make the worker accept a generic tool launch contract; and prove the exit gate above. Phrasly saved-state injection and authenticated-state verification remain Phase 8 work.

## Baseline audit

The approved Phase 6 runtime already provided generic browser creation, isolated Chromium sessions, Laravel-owned lifecycle orchestration, secure viewer grants, lifecycle reaping and restart reconciliation. It did not yet provide a server-owned tool-profile registry or a configured generic launch path. A signed caller could still supply the launch destination directly through the Phase 6 launch contract, so the runtime had no authoritative mapping from `tool_slug` to a configured tool launch target.

That was the Phase 7 gate gap.

## Implemented Phase 7 contract

Phase 7 adds a Laravel-owned generic tool-profile layer while leaving the browser worker tool-agnostic:

- `api/app/Services/ToolProfileRegistry.php` loads and validates a bounded JSON profile registry.
- `api/config/tool-profiles.json` supplies generic configured profiles used by regression and Phase 7 smoke tests. It contains no Phrasly profile.
- `api/config/browser.php` makes the profile source configurable rather than embedding it in controller logic.
- `SessionController::store()` accepts signed writer identity plus `tool_slug`, resolves the configured profile on the server, and passes only the resolved generic launch URL into common session infrastructure.
- Unknown profiles fail with `TOOL_PROFILE_NOT_FOUND` and disabled profiles fail with `TOOL_PROFILE_DISABLED` before Chromium creation.
- Caller attempts to replace a profile destination fail with `LAUNCH_URL_OVERRIDE_FORBIDDEN`.
- `{writer_id}` is the only supported template placeholder at this phase and is URL-encoded before use; unsupported placeholders and malformed profile configuration fail closed.
- Health treats tool-profile configuration as launch-critical and exposes only configuration counts/validity, not credentials or browser state.
- The worker remains generic: its private authenticated session endpoint accepts a generic launch URL and contains no Phrasly-specific branch. Tool authentication indicators, saved browser state and OTP/login detection are deliberately not implemented here because the Blueprint assigns those to Phase 8/9 profiles/adapters.

The resulting Phase 7 request path is:

`signed writer request -> tool_slug -> Laravel ToolProfileRegistry -> resolved generic launch URL -> SessionManager -> private worker launch -> isolated Chromium -> restricted viewer`

This is consistent with Appendix B's conceptual generic launch contract. Phase 7 supplies the writer/tool identity and signed service metadata at the Laravel boundary, returns session/viewer/lease metadata, and keeps the worker launch primitive generic. The authorized browser-state reference portion of Appendix B is intentionally deferred to the Phase 8 reference profile, where the Blueprint first requires saved authenticated state injection.

## Security and failure handling

The profile registry validates:

- profile count: 1 through 100;
- slug format and bounded length;
- exact supported profile fields for this phase;
- boolean enablement;
- bounded non-empty launch URLs;
- supported placeholder use; and
- launch schemes limited to `http`, `https`, or controlled `data:text/html` fixtures.

The launch controller does not trust a caller-provided destination. A supplied `launch_url` is accepted only when it is byte-for-byte identical to the server-resolved profile URL, preserving compatibility with inherited callers without restoring destination authority to them.

No tool credential, OTP, cookie, storage token, CDP endpoint, Docker/host capability or signing secret was added to the profile model or response surface.

## Regression issues found and fixed

### SB-007-001 — Missing authoritative tool-profile model

The Phase 6 launch path did not have a server-owned tool profile mapping. Phase 7 introduced `ToolProfileRegistry`, validated configured profiles and server-owned launch-target resolution. Unknown, disabled and malformed profiles fail closed.

Status: **FIXED / CLOSED**.

### SB-007-002 — Reaper sequencing interfered with inherited pre-reaper regression setup

The first combined Phase 7 workflow started the autonomous Phase 6 reaper while inherited Phase 4/5 fixtures were still running their historical setup sequence. The workflow was corrected so Phase 4/5 inherited regressions execute before the autonomous reaper is started; the reaper is then mandatory for Phase 6 lifecycle verification and final cleanup.

Status: **FIXED / CLOSED**.

### SB-007-003 — API restart could expose a transient worker-read connection refusal

The first complete inherited Phase 6 regression on the Phase 7 branch exposed a real restart race. Immediately after `docker compose restart api`, Laravel could be healthy while an idempotent API-to-worker read briefly encountered a connection refusal and returned `WORKER_UNAVAILABLE`.

RED evidence retained: Phase 6 Lifecycle Management run `33919958668`, job `101175779193`.

The fix was applied in `api/app/Services/BrowserWorkerClient.php` at commit `d1d9269b7f1dda161ac1c72f9eae7884b4d59266`:

- only idempotent worker reads (`health`, session list and session status) receive bounded connection-level retry;
- four total attempts are allowed with 100 ms delay;
- POST session creation is not retried, avoiding duplicate Chromium launch risk if a request is processed but its response is lost;
- permanent worker unavailability and worker HTTP errors still fail normally.

The inherited Phase 6 test was not weakened, skipped or rewritten around the failure. The same test passed after the runtime fix.

Status: **FIXED / CLOSED**.

## Corrected implementation verification

Exact corrected implementation head: `d1d9269b7f1dda161ac1c72f9eae7884b4d59266`.

All authoritative workflows passed on that same SHA:

- Verified Through Phase 3 — run `33926255081` — **SUCCESS**;
- Phase 4 Laravel Session API — run `33926255136` — **SUCCESS**;
- Phase 5 Session Isolation — run `33926255038` — **SUCCESS**;
- Phase 6 Lifecycle Management — run `33926255036` — **SUCCESS**;
- Phase 7 Generic Tool Profiles — run `33926255054` — **SUCCESS**.

## Final documented branch verification

Exact final documented branch head: `a6a17e43c1109533a1230c719b2524455837a8d4`.

All five authoritative workflows passed again on that exact SHA:

- Verified Through Phase 3 — run `33926867078` — **SUCCESS**;
- Phase 4 Laravel Session API — run `33926867092` — **SUCCESS**;
- Phase 5 Session Isolation — run `33926867099` — **SUCCESS**;
- Phase 6 Lifecycle Management — run `33926867114` — **SUCCESS**;
- Phase 7 Generic Tool Profiles — run `33926867048` — **SUCCESS**.

The Phase 7 workflow additionally proves:

- repository-wide type/syntax/configuration validation;
- no `phrasly` reference in core runtime source/configuration paths;
- no raw CDP exposure pattern;
- health reports a generic browser core and valid tool-profile configuration;
- Phase 4 Laravel ownership behavior remains intact;
- Phase 5 same-origin writer isolation remains intact;
- configured Phase 7 generic tool launch works without a caller-supplied URL;
- unknown and disabled profiles fail closed;
- caller destination override fails closed;
- same writer/profile reuses the same live browser;
- Phase 6 lifecycle/restart behavior remains intact;
- Chromium/profile residue scan is clean; and
- durable session records are terminal at the end of the run.

## Controlled promotion verification

PR #9 promoted the exact final documented Phase 7 head `a6a17e43c1109533a1230c719b2524455837a8d4` to standalone `main`.

Promoted `main` head: `67281ba8815f2a407d4f2e6904ce1d7c38880d1d`.

All five authoritative workflows passed on that resulting `main` SHA:

- Verified Through Phase 3 — run `33939565151` — **SUCCESS**;
- Phase 4 Laravel Session API — run `33939565157` — **SUCCESS**;
- Phase 5 Session Isolation — run `33939565153` — **SUCCESS**;
- Phase 6 Lifecycle Management — run `33939565173` — **SUCCESS**;
- Phase 7 Generic Tool Profiles — run `33939565154` — **SUCCESS**.

## Standing invariant check

1. **Browser Use untouched — PASS.** Phase 7 changes are confined to the standalone runtime; the production website repository remained unchanged after promotion.
2. **Separation maintained — PASS.** No production application integration is introduced; that remains Phase 15.
3. **Generic, not Phrasly-hardcoded — PASS.** Core-source CI scan is clean and the configured launch path is generic.
4. **Credentials never reach writers — PASS.** No credential/state/OTP surface was introduced; inherited viewer/service controls pass.
5. **No raw CDP or unrestricted DevTools exposure — PASS.** Static exposure scan and inherited viewer regressions pass.
6. **Session isolation — PASS.** Inherited Phase 5 same-origin isolation regression passes.
7. **Active sessions protected — PASS.** Inherited Phase 6 lifecycle regression passes.
8. **Abandoned sessions die — PASS.** Inherited Phase 6 reaper, crash, orphan and restart reconciliation regression passes.
9. **Capacity is configuration — PASS.** Existing 1..15 configuration model is preserved; empirical 5/10/15 proof remains Phase 18.
10. **Portability — PASS.** Linux + Docker/Compose topology is unchanged; no host-specific dependency was added.
11. **Fixed-cost model — PASS.** No usage-metered browser dependency or service was added.
12. **Logging policy — PASS.** Profile health exposes only counts/validity; no secret-bearing log path was added.
13. **Rollback preserved — PASS.** Production Browser Use remains independent and no production provider switch is introduced in Phase 7.
14. **Spend discipline — PASS.** No hosting purchase or paid infrastructure is introduced or recommended.

## Production isolation

After the Phase 7 promotion, the production website/Browser Use repository `Osuagwu101/topratedseotools-0bc24c5f` was rechecked and remained at `ea5d39b79d7c3fac9c004ae3dfd6b55ff75df084`.

Phase 7 therefore did not alter the production Browser Use path.

## Known limitations and correctly deferred work

These are not Phase 7 defects because the Blueprint assigns them to later gates:

- real Phrasly profile and saved authenticated-state injection — **Phase 8**;
- login/OTP/verification detection and admin-reauth-required behavior — **Phase 9**;
- second real eligible tool proof — **Phase 10**;
- broader security hardening/rate limiting — **Phase 11**;
- empirical resource/load measurements — **Phase 12 / 18**;
- production application/provider integration — **Phase 15**.

The generic profile schema is intentionally minimal in Phase 7. The Blueprint's wider profile concept includes login URLs, authentication indicators, browser-state requirements, compatibility state and optional navigation/timeout rules; those fields become meaningful as Phase 8-10 adapters are implemented. They are not fabricated prematurely into the browser core.

## Gate decision

**SATISFIED / APPROVED.** The runtime launches a server-configured generic tool without Phrasly-specific branching in core infrastructure, all inherited behavioral gates passed on the final documented branch head and promoted `main`, and the owner explicitly approved Phase 7 as COMPLETE on 2026-09-05.

No known Critical, High or gate-blocking Phase 7 defect remains open.

Phase 7 is **GREEN / COMPLETE / APPROVED**.

Phase 8 is eligible to begin only on explicit instruction and remains **NOT STARTED** by this closure.
