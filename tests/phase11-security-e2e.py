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
OPERATOR_SECRET = os.environ['RUNTIME_OPERATOR_AUTH_SECRET']
WORKER_SECRET = os.environ['WORKER_CONTROL_SECRET']
VIEWER_SECRET = os.environ['VIEWER_SIGNING_SECRET'].encode()
TOOL = 'generic-phase4-regression'
LAUNCH = 'data:text/html,%3Ctitle%3EPhase%204%20Owned%3C/title%3E%3Ch1%3EOwned%3C/h1%3E'


def call(req, timeout=30):
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            return response.status, dict(response.headers), json.loads(raw or b'{}')
    except error.HTTPError as exc:
        raw = exc.read()
        return exc.code, dict(exc.headers), json.loads(raw or b'{}')


def service(method, path, writer='phase11-writer-a', obj=None, raw=None, content_type='application/json',
            nonce=None, timestamp=None, signature_writer=None, signature_path=None):
    if raw is not None and obj is not None:
        raise ValueError('choose obj or raw')
    body = raw if raw is not None else (b'' if obj is None else json.dumps(obj, separators=(',', ':')).encode())
    ts = int(time.time()) if timestamp is None else int(timestamp)
    nonce = nonce or secrets.token_urlsafe(18)
    signed_writer = writer if signature_writer is None else signature_writer
    canonical_path = path.split('?', 1)[0] if signature_path is None else signature_path
    canonical = '\n'.join([
        method.upper(), canonical_path, str(ts), nonce, signed_writer,
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
    if body:
        headers['content-type'] = content_type
    return call(request.Request(API + path, data=(body if body else None), headers=headers, method=method.upper()))


def worker(method, path, obj=None, authorized=True, raw=None, content_type='application/json'):
    body = raw if raw is not None else (None if obj is None else json.dumps(obj, separators=(',', ':')).encode())
    headers = {'accept': 'application/json'}
    if authorized:
        headers['x-toprated-worker-secret'] = WORKER_SECRET
    if body is not None:
        headers['content-type'] = content_type
    return call(request.Request(WORKER + path, data=body, headers=headers, method=method.upper()))


def operator(method, path, obj=None, secret=OPERATOR_SECRET, raw=None, content_type='application/json'):
    body = raw if raw is not None else (None if obj is None else json.dumps(obj, separators=(',', ':')).encode())
    headers = {'accept': 'application/json'}
    if secret is not None:
        headers['x-toprated-operator-secret'] = secret
    if body is not None:
        headers['content-type'] = content_type
    return call(request.Request(API + path, data=body, headers=headers, method=method.upper()))


def viewer_token(payload):
    encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(',', ':')).encode()).decode().rstrip('=')
    signature = base64.urlsafe_b64encode(hmac.new(VIEWER_SECRET, encoded.encode(), hashlib.sha256).digest()).decode().rstrip('=')
    return encoded + '.' + signature


def grant_parts(grant):
    parts = parse.urlsplit(grant['url'])
    return parse.urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, '')), parse.unquote(parts.fragment)


def assert_error(result, status, code):
    actual, headers, payload = result
    assert actual == status, (actual, status, payload)
    assert payload.get('status') == 'error', payload
    assert payload.get('code') == code, payload
    assert 'text/html' not in headers.get('Content-Type', '').lower(), headers
    return payload


# Authentication boundaries fail closed.
assert_error(service('GET', '/api/capacity', writer='bad writer id'), 401, 'AUTH_INVALID_WRITER')
assert_error(service('GET', '/api/capacity', timestamp=int(time.time()) - 1000), 401, 'AUTH_CLOCK_SKEW')
assert_error(call(request.Request(API + '/api/capacity', headers={'accept': 'application/json'})), 401, 'AUTH_REQUIRED')
assert_error(worker('GET', '/browser/sessions', authorized=False), 401, None)
assert_error(operator('GET', f'/api/operator/tool-auth/{TOOL}', secret=None), 401, 'OPERATOR_AUTH_REQUIRED')

