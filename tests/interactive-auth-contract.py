#!/usr/bin/env python3
"""Static security contract for permanent, human-authenticated Chrome profiles."""
from pathlib import Path

manager = Path("browser-worker/src/interactive-auth-browser.mjs").read_text()
profile = Path("browser-worker/src/account-browser-profile.mjs").read_text()
server = Path("browser-worker/src/server.mjs").read_text()
interactive_server = Path("browser-worker/src/interactive-auth-server.mjs").read_text()
interactive_client = Path("browser-worker/src/interactive-auth-client.mjs").read_text()
tool_auth = Path("api/app/Http/Controllers/ToolAuthController.php").read_text()
session_controller = Path("api/app/Http/Controllers/SessionController.php").read_text()
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

for forbidden in ["exportAuthorizedState(validationSessionId)", "authorizedState"]:
    if forbidden in interactive_server:
        raise SystemExit(f"interactive auth finalization must keep browser state inside the persistent profile: {forbidden!r}")

if "cleanupProfile" in interactive_client:
    raise SystemExit("profile deletion must not be exposed through the interactive worker client")

for forbidden in ["exportAuthorizedState", "'browserState' =>", "'authenticated_cookies' =>"]:
    if forbidden in tool_auth:
        raise SystemExit(f"tool authentication API still exposes raw browser state directly: {forbidden!r}")

for forbidden in ["AuthorizedBrowserState", "authorizedState", "$normalizedState"]:
    if forbidden in tool_auth:
        raise SystemExit(f"persistent-profile approval must not copy raw browser state: {forbidden!r}")

for needle in ["['persistent_profile' => true]", "$identities->save($tool"]:
    if needle not in tool_auth:
        raise SystemExit(f"persistent-profile marker save missing {needle!r}")

for needle in ["persistent_profile", "persistentProfile", "BROWSER_STATE_INPUT_FORBIDDEN"]:
    if needle not in session_controller:
        raise SystemExit(f"writer permanent-profile routing missing {needle!r}")

for needle in ["interactive-auth-worker:", "ACCOUNT_BROWSER_PROFILE_ROOT: /srv/account-browser-profiles", "interactive-auth-profiles:/srv/account-browser-profiles"]:
    if needle not in compose:
        raise SystemExit(f"compose persistent profile volume missing {needle!r}")

print("interactive_auth_contract=pass")
