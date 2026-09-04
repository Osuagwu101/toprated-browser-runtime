import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from urllib import error, parse, request

API = os.environ.get('API_BASE', 'http://127.0.0.1:18080')
WORKER = os.environ.get('WORKER_BASE', 'http://127.0.0.1:18081')
SERVICE_SECRET = os.environ['RUNTIME_SERVICE_AUTH_SECRET'].encode()
VIEWER_SECRET = os.environ['VIEWER_SIGNING_SECRET'].encode()


def signed(method, path, writer, obj=None, nonce=None, timestamp=None, signature_writer=None):
    body = b'' if obj is None else json.dumps(obj, separators=(',', ':')).encode()
    ts = int(time.time()) if timestamp is None else int(timestamp)
    nonce = nonce or secrets.token_urlsafe(18)
    signed_writer = writer if signature_writer is None else signature_writer
    canonical = '\n'.join([
        method.upper(), path, str(ts), nonce, signed_writer,
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
        with request.urlopen(req, timeout=20) as response:
            raw = response.read()
            return response.status, json.loads(raw or b'{}')
    except error.HTTPError as exc:
        raw = exc.read()
        return exc.code, json.loads(raw or b'{}')


def assert_http_error(req, expected):
    try:
        request.urlopen(req, timeout=10)
    except error.HTTPError as exc:
        assert exc.code == expected, (exc.code, expected)
        return
    raise AssertionError(f'expected HTTP {expected}')


# Worker lifecycle endpoints must not bypass Laravel.
assert_http_error(request.Request(WORKER + '/browser/status'), 401)

# Runtime control-plane routes require signed service authentication.
assert_http_error(request.Request(API + '/api/capacity'), 401)

code, capacity = signed('GET', '/api/capacity', 'writer-a')
assert code == 200, (code, capacity)
assert capacity['phase'] == 4
assert capacity['configuredMaxSessions'] == 1
assert capacity['effectiveMaxSessions'] == 1
assert capacity['openSessions'] == 0
assert capacity['availableSlots'] == 1
assert capacity['workerHealthy'] is True
assert capacity['configurationValid'] is True

launch = 'data:text/html,%3Ctitle%3EPhase%204%20Owned%3C/title%3E%3Ch1%3EOwned%3C/h1%3E'
launch_body = {'writer_id': 'writer-a', 'tool_slug': 'generic-phase4', 'launch_url': launch}
code, created = signed('POST', '/api/sessions', 'writer-a', launch_body)
assert code == 201, (code, created)
assert created['status'] == 'active'
assert created['writerId'] == 'writer-a'
assert created['toolSlug'] == 'generic-phase4'
assert created['reused'] is False
sid = created['sessionId']
grant = created['viewerGrant']
assert grant and grant['rawCdpExposed'] is False
assert grant['tokenTransport'] == 'url-fragment-to-bearer'

# Verify Laravel-issued viewer grant signature and writer binding.
parts = parse.urlsplit(grant['url'])
token = parse.unquote(parts.fragment)
encoded, supplied_sig = token.split('.', 1)
payload = json.loads(base64.urlsafe_b64decode(encoded + '=' * ((4 - len(encoded) % 4) % 4)))
expected_sig = base64.urlsafe_b64encode(hmac.new(VIEWER_SECRET, encoded.encode(), hashlib.sha256).digest()).decode().rstrip('=')
assert hmac.compare_digest(supplied_sig, expected_sig)
assert payload['wid'] == 'writer-a'
assert payload['sid'] in grant['url']
assert payload['exp'] > payload['iat']

viewer_url = parse.urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ''))
frame_req = request.Request(viewer_url + '/frame', headers={'authorization': 'Bearer ' + token})
with request.urlopen(frame_req, timeout=20) as response:
    frame = response.read()
    assert response.status == 200
    assert frame[:3] == b'\xff\xd8\xff'
    assert len(frame) > 2000

# Same writer/tool gets the same live browser with a fresh grant.
code, reused = signed('POST', '/api/sessions', 'writer-a', launch_body)
assert code == 200, (code, reused)
assert reused['reused'] is True
assert reused['sessionId'] == sid
assert reused['viewerGrant']['url'] != grant['url']

# A second writer cannot take the Phase 4 single slot.
code, capacity = signed('GET', '/api/capacity', 'writer-a')
assert code == 200 and capacity['openSessions'] == 1 and capacity['availableSlots'] == 0, capacity
code, full = signed('POST', '/api/sessions', 'writer-b', {
    'writer_id': 'writer-b', 'tool_slug': 'generic-phase4', 'launch_url': launch,
})
assert code == 429 and full['code'] == 'CAPACITY_FULL', (code, full)

# Writer ownership applies to status, viewer grant renewal, and close.
for method, path, body in [
    ('GET', f'/api/sessions/{sid}', None),
    ('POST', f'/api/sessions/{sid}/viewer-grant', {}),
    ('DELETE', f'/api/sessions/{sid}', None),
]:
    code, forbidden = signed(method, path, 'writer-b', body)
    assert code == 403 and forbidden['code'] == 'SESSION_FORBIDDEN', (code, forbidden)

code, heartbeat = signed('POST', f'/api/sessions/{sid}/heartbeat', 'writer-a', {})
assert code == 200 and heartbeat['lastHeartbeatAt']
code, activity = signed('POST', f'/api/sessions/{sid}/activity', 'writer-a', {})
assert code == 200 and activity['lastActivityAt']
code, fresh_grant = signed('POST', f'/api/sessions/{sid}/viewer-grant', 'writer-a', {})
assert code == 200 and fresh_grant['viewerGrant']['url'] != grant['url']

# Writer identity is signed, so header substitution invalidates the request.
code, tampered = signed('GET', '/api/capacity', 'writer-b', signature_writer='writer-a')
assert code == 401 and tampered['code'] == 'AUTH_INVALID_SIGNATURE', (code, tampered)

# A valid nonce is single-use.
replay_nonce = secrets.token_urlsafe(18)
replay_ts = int(time.time())
code, first = signed('GET', '/api/capacity', 'writer-a', nonce=replay_nonce, timestamp=replay_ts)
assert code == 200, (code, first)
code, replay = signed('GET', '/api/capacity', 'writer-a', nonce=replay_nonce, timestamp=replay_ts)
assert code == 409 and replay['code'] == 'AUTH_REPLAY', (code, replay)

# Close and verify viewer invalidation plus capacity release.
code, closed = signed('DELETE', f'/api/sessions/{sid}', 'writer-a')
assert code == 200 and closed['status'] == 'closed', (code, closed)
assert closed['closedAt']
assert_http_error(frame_req, 410)
code, capacity = signed('GET', '/api/capacity', 'writer-a')
assert code == 200 and capacity['openSessions'] == 0 and capacity['availableSlots'] == 1, capacity

open('/tmp/phase4-session-id', 'w').write(sid)
print(json.dumps({'result': 'PASS', 'phase': 4, 'sessionId': sid}))
