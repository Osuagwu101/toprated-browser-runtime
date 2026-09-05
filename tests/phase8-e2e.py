import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from urllib import error, parse, request

API = os.environ.get('API_BASE', 'http://127.0.0.1:18080')
SERVICE_SECRET = os.environ['RUNTIME_SERVICE_AUTH_SECRET'].encode()


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
        with request.urlopen(req, timeout=35) as response:
            return response.status, json.loads(response.read() or b'{}')
    except error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b'{}')


def decode_grant(grant):
    parts = parse.urlsplit(grant['url'])
    token = parse.unquote(parts.fragment)
    encoded, _signature = token.split('.', 1)
    payload = json.loads(base64.urlsafe_b64decode(encoded + '=' * ((4 - len(encoded) % 4) % 4)))
    viewer_url = parse.urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ''))
    return token, payload, viewer_url


def viewer_status(viewer_url, token):
    req = request.Request(viewer_url + '/status', headers={'authorization': 'Bearer ' + token})
    with request.urlopen(req, timeout=20) as response:
        payload = json.loads(response.read() or b'{}')
        assert response.status == 200, (response.status, payload)
        return payload


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
            'captured_at': '2026-09-05T00:00:00Z',
            'storage': {
                'localStorage': {'phase8-local': 'shared-state-local'},
                'sessionStorage': {'phase8-session': 'shared-state-session'},
            },
        },
        'auth_headers': {},
    }


writer = 'phase8-writer'

# Writer launch requests cannot carry credentials or verification codes.
code, credential = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'generic-phase8-state',
    'password': 'must-never-be-submitted',
    'browser_state': good_state(),
})
assert code == 422 and credential['code'] == 'WRITER_CREDENTIALS_FORBIDDEN', (code, credential)
assert 'must-never-be-submitted' not in json.dumps(credential), credential

# A new stateful tool session cannot launch without authorized shared state.
code, missing = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'generic-phase8-state',
})
assert code == 422 and missing['code'] == 'BROWSER_STATE_REQUIRED', (code, missing)

# State is constrained to the configured tool hosts.
bad_state = good_state()
bad_state['authenticated_cookies'][0]['domain'] = 'attacker.invalid'
code, invalid = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'generic-phase8-state',
    'browser_state': bad_state,
})
assert code == 422 and invalid['code'] == 'BROWSER_STATE_INVALID', (code, invalid)

# Arbitrary reusable Authorization headers are not accepted in Phase 8.
header_state = good_state()
header_state['auth_headers'] = {'authorization': 'Bearer should-not-cross'}
code, headers_rejected = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'generic-phase8-state',
    'browser_state': header_state,
})
assert code == 422 and headers_rejected['code'] == 'BROWSER_STATE_INVALID', (code, headers_rejected)
assert 'should-not-cross' not in json.dumps(headers_rejected), headers_rejected

# Correct cookies + localStorage + sessionStorage are injected before navigation,
# and the configured authentication indicators must pass before a viewer grant exists.
code, created = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'generic-phase8-state',
    'browser_state': good_state(),
})
assert code == 201, (code, created)
assert created['status'] == 'active', created
assert created['toolSlug'] == 'generic-phase8-state', created
assert created['writerId'] == writer, created
assert created['reused'] is False, created
serialized_created = json.dumps(created)
for secret_value in ['phase8-auth', 'shared-state-local', 'shared-state-session']:
    assert secret_value not in serialized_created, created

token, payload, viewer_url = decode_grant(created['viewerGrant'])
assert payload['wid'] == writer, payload
status = viewer_status(viewer_url, token)
assert status['title'] == 'PHASE8_AUTHENTICATED', status
assert status['authentication']['required'] is True, status
assert status['authentication']['verified'] is True, status

# A healthy existing writer/tool browser is reusable without retransmitting raw shared state.
code, reused = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'generic-phase8-state',
})
assert code == 200, (code, reused)
assert reused['reused'] is True, reused
assert reused['sessionId'] == created['sessionId'], (created, reused)

code, closed = signed('DELETE', f"/api/sessions/{created['sessionId']}", writer)
assert code == 200 and closed['status'] == 'closed', (code, closed)

# State that is syntactically valid but does not satisfy the profile's authenticated
# indicators must never receive a viewer grant. Phase 9 owns the later admin-reauth UX.
failed_writer = 'phase8-unverified-writer'
unverified_state = good_state()
unverified_state['session_tokens']['storage']['localStorage']['phase8-local'] = 'wrong-value'
code, unverified = signed('POST', '/api/sessions', failed_writer, {
    'writer_id': failed_writer,
    'tool_slug': 'generic-phase8-state',
    'browser_state': unverified_state,
})
assert code == 409 and unverified['code'] == 'TOOL_AUTH_NOT_VERIFIED', (code, unverified)
assert 'viewerGrant' not in unverified, unverified

# The failed browser must have been cleaned before the request returns.
code, capacity = signed('GET', '/api/capacity', failed_writer)
assert code == 200, (code, capacity)
assert capacity['workerActiveSessions'] == 0, capacity

print(json.dumps({
    'result': 'PASS',
    'phase': 8,
    'sharedStateInjected': True,
    'cookieInjected': True,
    'localStorageInjected': True,
    'sessionStorageInjected': True,
    'authenticationVerifiedBeforeViewer': True,
    'credentialSubmissionRejected': True,
    'stateNotReturnedToWriter': True,
    'activeSessionReusableWithoutStateResend': True,
    'unverifiedStateGetsNoViewer': True,
}))
