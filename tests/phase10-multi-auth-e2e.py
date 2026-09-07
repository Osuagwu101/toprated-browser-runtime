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
URL_AUTH_TOOL = os.environ.get('PHASE10_URL_AUTH_TOOL', 'stealthwriter')
SELECTOR_AUTH_TOOL = os.environ.get('PHASE10_SELECTOR_AUTH_TOOL', 'chatgpt')
assert URL_AUTH_TOOL != SELECTOR_AUTH_TOOL


def read_json_response(req, timeout=35):
    try:
        with request.urlopen(req, timeout=timeout) as response:
            return response.status, json.loads(response.read() or b'{}')
    except error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b'{}')


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


def operator(method, path, obj=None):
    body = None if obj is None else json.dumps(obj, separators=(',', ':')).encode()
    headers = {
        'accept': 'application/json',
        'x-toprated-operator-secret': OPERATOR_SECRET,
    }
    if obj is not None:
        headers['content-type'] = 'application/json'
    req = request.Request(API + path, data=body, headers=headers, method=method.upper())
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


def decode_grant(grant):
    parts = parse.urlsplit(grant['url'])
    token = parse.unquote(parts.fragment)
    encoded, _signature = token.split('.', 1)
    payload = json.loads(base64.urlsafe_b64decode(encoded + '=' * ((4 - len(encoded) % 4) % 4)))
    viewer_url = parse.urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ''))
    return token, payload, viewer_url


def viewer_json(viewer_url, token, action='/status'):
    req = request.Request(
        viewer_url + action,
        headers={'authorization': 'Bearer ' + token, 'accept': 'application/json'},
    )
    return read_json_response(req, timeout=20)


def shared_state(tool, valid=True):
    if tool == URL_AUTH_TOOL:
        cookie_name = 'stealthwriter-session'
        storage_key = 'stealthwriter-auth'
    elif tool == SELECTOR_AUTH_TOOL:
        cookie_name = 'chatgpt-session'
        storage_key = 'chatgpt-auth'
    else:
        raise AssertionError(tool)

    return {
        'authenticated_cookies': [{
            'name': cookie_name,
            'value': 'valid' if valid else 'expired',
            'domain': '127.0.0.1',
            'path': '/',
            'secure': False,
            'httpOnly': False,
            'sameSite': 'Lax',
        }],
        'session_tokens': {
            'captured_at': '2026-09-06T00:00:00Z',
            'storage': {
                'localStorage': {storage_key: 'shared-valid' if valid else 'expired'},
                'sessionStorage': {},
            },
        },
        'auth_headers': {},
    }


def assert_reauth(code, payload):
    assert code == 423, (code, payload)
    assert payload.get('code') == 'TOOL_REAUTH_REQUIRED', payload
    assert payload.get('message') == 'This tool is temporarily unavailable while an administrator refreshes authentication.', payload
    assert 'viewerGrant' not in payload, payload


def assert_state_not_returned(payload):
    serialized = json.dumps(payload)
    for marker in [
        'stealthwriter-session', 'stealthwriter-auth',
        'chatgpt-session', 'chatgpt-auth', 'shared-valid',
        'phase10-multi-auth-password-marker',
    ]:
        assert marker not in serialized, (marker, payload)


# Both new one-click profiles require administrator-provided shared browser state.
for tool in [URL_AUTH_TOOL, SELECTOR_AUTH_TOOL]:
    writer = f'phase10-{tool}-missing-state'
    code, missing = signed('POST', '/api/sessions', writer, {
        'writer_id': writer,
        'tool_slug': tool,
    })
    assert code == 422 and missing.get('code') == 'BROWSER_STATE_REQUIRED', (tool, code, missing)

# Writer traffic cannot become a credential transport for either tool.
for tool in [URL_AUTH_TOOL, SELECTOR_AUTH_TOOL]:
    writer = f'phase10-{tool}-credential-reject'
    code, rejected = signed('POST', '/api/sessions', writer, {
        'writer_id': writer,
        'tool_slug': tool,
        'password': 'phase10-multi-auth-password-marker',
        'browser_state': shared_state(tool),
    })
    assert code == 422 and rejected.get('code') == 'WRITER_CREDENTIALS_FORBIDDEN', (tool, code, rejected)
    assert 'phase10-multi-auth-password-marker' not in json.dumps(rejected), rejected