# Protected request parsing is deterministic and never falls through to HTML.
assert_error(service('GET', '/api/capacity?debug=1'), 400, 'REQUEST_QUERY_FORBIDDEN')
assert_error(service('POST', '/api/sessions', raw=b'{', content_type='application/json'), 400, 'MALFORMED_JSON')
assert_error(service('POST', '/api/sessions', raw=b'{' + b'"padding":"' + (b'x' * 327681) + b'"}', content_type='application/json'), 413, 'REQUEST_TOO_LARGE')
assert_error(service('POST', '/api/sessions', raw=b'[]', content_type='application/json'), 400, 'MALFORMED_REQUEST')
assert_error(service('POST', '/api/sessions', raw=b'{"writer_id":"phase11-writer-a"}', content_type='text/plain'), 415, 'UNSUPPORTED_MEDIA_TYPE')
assert_error(service('POST', '/api/sessions', obj={'writer_id': 'phase11-writer-a', 'tool_slug': TOOL, 'launch_url': LAUNCH, 'unexpected': True}), 422, 'UNSUPPORTED_LAUNCH_FIELDS')
assert_error(service('POST', '/api/sessions', obj={'writer_id': 'phase11-writer-a', 'tool_slug': TOOL, 'launch_url': LAUNCH, 'password': 'must-never-reach-runtime'}), 422, 'WRITER_CREDENTIALS_FORBIDDEN')
assert_error(worker('GET', '/browser/sessions?debug=1'), 400, 'REQUEST_QUERY_FORBIDDEN')
assert_error(worker('POST', '/browser/start', raw=b'{', content_type='application/json'), 400, 'MALFORMED_JSON')
assert_error(worker('POST', '/browser/start', raw=b'{' + b'"padding":"' + (b'x' * 17000) + b'"}', content_type='application/json'), 413, 'REQUEST_TOO_LARGE')
assert_error(worker('POST', '/browser/start', obj={'url': LAUNCH, 'unexpected': True}), 422, 'UNSUPPORTED_REQUEST_FIELDS')
assert_error(worker('POST', '/browser/start', raw=b'{"url":"x"}', content_type='text/plain'), 415, 'UNSUPPORTED_MEDIA_TYPE')
assert_error(operator('GET', f'/api/operator/tool-auth/{TOOL}?debug=1'), 400, 'REQUEST_QUERY_FORBIDDEN')
assert_error(operator('POST', f'/api/operator/tool-auth/{TOOL}/restore', raw=b'{'), 400, 'MALFORMED_JSON')

# Nonces are single-use after a valid signature.
replay_nonce = secrets.token_urlsafe(18)
replay_time = int(time.time())
first = service('GET', '/api/capacity', nonce=replay_nonce, timestamp=replay_time)
assert first[0] == 200, first
assert_error(service('GET', '/api/capacity', nonce=replay_nonce, timestamp=replay_time), 409, 'AUTH_REPLAY')

# Create independent writer sessions and prove viewer/session isolation.
body_a = {'writer_id': 'phase11-writer-a', 'tool_slug': TOOL, 'launch_url': LAUNCH}
body_b = {'writer_id': 'phase11-writer-b', 'tool_slug': TOOL, 'launch_url': LAUNCH}
created_a = service('POST', '/api/sessions', writer='phase11-writer-a', obj=body_a)
created_b = service('POST', '/api/sessions', writer='phase11-writer-b', obj=body_b)
assert created_a[0] == 201, created_a
assert created_b[0] == 201, created_b
session_a = created_a[2]['sessionId']
session_b = created_b[2]['sessionId']
viewer_a, token_a = grant_parts(created_a[2]['viewerGrant'])
viewer_b, token_b = grant_parts(created_b[2]['viewerGrant'])
assert session_a != session_b and token_a != token_b

# Raw CDP stays on Chromium loopback and the worker does not expose a fixed public port.
probe = subprocess.run([
    'docker', 'compose', 'exec', '-T', 'browser-worker', 'node', '-e',
    """const fs=require('node:fs');let found=0;for(const p of fs.readdirSync('/proc')){if(!/^\\d+$/.test(p))continue;try{const c=fs.readFileSync('/proc/'+p+'/cmdline','utf8').split('\\0');if(c.includes('--remote-debugging-port=0')){found++;if(!c.includes('--remote-debugging-address=127.0.0.1'))process.exit(2)}}catch{}}if(found<2)process.exit(3);console.log('cdp_loopback=pass chromium_roots='+found);"""
], check=True, capture_output=True, text=True)
print(probe.stdout.strip())

