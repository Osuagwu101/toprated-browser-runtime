#!/usr/bin/env python3
"""Operator-only Phase 10 live-account validation for configured authenticated tools.

The harness never accepts or prints account credentials, OTP values, raw browser
state, viewer bearer tokens, or runtime secrets. The administrator authenticates
inside the restricted self-hosted viewer, then this harness proves the captured
state in a fresh Chromium and removes all temporary sessions and link files.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import stat
import subprocess
import sys
import time
from pathlib import Path
from urllib import error, parse, request

API = os.environ.get("API_BASE", "http://127.0.0.1:18080").rstrip("/")
WORKER = os.environ.get("WORKER_BASE", "http://127.0.0.1:18081").rstrip("/")
SERVICE_SECRET = os.environ.get("RUNTIME_SERVICE_AUTH_SECRET", "").encode()
WORKER_SECRET = os.environ.get("WORKER_CONTROL_SECRET", "")
OPERATOR_SECRET = os.environ.get("RUNTIME_OPERATOR_AUTH_SECRET", "")
TOOL = os.environ.get("PHASE10_LIVE_TOOL", "chatgpt").strip().lower()
LOGIN_TIMEOUT_SECONDS = int(os.environ.get("PHASE10_ADMIN_LOGIN_TIMEOUT_SECONDS", "1200"))
READY_FILE_VALUE = os.environ.get("PHASE10_ADMIN_LOGIN_READY_FILE", "").strip()

TOOLS = {
    "chatgpt": {
        "bootstrap": "chatgpt-admin-bootstrap",
        "hosts": {"chatgpt.com", "openai.com"},
    },
    "stealthwriter": {
        "bootstrap": "stealthwriter-admin-bootstrap",
        "hosts": {"stealthwriter.ai"},
    },
}


def progress(stage):
    print(json.dumps({"result": "PROGRESS", "tool": TOOL, "stage": stage}), flush=True)


def die(message):
    print(json.dumps({"result": "FAIL", "tool": TOOL, "reason": message}), file=sys.stderr, flush=True)
    raise SystemExit(1)


def read_json(req, timeout=75):
    try:
        with request.urlopen(req, timeout=timeout) as response:
            return response.status, json.loads(response.read() or b"{}")
    except error.HTTPError as exc:
        try:
            payload = json.loads(exc.read() or b"{}")
        except Exception:
            payload = {"code": "HTTP_ERROR"}
        return exc.code, payload
    except Exception:
        die("Could not reach the standalone runtime.")


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
    return read_json(request.Request(
        API + path,
        data=(body if obj is not None else None),
        headers=headers,
        method=method.upper(),
    ))


def operator(method, path):
    if len(OPERATOR_SECRET.encode()) < 32:
        die("Runtime operator authentication is not configured.")
    return read_json(request.Request(
        API + path,
        headers={
            "accept": "application/json",
            "x-toprated-operator-secret": OPERATOR_SECRET,
        },
        method=method.upper(),
    ), timeout=30)


def worker_json(method, path):
    if len(WORKER_SECRET.encode()) < 32:
        die("Worker control authentication is not configured.")
    return read_json(request.Request(
        WORKER + path,
        headers={
            "accept": "application/json",
            "x-toprated-worker-secret": WORKER_SECRET,
        },
        method=method.upper(),
    ), timeout=30)


def decode_grant(grant):
    if not isinstance(grant, dict) or not isinstance(grant.get("url"), str):
        die("Runtime did not return a restricted viewer grant.")
    parts = parse.urlsplit(grant["url"])
    token = parse.unquote(parts.fragment)
    if "." not in token:
        die("Restricted viewer grant is malformed.")
    encoded, _signature = token.split(".", 1)
    try:
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * ((4 - len(encoded) % 4) % 4)))
    except Exception:
        die("Restricted viewer grant payload is malformed.")
    viewer_url = parse.urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
    return grant["url"], token, payload, viewer_url


def viewer_status(viewer_url, token):
    return read_json(request.Request(
        viewer_url + "/status",
        headers={"authorization": "Bearer " + token, "accept": "application/json"},
    ), timeout=30)


def secure_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR)
    try:
        os.write(descriptor, value.encode())
    finally:
        os.close(descriptor)


def close_session(session_id, writer):
    if not session_id:
        return
    try:
        signed("DELETE", f"/api/sessions/{session_id}", writer)
    except Exception:
        pass


def wait_for_admin(ready_file, viewer_opened=False, timeout_seconds=LOGIN_TIMEOUT_SECONDS):
    print(json.dumps({
        "result": "WAITING_FOR_ADMIN_LOGIN",
        "tool": TOOL,
        "viewerLinkFile": str(LINK_FILE),
        "instruction": "Open the protected one-time viewer link, complete account sign-in in that browser, then return to this terminal and press Enter.",
        "timeoutSeconds": timeout_seconds,
        "credentialsPrinted": False,
        "rawStatePrinted": False,
        "viewerOpenedAutomatically": viewer_opened,
    }), flush=True)

    if sys.stdin.isatty():
        input()
        return

    if ready_file is None:
        die("Interactive confirmation is unavailable; set PHASE10_ADMIN_LOGIN_READY_FILE.")
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if ready_file.is_file():
            ready_file.unlink(missing_ok=True)
            return
        time.sleep(2)
    die("Administrator sign-in confirmation timed out.")


def host_allowed(value):
    try:
        host = (parse.urlsplit(str(value or "")).hostname or "").lower().strip(".")
    except Exception:
        return False
    return any(host == item or host.endswith("." + item) for item in TOOLS[TOOL]["hosts"])


def assert_clean_runtime(writer):
    code, capacity = signed("GET", "/api/capacity", writer)
    if code != 200 or capacity.get("workerActiveSessions") != 0 or capacity.get("openSessions") != 0:
        die("Runtime retained an active or open session after live validation.")
    code, worker = worker_json("GET", "/browser/sessions")
    if code != 200 or worker.get("activeCount") != 0 or worker.get("startingCount") != 0:
        die("Browser worker retained a Chromium session after live validation.")


def assert_secrets_absent_from_logs():
    markers = [
        SERVICE_SECRET.decode(errors="ignore"),
        WORKER_SECRET,
        OPERATOR_SECRET,
    ]
    try:
        result = subprocess.run(
            ["docker", "compose", "logs", "--no-color", "api", "browser-worker"],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except Exception:
        die("Runtime logs could not be inspected after live validation.")
    logs = result.stdout + result.stderr
    if any(marker and marker in logs for marker in markers):
        die("A runtime control secret appeared in container logs.")


if TOOL not in TOOLS:
    die("PHASE10_LIVE_TOOL must be chatgpt or stealthwriter.")

BOOTSTRAP_WRITER = f"phase10-{TOOL}-admin-bootstrap"
PROOF_WRITER = f"phase10-{TOOL}-live-proof"
LINK_FILE = Path(os.environ.get(
    "PHASE10_ADMIN_VIEWER_LINK_FILE",
    f"/tmp/phase10-{TOOL}-admin-viewer.txt",
))
READY_FILE = Path(READY_FILE_VALUE) if READY_FILE_VALUE else None


def main():
    bootstrap_id = None
    proof_id = None
    try:
        progress("PREFLIGHT_RUNTIME")
        code, capacity = signed("GET", "/api/capacity", BOOTSTRAP_WRITER)
        if code != 200 or capacity.get("workerHealthy") is not True:
            die("Standalone runtime preflight failed.")

        progress("RESTORE_OPERATOR_BOUNDARY")
        operator("POST", f"/api/operator/tool-auth/{TOOL}/restore")
        progress("START_ADMIN_BROWSER")
        code, bootstrap = signed("POST", "/api/sessions", BOOTSTRAP_WRITER, {
            "writer_id": BOOTSTRAP_WRITER,
            "tool_slug": TOOLS[TOOL]["bootstrap"],
        })
        if code not in (200, 201) or bootstrap.get("status") != "active":
            die(f"Administrator browser could not start ({bootstrap.get('code', 'UNKNOWN')}).")
        bootstrap_id = bootstrap.get("sessionId")
        viewer_link, _token, grant, _viewer_url = decode_grant(bootstrap.get("viewerGrant"))
        worker_session_id = grant.get("sid")
        if not isinstance(worker_session_id, str) or not worker_session_id:
            die("Administrator browser identity is missing.")

        secure_write(LINK_FILE, viewer_link + "\n")
        viewer_opened = False
        if os.name == "nt":
            try:
                os.startfile(viewer_link)
                viewer_opened = True
            except OSError:
                viewer_opened = False
        grantExpiresAt = int(grant.get("exp", 0))
        safeLoginSeconds = grantExpiresAt - int(time.time()) - 30
        if safeLoginSeconds < 60:
            die("Administrator viewer grant lifetime is too short for safe login.")
        wait_for_admin(
            READY_FILE,
            viewer_opened,
            min(LOGIN_TIMEOUT_SECONDS, safeLoginSeconds),
        )

        progress("CAPTURE_AUTHORIZED_STATE")
        code, state = worker_json(
            "GET",
            f"/browser/sessions/{parse.quote(worker_session_id)}/authorized-state",
        )
        if code != 200 or not isinstance(state, dict):
            die("Private worker could not capture the authenticated browser state.")

        close_session(bootstrap_id, BOOTSTRAP_WRITER)
        bootstrap_id = None
        LINK_FILE.unlink(missing_ok=True)

        progress("START_FRESH_PROOF_BROWSER")
        code, restored = operator("POST", f"/api/operator/tool-auth/{TOOL}/restore")
        if code != 200 or restored.get("status") != "ready":
            die("Operator recovery boundary could not prepare the live proof.")

        code, proof = signed("POST", "/api/sessions", PROOF_WRITER, {
            "writer_id": PROOF_WRITER,
            "tool_slug": TOOL,
            "browser_state": state,
        })
        state = None
        if code not in (200, 201) or proof.get("status") != "active":
            die(f"Fresh live-account proof failed ({proof.get('code', 'UNKNOWN')}).")
        proof_id = proof.get("sessionId")
        _link, proof_token, proof_grant, proof_viewer = decode_grant(proof.get("viewerGrant"))
        if proof_grant.get("wid") != PROOF_WRITER:
            die("Viewer grant writer ownership does not match the live-proof writer.")

        code, status = viewer_status(proof_viewer, proof_token)
        authentication = status.get("authentication") if isinstance(status, dict) else {}
        if code != 200 or not host_allowed(status.get("url")):
            die("Fresh proof browser did not remain on an expected live tool host.")
        if not isinstance(authentication, dict) or authentication.get("required") is not True or authentication.get("verified") is not True:
            die("Runtime did not verify live authentication before viewer access.")

        code, reused = signed("POST", "/api/sessions", PROOF_WRITER, {
            "writer_id": PROOF_WRITER,
            "tool_slug": TOOL,
        })
        if code != 200 or reused.get("reused") is not True or reused.get("sessionId") != proof_id:
            die("Live authenticated session was not reusable without state retransmission.")

        progress("VERIFY_FRESH_AUTHENTICATION")
        safe = parse.urlsplit(str(status.get("url") or ""))
        safe_location = parse.urlunsplit((safe.scheme, safe.netloc, safe.path, "", ""))
        close_session(proof_id, PROOF_WRITER)
        proof_id = None
        assert_clean_runtime(PROOF_WRITER)
        assert_secrets_absent_from_logs()

        print(json.dumps({
            "result": "PASS",
            "phase": 10,
            "tool": TOOL,
            "liveAccount": True,
            "authenticated": True,
            "location": safe_location,
            "title": str(status.get("title") or "")[:160],
            "viewerGrantedAfterAuth": True,
            "freshChromiumProof": True,
            "reuseWithoutStateResend": True,
            "finalBrowserResidue": 0,
            "credentialsPrinted": False,
            "rawStatePrinted": False,
            "runtimeSecretsInLogs": False,
        }))
    finally:
        close_session(proof_id, PROOF_WRITER)
        close_session(bootstrap_id, BOOTSTRAP_WRITER)
        LINK_FILE.unlink(missing_ok=True)
        if READY_FILE is not None:
            READY_FILE.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
