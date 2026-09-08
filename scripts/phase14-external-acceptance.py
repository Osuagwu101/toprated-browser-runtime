#!/usr/bin/env python3
"""Phase 14 external health, isolation, browser, viewer, and cleanup acceptance."""

import hashlib
import hmac
import json
import os
import secrets
import ssl
import sys
import time
from urllib import error, parse, request

BASE_URL = os.environ["RUNTIME_BASE_URL"].rstrip("/")
SERVICE_SECRET = os.environ["RUNTIME_SERVICE_AUTH_SECRET"].encode()
WRITER = "phase14-external-" + secrets.token_hex(8)

if not BASE_URL.startswith("https://"):
    raise SystemExit("RUNTIME_BASE_URL must use https://")
if len(SERVICE_SECRET) < 32:
    raise SystemExit("RUNTIME_SERVICE_AUTH_SECRET must contain at least 32 bytes")


def call(method, path, body=None, headers=None, timeout=60):
    payload = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    req = request.Request(BASE_URL + path, data=payload, method=method, headers=headers or {})
    if payload is not None:
        req.add_header("content-type", "application/json")
    try:
        with request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as response:
            return response.status, response.headers, response.read()
    except error.HTTPError as exc:
        return exc.code, exc.headers, exc.read()


def signed(method, path, body=None):
    payload = b"" if body is None else json.dumps(body, separators=(",", ":")).encode()
    timestamp = str(int(time.time()))
    nonce = secrets.token_urlsafe(18)
    canonical = "\n".join([
        method.upper(), path, timestamp, nonce, WRITER, hashlib.sha256(payload).hexdigest()
    ]).encode()
    signature = hmac.new(SERVICE_SECRET, canonical, hashlib.sha256).hexdigest()
    headers = {
        "accept": "application/json",
        "x-toprated-timestamp": timestamp,
        "x-toprated-nonce": nonce,
        "x-toprated-signature": signature,
        "x-toprated-writer-id": WRITER,
    }
    return call(method, path, body, headers)


session_id = None
checks = {}
try:
    status, headers, raw = call("GET", "/api/health")
    health = json.loads(raw or b"{}")
    checks["health"] = status == 200 and health.get("status") == "ok"
    checks["tls_hsts"] = "max-age=" in headers.get("Strict-Transport-Security", "")

    status, _, _ = call("GET", "/api/capacity")
    checks["unsigned_api_rejected"] = status == 401

    status, _, _ = call("GET", "/browser/status")
    checks["worker_control_private"] = status == 404

    status, _, raw = signed("POST", "/api/sessions", {
        "writer_id": WRITER,
        "tool_slug": "generic-phase7-smoke",
    })
    created = json.loads(raw or b"{}")
    if status != 201:
        raise RuntimeError(f"session creation returned HTTP {status}")
    session_id = created["sessionId"]
    grant_url = created["viewerGrant"]["url"]
    grant = parse.urlsplit(grant_url)
    if f"{grant.scheme}://{grant.netloc}" != BASE_URL:
        raise RuntimeError("viewer grant origin does not match RUNTIME_BASE_URL")
    token = parse.unquote(grant.fragment)
    viewer_path = grant.path

    status, _, shell = call("GET", viewer_path)
    checks["viewer_shell"] = status == 200 and token.encode() not in shell

    status, _, raw = call("GET", viewer_path + "/status", headers={"authorization": "Bearer " + token})
    viewer = json.loads(raw or b"{}")
    checks["restricted_viewer"] = status == 200 and viewer.get("title") == "Phase 7 Generic Configured Tool"
finally:
    if session_id:
        status, _, _ = signed("DELETE", f"/api/sessions/{session_id}")
        checks["cleanup"] = status == 200

failed = sorted(name for name, passed in checks.items() if not passed)
print(json.dumps({"phase": 14, "result": "FAIL" if failed else "PASS", "checks": checks}, sort_keys=True))
sys.exit(1 if failed else 0)
