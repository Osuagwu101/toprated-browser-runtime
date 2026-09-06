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
WORKER_SECRET = os.environ['WORKER_CONTROL_SECRET']
OPERATOR_SECRET = os.environ['RUNTIME_OPERATOR_AUTH_SECRET']


def read_json_response(req, timeout=35):
    try:
        with request.urlopen(req, timeout=timeout) as response:
            body = response.read()
            return response.status, json.loads(body or b'{}')
    except error.HTTPError as exc:
        body = exc.read()
        return exc.code, json.loads(body or b'{}')


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
    return read_json_response(req)


def worker_json(method, path, obj=None):
    body = None if obj is None else json.dumps(obj, separators=(',', ':')).encode()
    headers = {
        'accept': 'application/json',
        'x-toprated-worker-secret': WORKER_SECRET,
    }
    if obj is not None:
        headers['content-type'] = 'application/json'
    req = request.Request(WORKER + path, data=body, headers=headers, method=method.upper())
    return read_json_response(req, timeout=25)


def operator(method, path, obj=None, secret=None):
    body = None if obj is None else json.dumps(obj, separators=(',', ':')).encode()
    headers = {'accept': 'application/json'}
    if secret is not None:
        headers['x-toprated-operator-secret'] = secret
    if obj is not None:
        headers['content-type'] = 'application/json'
    req = request.Request(API + path, data=body, headers=headers, method=method.upper())
    return read_json_response(req)


def decode_grant(grant):
    parts = parse.urlsplit(grant['url'])
    token = parse.unquote(parts.fragment)
    encoded, _signature = token.split('.', 1)
    payload = json.loads(base64.urlsafe_b64decode(encoded + '=' * ((4 - len(encoded) % 4) % 4)))
    viewer_url = parse.urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ''))
    return token, payload, viewer_url


def viewer_json(viewer_url, token, action):
    req = request.Request(
        viewer_url + action,
        headers={'authorization': 'Bearer ' + token, 'accept': 'application/json'},
    )
    return read_json_response(req, timeout=20)


def good_state():
    return {
        'authenticated_cookies': [{
            'name': 'phase8-auth',
            'value': 'ok',
            'domain': '127.0.0.1',
            'path': '/',
            'secure': False,
            'httpOnly': False,
            'sameSite': 'Lax',
        }],
        'session_tokens': {
            'captured_at': '2026-09-06T00:00:00Z',
            'storage': {
                'localStorage': {'phase8-local': 'shared-state-local'},
                'sessionStorage': {'phase8-session': 'shared-state-session'},
            },
        },
        'auth_headers': {},
    }


def assert_reauth(code, payload):
    assert code == 423, (code, payload)
    assert payload.get('code') == 'TOOL_REAUTH_REQUIRED', payload
    assert payload.get('message') == 'This tool is temporarily unavailable while an administrator refreshes authentication.', payload
    serialized = json.dumps(payload)
    for forbidden in ['phase8-auth', 'shared-state-local', 'shared-state-session', 'phase9-secret-otp']:
        assert forbidden not in serialized, payload


# Startup failure: syntactically valid saved state that no longer authenticates must
# become an admin-only outage, not a writer login/OTP flow.
stale_writer = 'phase9-stale-writer'
stale_state = good_state()
stale_state['session_tokens']['storage']['localStorage']['phase8-local'] = 'expired-state'
code, stale = signed('POST', '/api/sessions', stale_writer, {
    'writer_id': stale_writer,
    'tool_slug': 'generic-phase8-state',
    'browser_state': stale_state,
})
assert_reauth(code, stale)
assert 'viewerGrant' not in stale, stale

code, capacity = signed('GET', '/api/capacity', stale_writer)
assert code == 200, (code, capacity)
assert capacity['workerActiveSessions'] == 0, capacity

# Once latched, another writer with otherwise valid state must fail before Chromium
# is spawned. Repeated stale launches must not consume browser capacity.
blocked_writer = 'phase9-blocked-writer'
code, blocked = signed('POST', '/api/sessions', blocked_writer, {
    'writer_id': blocked_writer,
    'tool_slug': 'generic-phase8-state',
    'browser_state': good_state(),
})
assert_reauth(code, blocked)
code, capacity = signed('GET', '/api/capacity', blocked_writer)
assert code == 200 and capacity['workerActiveSessions'] == 0, (code, capacity)

# Writer/service credentials cannot operate the admin recovery surface.
code, denied = operator('GET', '/api/operator/tool-auth/generic-phase8-state')
assert code == 401 and denied.get('code') == 'OPERATOR_AUTH_REQUIRED', (code, denied)
code, denied = operator('GET', '/api/operator/tool-auth/generic-phase8-state', secret='wrong-operator-secret')
assert code == 401 and denied.get('code') == 'OPERATOR_AUTH_REQUIRED', (code, denied)

code, auth_state = operator('GET', '/api/operator/tool-auth/generic-phase8-state', secret=OPERATOR_SECRET)
assert code == 200, (code, auth_state)
assert auth_state['status'] == 'reauth_required', auth_state
assert auth_state['adminActionRequired'] is True, auth_state
assert auth_state['reasonCode'] == 'TOOL_AUTH_NOT_VERIFIED', auth_state