# Host policy remains tool-owned and rejects state from an unrelated origin.
bad_chatgpt_state = shared_state(SELECTOR_AUTH_TOOL)
bad_chatgpt_state['authenticated_cookies'][0]['domain'] = 'attacker.invalid'
code, invalid_host = signed('POST', '/api/sessions', 'phase10-chatgpt-bad-host', {
    'writer_id': 'phase10-chatgpt-bad-host',
    'tool_slug': SELECTOR_AUTH_TOOL,
    'browser_state': bad_chatgpt_state,
})
assert code == 422 and invalid_host.get('code') == 'BROWSER_STATE_INVALID', (code, invalid_host)

# The first configured profile proves URL-based verification. Stale state redirects away from the
# configured authenticated dashboard and must latch only that profile.
stale_writer = 'phase10-stealthwriter-stale'
code, stale = signed('POST', '/api/sessions', stale_writer, {
    'writer_id': stale_writer,
    'tool_slug': URL_AUTH_TOOL,
    'browser_state': shared_state(URL_AUTH_TOOL, valid=False),
})
assert_reauth(code, stale)
assert_state_not_returned(stale)

code, stealth_auth_state = operator('GET', f'/api/operator/tool-auth/{URL_AUTH_TOOL}')
assert code == 200, (code, stealth_auth_state)
assert stealth_auth_state['status'] == 'reauth_required', stealth_auth_state
assert stealth_auth_state['adminActionRequired'] is True, stealth_auth_state
assert stealth_auth_state['reasonCode'] == 'TOOL_AUTH_NOT_VERIFIED', stealth_auth_state

# A URL-auth profile outage must not poison the independent selector-auth profile.
chat_writer = 'phase10-chatgpt-live'
code, chat_created = signed('POST', '/api/sessions', chat_writer, {
    'writer_id': chat_writer,
    'tool_slug': SELECTOR_AUTH_TOOL,
    'browser_state': shared_state(SELECTOR_AUTH_TOOL),
})
assert code == 201 and chat_created['status'] == 'active', (code, chat_created)
assert chat_created['toolSlug'] == SELECTOR_AUTH_TOOL, chat_created
assert chat_created['reused'] is False, chat_created
assert_state_not_returned(chat_created)

chat_token, chat_grant, chat_viewer = decode_grant(chat_created['viewerGrant'])
code, chat_status = viewer_json(chat_viewer, chat_token)
assert code == 200, (code, chat_status)
assert chat_status['title'] == 'CHATGPT_AUTHENTICATED', chat_status
assert chat_status['authentication']['required'] is True, chat_status
assert chat_status['authentication']['verified'] is True, chat_status

# A healthy one-click-auth session is reusable without resending raw state.
code, chat_reused = signed('POST', '/api/sessions', chat_writer, {
    'writer_id': chat_writer,
    'tool_slug': SELECTOR_AUTH_TOOL,
})
assert code == 200 and chat_reused['reused'] is True, (code, chat_reused)
assert chat_reused['sessionId'] == chat_created['sessionId'], (chat_created, chat_reused)
assert_state_not_returned(chat_reused)

# Existing writer ownership remains cross-tool: one writer cannot silently switch
# an active selector-auth browser into a URL-auth browser.
code, cross_tool = signed('POST', '/api/sessions', chat_writer, {
    'writer_id': chat_writer,
    'tool_slug': URL_AUTH_TOOL,
    'browser_state': shared_state(URL_AUTH_TOOL),
})
assert code == 409 and cross_tool.get('code') == 'WRITER_SESSION_ACTIVE', (code, cross_tool)

code, chat_closed = signed('DELETE', f"/api/sessions/{chat_created['sessionId']}", chat_writer)
assert code == 200 and chat_closed['status'] == 'closed', (code, chat_closed)

# Clear only the URL-auth outage through the existing operator boundary, then
# prove the same generic shared-state machinery verifies that profile.
code, stealth_restored = operator('POST', f'/api/operator/tool-auth/{URL_AUTH_TOOL}/restore')
assert code == 200 and stealth_restored['status'] == 'ready', (code, stealth_restored)

