import base64
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import time
from urllib import error, parse, request

API = os.environ.get('API_BASE', 'http://127.0.0.1:18080')
WORKER = os.environ.get('WORKER_BASE', 'http://127.0.0.1:18081')
SERVICE_SECRET = os.environ['RUNTIME_SERVICE_AUTH_SECRET'].encode()
WORKER_SECRET = os.environ['WORKER_CONTROL_SECRET']


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


def http_status(req):
    try:
        with request.urlopen(req, timeout=20) as response:
            response.read()
            return response.status
    except error.HTTPError as exc:
        exc.read()
        return exc.code


def decode_grant(grant):
    parts = parse.urlsplit(grant['url'])
    token = parse.unquote(parts.fragment)
    encoded, _signature = token.split('.', 1)
    padding = '=' * ((4 - len(encoded) % 4) % 4)
    payload = json.loads(base64.urlsafe_b64decode(encoded + padding))
    viewer_url = parse.urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ''))
    return token, payload, viewer_url


def parse_isolation_title(title):
    assert title.startswith('ISO:'), title
    return json.loads(parse.unquote(title[4:]))


def viewer_status(viewer_url, token, expected=200):
    req = request.Request(viewer_url + '/status', headers={'authorization': 'Bearer ' + token})
    try:
        with request.urlopen(req, timeout=20) as response:
            payload = json.loads(response.read() or b'{}')
            assert response.status == expected, (response.status, expected, payload)
            return payload
    except error.HTTPError as exc:
        payload = json.loads(exc.read() or b'{}')
        assert exc.code == expected, (exc.code, expected, payload)
        return payload


def viewer_frame_status(viewer_url, token):
    return http_status(request.Request(viewer_url + '/frame', headers={'authorization': 'Bearer ' + token}))


# Worker lifecycle control remains private to Laravel/internal control credentials.
assert http_status(request.Request(WORKER + '/browser/sessions')) == 401

code, capacity = signed('GET', '/api/capacity', 'writer-a')
assert code == 200, (code, capacity)
assert capacity['phase'] == 6, capacity
assert capacity['configuredMaxSessions'] == 3, capacity
assert capacity['effectiveMaxSessions'] == 3, capacity
assert capacity['openSessions'] == 0, capacity
assert capacity['workerActiveSessions'] == 0, capacity
assert capacity['availableSlots'] == 3, capacity
assert capacity['configurationValid'] is True, capacity

fixture = 'http://127.0.0.1:19090/'


def create_writer(writer):
    code, created = signed('POST', '/api/sessions', writer, {
        'writer_id': writer,
        'tool_slug': 'generic-phase5-isolation',
        'launch_url': fixture + '?' + parse.urlencode({'marker': writer}),
    })
    assert code == 201, (code, created)
    assert created['status'] == 'active', created
    assert created['writerId'] == writer, created
    assert created['leaseExpiresAt'], created
    token, payload, viewer_url = decode_grant(created['viewerGrant'])
    assert payload['wid'] == writer, payload
    return created, token, payload, viewer_url


a, token_a, payload_a, viewer_a = create_writer('writer-a')
status_a = viewer_status(viewer_a, token_a)
state_a = parse_isolation_title(status_a['title'])
assert state_a['before']['local'] is None, state_a
assert state_a['before']['session'] is None, state_a
assert 'phase5-marker=' not in state_a['before']['cookie'], state_a
assert state_a['after']['local'] == 'writer-a', state_a
assert state_a['after']['session'] == 'writer-a', state_a
assert 'phase5-marker=writer-a' in state_a['after']['cookie'], state_a

b, token_b, payload_b, viewer_b = create_writer('writer-b')
status_b = viewer_status(viewer_b, token_b)
state_b = parse_isolation_title(status_b['title'])
assert state_b['before']['local'] is None, state_b
assert state_b['before']['session'] is None, state_b
assert 'phase5-marker=' not in state_b['before']['cookie'], state_b
assert state_b['after']['local'] == 'writer-b', state_b
assert state_b['after']['session'] == 'writer-b', state_b
assert 'phase5-marker=writer-b' in state_b['after']['cookie'], state_b

assert payload_a['sid'] != payload_b['sid'], (payload_a, payload_b)

