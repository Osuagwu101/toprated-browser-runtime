#!/usr/bin/env python3
"""Static guard for the public, signed Phase 15 administrator handoff."""

from pathlib import Path

routes = Path("api/routes/api.php").read_text()
caddy = Path("deploy/Caddyfile").read_text()

service_group = routes.split(
    "Route::middleware(['runtime.security:service', 'service.auth'])", 1
)[1].split(
    "Route::middleware(['runtime.security:operator', 'operator.auth'])", 1
)[0]

required = (
    "Route::post('/tool-auth/{tool}/sessions'",
    "Route::post('/tool-auth/{tool}/sessions/{session}/approve'",
    "Route::delete('/tool-auth/{tool}/sessions/{session}'",
)
for route in required:
    assert route in service_group, f"missing signed service route: {route}"

assert "/api/tool-auth/*" in caddy, "public ingress does not expose signed handoff"
assert "/api/operator/*" not in caddy, "private operator API must remain unexposed"

print("phase15-service-auth-handoff-contract: signed routes exposed; operator API private")
