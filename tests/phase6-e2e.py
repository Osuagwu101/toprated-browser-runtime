import base64
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import time
from datetime import datetime, timezone
from urllib import error, parse, request

API = os.environ.get('API_BASE', 'http://127.0.0.1:18080')
WORKER = os.environ.get('WORKER_BASE', 'http://127.0.0.1:18081')
SERVICE_SECRET = os.environ['RUNTIME_SERVICE_AUTH_SECRET'].encode()
WORKER_SECRET = os.environ['WORKER_CONTROL_SECRET']
LEASE_SECONDS = int(os.environ.get('SESSION_LEASE_SECONDS', '30'))
IDLE_SECONDS = int(os.environ.get('SESSION_IDLE_TIMEOUT_SECONDS', '20'))
DISCONNECT_SECONDS = int(os.environ.get('SESSION_DISCONNECT_GRACE_SECONDS', '12'))


def signed(method, path, writer, obj=None):
    body = b'' if obj is None else json.dumps(obj, separators=(',', ':')).encode()
    ts = int(time.time())
    nonce = secrets.token_urlsafe(18)
    canonical = '\n'.join([
        method.upper(), path, str(ts), nonce, writer,
        hashlib.sha256(body).hexdigest(),
    ]).encode()
    signature = hmac.new(SERVICE_SECRET, canonical, hashlib.sha256).hexdigest()
    headers = {
        'accept': 'application/json',
        'x-toprated-timestamp': str(ts),
        'x-toprated-nonce': nonce,
        'x-toprated-signature': signature,
        'x-toprated-writer-id': writer,
    }
    if obj is not None:
        headers['content-type'] = 'application/json'
    req = request.Request(API + path, data=(body if obj is not None else None), headers=headers, method=method.upper())
    try:
        with request.urlopen(req, timeout=25) as response:
            return response.status, json.loads(response.read() or b'{}')
    except error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b'{}')


def worker_json(method, path, obj=None, expected=200):
    body = None if obj is None else json.dumps(obj, separators=(',', ':')).encode()
    headers = {'accept': 'application/json', 'x-toprated-worker-secret': WORKER_SECRET}
    if obj is not None:
        headers['content-type'] = 'application/json'
    req = request.Request(WORKER + path, data=body, headers=headers, method=method.upper())
    try:
        with request.urlopen(req, timeout=25) as response:
            payload = json.loads(response.read() or b'{}')
            assert response.status == expected, (response.status, expected, payload)
            return payload
    except error.HTTPError as exc:
        payload = json.loads(exc.read() or b'{}')
        assert exc.code == expected, (exc.code, expected, payload)
        return payload


def decode_grant(grant):
    parts = parse.urlsplit(grant['url'])
    token = parse.unquote(parts.fragment)
    encoded, _signature = token.split('.', 1)
    payload = json.loads(base64.urlsafe_b64decode(encoded + '=' * ((4 - len(encoded) % 4) % 4)))
    return token, payload


def create_session(writer):
    code, created = signed('POST', '/api/sessions', writer, {
        'writer_id': writer,
        'tool_slug': 'generic-phase6-lifecycle',
        'launch_url': 'data:text/html,' + parse.quote(f'<!doctype html><title>{writer}</title><h1>{writer}</h1>'),
    })
    assert code == 201, (code, created)
    assert created['status'] == 'active', created
    assert created['leaseExpiresAt'], created
    _token, payload = decode_grant(created['viewerGrant'])
    worker_status = worker_json('GET', f"/browser/sessions/{payload['sid']}")
    return created, payload['sid'], int(worker_status['pid'])


def php(code):
    result = subprocess.run(
        ['docker', 'compose', 'exec', '-T', 'api', 'php', '-r', code],
        check=True, text=True, capture_output=True,
    )
    return result.stdout.strip()


def db_update(session_id, set_clause):
    safe = session_id.replace("'", "''")
    php(
        '$db=new PDO("sqlite:/srv/runtime-api/storage/data/database.sqlite");'
        f'$db->exec("update browser_sessions set {set_clause} where id=\'{safe}\'");'
    )


