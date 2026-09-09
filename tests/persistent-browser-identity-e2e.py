#!/usr/bin/env python3
"""Persistent administrator-approved browser identity acceptance test."""

import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
from urllib import error, parse, request

API = os.environ.get("API_BASE", "http://127.0.0.1:18080").rstrip("/")
SERVICE_SECRET = os.environ["RUNTIME_SERVICE_AUTH_SECRET"].encode()
OPERATOR_SECRET = os.environ["RUNTIME_OPERATOR_AUTH_SECRET"]
WORKER_SECRET = os.environ["WORKER_CONTROL_SECRET"]
WORKER = os.environ.get("WORKER_BASE", "http://127.0.0.1:18081").rstrip("/")
TOOLS = ("generic-phase8-state", "generic-persistent-second")


def http(method, url, body=None, headers=None, timeout=60):
    payload = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    actual_headers = {"accept": "application/json", **(headers or {})}
    if payload is not None:
        actual_headers["content-type"] = "application/json"
    req = request.Request(url, data=payload, headers=actual_headers, method=method)
    try:
        with request.urlopen(req, timeout=timeout) as response:
            return response.status, json.loads(response.read() or b"{}")
    except error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}")


def signed(method, path, writer, body=None):
    raw = b"" if body is None else json.dumps(body, separators=(",", ":")).encode()
    timestamp = int(time.time())
    nonce = secrets.token_urlsafe(18)
    canonical = "\n".join((
        method, path, str(timestamp), nonce, writer, hashlib.sha256(raw).hexdigest(),
    )).encode()
    headers = {
        "x-toprated-timestamp": str(timestamp),
        "x-toprated-nonce": nonce,
        "x-toprated-writer-id": writer,
        "x-toprated-signature": hmac.new(SERVICE_SECRET, canonical, hashlib.sha256).hexdigest(),
    }
    return http(method, API + path, body, headers)


def operator(method, path, body=None):
    return http(method, API + path, body, {"x-toprated-operator-secret": OPERATOR_SECRET})


def decode_grant(grant):
    parts = parse.urlsplit(grant["url"])
    token = parse.unquote(parts.fragment)
    encoded = token.split(".", 1)[0]
    payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * ((4 - len(encoded) % 4) % 4)))
    viewer = parse.urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
    return viewer, token, payload


def viewer(method, viewer_url, token, action, body=None):
    return http(method, viewer_url + action, body, {"authorization": "Bearer " + token})


def worker(method, path, body=None):
    return http(method, WORKER + path, body, {"x-toprated-worker-secret": WORKER_SECRET})


def approve_identity(tool):
    code, started = operator("POST", f"/api/operator/tool-auth/{tool}/sessions")
    assert code == 201 and started["status"] == "active", (code, started)
    session_id = started["sessionId"]
    viewer_url, token, payload = decode_grant(started["viewerGrant"])

    for event in ("pressed", "released"):
        code, accepted = viewer("POST", viewer_url, token, "/input", {
            "type": "mouse", "event": event, "button": "left", "x": 230, "y": 150,
        })
        assert code == 200 and accepted["inputAccepted"] is True, (code, accepted)

    for _ in range(30):
        code, status = viewer("GET", viewer_url, token, "/status")
        if code == 200 and "/dashboard" in status.get("url", ""):
            break
        time.sleep(0.2)
    else:
        raise AssertionError("administrator browser never reached the authenticated fixture")

    code, approved = operator("POST", f"/api/operator/tool-auth/{tool}/sessions/{session_id}/approve")
    assert code == 200 and approved["status"] == "ready", (code, approved)
    assert approved["identity"]["available"] is True, approved
    assert approved["administratorSessionClosed"] is True, approved
    return approved["identity"], payload["sid"]


def launch(tool, writer):
    code, created = signed("POST", "/api/sessions", writer, {
        "writer_id": writer,
        "tool_slug": tool,
    })
    assert code == 201 and created["status"] == "active", (code, created)
    serialized = json.dumps(created)
    for secret_marker in ("phase8-auth", "shared-state-local", "shared-state-session", "encrypted_payload"):
        assert secret_marker not in serialized, created
    return created


