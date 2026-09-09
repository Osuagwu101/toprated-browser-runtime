# Persistent Administrator-Approved Browser Identity

## Architecture and security model

Each managed tool has one administrator-approved identity record. The record is created only from an operator browser session after the runtime verifies the tool profile's configured authentication indicators. Cookies and Web Storage are normalized to the tool's allowed hosts, encrypted with the dedicated `BROWSER_IDENTITY_ENCRYPTION_KEY`, and stored in the persistent runtime database. Only non-secret metadata is returned by the operator status API.

Writer browsers remain isolated. Every writer receives a separate ephemeral Chromium profile and a session-bound restricted viewer. At launch, Laravel decrypts the approved identity in memory and sends it over the authenticated private worker network. The worker hydrates the new isolated profile before navigating to the configured tool URL, verifies authentication, and removes the bootstrap script. The profile is deleted when the session ends.

The runtime never returns passwords, OTPs, cookies, Web Storage, the encrypted payload, raw CDP, profile files, or worker control credentials to a writer. The production defaults reject caller-supplied `browser_state` and reject the former status-only restore operation.

The persistent record is a bounded authenticated-identity snapshot, not one shared writable Chrome directory. This preserves concurrent writer isolation and avoids cross-user history or form-data leakage. Tool-specific URLs, allowed hosts, authentication indicators, and administrator login URLs remain configuration-driven in `api/config/tool-profiles.json`.

## Required configuration

Generate a dedicated 32-byte key and store its Base64 representation only in the protected deployment environment:

```bash
openssl rand -base64 32
```

Set:

```dotenv
BROWSER_IDENTITY_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
ALLOW_LEGACY_BROWSER_STATE_INPUT=false
ALLOW_LEGACY_AUTH_RESTORE=false
```

Do not rotate or lose the identity encryption key until every managed tool has been reapproved. A missing or incorrect key fails closed; it does not expose or silently discard identity data.

## Tool configuration

An authenticated tool is defined with no core-code changes:

```json
{
  "example-tool": {
    "enabled": true,
    "launch_url": "https://example.com/app",
    "admin_login_url": "https://example.com/login",
    "browser_state": {
      "required": true,
      "allowed_hosts": ["example.com"]
    },
    "authentication": {
      "required": true,
      "url_contains_any": ["/app"],
      "selectors_any": ["[data-authenticated=\"true\"]"],
      "timeout_seconds": 15
    }
  }
}
```

Both launch and administrator-login hosts must be within `allowed_hosts`. Unknown fields, unsafe URLs, missing authentication indicators, and host mismatches fail closed.

## Administrator workflow

Operator APIs are intentionally absent from the public Caddy ingress. On the VPS, access them through an administrator-controlled localhost/SSH path and supply the operator secret as a protected environment value.

1. Start an authentication session with `POST /api/operator/tool-auth/{tool}/sessions` and an empty body.
2. Open the returned one-time restricted viewer URL.
3. Complete the normal login, MFA/OTP, CAPTCHA, or device verification directly in that browser. No credential or verification value is submitted to a runtime API.
4. After the tool reaches the configured authenticated state, call `POST /api/operator/tool-auth/{tool}/sessions/{session}/approve` with an empty body.
5. The runtime verifies authentication, captures and encrypts the approved identity, closes the administrator browser, increments the identity version, and marks the tool ready.
6. Cancel an unfinished session with `DELETE /api/operator/tool-auth/{tool}/sessions/{session}`.

`GET /api/operator/tool-auth/{tool}` reports only readiness and safe identity metadata: availability, version, capture time, and approval time.

## Writer workflow

The platform backend signs the normal request:

```json
{
  "writer_id": "assigned-writer-id",
  "tool_slug": "example-tool"
}
```

The writer receives only the runtime session metadata and restricted viewer grant. The approved identity is loaded internally. A launch request containing `browser_state`, credentials, OTP fields, or a URL override is rejected under production defaults.

## Expiration and recovery

Authentication is verified at startup and while the viewer is used. When an authenticated indicator disappears, the runtime:

1. blocks the viewer frame/input path;
2. closes the affected browser;
3. latches the tool as `reauth_required`;
4. blocks later launches before consuming browser capacity; and
5. requires a new administrator session and approved capture.

The old status-only `/restore` shortcut is disabled in production. Successful recovery creates a new encrypted identity version; simply clearing the latch cannot make stale state trusted again.

## Restart, cleanup, and concurrency

- Encrypted identity records use the existing persistent runtime database volume and survive API, worker, container, and host restarts.
- Writer Chromium profiles are temporary and are removed on normal close, timeout, crash cleanup, and restart reconciliation.
- Multiple writers can consume the same approved identity concurrently without sharing a writable browser profile or viewer token.
- Existing lease, idle/disconnect cleanup, orphan reaping, capacity limits, and exact-session ownership checks remain in force.

## Validation

`.github/workflows/persistent-browser-identity.yml` verifies administrator capture, encrypted storage, writer launch without state input, restart persistence, two configuration-defined tools, concurrent isolated sessions, authentication expiry, mandatory recapture, versioned reapproval, secret-free responses/logs, and final process/profile cleanup. All inherited phase workflows remain required because this change touches completed Phase 8/9 guarantees.
