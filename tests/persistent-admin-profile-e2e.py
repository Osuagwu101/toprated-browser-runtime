#!/usr/bin/env python3
"""Deterministic persistent administrator-profile lifecycle validation."""

import base64
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import time
from urllib import error, parse, request

API = os.environ.get('API_BASE', 'http://127.0.0.1:18080').rstrip('/')
WORKER = os.environ.get('WORKER_BASE', 'http://127.0.0.1:18081').rstrip('/')
SERVICE_SECRET = os.environ['RUNTIME_SERVICE_AUTH_SECRET'].encode()
OPERATOR_SECRET = os.environ['RUNTIME_OPERATOR_AUTH_SECRET']
WORKER_SECRET = os.environ['WORKER_CONTROL_SECRET']
TOOL = 'generic-phase8-state'
SECRET_MARKERS = ['phase8-auth', 'shared-state-local', 'shared-state-session']


def response_json(req, timeout=45):
    try:
        with request.urlopen(req, timeout=timeout) as response:
            return response.status, json.loads(response.read() or b'{}')
    except error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b'{}')


def service(method, path, writer, obj=None):
    body = b'' if obj is None else json.dumps(obj, separators=(',', ':')).encode()
    timestamp = int(time.time())
    nonce = secrets.token_urlsafe(18)
    canonical = '\n'.join([
        method.upper(), path, str(timestamp), nonce, writer,
        hashlib.sha256(body).hexdigest(),
    ]).encode()
    headers = {
        'accept': 'application/json',
        'x-toprated-timestamp': str(timestamp),
        'x-toprated-nonce': nonce,
        'x-toprated-signature': hmac.new(SERVICE_SECRET, canonical, hashlib.sha256).hexdigest(),
        'x-toprated-writer-id': writer,
    }
    if obj is not None:
        headers['content-type'] = 'application/json'
    return response_json(request.Request(API + path, data=(body if obj is not None else None), headers=headers, method=method.upper()))


def operator(method, path, obj=None, authenticated=True):
    body = None if obj is None else json.dumps(obj, separators=(',', ':')).encode()
    headers = {'accept': 'application/json'}
    if authenticated:
        headers['x-toprated-operator-secret'] = OPERATOR_SECRET
    if obj is not None:
        headers['content-type'] = 'application/json'
    return response_json(request.Request(API + path, data=body, headers=headers, method=method.upper()), timeout=180)


def worker(method, path, obj=None):
    body = None if obj is None else json.dumps(obj, separators=(',', ':')).encode()
    headers = {'accept': 'application/json', 'x-toprated-worker-secret': WORKER_SECRET}
    if obj is not None:
        headers['content-type'] = 'application/json'
    return response_json(request.Request(WORKER + path, data=body, headers=headers, method=method.upper()))


def decode_grant(grant):
    parts = parse.urlsplit(grant['url'])
    token = parse.unquote(parts.fragment)
    encoded, _signature = token.split('.', 1)
    payload = json.loads(base64.urlsafe_b64decode(encoded + '=' * ((4 - len(encoded) % 4) % 4)))
    viewer_url = parse.urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ''))
    return token, payload, viewer_url


def viewer(method, viewer_url, token, action, obj=None):
    body = None if obj is None else json.dumps(obj, separators=(',', ':')).encode()
    headers = {'accept': 'application/json', 'authorization': 'Bearer ' + token}
    if obj is not None:
        headers['content-type'] = 'application/json'
    return response_json(request.Request(viewer_url + action, data=body, headers=headers, method=method.upper()))


def wait_viewer_title(viewer_url, token, expected, timeout=20):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        code, last = viewer('GET', viewer_url, token, '/status')
        if code == 200 and last.get('title') == expected:
            return last
        time.sleep(0.25)
    raise AssertionError((expected, last))


def click_admin_login(viewer_url, token):
    for event in ('pressed', 'released'):
        code, payload = viewer('POST', viewer_url, token, '/input', {
            'type': 'mouse', 'event': event, 'button': 'left', 'x': 100, 'y': 55,
        })
        assert code == 200 and payload.get('inputAccepted') is True, (code, payload)
    return wait_viewer_title(viewer_url, token, 'PHASE8_AUTHENTICATED')


def mouse_click(viewer_url, token, x, y):
    for event in ('pressed', 'released'):
        code, payload = viewer('POST', viewer_url, token, '/input', {
            'type': 'mouse', 'event': event, 'button': 'left', 'x': x, 'y': y,
        })
        assert code == 200 and payload.get('inputAccepted') is True, (code, payload)


def set_writer_marker(created, marker):
    token, _grant, viewer_url = decode_grant(created['viewerGrant'])
    mouse_click(viewer_url, token, 100, 145)
    code, inserted = viewer('POST', viewer_url, token, '/input', {'type': 'text', 'text': marker})
    assert code == 200 and inserted.get('inputAccepted') is True, (code, inserted)
    mouse_click(viewer_url, token, 100, 215)
    wait_viewer_title(viewer_url, token, 'WRITER_MARKER:' + marker)


