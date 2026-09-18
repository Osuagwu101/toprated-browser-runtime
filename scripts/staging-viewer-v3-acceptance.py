#!/usr/bin/env python3
"""Private staging acceptance for the V3 viewer and shared-account handoff.

Run only from the staging host or an owner-controlled SSH tunnel.  The script
uses the existing signed service and private worker-control APIs, never sends
credentials, and deliberately omits grants, tokens, cookies, URLs and browser
state from its output.
"""

import argparse
import base64
import concurrent.futures
import hashlib
import hmac
import json
import math
import os
import secrets
import sys
import time
import uuid
from urllib import error, parse, request


class AcceptanceError(RuntimeError):
    pass


def required_environment(name):
    value = os.environ.get(name, "")
    if not value:
        raise AcceptanceError(f"missing required environment variable: {name}")
    return value


def request_json(method, url, body=None, headers=None, timeout=90):
    payload = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    actual_headers = {"accept": "application/json", **(headers or {})}
    if payload is not None:
        actual_headers["content-type"] = "application/json"
    query = request.Request(url, data=payload, headers=actual_headers, method=method)
    started = time.perf_counter()
    try:
        with request.urlopen(query, timeout=timeout) as response:
            raw = response.read()
            return response.status, json.loads(raw or b"{}"), (time.perf_counter() - started) * 1000
    except error.HTTPError as exc:
        raw = exc.read()
        try:
            response = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            response = {}
        return exc.code, response, (time.perf_counter() - started) * 1000


def signed_service(api_base, secret, method, path, writer_id, body=None):
    raw = b"" if body is None else json.dumps(body, separators=(",", ":")).encode()
    timestamp = str(int(time.time()))
    nonce = secrets.token_urlsafe(18)
    canonical = "\n".join((
        method.upper(), path, timestamp, nonce, writer_id, hashlib.sha256(raw).hexdigest(),
    )).encode()
    headers = {
        "x-toprated-timestamp": timestamp,
        "x-toprated-nonce": nonce,
        "x-toprated-writer-id": writer_id,
        "x-toprated-signature": hmac.new(secret, canonical, hashlib.sha256).hexdigest(),
    }
    return request_json(method, api_base + path, body, headers)


def worker_control(worker_base, secret, method, path, body=None):
    return request_json(
        method,
        worker_base + path,
        body,
        {"x-toprated-worker-secret": secret},
    )


def viewer_status(viewer_url, token):
    return request_json("GET", viewer_url + "/status", None, {"authorization": "Bearer " + token})


def grant_parts(grant):
    parts = parse.urlsplit(str(grant.get("url", "")))
    token = parse.unquote(parts.fragment)
    if not parts.scheme or not parts.netloc or not token or "." not in token:
        raise AcceptanceError("the service did not return a usable viewer grant")
    encoded = token.split(".", 1)[0]
    try:
        decoded = base64.urlsafe_b64decode(encoded + "=" * ((4 - len(encoded) % 4) % 4))
        claims = json.loads(decoded)
    except (ValueError, json.JSONDecodeError) as exc:
        raise AcceptanceError("the service returned an unreadable viewer grant") from exc
    session_id = claims.get("sid")
    if not isinstance(session_id, str) or not session_id:
        raise AcceptanceError("the viewer grant is missing its session binding")
    viewer_url = parse.urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
    return viewer_url, token, session_id


def percentile(values, fraction):
    ordered = sorted(values)
    index = max(0, math.ceil(len(ordered) * fraction) - 1)
    return round(ordered[index], 2)


def timing_summary(values):
    return {
        "count": len(values),
        "minMs": round(min(values), 2),
        "p50Ms": percentile(values, 0.50),
        "p95Ms": percentile(values, 0.95),
        "maxMs": round(max(values), 2),
    }


def require(condition, message):
    if not condition:
        raise AcceptanceError(message)


