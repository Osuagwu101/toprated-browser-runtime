#!/usr/bin/env python3
from pathlib import Path

manager = Path("browser-worker/src/interactive-auth-browser.mjs").read_text()
server = Path("browser-worker/src/server.mjs").read_text()
session_manager = Path("api/app/Services/SessionManager.php").read_text()
tool_auth = Path("api/app/Http/Controllers/ToolAuthController.php").read_text()
dockerfile = Path("browser-worker/Dockerfile").read_text()
compose = Path("docker-compose.yml").read_text()
interactive_server = Path("browser-worker/src/interactive-auth-server.mjs").read_text()
interactive_client = Path("browser-worker/src/interactive-auth-client.mjs").read_text()

required_manager = [
    "google-chrome-stable",
    "automationAttached: false",
    "Interactive authentication Chrome must not use",
    "--remote-debugging-port",
    "--headless",
    "xdotool",
    "ImageMagick import",
    "prepareForValidation(sessionId",
    "cleanupProfile(profileId",
]
for needle in required_manager:
    if needle not in manager:
        raise SystemExit(f"interactive-auth contract missing {needle!r} in manager")

for forbidden_runtime_arg in [
    "'--headless=new'",
    "'--remote-debugging-port=0'",
    "'--enable-automation'",
    "'--disable-blink-features=AutomationControlled'",
]:
    # These strings may exist in guard/test logic, but must not be emitted by
    # buildInteractiveChromeArgs itself. Inspect only the helper body.
    helper = manager.split("export function buildInteractiveChromeArgs", 1)[1].split("export function assertInteractiveChromeArgs", 1)[0]
    if forbidden_runtime_arg in helper:
        raise SystemExit(f"interactive auth launch helper contains {forbidden_runtime_arg}")

required_server = [
    "/browser/interactive-auth-sessions",
    "finalize-authentication",
    "interactiveAuth.frame(sessionId)",
    "interactiveAuth.input(sessionId, body)",
    "interactiveAuth.prepare(sessionId)",
    "profileValidationController.start",
    "interactiveAuth.cleanupProfile(profileId)",
]
for needle in required_server:
    if needle not in server:
        raise SystemExit(f"interactive-auth contract missing {needle!r} in worker server")

if "startInteractiveAuthentication($launchUrl)" not in session_manager:
    raise SystemExit("operator sessions are not routed through interactive authentication")

for needle in [
    "finalizeInteractiveAuthentication(",
    "Interactive authentication did not produce reusable browser identity state.",
]:
    if needle not in tool_auth:
        raise SystemExit(f"tool auth finalization contract missing {needle!r}")

for needle in [
    "google-chrome-stable",
    "USER browser",
    "xdotool",
    "imagemagick",
]:
    if needle not in dockerfile:
        raise SystemExit(f"browser image contract missing {needle!r}")

for needle in [
    "interactive-auth-worker:",
    "cap_add:",
    "- SYS_ADMIN",
    "INTERACTIVE_AUTH_WORKER_URL: http://interactive-auth-worker:8082",
    "interactive-auth-profiles:/srv/interactive-auth-profiles",
]:
    if needle not in compose:
        raise SystemExit(f"isolated auth service contract missing {needle!r}")

browser_worker_block = compose.split("\n  browser-worker:\n    build:", 1)[1].split("\nnetworks:", 1)[0]
if "SYS_ADMIN" in browser_worker_block:
    raise SystemExit("writer browser worker must not receive SYS_ADMIN")

for needle in [
    "InteractiveAuthBrowserManager",
    "/internal/sessions",
    "automationAttachedDuringAuth: false",
]:
    if needle not in interactive_server:
        raise SystemExit(f"interactive auth server contract missing {needle!r}")

for needle in [
    "INTERACTIVE_AUTH_WORKER_URL",
    "X-Toprated-Worker-Secret",
    "prepare(sessionId)",
    "cleanupProfile(profileId)",
]:
    if needle not in interactive_client:
        raise SystemExit(f"interactive auth client contract missing {needle!r}")

print("interactive_auth_contract=pass")