# Both isolated Chromium instances are live simultaneously.
code, capacity = signed('GET', '/api/capacity', 'writer-a')
assert code == 200, (code, capacity)
assert capacity['openSessions'] == 2, capacity
assert capacity['workerActiveSessions'] == 2, capacity
assert capacity['availableSlots'] == 1, capacity
sessions = worker_json('GET', '/browser/sessions')
assert sessions['phase'] == 6, sessions
assert sessions['activeCount'] == 2, sessions
assert {item['sessionId'] for item in sessions['sessions']} == {payload_a['sid'], payload_b['sid']}, sessions

# Cross-writer ownership is rejected at every Laravel-owned session operation.
for method, path, body in [
    ('GET', f"/api/sessions/{a['sessionId']}", None),
    ('POST', f"/api/sessions/{a['sessionId']}/heartbeat", {}),
    ('POST', f"/api/sessions/{a['sessionId']}/activity", {}),
    ('POST', f"/api/sessions/{a['sessionId']}/viewer-grant", {}),
    ('DELETE', f"/api/sessions/{a['sessionId']}", None),
]:
    code, denied = signed(method, path, 'writer-b', body)
    assert code == 403 and denied['code'] == 'SESSION_FORBIDDEN', (method, path, code, denied)

# A valid bearer grant is bound to exactly one worker session.
assert viewer_frame_status(viewer_b, token_a) == 403
assert viewer_frame_status(viewer_a, token_b) == 403
assert viewer_frame_status(viewer_a, token_a) == 200
assert viewer_frame_status(viewer_b, token_b) == 200

# Re-inspect the same origin in each browser. Each profile keeps only its own cookie/storage state.
for writer, worker_sid, token, viewer_url in [
    ('writer-a', payload_a['sid'], token_a, viewer_a),
    ('writer-b', payload_b['sid'], token_b, viewer_b),
]:
    navigated = worker_json('POST', f'/browser/sessions/{worker_sid}/navigate', {'url': fixture})
    assert navigated['sessionId'] == worker_sid, navigated
    inspected = parse_isolation_title(viewer_status(viewer_url, token)['title'])
    assert inspected['before']['local'] == writer, inspected
    assert inspected['before']['session'] == writer, inspected
    assert f'phase5-marker={writer}' in inspected['before']['cookie'], inspected

# Crash writer A's Chromium root process directly. Writer B must remain usable.
worker_a = worker_json('GET', f"/browser/sessions/{payload_a['sid']}")
pid_a = int(worker_a['pid'])
subprocess.run(['docker', 'compose', 'exec', '-T', 'browser-worker', 'sh', '-lc', f'kill -9 {pid_a}'], check=True)
time.sleep(1.0)
assert viewer_frame_status(viewer_b, token_b) == 200
still_b = parse_isolation_title(viewer_status(viewer_b, token_b)['title'])
assert still_b['before']['local'] == 'writer-b', still_b

# Closing the crashed exact session must not terminate writer B.
code, closed_a = signed('DELETE', f"/api/sessions/{a['sessionId']}", 'writer-a')
assert code == 200 and closed_a['status'] == 'closed', (code, closed_a)
assert viewer_frame_status(viewer_b, token_b) == 200
sessions_after_a = worker_json('GET', '/browser/sessions')
assert sessions_after_a['activeCount'] == 1, sessions_after_a
assert sessions_after_a['sessions'][0]['sessionId'] == payload_b['sid'], sessions_after_a

code, closed_b = signed('DELETE', f"/api/sessions/{b['sessionId']}", 'writer-b')
assert code == 200 and closed_b['status'] == 'closed', (code, closed_b)
assert viewer_frame_status(viewer_b, token_b) == 410

code, capacity = signed('GET', '/api/capacity', 'writer-a')
assert code == 200, (code, capacity)
assert capacity['openSessions'] == 0, capacity
assert capacity['workerActiveSessions'] == 0, capacity
assert capacity['availableSlots'] == 3, capacity

print(json.dumps({
    'result': 'PASS',
    'phase': 5,
    'currentPhase': 6,
    'simultaneousWriters': 2,
    'storageIsolation': True,
    'crossWriterOwnershipRejected': True,
    'crossSessionViewerRejected': True,
    'singleBrowserCrashIsolation': True,
}))