stealth_writer = 'phase10-stealthwriter-live'
code, stealth_created = signed('POST', '/api/sessions', stealth_writer, {
    'writer_id': stealth_writer,
    'tool_slug': URL_AUTH_TOOL,
    'browser_state': shared_state(URL_AUTH_TOOL),
})
assert code == 201 and stealth_created['status'] == 'active', (code, stealth_created)
assert stealth_created['toolSlug'] == URL_AUTH_TOOL, stealth_created
assert_state_not_returned(stealth_created)

stealth_token, stealth_grant, stealth_viewer = decode_grant(stealth_created['viewerGrant'])
code, stealth_status = viewer_json(stealth_viewer, stealth_token)
assert code == 200, (code, stealth_status)
assert stealth_status['title'] == 'STEALTHWRITER_AUTHENTICATED', stealth_status
assert stealth_status['authentication']['required'] is True, stealth_status
assert stealth_status['authentication']['verified'] is True, stealth_status

code, stealth_closed = signed('DELETE', f"/api/sessions/{stealth_created['sessionId']}", stealth_writer)
assert code == 200 and stealth_closed['status'] == 'closed', (code, stealth_closed)

# The selector-auth profile proves live-auth loss. Moving the private worker to a page
# without the profile selector must fail the viewer closed and latch only that profile.
chat_loss_writer = 'phase10-chatgpt-live-loss'
code, chat_loss_created = signed('POST', '/api/sessions', chat_loss_writer, {
    'writer_id': chat_loss_writer,
    'tool_slug': SELECTOR_AUTH_TOOL,
    'browser_state': shared_state(SELECTOR_AUTH_TOOL),
})
assert code == 201, (code, chat_loss_created)
loss_token, loss_grant, loss_viewer = decode_grant(chat_loss_created['viewerGrant'])
worker_session_id = loss_grant['sid']

code, navigated = worker_json('POST', f'/browser/sessions/{worker_session_id}/navigate', {
    'url': 'http://127.0.0.1:19093/chatgpt/logged-out',
})
assert code == 200, (code, navigated)

code, viewer_blocked = viewer_json(loss_viewer, loss_token, '/status')
assert_reauth(code, viewer_blocked)
code, frame_blocked = viewer_json(loss_viewer, loss_token, '/frame')
assert_reauth(code, frame_blocked)

code, service_observed_loss = signed('POST', '/api/sessions', chat_loss_writer, {
    'writer_id': chat_loss_writer,
    'tool_slug': SELECTOR_AUTH_TOOL,
})
assert_reauth(code, service_observed_loss)

code, chat_auth_state = operator('GET', f'/api/operator/tool-auth/{SELECTOR_AUTH_TOOL}')
assert code == 200, (code, chat_auth_state)
assert chat_auth_state['status'] == 'reauth_required', chat_auth_state
assert chat_auth_state['adminActionRequired'] is True, chat_auth_state
assert chat_auth_state['reasonCode'] == 'TOOL_AUTH_LOST', chat_auth_state

code, capacity = signed('GET', '/api/capacity', chat_loss_writer)
assert code == 200, (code, capacity)
assert capacity['workerActiveSessions'] == 0, capacity
assert capacity['openSessions'] == 0, capacity

# Operator restore plus fresh shared state makes the selector-auth profile reusable again.
code, chat_restored = operator('POST', f'/api/operator/tool-auth/{SELECTOR_AUTH_TOOL}/restore')
assert code == 200 and chat_restored['status'] == 'ready', (code, chat_restored)

chat_recovery_writer = 'phase10-chatgpt-recovered'
code, recovered = signed('POST', '/api/sessions', chat_recovery_writer, {
    'writer_id': chat_recovery_writer,
    'tool_slug': SELECTOR_AUTH_TOOL,
    'browser_state': shared_state(SELECTOR_AUTH_TOOL),
})
assert code == 201 and recovered['status'] == 'active', (code, recovered)
assert_state_not_returned(recovered)
code, recovered_closed = signed('DELETE', f"/api/sessions/{recovered['sessionId']}", chat_recovery_writer)
assert code == 200 and recovered_closed['status'] == 'closed', (code, recovered_closed)