def db_row(session_id):
    safe = session_id.replace("'", "''")
    raw = php(
        '$db=new PDO("sqlite:/srv/runtime-api/storage/data/database.sqlite");'
        f'$s=$db->query("select id,status,worker_session_id,last_heartbeat_at,last_activity_at,lease_expires_at,closed_at,termination_reason,failure_code from browser_sessions where id=\'{safe}\'");'
        '$r=$s->fetch(PDO::FETCH_ASSOC); echo json_encode($r ?: null);'
    )
    return json.loads(raw)


def wait_for(predicate, description, timeout=25, interval=0.5):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = predicate()
            if last:
                return last
        except Exception as exc:
            last = repr(exc)
        time.sleep(interval)
    raise AssertionError(f'timed out waiting for {description}; last={last!r}')


def wait_terminal(session_id, expected_reason=None, expected_failure=None):
    def check():
        row = db_row(session_id)
        if not row or row['status'] not in ('closed', 'failed'):
            return False
        if expected_reason is not None and row['termination_reason'] != expected_reason:
            return False
        if expected_failure is not None and row['failure_code'] != expected_failure:
            return False
        return row
    return wait_for(check, f'terminal session {session_id}')


def wait_api_health():
    def check():
        try:
            with request.urlopen(API + '/api/health', timeout=3) as response:
                data = json.load(response)
                return data if response.status == 200 and data.get('status') == 'ok' else False
        except Exception:
            return False
    return wait_for(check, 'API health', timeout=40, interval=1)


def wait_worker_health():
    def check():
        try:
            with request.urlopen(WORKER + '/health', timeout=3) as response:
                data = json.load(response)
                return data if response.status == 200 and data.get('status') == 'ok' else False
        except Exception:
            return False
    return wait_for(check, 'worker health', timeout=40, interval=1)


health = wait_api_health()
worker_health = wait_worker_health()
assert health['phase'] == 6, health
assert health['lifecycle']['leaseSeconds'] == LEASE_SECONDS, health
assert health['lifecycle']['idleTimeoutSeconds'] == IDLE_SECONDS, health
assert health['lifecycle']['disconnectGraceSeconds'] == DISCONNECT_SECONDS, health
assert worker_health['phase'] == 6, worker_health
assert worker_health['crashWatchdog'] == 'process-exit-cleanup', worker_health

# 1) Genuine activity renews the lease, heartbeat alone does not, and the same browser survives the old boundary.
active, active_worker, active_pid = create_session('phase6-active')
db_update(active['sessionId'], "lease_expires_at=datetime('now','+2 seconds'), last_activity_at=datetime('now'), last_heartbeat_at=datetime('now')")
code, before_activity = signed('GET', f"/api/sessions/{active['sessionId']}", 'phase6-active')
assert code == 200 and before_activity['status'] == 'active', (code, before_activity)
old_lease = before_activity['leaseExpiresAt']
code, renewed = signed('POST', f"/api/sessions/{active['sessionId']}/activity", 'phase6-active', {})
assert code == 200 and renewed['status'] == 'active', (code, renewed)
assert renewed['leaseExpiresAt'] != old_lease, (old_lease, renewed)
renewed_lease = renewed['leaseExpiresAt']
code, heartbeat = signed('POST', f"/api/sessions/{active['sessionId']}/heartbeat", 'phase6-active', {})
assert code == 200, (code, heartbeat)
assert heartbeat['leaseExpiresAt'] == renewed_lease, (heartbeat, renewed_lease)
time.sleep(3.0)
worker_after_boundary = worker_json('GET', f'/browser/sessions/{active_worker}')
assert int(worker_after_boundary['pid']) == active_pid, worker_after_boundary
code, active_status = signed('GET', f"/api/sessions/{active['sessionId']}", 'phase6-active')
assert code == 200 and active_status['status'] == 'active', (code, active_status)
code, explicitly_closed = signed('DELETE', f"/api/sessions/{active['sessionId']}", 'phase6-active')
assert code == 200 and explicitly_closed['terminationReason'] == 'explicit_close', explicitly_closed