def assert_no_state(payload):
    serialized = json.dumps(payload)
    for marker in SECRET_MARKERS:
        assert marker not in serialized, payload
    for forbidden_key in ('authorizedState', 'browserState', 'userDataDir', 'adminProfileId'):
        assert forbidden_key not in serialized, payload


def start_admin(expected_title):
    code, created = operator('POST', f'/api/operator/tool-auth/{TOOL}/sessions')
    assert code == 201 and created.get('sessionKind') == 'admin_auth', (code, created)
    assert created.get('reused') is False and created.get('viewerGrant'), created
    assert_no_state(created)
    token, grant, viewer_url = decode_grant(created['viewerGrant'])
    assert grant['wid'].startswith('runtime-operator-'), grant
    status = wait_viewer_title(viewer_url, token, expected_title)
    assert status.get('sessionKind') == 'admin_auth', status
    return created, token, grant, viewer_url


def approve_admin(created):
    code, approved = operator('POST', f"/api/operator/tool-auth/{TOOL}/sessions/{created['sessionId']}/approve")
    assert code == 200 and approved.get('status') == 'ready', (code, approved)
    assert approved.get('adminSessionClosed') is True, approved
    assert approved.get('approvedState', {}).get('available') is True, approved
    assert approved['approvedState'].get('encryptedAtRest') is True, approved
    assert_no_state(approved)
    return approved


def start_writer(writer_id):
    code, created = service('POST', '/api/sessions', writer_id, {
        'writer_id': writer_id,
        'tool_slug': TOOL,
    })
    assert code == 201 and created.get('status') == 'active', (code, created)
    assert created.get('sessionKind') == 'writer', created
    assert_no_state(created)
    token, grant, viewer_url = decode_grant(created['viewerGrant'])
    status = wait_viewer_title(viewer_url, token, 'PHASE8_AUTHENTICATED')
    assert status.get('authentication') == {'required': True, 'verified': True}, status
    return created, grant


def close_writer(created, writer_id):
    code, closed = service('DELETE', f"/api/sessions/{created['sessionId']}", writer_id)
    assert code == 200 and closed.get('status') == 'closed', (code, closed)


def restart_worker_and_fixture():
    subprocess.run(['docker', 'compose', 'restart', 'browser-worker'], check=True)
    deadline = time.time() + 45
    while time.time() < deadline:
        try:
            with request.urlopen(WORKER + '/health', timeout=3) as response:
                if response.status == 200:
                    break
        except Exception:
            pass
        time.sleep(1)
    else:
        raise AssertionError('browser worker did not recover after restart')
    subprocess.run([
        'docker', 'compose', 'exec', '-d', 'browser-worker',
        'node', '/srv/browser-worker/test/auth-state-fixture.mjs',
    ], check=True)
    probe = "fetch('http://127.0.0.1:19091/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
    for _attempt in range(30):
        result = subprocess.run(['docker', 'compose', 'exec', '-T', 'browser-worker', 'node', '-e', probe], check=False)
        if result.returncode == 0:
            return
        time.sleep(0.5)
    raise AssertionError('authentication fixture did not recover after worker restart')


# No approved state means writers fail closed and the operator recovery state is latched.
writer = 'persistent-profile-preapproval'
code, blocked = service('POST', '/api/sessions', writer, {'writer_id': writer, 'tool_slug': TOOL})
assert code == 423 and blocked.get('code') == 'TOOL_REAUTH_REQUIRED', (code, blocked)
assert_no_state(blocked)

# Neither anonymous callers nor writer-scoped service calls can enter the operator profile.
code, denied = operator('POST', f'/api/operator/tool-auth/{TOOL}/sessions', authenticated=False)
assert code == 401 and denied.get('code') == 'OPERATOR_AUTH_REQUIRED', (code, denied)
code, restricted = service('POST', '/api/sessions', writer, {
    'writer_id': writer, 'tool_slug': 'phrasly-admin-bootstrap',
})
assert code == 403 and restricted.get('code') == 'TOOL_PROFILE_FORBIDDEN', (code, restricted)
code, forbidden_body = operator('POST', f'/api/operator/tool-auth/{TOOL}/sessions', {'password': 'never-store-this'})
assert code == 422 and forbidden_body.get('code') == 'OPERATOR_AUTH_BODY_FORBIDDEN', (code, forbidden_body)
assert 'never-store-this' not in json.dumps(forbidden_body), forbidden_body

# First run: a human-equivalent click completes authentication once.
admin, admin_token, admin_grant, admin_viewer = start_admin('ADMIN_PROFILE_FIRST_RUN')
code, cross_boundary = service('GET', f"/api/sessions/{admin['sessionId']}", writer)
assert code == 403 and cross_boundary.get('code') == 'SESSION_FORBIDDEN', (code, cross_boundary)
click_admin_login(admin_viewer, admin_token)
approval_one = approve_admin(admin)
assert approval_one['approvedState']['stateVersion'] == 1, approval_one