def wait_for(predicate, timeout_seconds, description):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.5)
    raise AcceptanceError(f"timed out waiting for {description}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tool", required=True, help="Configured authenticated tool slug to test")
    parser.add_argument("--account-id", required=True, help="Administrator-approved account UUID to clone")
    parser.add_argument("--writers", type=int, default=15, help="Concurrent writer sessions to prove (2..15)")
    parser.add_argument("--warm-slots", type=int, default=1, help="Expected clean warm-browser slots (1..3)")
    parser.add_argument("--wait-seconds", type=int, default=90, help="Bound for warmup and cleanup waits")
    parser.add_argument("--max-first-launch-ms", type=float, default=0, help="Optional launch gate; zero records timing without a threshold")
    args = parser.parse_args()

    require(2 <= args.writers <= 15, "writers must be between 2 and 15")
    require(1 <= args.warm_slots <= 3, "warm slots must be between 1 and 3")
    require(args.wait_seconds >= 10, "wait seconds must be at least 10")
    try:
        parsed_account = uuid.UUID(args.account_id)
        require(parsed_account.version in {1, 2, 3, 4, 5}, "account id must be a UUID")
    except (ValueError, AttributeError) as exc:
        raise SystemExit("account id must be a UUID") from exc

    api_base = required_environment("RUNTIME_ACCEPTANCE_API_BASE").rstrip("/")
    worker_base = required_environment("RUNTIME_ACCEPTANCE_WORKER_BASE").rstrip("/")
    service_secret = required_environment("RUNTIME_SERVICE_AUTH_SECRET").encode()
    worker_secret = required_environment("WORKER_CONTROL_SECRET")
    require(len(service_secret) >= 32, "service authentication secret is too short")
    require(len(worker_secret) >= 32, "worker control secret is too short")

    created = []
    run_prefix = "v3-stage-" + secrets.token_hex(8)
    result = {
        "phase": "viewer-v3-staging",
        "tool": args.tool,
        "writers": args.writers,
        "warmSlots": args.warm_slots,
    }

    def worker_sessions():
        code, payload, _elapsed = worker_control(worker_base, worker_secret, "GET", "/browser/sessions")
        require(code == 200, "private worker session status is unavailable")
        return payload

    def capacity():
        code, payload, _elapsed = signed_service(api_base, service_secret, "GET", "/api/capacity", run_prefix + "-capacity")
        require(code == 200, "signed capacity status is unavailable")
        return payload

    def start_one(index):
        writer_id = f"{run_prefix}-writer-{index}"
        code, payload, elapsed = signed_service(
            api_base,
            service_secret,
            "POST",
            "/api/sessions",
            writer_id,
            {"writer_id": writer_id, "tool_slug": args.tool, "account_id": args.account_id},
        )
        require(code == 201 and payload.get("status") == "active", "writer launch was not activated")
        viewer_url, token, worker_session_id = grant_parts(payload.get("viewerGrant", {}))
        return {
            "writer": writer_id,
            "session": str(payload.get("sessionId", "")),
            "viewer": viewer_url,
            "token": token,
            "workerSession": worker_session_id,
            "launchMs": elapsed,
        }

    def close_one(item):
        code, payload, _elapsed = signed_service(
            api_base,
            service_secret,
            "DELETE",
            "/api/sessions/" + parse.quote(item["session"], safe=""),
            item["writer"],
        )
        require(code == 200 and payload.get("status") == "closed", "writer browser cleanup was not confirmed")

    try:
        code, health, _elapsed = request_json("GET", api_base + "/api/health")
        require(code == 200 and health.get("status") == "ok", "staging API health is not OK")

        before_capacity = capacity()
        require(before_capacity.get("effectiveMaxSessions") == args.writers, "staging capacity does not equal the requested writer proof")

        before_worker = worker_sessions()
        require(before_worker.get("activeCount") == 0, "staging has active browser sessions; do not disturb another acceptance run")
        require(before_worker.get("warmSlots") == args.warm_slots, "warm browser configuration does not match this acceptance run")

        wait_for(
            lambda: worker_sessions().get("warmCount", 0) >= args.warm_slots,
            args.wait_seconds,
            "the clean warm-browser pool",
        )

        launch_failure = None
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.writers) as pool:
            futures = [pool.submit(start_one, index) for index in range(args.writers)]
            for future in concurrent.futures.as_completed(futures):
                try:
                    created.append(future.result())
                except AcceptanceError as exc:
                    launch_failure = exc
        if launch_failure is not None:
            raise launch_failure

        worker_ids = {item["workerSession"] for item in created}
        session_ids = {item["session"] for item in created}
        require(len(worker_ids) == args.writers and len(session_ids) == args.writers, "writers did not receive separate private browser sessions")

        active_capacity = capacity()
        require(active_capacity.get("openSessions") == args.writers, "all writer reservations were not tracked")
        require(active_capacity.get("workerActiveSessions") == args.writers, "all private writer browsers were not active")
        require(active_capacity.get("availableSlots") == 0, "full capacity was not reached exactly")

        active_worker = worker_sessions()
        listed = {item.get("sessionId"): item for item in active_worker.get("sessions", [])}
        require(active_worker.get("activeCount") == args.writers, "worker active count does not match writer capacity")
        require(worker_ids == set(listed), "worker status does not contain exactly the created writer browsers")
        for worker_id in worker_ids:
            authentication = listed[worker_id].get("authentication", {})
            require(authentication.get("required") is True and authentication.get("verified") is True, "a writer browser was not verified as authenticated")

        for item in created:
            code, status, _elapsed = viewer_status(item["viewer"], item["token"])
            require(code == 200 and status.get("active") is True, "a private viewer did not remain active")

        code, _cross, _elapsed = viewer_status(created[1]["viewer"], created[0]["token"])
        require(code == 403, "a viewer token crossed into another writer browser")

        launch_times = [item["launchMs"] for item in created]
        if args.max_first_launch_ms > 0:
            require(min(launch_times) <= args.max_first_launch_ms, "warm launch exceeded the supplied timing gate")
        result["launchTiming"] = timing_summary(launch_times)

        first_writer = created.pop(0)
        close_one(first_writer)
        code, remaining, _elapsed = viewer_status(created[0]["viewer"], created[0]["token"])
        require(code == 200 and remaining.get("active") is True, "closing one writer disturbed another writer")
        result["result"] = "PASS"
    finally:
        cleanup_failures = 0
        for item in reversed(created):
            try:
                close_one(item)
            except AcceptanceError:
                cleanup_failures += 1
        if cleanup_failures:
            result["result"] = "FAIL"
            result["failure"] = "one or more writer browsers did not close cleanly"
        else:
            try:
                wait_for(
                    lambda: capacity().get("openSessions") == 0 and worker_sessions().get("activeCount") == 0,
                    args.wait_seconds,
                    "writer cleanup",
                )
            except AcceptanceError:
                result["result"] = "FAIL"
                result["failure"] = "writer cleanup did not settle"

    print(json.dumps(result, sort_keys=True))
    return 0 if result.get("result") == "PASS" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AcceptanceError as exc:
        print(json.dumps({"phase": "viewer-v3-staging", "result": "FAIL", "failure": str(exc)}, sort_keys=True))
        raise SystemExit(1)
