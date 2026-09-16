#!/usr/bin/env python3
"""Regression contract for interactive administrator viewer lifecycle."""
from pathlib import Path

manager = Path("api/app/Services/SessionManager.php").read_text()
config = Path("api/config/browser.php").read_text()
env_example = Path(".env.example").read_text()
viewer_auth = Path("browser-worker/src/viewer-auth.mjs").read_text()
grant_service = Path("api/app/Services/ViewerGrantService.php").read_text()

for needle in [
    "$isOperatorAuthentication = str_ends_with((string) $session->tool_slug, '-admin-bootstrap');",
    "if (! $isOperatorAuthentication && $activityAt !== null)",
    "if (! $isOperatorAuthentication && $heartbeatAt !== null)",
]:
    if needle not in manager:
        raise SystemExit(f"admin lifecycle exemption missing {needle!r}")

for needle in ["SESSION_IDLE_TIMEOUT_SECONDS', 900", "SESSION_DISCONNECT_GRACE_SECONDS', 180"]:
    if needle not in config:
        raise SystemExit(f"writer lifecycle default changed unexpectedly: {needle!r}")

for needle in ["ADMIN_VIEWER_TOKEN_TTL_SECONDS', 3600", "MAX_VIEWER_TTL_SECONDS = 3600"]:
    if needle not in config + viewer_auth:
        raise SystemExit(f"admin viewer TTL contract missing {needle!r}")

if "MAX_VIEWER_TTL_SECONDS = 3600" not in grant_service:
    raise SystemExit("API viewer grant ceiling is not aligned with worker verification")
if "ADMIN_VIEWER_TOKEN_TTL_SECONDS=3600" not in env_example:
    raise SystemExit("documented admin viewer TTL is not one hour")

print("admin_viewer_lifecycle_contract=pass")