first_writer, _first_grant = start_writer('persistent-profile-writer-one')
close_writer(first_writer, 'persistent-profile-writer-one')
code, health = worker('GET', '/health')
assert code == 200 and health['adminProfiles']['activeCount'] == 0, (code, health)
assert health['adminProfiles']['persistedCount'] == 1, health

# The profile survives a worker restart. Existing authentication is recognized and
# can be approved without repeating the login click.
restart_worker_and_fixture()
admin_reused, _token, _grant, _viewer = start_admin('ADMIN_PROFILE_REUSED_AUTHENTICATED')
approval_two = approve_admin(admin_reused)
assert approval_two['approvedState']['stateVersion'] == 2, approval_two

# Simulate provider-side expiry, refresh the open writer page, and verify the runtime
# invalidates the server vault before another writer can launch.
expired_writer, expired_grant = start_writer('persistent-profile-expired-writer')
subprocess.run([
    'docker', 'compose', 'exec', '-T', 'browser-worker', 'node', '-e',
    "fetch('http://127.0.0.1:19091/invalidate').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
], check=True)
code, _navigated = worker('POST', f"/browser/sessions/{expired_grant['sid']}/navigate", {
    'url': 'http://127.0.0.1:19091/dashboard',
})
assert code == 200, code
code, expired = service('GET', f"/api/sessions/{expired_writer['sessionId']}", 'persistent-profile-expired-writer')
assert code == 423 and expired.get('code') == 'TOOL_REAUTH_REQUIRED', (code, expired)
code, auth_state = operator('GET', f'/api/operator/tool-auth/{TOOL}')
assert code == 200 and auth_state.get('adminActionRequired') is True, (code, auth_state)
assert auth_state.get('approvedState', {}).get('available') is False, auth_state
code, still_blocked = service('POST', '/api/sessions', 'persistent-profile-blocked-writer', {
    'writer_id': 'persistent-profile-blocked-writer', 'tool_slug': TOOL,
})
assert code == 423 and still_blocked.get('code') == 'TOOL_REAUTH_REQUIRED', (code, still_blocked)

# The durable browser identity remains, but expired provider state forces explicit
# administrator interaction and a new isolated proof before writer access resumes.
admin_expired, expired_token, _expired_grant, expired_viewer = start_admin('ADMIN_PROFILE_EXPIRED')
click_admin_login(expired_viewer, expired_token)
approval_three = approve_admin(admin_expired)
assert approval_three['approvedState']['stateVersion'] == 3, approval_three

writer_a, grant_a = start_writer('persistent-profile-isolation-a')
writer_b, grant_b = start_writer('persistent-profile-isolation-b')
assert writer_a['sessionId'] != writer_b['sessionId'], (writer_a, writer_b)
assert grant_a['sid'] != grant_b['sid'], (grant_a, grant_b)
code, worker_a = worker('GET', f"/browser/sessions/{grant_a['sid']}")
assert code == 200 and worker_a.get('sessionKind') == 'writer', (code, worker_a)
code, worker_b = worker('GET', f"/browser/sessions/{grant_b['sid']}")
assert code == 200 and worker_b.get('sessionKind') == 'writer', (code, worker_b)
assert worker_a.get('pid') != worker_b.get('pid'), (worker_a, worker_b)
assert_no_state(worker_a)
assert_no_state(worker_b)
set_writer_marker(writer_a, 'writer-a-only')
code, reloaded_b = worker('POST', f"/browser/sessions/{grant_b['sid']}/navigate", {
    'url': 'http://127.0.0.1:19091/dashboard',
})
assert code == 200, (code, reloaded_b)
token_b, _grant_b, viewer_b = decode_grant(writer_b['viewerGrant'])
status_b = wait_viewer_title(viewer_b, token_b, 'PHASE8_AUTHENTICATED')
assert status_b.get('title') != 'WRITER_MARKER:writer-a-only', status_b
close_writer(writer_a, 'persistent-profile-isolation-a')
close_writer(writer_b, 'persistent-profile-isolation-b')

code, sessions = worker('GET', '/browser/sessions')
assert code == 200 and sessions.get('activeCount') == 0 and sessions.get('startingCount') == 0, (code, sessions)
code, final_health = worker('GET', '/health')
assert code == 200 and final_health['adminProfiles'] == {
    'persistence': 'durable-operator-only', 'activeCount': 0, 'persistedCount': 1,
}, (code, final_health)

print(json.dumps({
    'result': 'PASS',
    'persistentAdminProfile': True,
    'firstRunRequiredAdministratorInteraction': True,
    'profileSurvivedWorkerRestart': True,
    'approvedStateReusedAcrossWriterSessions': True,
    'expiryLatchedAdministratorApproval': True,
    'reauthenticationRecoveredWriters': True,
    'writerAdminMaterialExposure': False,
    'writerSessionIsolation': True,
    'temporaryProofCleanup': True,
}))