# Even the operator recovery endpoint never accepts a password, OTP or verification
# code. Authentication itself remains an administrator action outside writer traffic.
code, forbidden_body = operator(
    'POST',
    '/api/operator/tool-auth/generic-phase8-state/restore',
    {'otp': 'phase9-secret-otp'},
    secret=OPERATOR_SECRET,
)
assert code == 422 and forbidden_body.get('code') == 'OPERATOR_AUTH_BODY_FORBIDDEN', (code, forbidden_body)
assert 'phase9-secret-otp' not in json.dumps(forbidden_body), forbidden_body

code, restored = operator('POST', '/api/operator/tool-auth/generic-phase8-state/restore', secret=OPERATOR_SECRET)
assert code == 200, (code, restored)
assert restored['status'] == 'ready' and restored['adminActionRequired'] is False, restored

# A valid refreshed state can launch again after the operator clears the outage.
live_writer = 'phase9-live-loss-writer'
code, created = signed('POST', '/api/sessions', live_writer, {
    'writer_id': live_writer,
    'tool_slug': 'generic-phase8-state',
    'browser_state': good_state(),
})
assert code == 201 and created['status'] == 'active', (code, created)
assert created['viewerGrant'] is not None, created

token, grant_payload, viewer_url = decode_grant(created['viewerGrant'])
worker_session_id = grant_payload['sid']

# Simulate authentication expiring during an already-open writer session by moving
# the private worker to a non-authenticated path. The writer viewer must fail closed:
# no status content, no frame, and no input path to a login/OTP screen.
code, navigated = worker_json(
    'POST',
    f'/browser/sessions/{worker_session_id}/navigate',
    {'url': 'http://127.0.0.1:19091/login'},
)
assert code == 200, (code, navigated)

code, viewer_block = viewer_json(viewer_url, token, '/status')
assert_reauth(code, viewer_block)
code, frame_block = viewer_json(viewer_url, token, '/frame')
assert_reauth(code, frame_block)

# The next normal service interaction observes the worker's live auth=false state,
# latches the shared outage, terminates the exact failed browser, and reports only
# the safe admin-required state.
code, lost = signed('POST', '/api/sessions', live_writer, {
    'writer_id': live_writer,
    'tool_slug': 'generic-phase8-state',
})
assert_reauth(code, lost)

code, capacity = signed('GET', '/api/capacity', live_writer)
assert code == 200, (code, capacity)
assert capacity['workerActiveSessions'] == 0, capacity
assert capacity['openSessions'] == 0, capacity

code, latched = operator('GET', '/api/operator/tool-auth/generic-phase8-state', secret=OPERATOR_SECRET)
assert code == 200, (code, latched)
assert latched['status'] == 'reauth_required' and latched['adminActionRequired'] is True, latched
assert latched['reasonCode'] == 'TOOL_AUTH_LOST', latched

# Admin refresh acknowledgement restores availability, and a newly refreshed saved
# state is accepted again without exposing credentials or raw state to the writer.
code, restored_again = operator('POST', '/api/operator/tool-auth/generic-phase8-state/restore', secret=OPERATOR_SECRET)
assert code == 200 and restored_again['status'] == 'ready', (code, restored_again)

recovered_writer = 'phase9-recovered-writer'
code, recovered = signed('POST', '/api/sessions', recovered_writer, {
    'writer_id': recovered_writer,
    'tool_slug': 'generic-phase8-state',
    'browser_state': good_state(),
})
assert code == 201 and recovered['status'] == 'active', (code, recovered)
serialized = json.dumps(recovered)
for forbidden in ['phase8-auth', 'shared-state-local', 'shared-state-session', OPERATOR_SECRET]:
    assert forbidden not in serialized, recovered

code, closed = signed('DELETE', f"/api/sessions/{recovered['sessionId']}", recovered_writer)
assert code == 200 and closed['status'] == 'closed', (code, closed)

code, final_state = operator('GET', '/api/operator/tool-auth/generic-phase8-state', secret=OPERATOR_SECRET)
assert code == 200, (code, final_state)
assert final_state['status'] == 'ready' and final_state['adminActionRequired'] is False, final_state
assert final_state['verifiedAt'] is not None, final_state

code, final_capacity = signed('GET', '/api/capacity', recovered_writer)
assert code == 200, (code, final_capacity)
assert final_capacity['workerActiveSessions'] == 0, final_capacity
assert final_capacity['openSessions'] == 0, final_capacity

print(json.dumps({
    'result': 'PASS',
    'phase': 9,
    'startupAuthFailureRequiresAdmin': True,
    'latchedFailureBlocksOtherWritersBeforeChromium': True,
    'writerCredentialsAndOtpNeverAccepted': True,
    'operatorRecoveryIsSeparateAndCredentialFree': True,
    'liveAuthLossBlocksViewerStatus': True,
    'liveAuthLossBlocksViewerFrames': True,
    'failedBrowserCleaned': True,
    'refreshedStateRestoresWriterAccess': True,
}))