def viewer(method, url, token, obj=None):
    body = None if obj is None else json.dumps(obj, separators=(',', ':')).encode()
    headers = {'authorization': 'Bearer ' + token}
    if body is not None:
        headers['content-type'] = 'application/json'
    return call(request.Request(url, data=body, headers=headers, method=method))

ok_status = viewer('GET', viewer_a + '/status', token_a)
assert ok_status[0] == 200, ok_status
assert_error(viewer('GET', viewer_a + '/status', token_a[:-1] + ('A' if token_a[-1] != 'A' else 'B')), 401, None)

now = int(time.time())
payload_base = {'v': 1, 'sid': parse.urlsplit(viewer_a).path.split('/')[2], 'wid': 'phase11-writer-a', 'jti': 'phase11'}
assert_error(viewer('GET', viewer_a + '/status', viewer_token({**payload_base, 'iat': now - 120, 'exp': now - 1})), 401, None)
assert_error(viewer('GET', viewer_a + '/status', viewer_token({**payload_base, 'iat': now + 120, 'exp': now + 180})), 401, None)
assert_error(viewer('GET', viewer_a + '/status', viewer_token({**payload_base, 'iat': now, 'exp': now + 901})), 401, None)
assert_error(viewer('GET', viewer_b + '/status', token_a), 403, None)

# Writer B cannot observe, operate, mint grants for, or close writer A's session.
for method, path, obj in [
    ('GET', f'/api/sessions/{session_a}', None),
    ('POST', f'/api/sessions/{session_a}/heartbeat', {}),
    ('POST', f'/api/sessions/{session_a}/activity', {}),
    ('POST', f'/api/sessions/{session_a}/viewer-grant', {}),
    ('DELETE', f'/api/sessions/{session_a}', None),
]:
    assert_error(service(method, path, writer='phase11-writer-b', obj=obj), 403, 'SESSION_FORBIDDEN')

assert_error(service('POST', f'/api/sessions/{session_a}/heartbeat', writer='phase11-writer-a', obj={'unexpected': True}), 422, 'REQUEST_BODY_FORBIDDEN')

# Viewer limiting is independent from API control; overflow returns Retry-After.
viewer_limited = None
for _ in range(40):
    result = viewer('GET', viewer_a + '/status', token_a)
    if result[0] == 429:
        viewer_limited = result
        break
assert viewer_limited is not None, 'viewer rate limit did not engage'
assert viewer_limited[2]['code'] == 'RATE_LIMITED' and int(viewer_limited[1]['Retry-After']) >= 1, viewer_limited

# Both sessions close through their owning identities and leave no worker state.
assert service('DELETE', f'/api/sessions/{session_a}', writer='phase11-writer-a')[0] == 200
assert service('DELETE', f'/api/sessions/{session_b}', writer='phase11-writer-b')[0] == 200
worker_state = worker('GET', '/browser/sessions')
assert worker_state[0] == 200 and worker_state[2]['activeCount'] == 0 and worker_state[2]['startingCount'] == 0, worker_state

# Independent operator, service, and worker control limits all fail closed.
for caller, expected_code in [
    (lambda: operator('GET', f'/api/operator/tool-auth/{TOOL}'), 'RATE_LIMITED'),
    (lambda: service('GET', '/api/capacity'), 'RATE_LIMITED'),
    (lambda: worker('GET', '/browser/sessions'), 'RATE_LIMITED'),
]:
    limited = None
    for _ in range(160):
        result = caller()
        if result[0] == 429:
            limited = result
            break
    assert limited is not None and limited[2].get('code') == expected_code, limited
    assert int(limited[1]['Retry-After']) >= 1, limited

print(json.dumps({
    'result': 'PASS',
    'phase': 11,
    'forgedAndExpiredViewerTokensRejected': True,
    'crossWriterDenied': True,
    'serviceReplayRejected': True,
    'malformedRequestsRejected': True,
    'rateLimitsEnforced': True,
    'rawCdpPubliclyExposed': False,
    'cleanupActiveSessions': 0,
}))