# Two independent configured tools can be active concurrently for different writers.
url_concurrent_writer = 'phase10-concurrent-url-auth'
selector_concurrent_writer = 'phase10-concurrent-selector-auth'
code, url_concurrent = signed('POST', '/api/sessions', url_concurrent_writer, {
    'writer_id': url_concurrent_writer,
    'tool_slug': URL_AUTH_TOOL,
    'browser_state': shared_state(URL_AUTH_TOOL),
})
assert code == 201 and url_concurrent['status'] == 'active', (code, url_concurrent)
code, selector_concurrent = signed('POST', '/api/sessions', selector_concurrent_writer, {
    'writer_id': selector_concurrent_writer,
    'tool_slug': SELECTOR_AUTH_TOOL,
    'browser_state': shared_state(SELECTOR_AUTH_TOOL),
})
assert code == 201 and selector_concurrent['status'] == 'active', (code, selector_concurrent)
assert url_concurrent['sessionId'] != selector_concurrent['sessionId']

url_token, url_grant, url_viewer = decode_grant(url_concurrent['viewerGrant'])
selector_token, selector_grant, selector_viewer = decode_grant(selector_concurrent['viewerGrant'])
assert url_grant['sid'] != selector_grant['sid'], (url_grant, selector_grant)
code, url_concurrent_status = viewer_json(url_viewer, url_token)
assert code == 200 and url_concurrent_status['title'] == 'STEALTHWRITER_AUTHENTICATED', (code, url_concurrent_status)
code, selector_concurrent_status = viewer_json(selector_viewer, selector_token)
assert code == 200 and selector_concurrent_status['title'] == 'CHATGPT_AUTHENTICATED', (code, selector_concurrent_status)

code, concurrent_capacity = signed('GET', '/api/capacity', url_concurrent_writer)
assert code == 200, (code, concurrent_capacity)
assert concurrent_capacity['workerActiveSessions'] == 2, concurrent_capacity
assert concurrent_capacity['openSessions'] == 2, concurrent_capacity

code, url_concurrent_closed = signed('DELETE', f"/api/sessions/{url_concurrent['sessionId']}", url_concurrent_writer)
assert code == 200 and url_concurrent_closed['status'] == 'closed', (code, url_concurrent_closed)
code, selector_concurrent_closed = signed('DELETE', f"/api/sessions/{selector_concurrent['sessionId']}", selector_concurrent_writer)
assert code == 200 and selector_concurrent_closed['status'] == 'closed', (code, selector_concurrent_closed)

# Both authenticated tools finish in ready/verified metadata state with no browser
# residue and no raw authorized state persisted in these metadata responses.
for tool in [URL_AUTH_TOOL, SELECTOR_AUTH_TOOL]:
    code, final_auth = operator('GET', f'/api/operator/tool-auth/{tool}')
    assert code == 200, (tool, code, final_auth)
    assert final_auth['status'] == 'ready', final_auth
    assert final_auth['adminActionRequired'] is False, final_auth
    assert final_auth.get('verifiedAt'), final_auth
    assert_state_not_returned(final_auth)

code, final_capacity = signed('GET', '/api/capacity', 'phase10-final-capacity')
assert code == 200, (code, final_capacity)
assert final_capacity['workerActiveSessions'] == 0, final_capacity
assert final_capacity['openSessions'] == 0, final_capacity

print(json.dumps({
    'result': 'PASS',
    'phase': 10,
    'multiToolOneClickAuth': True,
    'authenticatedTools': [URL_AUTH_TOOL, SELECTOR_AUTH_TOOL],
    'urlBasedAuthenticationVerified': True,
    'selectorBasedAuthenticationVerified': True,
    'sharedStateRequired': True,
    'credentialSubmissionRejected': True,
    'toolAuthOutagesAreIndependent': True,
    'activeSessionReuseWithoutStateResend': True,
    'crossToolOwnershipPreserved': True,
    'concurrentIndependentTools': True,
    'liveAuthenticationLossFailsClosed': True,
    'operatorRecoveryPreserved': True,
    'finalBrowserResidue': 0,
}))
