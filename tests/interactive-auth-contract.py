#!/usr/bin/env python3
from pathlib import Path

manager = Path("browser-worker/src/interactive-auth-browser.mjs").read_text()
server = Path("browser-worker/src/server.mjs").read_text()
session_manager = Path("api/app/Services/SessionManager.php").read_text()
tool_auth = Path("api/app/Http/Controllers/ToolAuthController.php").read_text()
dockerfile = Path("browser-worker/Dockerfile").read_text()

required_manager = [
    "google-chrome-stable",
    "automationAttached: false",
    "Interactive authentication Chrome must not use",
    "--remote-debugging-port",
    "--headless",
    "xdotool",
    "ImageMagick import",
    "finalize(sessionId",
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

print("interactive_auth_contract=pass")
