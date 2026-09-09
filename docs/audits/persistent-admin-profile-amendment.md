# Persistent administrator-profile amendment

Date: 2026-09-09

Owner decision: approved for implementation

Baseline: standalone `main` at `fbfe54d86fa44bcd66125d38a4a9a689dcd73bf0`

Branch: `repair/persistent-admin-profiles`

## Root cause

Every browser session previously received a new `/tmp/toprated-browser-*` Chromium `--user-data-dir`, and exact-session cleanup recursively deleted that directory. The administrator harness could export cookies and Web Storage for a proof session, but Chromium profile identity—such as provider trust artifacts, IndexedDB, service-worker state, and other browser-managed profile data—never survived session closure. Phase 10 therefore proved reuse inside an already-running browser, not reuse of an approved administrator identity on a later run.

## Minimal architecture change

The generic browser/session architecture remains intact. The amendment adds one separate lifecycle class:

- `admin_auth` sessions use one opaque, per-tool Chromium profile below `ADMIN_PROFILE_ROOT`;
- `writer` and `proof` sessions continue using isolated temporary profiles that are deleted on stop;
- only operator-authenticated API routes can create, approve, or close an `admin_auth` session;
- a per-tool profile cannot be opened concurrently;
- approval verifies the live authenticated state, captures a bounded allowed-host state envelope, proves it in a fresh isolated browser, closes the admin browser, then encrypts the approved envelope with Laravel `APP_KEY`;
- normal writer launches load the approved envelope server-side and never receive the admin profile or raw state; and
- live authentication loss invalidates the approved envelope and latches the existing administrator-action-required state.

This intentionally keeps two different persistence mechanisms. The durable Chromium profile preserves administrator-controlled browser identity. The encrypted Laravel vault provides only the bounded cookie/Web Storage material needed to bootstrap isolated writer browsers. Writers never run on the admin profile.

## Changed surfaces

| Surface | Change |
|---|---|
| Worker lifecycle | Added `admin_auth` session kind and exact persistent-profile acquire/release semantics. |
| Chromium launch | `--user-data-dir` points to the per-tool durable directory only for admin sessions; all other sessions retain temporary directories. |
| Worker control API | Added private `/browser/admin-sessions` start/status/approve routes. |
| Operator API | Added start/approve/delete routes below `/api/operator/tool-auth/{tool}/sessions`. |
| Authorized state | Added encrypted `tool_authorized_states` vault and automatic server-side injection for managed writer launches. |
| Tool profiles | Added optional `audience` and `admin_profile.enabled`/`admin_profile.launch_url`. |
| Deployment | Added the `admin-profile-data` named volume and Chromium managed policies that disable password saving, autofill, browser sign-in, and sync. |
| Harnesses | Phase 8 and Phase 10 operator flows now approve the persistent profile; writer proofs no longer shuttle raw state through harness memory/files. |

## Security invariants

- Admin profile identifiers are SHA-256-derived opaque directory names, not tool slugs.
- The profile root and tool directories are real directories with mode `0700`; broad and symbolic-link roots fail closed.
- Admin profile paths, raw approved state, cookies, storage and worker control data are absent from writer/operator responses and normal logs.
- Writer tool profiles marked `audience: operator` fail through the signed service API.
- The worker keeps loopback-only dynamic CDP and the restricted frame/input viewer.
- A persistent profile is released only after Chromium and its process group are proven stopped; incomplete cleanup keeps the profile unavailable.
- Proof and writer browsers never use the persistent admin `user-data-dir`.

## Migration and rollback

Deployment must run the included Laravel migration before use. Existing `browser_sessions` rows receive `session_kind=writer`; the new approved-state table begins empty, so each managed tool requires one administrator approval before a new writer browser can launch.

`APP_KEY` is now also the encryption root for approved-state envelopes. Preserve it across deployments and back up the runtime database and `admin-profile-data` volume together. Rotating or losing `APP_KEY` makes existing approved envelopes unreadable and requires administrator reapproval. Restoring only one of the database or profile volume is supported but may require reapproval; it must never silently expose state.

Rollback requires stopping the runtime first. The schema migration can be rolled back, but the persistent profile volume should be retained as a protected backup until rollback is accepted. Deleting a per-tool profile or the named volume intentionally resets browser identity and forces full administrator authentication on the next approval.

## Validation gate

`tests/persistent-admin-profile-e2e.py` and `.github/workflows/persistent-admin-profiles.yml` prove:

1. a writer is blocked before approval;
2. the first admin run needs explicit restricted-viewer interaction;
3. approval succeeds only after live authentication and isolated proof;
4. a writer launches without receiving or submitting raw state;
5. the admin profile survives worker restart and reuses existing authentication without repeating the login interaction;
6. provider-side expiry invalidates the encrypted approved state and blocks writers;
7. the persistent profile remains identifiable as expired and requires administrator interaction;
8. reapproval restores writer launches;
9. concurrent writers have distinct worker sessions, PIDs and temporary profiles; and
10. proof/writer cleanup leaves zero active sessions and zero temporary profile residue while retaining exactly one durable admin profile.

The workflow separately inspects the database ciphertext, filesystem permissions, runtime logs, durable terminal records, and final worker inventory. This amendment is not complete until exact-head CI evidence is green; it does not advance or close Phase 14.
