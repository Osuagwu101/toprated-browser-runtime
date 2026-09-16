#!/usr/bin/env python3
"""Static security contract for permanent, human-authenticated Chrome profiles."""
from pathlib import Path

manager = Path("browser-worker/src/interactive-auth-browser.mjs").read_text()
profile = Path("browser-worker/src/account-browser-profile.mjs").read_text()
server = Path("browser-worker/src/server.mjs").read_text()
interactive_server = Path("browser-worker/src/interactive-auth-server.mjs").read_text()
interactive_client = Path("browser-worker/src/interactive-auth-client.mjs").read_text()
viewer_auth = Path("browser-worker/src/viewer-auth.mjs").read_text()
tool_auth = Path("api/app/Http/Controllers/ToolAuthController.php").read_text()
session_controller = Path("api/app/Http/Controllers/SessionController.php").read_text()
browser_config = Path("api/config/browser.php").read_text()
env_example = Path(".env.example").read_text()
compose = Path("docker-compose.yml").read_text()

helper = manager.split("export function buildInteractiveChromeArgs", 1)[1].split("export function assertInteractiveChromeArgs", 1)[0]
for forbidden in ["'--headless=new'", "'--remote-debugging-port=0'", "'--enable-automation'", "'--disable-blink-features=AutomationControlled'", "'--no-sandbox'"]:
    if forbidden in helper:
        raise SystemExit(f"human-auth Chrome launch helper contains forbidden switch {forbidden}")

for needle in ["AccountBrowserProfileLease", "clearStaleChromeArtifacts", "automationAttached: false", "prepareForValidation(sessionId", "persistentProfile: true", "google-chrome-stable"]:
    if needle not in manager:
        raise SystemExit(f"interactive manager missing {needle!r}")

for needle in ["profileIdFor", "createHash('sha256')", "ACCOUNT_PROFILE_IN_USE", "expiresAt", "SingletonLock", "clearStaleChromeArtifacts"]:
    if needle not in profile:
        raise SystemExit(f"profile safety contract missing {needle!r}")

for needle in ["persistentProfile", "ACCOUNT_PROFILE_IN_USE", "interactiveAuth.start(body.url", "GOOGLE_CHROME_EXECUTABLE"]:
    if needle not in server:
        raise SystemExit(f"runtime persistent-profile contract missing {needle!r}")

for needle in ["toolSlug", "accountScope", "persistentProfile:", "validationController.start", "automationAttachedDuringAuth: false"]:
    if needle not in interactive_server:
        raise SystemExit(f"interactive auth server contract missing {needle!r}")

if "cleanupProfile" in interactive_client:
    raise SystemExit("profile deletion must not be exposed through the interactive worker client")

for forbidden in ["exportAuthorizedState", "'browserState' =>", "'authenticated_cookies' =>"]:
    if forbidden in tool_auth:
        raise SystemExit(f"tool authentication API still exposes or persists raw browser state: {forbidden!r}")

for needle in ["persistent_profile", "persistentProfile", "BROWSER_STATE_INPUT_FORBIDDEN"]:
    if needle not in session_controller:
        raise SystemExit(f"writer permanent-profile routing missing {needle!r}")

for needle in ["MAX_VIEWER_TTL_SECONDS = 3600", "viewer token TTL must be between 1 and ${MAX_VIEWER_TTL_SECONDS} seconds"]:
    if needle not in viewer_auth:
        raise SystemExit(f"viewer authorization lifetime contract missing {needle!r}")

for needle in [
    "'admin_viewer_token_ttl_seconds' => (int) env('ADMIN_VIEWER_TOKEN_TTL_SECONDS', 3600)",
    "'session_idle_timeout_seconds' => (int) env('SESSION_IDLE_TIMEOUT_SECONDS', 3600)",
    "'session_disconnect_grace_seconds' => (int) env('SESSION_DISCONNECT_GRACE_SECONDS', 3600)",
]:
    if needle not in browser_config:
        raise SystemExit(f"interactive admin lifecycle config missing {needle!r}")

for needle in ["ADMIN_VIEWER_TOKEN_TTL_SECONDS=3600", "SESSION_IDLE_TIMEOUT_SECONDS=3600", "SESSION_DISCONNECT_GRACE_SECONDS=3600"]:
    if needle not in env_example:
        raise SystemExit(f"documented interactive admin lifecycle default missing {needle!r}")

for needle in ["interactive-auth-worker:", "ACCOUNT_BROWSER_PROFILE_ROOT: /srv/account-browser-profiles", "interactive-auth-profiles:/srv/account-browser-profiles"]:
    if needle not in compose:
        raise SystemExit(f"compose persistent profile volume missing {needle!r}")

print("interactive_auth_contract=pass")