# 2) Reconnect within disconnect grace refreshes heartbeat and keeps the exact browser/PID alive.
reconnect, reconnect_worker, reconnect_pid = create_session('phase6-reconnect')
db_update(reconnect['sessionId'], "last_heartbeat_at=datetime('now','-10 seconds'), last_activity_at=datetime('now'), lease_expires_at=datetime('now','+60 seconds')")
pre_reconnect = db_row(reconnect['sessionId'])
code, fresh_grant = signed('POST', f"/api/sessions/{reconnect['sessionId']}/viewer-grant", 'phase6-reconnect', {})
assert code == 200 and fresh_grant['viewerGrant'], (code, fresh_grant)
post_reconnect = db_row(reconnect['sessionId'])
assert post_reconnect['last_heartbeat_at'] != pre_reconnect['last_heartbeat_at'], (pre_reconnect, post_reconnect)
time.sleep(3.0)
reconnect_worker_status = worker_json('GET', f'/browser/sessions/{reconnect_worker}')
assert int(reconnect_worker_status['pid']) == reconnect_pid, reconnect_worker_status
code, reconnect_status = signed('GET', f"/api/sessions/{reconnect['sessionId']}", 'phase6-reconnect')
assert code == 200 and reconnect_status['status'] == 'active', (code, reconnect_status)
signed('DELETE', f"/api/sessions/{reconnect['sessionId']}", 'phase6-reconnect')

# 3) Lease expiration removes only the expired browser; a healthy companion survives.
expired, expired_worker, _expired_pid = create_session('phase6-lease-expired')
companion, companion_worker, companion_pid = create_session('phase6-companion')
db_update(expired['sessionId'], "lease_expires_at=datetime('now','-1 second'), last_activity_at=datetime('now'), last_heartbeat_at=datetime('now')")
db_update(companion['sessionId'], "lease_expires_at=datetime('now','+60 seconds'), last_activity_at=datetime('now'), last_heartbeat_at=datetime('now')")
lease_row = wait_terminal(expired['sessionId'], expected_reason='lease_expired')
assert lease_row['status'] == 'closed', lease_row
wait_for(lambda: all(s['sessionId'] != expired_worker for s in worker_json('GET', '/browser/sessions')['sessions']), 'expired worker removal')
companion_worker_status = worker_json('GET', f'/browser/sessions/{companion_worker}')
assert int(companion_worker_status['pid']) == companion_pid, companion_worker_status
code, companion_status = signed('GET', f"/api/sessions/{companion['sessionId']}", 'phase6-companion')
assert code == 200 and companion_status['status'] == 'active', (code, companion_status)
signed('DELETE', f"/api/sessions/{companion['sessionId']}", 'phase6-companion')

# 4) Idle timeout automatically removes an otherwise connected browser.
idle, _idle_worker, _idle_pid = create_session('phase6-idle')
db_update(idle['sessionId'], f"last_activity_at=datetime('now','-{IDLE_SECONDS + 1} seconds'), last_heartbeat_at=datetime('now'), lease_expires_at=datetime('now','+60 seconds')")
idle_row = wait_terminal(idle['sessionId'], expected_reason='idle_timeout')
assert idle_row['status'] == 'closed', idle_row

# 5) Disconnect timeout automatically removes an otherwise recently active browser.
disconnected, _disconnect_worker, _disconnect_pid = create_session('phase6-disconnected')
db_update(disconnected['sessionId'], f"last_heartbeat_at=datetime('now','-{DISCONNECT_SECONDS + 1} seconds'), last_activity_at=datetime('now'), lease_expires_at=datetime('now','+60 seconds')")
disconnect_row = wait_terminal(disconnected['sessionId'], expected_reason='disconnect_timeout')
assert disconnect_row['status'] == 'closed', disconnect_row

# 6) Worker sessions not owned by any durable Laravel record are reaped automatically.
orphan = worker_json('POST', '/browser/sessions', {'url': 'data:text/html,%3Ctitle%3Eorphan%3C/title%3E'}, expected=201)
orphan_id = orphan['sessionId']
wait_for(lambda: all(s['sessionId'] != orphan_id for s in worker_json('GET', '/browser/sessions')['sessions']), 'untracked worker session reaping')

