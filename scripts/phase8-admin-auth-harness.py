#!/usr/bin/env python3
"""Operator-only Phase 8 Phrasly login, capture and live proof harness.

Requires runtime operator secrets. It never asks for or prints Phrasly credentials,
OTP values, cookies, browser storage, worker secrets, or viewer bearer tokens.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import stat
import sys
import tempfile
import time
from pathlib import Path
from urllib import error, parse, request

API = os.environ.get("API_BASE", "http://127.0.0.1:18080").rstrip("/")
WORKER = os.environ.get("WORKER_BASE", "http://127.0.0.1:18081").rstrip("/")
SERVICE_SECRET = os.environ.get("RUNTIME_SERVICE_AUTH_SECRET", "").encode()
WORKER_SECRET = os.environ.get("WORKER_CONTROL_SECRET", "")
LOGIN_TIMEOUT_SECONDS = int(os.environ.get("PHASE8_ADMIN_LOGIN_TIMEOUT_SECONDS", "900"))
LINK_FILE = Path(os.environ.get("PHASE8_ADMIN_VIEWER_LINK_FILE", "/tmp/phase8-phrasly-admin-viewer.txt"))
BOOTSTRAP_WRITER = "phase8-admin-bootstrap"
PROOF_WRITER = "phase8-live-proof"


def die(message):
    print(json.dumps({"result": "FAIL", "reason": message}), file=sys.stderr)
    raise SystemExit(1)


def signed(method, path, writer, obj=None):
    if len(SERVICE_SECRET) < 32:
        die("Runtime service authentication is not configured.")
    body = b"" if obj is None else json.dumps(obj, separators=(",", ":")).encode()
    timestamp = int(time.time())
    nonce = secrets.token_urlsafe(18)
    canonical = "\n".join([
        method.upper(), path, str(timestamp), nonce, writer,
        hashlib.sha256(body).hexdigest(),
    ]).encode()
    headers = {
        "accept": "application/json",
        "x-toprated-timestamp": str(timestamp),
        "x-toprated-nonce": nonce,
        "x-toprated-signature": hmac.new(SERVICE_SECRET, canonical, hashlib.sha256).hexdigest(),
        "x-toprated-writer-id": writer,
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


def decode_grant(grant):
    if not isinstance(grant, dict) or not isinstance(grant.get("url"), str):
        die("Runtime did not return an operator viewer grant.")
    parts = parse.urlsplit(grant["url"])
    token = parse.unquote(parts.fragment)
    if "." not in token:
        die("Operator viewer grant is malformed.")
    encoded, _signature = token.split(".", 1)
    try:
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * ((4 - len(encoded) % 4) % 4)))
    except Exception:
        die("Operator viewer grant payload is malformed.")
    viewer_url = parse.urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
    return grant["url"], token, payload, viewer_url


def worker_json(path):
    if len(WORKER_SECRET.encode()) < 32:
        die("Worker control authentication is not configured.")
    req = request.Request(
        WORKER + path,
        headers={"accept": "application/json", "x-toprated-worker-secret": WORKER_SECRET},
        method="GET",
    )
    try:
        with request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read() or b"{}")
    except error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read() or b"{}")
        except Exception:
            return exc.code, {"status": "error"}
    except Exception:
        die("Could not reach the private browser worker.")


def viewer_status(viewer_url, token):
    req = request.Request(viewer_url + "/status", headers={"authorization": "Bearer " + token})
    try:
        with request.urlopen(req, timeout=30) as response:
            return json.loads(response.read() or b"{}")
    except Exception:
        return {}


def is_authenticated_phrasly(url):
    parts = parse.urlsplit(str(url or ""))
    host = (parts.hostname or "").lower().strip(".")
    return (host == "phrasly.ai" or host.endswith(".phrasly.ai")) and "/dashboard" in parts.path


def secure_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR)
    try:
        os.write(descriptor, value.encode())
    finally:
        os.close(descriptor)


def close_session(session_id, writer):
    if session_id:
        try:
            signed("DELETE", f"/api/sessions/{session_id}", writer)
        except Exception:
            pass


def main():
    bootstrap_id = None
    proof_id = None
    state_file = None
    try:
        code, bootstrap = signed("POST", "/api/sessions", BOOTSTRAP_WRITER, {
            "writer_id": BOOTSTRAP_WRITER,
            "tool_slug": "phrasly-admin-bootstrap",
        })
        if code not in (200, 201):
            die(f"Administrator browser could not start ({bootstrap.get('code', 'UNKNOWN')}).")
        bootstrap_id = bootstrap.get("sessionId")
        viewer_link, token, grant_payload, viewer_url = decode_grant(bootstrap.get("viewerGrant"))
        worker_session_id = grant_payload.get("sid")
        if not isinstance(worker_session_id, str):
            die("Administrator browser identity is missing.")

        secure_write(LINK_FILE, viewer_link + "\n")
        print(json.dumps({
            "result": "WAITING_FOR_ADMIN_LOGIN",
            "viewerLinkFile": str(LINK_FILE),
            "instruction": "Open the protected link file, use that one-time link, and complete Phrasly login and verification in the displayed browser.",
            "timeoutSeconds": LOGIN_TIMEOUT_SECONDS,
            "credentialsPrinted": False,
        }), flush=True)

        deadline = time.time() + LOGIN_TIMEOUT_SECONDS
        while time.time() < deadline:
            status = viewer_status(viewer_url, token)
            if is_authenticated_phrasly(status.get("url")):
                break
            time.sleep(2)
        else:
            die("Phrasly did not reach an authenticated dashboard before the operator-login timeout.")

        code, state = worker_json(f"/browser/sessions/{parse.quote(worker_session_id)}/authorized-state")
        if code != 200 or not isinstance(state, dict):
            die("The private worker could not capture the authenticated browser state.")

        descriptor, state_path = tempfile.mkstemp(prefix="phase8-phrasly-state-", suffix=".json")
        os.close(descriptor)
        state_file = Path(state_path)
        os.chmod(state_file, stat.S_IRUSR | stat.S_IWUSR)
        secure_write(state_file, json.dumps(state, separators=(",", ":")))

        close_session(bootstrap_id, BOOTSTRAP_WRITER)
        bootstrap_id = None
        try:
            LINK_FILE.unlink(missing_ok=True)
        except Exception:
            pass

        code, proof = signed("POST", "/api/sessions", PROOF_WRITER, {
            "writer_id": PROOF_WRITER,
            "tool_slug": "phrasly",
            "browser_state": state,
        })
        if code not in (200, 201) or proof.get("status") != "active":
            die(f"Live Phrasly shared-state proof failed ({proof.get('code', 'UNKNOWN')}).")
        proof_id = proof.get("sessionId")
        _link, _proof_token, proof_payload, _proof_viewer = decode_grant(proof.get("viewerGrant"))
        code, proof_status = worker_json(f"/browser/sessions/{parse.quote(str(proof_payload.get('sid') or ''))}")
        authentication = proof_status.get("authentication") if isinstance(proof_status, dict) else {}
        if code != 200 or not is_authenticated_phrasly(proof_status.get("url")):
            die("Live proof browser did not remain on an authenticated Phrasly dashboard.")
        if not isinstance(authentication, dict) or authentication.get("required") is not True or authentication.get("verified") is not True:
            die("Runtime did not verify authenticated Phrasly before viewer access.")

        print(json.dumps({
            "result": "PASS",
            "phase": 8,
            "tool": "phrasly",
            "authenticated": True,
            "viewerGrantedAfterAuth": True,
            "statePersisted": False,
            "credentialsPrinted": False,
        }))
    finally:
        close_session(proof_id, PROOF_WRITER)
        close_session(bootstrap_id, BOOTSTRAP_WRITER)
        try:
            LINK_FILE.unlink(missing_ok=True)
        except Exception:
            pass
        if state_file:
            try:
                state_file.unlink(missing_ok=True)
            except Exception:
                pass


if __name__ == "__main__":
    main()
