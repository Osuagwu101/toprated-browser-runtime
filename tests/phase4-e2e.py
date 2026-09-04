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
            return response.status, json.loads(response.read() or b'{}')
    except error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b'{}')


def assert_http_error(req, expected):
    try:
        request.urlopen(req, timeout=10)
    except error.HTTPError as exc:
        assert exc.code == expected, (exc.code, expected)
        exc.read()
        return
    raise AssertionError(f'expected HTTP {expected}')


# Phase 4 ownership boundary remains enforced after later phases add isolation/lifecycle behavior.
assert_http_error(request.Request(WORKER + '/browser/status'), 401)
assert_http_error(request.Request(API + '/api/capacity'), 401)

code, capacity = signed('GET', '/api/capacity', 'writer-a')
assert code == 200, (code, capacity)
assert capacity['phase'] == 6, capacity
assert capacity['configuredMaxSessions'] == 3, capacity
assert capacity['effectiveMaxSessions'] == 3, capacity
assert capacity['openSessions'] == 0, capacity
assert capacity['availableSlots'] == 3, capacity
assert capacity['workerHealthy'] is True, capacity
assert capacity['configurationValid'] is True, capacity

launch = 'data:text/html,%3Ctitle%3EPhase%204%20Owned%3C/title%3E%3Ch1%3EOwned%3C/h1%3E'
launch_body = {'writer_id': 'writer-a', 'tool_slug': 'generic-phase4-regression', 'launch_url': launch}
code, created = signed('POST', '/api/sessions', 'writer-a', launch_body)
assert code == 201, (code, created)
assert created['status'] == 'active', created
assert created['writerId'] == 'writer-a', created
assert created['toolSlug'] == 'generic-phase4-regression', created
assert created['reused'] is False, created
assert created['leaseExpiresAt'], created
sid = created['sessionId']
grant = created['viewerGrant']
assert grant and grant['rawCdpExposed'] is False, grant
assert grant['tokenTransport'] == 'url-fragment-to-bearer', grant

parts = parse.urlsplit(grant['url'])
token = parse.unquote(parts.fragment)
encoded, supplied_sig = token.split('.', 1)
payload = json.loads(base64.urlsafe_b64decode(encoded + '=' * ((4 - len(encoded) % 4) % 4)))
expected_sig = base64.urlsafe_b64encode(hmac.new(VIEWER_SECRET, encoded.encode(), hashlib.sha256).digest()).decode().rstrip('=')
assert hmac.compare_digest(supplied_sig, expected_sig)
assert payload['wid'] == 'writer-a', payload
assert payload['sid'] in grant['url'], grant
assert payload['exp'] > payload['iat'], payload

viewer_url = parse.urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ''))
frame_req = request.Request(viewer_url + '/frame', headers={'authorization': 'Bearer ' + token})
with request.urlopen(frame_req, timeout=20) as response:
    frame = response.read()
    assert response.status == 200
    assert frame[:3] == b'\xff\xd8\xff'
    assert len(frame) > 2000

# Same writer/tool reuses the same live browser with a fresh grant.
code, reused = signed('POST', '/api/sessions', 'writer-a', launch_body)
assert code == 200, (code, reused)
assert reused['reused'] is True, reused
assert reused['sessionId'] == sid, reused
assert reused['viewerGrant']['url'] != grant['url'], reused

# Cross-writer access to the owned session remains forbidden.
for method, path, body in [
    ('GET', f'/api/sessions/{sid}', None),
    ('POST', f'/api/sessions/{sid}/heartbeat', {}),
    ('POST', f'/api/sessions/{sid}/activity', {}),
    ('POST', f'/api/sessions/{sid}/viewer-grant', {}),
    ('DELETE', f'/api/sessions/{sid}', None),
]:
    code, forbidden = signed(method, path, 'writer-b', body)
    assert code == 403 and forbidden['code'] == 'SESSION_FORBIDDEN', (method, path, code, forbidden)

code, heartbeat = signed('POST', f'/api/sessions/{sid}/heartbeat', 'writer-a', {})
assert code == 200 and heartbeat['lastHeartbeatAt'], (code, heartbeat)
code, activity = signed('POST', f'/api/sessions/{sid}/activity', 'writer-a', {})
assert code == 200 and activity['lastActivityAt'] and activity['leaseExpiresAt'], (code, activity)
code, fresh_grant = signed('POST', f'/api/sessions/{sid}/viewer-grant', 'writer-a', {})
assert code == 200 and fresh_grant['viewerGrant']['url'] != grant['url'], (code, fresh_grant)

# Writer identity is signed and nonces are single-use.
code, tampered = signed('GET', '/api/capacity', 'writer-b', signature_writer='writer-a')
assert code == 401 and tampered['code'] == 'AUTH_INVALID_SIGNATURE', (code, tampered)
replay_nonce = secrets.token_urlsafe(18)
replay_ts = int(time.time())
code, first = signed('GET', '/api/capacity', 'writer-a', nonce=replay_nonce, timestamp=replay_ts)
assert code == 200, (code, first)
code, replay = signed('GET', '/api/capacity', 'writer-a', nonce=replay_nonce, timestamp=replay_ts)
assert code == 409 and replay['code'] == 'AUTH_REPLAY', (code, replay)

code, closed = signed('DELETE', f'/api/sessions/{sid}', 'writer-a')
assert code == 200 and closed['status'] == 'closed', (code, closed)
assert closed['closedAt'], closed
assert closed['terminationReason'] == 'explicit_close', closed
assert_http_error(frame_req, 410)
code, capacity = signed('GET', '/api/capacity', 'writer-a')
assert code == 200 and capacity['openSessions'] == 0 and capacity['availableSlots'] == 3, capacity

open('/tmp/phase4-session-id', 'w').write(sid)
print(json.dumps({'result': 'PASS', 'phase4OwnershipRegression': True, 'currentPhase': 6, 'sessionId': sid}))