# 7) A crashed Chromium is removed by the worker watchdog and reconciled by Laravel without manual close.
crashed, crashed_worker, crashed_pid = create_session('phase6-crashed')
subprocess.run(['docker', 'compose', 'exec', '-T', 'browser-worker', 'sh', '-lc', f'kill -9 {crashed_pid}'], check=True)
wait_for(lambda: all(s['sessionId'] != crashed_worker for s in worker_json('GET', '/browser/sessions')['sessions']), 'worker crash watchdog cleanup')
crash_row = wait_terminal(crashed['sessionId'], expected_reason='failure', expected_failure='WORKER_SESSION_MISSING')
assert crash_row['status'] == 'failed', crash_row

# 8) Restarting the API/control plane preserves a live browser and durable session record.
restart_api, restart_api_worker, restart_api_pid = create_session('phase6-api-restart')
code, _ = signed('POST', f"/api/sessions/{restart_api['sessionId']}/activity", 'phase6-api-restart', {})
assert code == 200
code, _ = signed('POST', f"/api/sessions/{restart_api['sessionId']}/heartbeat", 'phase6-api-restart', {})
assert code == 200
subprocess.run(['docker', 'compose', 'restart', 'api'], check=True)
wait_api_health()
worker_after_api_restart = worker_json('GET', f'/browser/sessions/{restart_api_worker}')
assert int(worker_after_api_restart['pid']) == restart_api_pid, worker_after_api_restart
code, after_api_restart = signed('GET', f"/api/sessions/{restart_api['sessionId']}", 'phase6-api-restart')
assert code == 200 and after_api_restart['status'] == 'active', (code, after_api_restart)
signed('DELETE', f"/api/sessions/{restart_api['sessionId']}", 'phase6-api-restart')

# 9) Restarting the worker removes its browsers; durable stale records are reconciled and capacity recovers automatically.
restart_worker, _restart_worker_id, _restart_worker_pid = create_session('phase6-worker-restart')
subprocess.run(['docker', 'compose', 'restart', 'browser-worker'], check=True)
wait_worker_health()
worker_restart_row = wait_terminal(restart_worker['sessionId'], expected_reason='failure', expected_failure='WORKER_SESSION_MISSING')
assert worker_restart_row['status'] == 'failed', worker_restart_row
code, capacity = signed('GET', '/api/capacity', 'phase6-worker-restart')
assert code == 200, (code, capacity)
assert capacity['openSessions'] == 0, capacity
assert capacity['workerActiveSessions'] == 0, capacity
assert capacity['availableSlots'] == capacity['effectiveMaxSessions'] == 3, capacity

# 10) A stale starting record is reconciled automatically rather than blocking capacity forever.
stale_id = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000006'
php(
    '$db=new PDO("sqlite:/srv/runtime-api/storage/data/database.sqlite");'
    '$s=$db->prepare("insert into browser_sessions (id,writer_id,tool_slug,launch_url,status,last_heartbeat_at,last_activity_at,created_at,updated_at) values (?,?,?,?,?,?,?,?,?)");'
    '$now=date("Y-m-d H:i:s");$old=date("Y-m-d H:i:s",time()-10);'
    f'$s->execute(["{stale_id}","phase6-stale","generic-phase6-lifecycle","data:text/html","starting",$now,$now,$old,$old]);'
)
stale_row = wait_terminal(stale_id, expected_reason='failure', expected_failure='STARTUP_TIMEOUT')
assert stale_row['status'] == 'failed', stale_row

code, final_capacity = signed('GET', '/api/capacity', 'phase6-final')
assert code == 200, (code, final_capacity)
assert final_capacity['openSessions'] == 0, final_capacity
assert final_capacity['workerActiveSessions'] == 0, final_capacity
assert final_capacity['availableSlots'] == 3, final_capacity
worker_final = worker_json('GET', '/browser/sessions')
assert worker_final['activeCount'] == 0, worker_final

print(json.dumps({
    'result': 'PASS',
    'phase': 6,
    'leaseRenewedByGenuineActivity': True,
    'heartbeatDoesNotRenewLease': True,
    'reconnectKeepsSameBrowser': True,
    'leaseExpiryReaped': True,
    'idleExpiryReaped': True,
    'disconnectExpiryReaped': True,
    'untrackedWorkerReaped': True,
    'crashWatchdogReconciled': True,
    'apiRestartPreservesBrowser': True,
    'workerRestartReconcilesDurableState': True,
    'staleStartingReconciled': True,
    'checkedAt': datetime.now(timezone.utc).isoformat(),
}))
