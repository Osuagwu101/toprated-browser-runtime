#!/usr/bin/env python3
"""Manual Phase 8 acceptance against real Phrasly shared state.

Reads sensitive state only from PHRASLY_STATE_FILE, submits it over the signed
service API, verifies that the self-hosted Chromium reached authenticated Phrasly,
and closes the browser. The state itself is never printed.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import stat
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, parse, request

API = os.environ.get("API_BASE", "http://127.0.0.1:18080").rstrip("/")
WRITER = os.environ.get("PHASE8_ACCEPTANCE_WRITER", "phase8-real-phrasly")
STATE_FILE = os.environ.get("PHRASLY_STATE_FILE", "")
SERVICE_SECRET = os.environ.get("RUNTIME_SERVICE_AUTH_SECRET", "").encode()


def die(message: str, code: int = 1) -> None:
    print(json.dumps({"result": "FAIL", "reason": message}), file=sys.stderr)
    raise SystemExit(code)


def load_state() -> dict:
    if not STATE_FILE:
        die("PHRASLY_STATE_FILE is required; do not paste shared state into chat or command history.")
    path = Path(STATE_FILE).expanduser().resolve()
    if not path.is_file():
        die("PHRASLY_STATE_FILE does not point to a readable file.")

    if os.name == "posix":
        mode = stat.S_IMODE(path.stat().st_mode)
        if mode & 0o077:
            die("PHRASLY_STATE_FILE must not be group/world-readable; run chmod 600 on it.")

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        die("PHRASLY_STATE_FILE is not valid JSON.")
    if not isinstance(payload, dict):
        die("PHRASLY_STATE_FILE must contain a JSON object.")

    # A direct state object is accepted, as is a single exported
    # tool_account_sessions row. Only the three state fields cross into runtime.
    if "verification_status" in payload and payload.get("verification_status") != "active":
        die("The exported Phrasly state is not marked active.")
    if payload.get("expires_at"):
        try:
            expires = datetime.fromisoformat(str(payload["expires_at"]).replace("Z", "+00:00"))
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if expires <= datetime.now(timezone.utc):
                die("The exported Phrasly state is expired.")
        except SystemExit:
            raise
        except Exception:
            die("The exported Phrasly state has an invalid expires_at value.")

    state = {
        "authenticated_cookies": payload.get("authenticated_cookies"),
        "session_tokens": payload.get("session_tokens"),
        "auth_headers": payload.get("auth_headers") or {},
    }
    if not isinstance(state["authenticated_cookies"], list):
        die("The exported state does not contain authenticated_cookies as an array.")
    if not isinstance(state["session_tokens"], dict):
        die("The exported state does not contain session_tokens as an object.")
    return state


def signed(method: str, path: str, obj=None):
    if len(SERVICE_SECRET) < 32:
        die("RUNTIME_SERVICE_AUTH_SECRET must be set to the same runtime service secret used by the API.")
    body = b"" if obj is None else json.dumps(obj, separators=(",", ":")).encode()
    timestamp = int(time.time())
    nonce = secrets.token_urlsafe(18)
    canonical = "\n".join([
        method.upper(),
        path,
        str(timestamp),
        nonce,
        WRITER,
        hashlib.sha256(body).hexdigest(),
    ]).encode()
    signature = hmac.new(SERVICE_SECRET, canonical, hashlib.sha256).hexdigest()
    headers = {
        "accept": "application/json",
        "x-toprated-timestamp": str(timestamp),
        "x-toprated-nonce": nonce,
        "x-toprated-signature": signature,
        "x-toprated-writer-id": WRITER,
    }
    if obj is not None:
        headers["content-type"] = "application/json"
    req = request.Request(API + path, data=(body if obj is not None else None), headers=headers, method=method.upper())
    try:
        with request.urlopen(req, timeout=45) as response:
            return response.status, json.loads(response.read() or b"{}")
    except error.HTTPError as exc:
        try:
            payload = json.loads(exc.read() or b"{}")
        except Exception:
            payload = {"code": "HTTP_ERROR"}
        return exc.code, payload
    except Exception:
        die("Could not reach the standalone runtime API.")


def decode_grant(grant: dict):
    if not isinstance(grant, dict) or not isinstance(grant.get("url"), str):
        die("Runtime did not return a viewer grant after authentication verification.")
    parts = parse.urlsplit(grant["url"])
    token = parse.unquote(parts.fragment)
    if not token or "." not in token:
        die("Viewer grant token is malformed.")
    encoded, _signature = token.split(".", 1)
    try:
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * ((4 - len(encoded) % 4) % 4)))
    except Exception:
        die("Viewer grant token payload is malformed.")
    viewer_url = parse.urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
    return token, payload, viewer_url


def viewer_status(viewer_url: str, token: str) -> dict:
    req = request.Request(viewer_url + "/status", headers={"authorization": "Bearer " + token})
    try:
        with request.urlopen(req, timeout=30) as response:
            return json.loads(response.read() or b"{}")
    except Exception:
        die("Authenticated viewer status could not be read from the self-hosted browser.")


def safe_location(value: str) -> str:
    try:
        parts = parse.urlsplit(value)
        return parse.urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
    except Exception:
        return "[invalid]"


def main() -> None:
    state = load_state()
    session_id = None
    try:
        code, created = signed("POST", "/api/sessions", {
            "writer_id": WRITER,
            "tool_slug": "phrasly",
            "browser_state": state,
        })
        if code not in (200, 201):
            public_code = created.get("code") if isinstance(created, dict) else None
            die(f"Phrasly launch was rejected by the runtime ({public_code or 'UNKNOWN'}).")
        if created.get("status") != "active":
            die("Phrasly browser did not become active.")
        session_id = created.get("sessionId")

        token, grant_payload, viewer_url = decode_grant(created.get("viewerGrant"))
        if grant_payload.get("wid") != WRITER:
            die("Viewer grant writer ownership does not match the acceptance writer.")
        status = viewer_status(viewer_url, token)
        authentication = status.get("authentication") or {}
        location = str(status.get("url") or "")
        parsed = parse.urlsplit(location)
        host = (parsed.hostname or "").lower().strip(".")
        if host != "phrasly.ai" and not host.endswith(".phrasly.ai"):
            die("Self-hosted browser did not end on a Phrasly host.")
        if authentication.get("required") is not True or authentication.get("verified") is not True:
            die("Runtime did not verify authenticated Phrasly before viewer access.")
        if "/dashboard" not in parsed.path:
            die("Phrasly did not remain on an authenticated dashboard path.")

        print(json.dumps({
            "result": "PASS",
            "phase": 8,
            "tool": "phrasly",
            "authenticated": True,
            "location": safe_location(location),
            "title": str(status.get("title") or "")[:160],
            "viewerGrantedAfterAuth": True,
            "rawStatePrinted": False,
        }))
    finally:
        if session_id:
            try:
                signed("DELETE", f"/api/sessions/{session_id}")
            except Exception:
                pass


if __name__ == "__main__":
    main()
