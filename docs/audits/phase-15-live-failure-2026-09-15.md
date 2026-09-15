# Phase 15 live launch failure — 2026-09-15

## Evidence

- Owner performed the required live Phrasly launch from the deployed Top Rated SEO Tools website using an active writer account.
- Website UI confirmed the writer still had access, but displayed: `Phrasly access is temporarily unavailable. Please try again shortly.`
- Live Supabase row created by that click:
  - `created_at`: `2026-09-15 02:04:46.339556+00`
  - `tool_slug`: `phrasly`
  - `provider`: `self_hosted`
  - `status`: `failed`
  - `error_code`: `self_hosted_runtime_unavailable`
  - `provider_session_id`: null
- The failing user id corresponds to one of the three active Phase 15 writer grants. The grant itself remained active.

## Diagnosis

The failure occurs after access/grant/account validation and after provider resolution selects `self_hosted`, but before a runtime session id is returned. The main app deliberately collapses every exception in `launchSelfHostedBrowser()` into the audit code `self_hosted_runtime_unavailable`, so the database row alone cannot distinguish among:

1. missing/invalid `SELF_HOSTED_BROWSER_RUNTIME_SECRET` on the website server;
2. invalid `SELF_HOSTED_BROWSER_RUNTIME_URL` on the website server;
3. website DNS/network/TLS failure reaching the Contabo runtime;
4. runtime authentication rejection caused by a signing-secret mismatch;
5. another non-success runtime response not mapped to `CAPACITY_FULL` or reauthentication.

Repository evidence shows the main app's checked-in `.env` does not contain either Phase 15 runtime variable. Production clearly uses external environment overrides for other services, so the actual OVH process environment must be inspected rather than inferred from the repository.

No retrieved Phase 15 evidence confirms that the OVH website process was ever configured with the runtime URL/signing secret before the phase was paused.

## Root-cause status

`NOT YET PROVEN` — highest-probability configuration gap is the website process missing the Phase 15 runtime signing secret, but the server process environment or logs must be inspected before changing production configuration.

## Required next diagnostic

On the OVH website host, inspect only whether these variables are present (do not print the secret value):

- `SELF_HOSTED_BROWSER_RUNTIME_URL`
- `SELF_HOSTED_BROWSER_RUNTIME_SECRET`

Then verify the website host can reach `https://runtime.topratedseotools.com/api/health`.

If both variables are present, compare the website signing secret with the Contabo runtime service secret using a non-reversible digest/length check rather than printing either secret.

## Gate impact

Phase 15 remains `IN TEST`. This is a real failing acceptance run and blocks `TECHNICALLY GREEN` until the underlying handoff failure is fixed and the live writer launch is rerun successfully.