def close(created, writer):
    code, result = signed("DELETE", f"/api/sessions/{created['sessionId']}", writer)
    assert code == 200 and result["status"] == "closed", (code, result)


def bootstrap():
    code, denied = http("POST", API + f"/api/operator/tool-auth/{TOOLS[0]}/sessions")
    assert code == 401 and denied["code"] == "OPERATOR_AUTH_REQUIRED", (code, denied)

    state = {
        "authenticated_cookies": [{"name": "phase8-auth", "value": "must-not-enter-writer-api", "domain": "127.0.0.1", "path": "/"}],
        "session_tokens": {"storage": {"localStorage": {"phase8-local": "shared-state-local"}}},
        "auth_headers": {},
    }
    code, forbidden = signed("POST", "/api/sessions", "raw-state-writer", {
        "writer_id": "raw-state-writer", "tool_slug": TOOLS[0], "browser_state": state,
    })
    assert code == 422 and forbidden["code"] == "BROWSER_STATE_INPUT_FORBIDDEN", (code, forbidden)
    assert "must-not-enter-writer-api" not in json.dumps(forbidden), forbidden

    code, missing = signed("POST", "/api/sessions", "missing-identity-writer", {
        "writer_id": "missing-identity-writer", "tool_slug": TOOLS[0],
    })
    assert code == 423 and missing["code"] == "TOOL_REAUTH_REQUIRED", (code, missing)

    versions = {}
    for tool in TOOLS:
        identity, _ = approve_identity(tool)
        versions[tool] = identity["version"]
        code, status = operator("GET", f"/api/operator/tool-auth/{tool}")
        assert code == 200 and status["identity"] == identity, (code, status)
        for forbidden_key in ("encrypted_payload", "payload_fingerprint", "cookies", "storage"):
            assert forbidden_key not in json.dumps(status), status
        created = launch(tool, "bootstrap-" + tool)
        close(created, "bootstrap-" + tool)
    assert versions == {tool: 1 for tool in TOOLS}, versions
    print(json.dumps({"result": "PASS", "stage": "bootstrap", "versions": versions}))


def after_restart():
    sessions = []
    for tool in TOOLS:
        code, status = operator("GET", f"/api/operator/tool-auth/{tool}")
        assert code == 200 and status["identity"]["available"] is True, (code, status)
        assert status["identity"]["version"] == 1, status
        sessions.append((launch(tool, "restart-" + tool), "restart-" + tool))
    assert sessions[0][0]["sessionId"] != sessions[1][0]["sessionId"]
    for created, writer in sessions:
        close(created, writer)
    print(json.dumps({"result": "PASS", "stage": "after-restart", "tools": len(TOOLS)}))


def expiration_recovery():
    writer = "expiry-writer"
    created = launch(TOOLS[0], writer)
    viewer_url, _token, payload = decode_grant(created["viewerGrant"])
    code, navigated = worker("POST", f"/browser/sessions/{payload['sid']}/navigate", {"url": "http://127.0.0.1:19091/login"})
    assert code == 200, (code, navigated)
    code, expired = signed("GET", f"/api/sessions/{created['sessionId']}", writer)
    assert code == 423 and expired["code"] == "TOOL_REAUTH_REQUIRED", (code, expired)

    code, unsafe_restore = operator("POST", f"/api/operator/tool-auth/{TOOLS[0]}/restore")
    assert code == 409 and unsafe_restore["code"] == "ADMIN_REAUTH_SESSION_REQUIRED", (code, unsafe_restore)

    identity, _ = approve_identity(TOOLS[0])
    assert identity["version"] == 2, identity
    recovered = launch(TOOLS[0], "recovered-writer")
    close(recovered, "recovered-writer")
    print(json.dumps({"result": "PASS", "stage": "expiration-recovery", "version": identity["version"], "viewer": viewer_url}))


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "bootstrap"
    {"bootstrap": bootstrap, "after-restart": after_restart, "expiration-recovery": expiration_recovery}[stage]()
