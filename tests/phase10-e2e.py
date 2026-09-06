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
        with request.urlopen(req, timeout=30) as response:
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


writer = 'phase10-sneakwrite-writer'

# The second tool uses the same server-owned tool profile path. A caller cannot
# replace its configured destination with an arbitrary URL.
code, override = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'sneakwrite',
    'launch_url': 'https://example.com/override',
})
assert code == 422 and override['code'] == 'LAUNCH_URL_OVERRIDE_FORBIDDEN', (code, override)

# Phase 10 does not create an ad-hoc credential path for SneakWrite. The
# production catalogue currently has no one-click authentication for this tool.
code, credential = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'sneakwrite',
    'password': 'phase10-must-never-reach-writer-runtime',
})
assert code == 422 and credential['code'] == 'WRITER_CREDENTIALS_FORBIDDEN', (code, credential)
assert 'phase10-must-never-reach-writer-runtime' not in json.dumps(credential), credential

# The committed SneakWrite profile is rewritten only inside the Phase 10 CI
# workspace to the deterministic same-container fixture. Runtime core code sees
# a normal profile and must create a normal isolated Chromium/viewer session.
code, created = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'sneakwrite',
})
assert code == 201, (code, created)
assert created['status'] == 'active', created
assert created['toolSlug'] == 'sneakwrite', created
assert created['writerId'] == writer, created
assert created['reused'] is False, created

token, payload, viewer_url = decode_grant(created['viewerGrant'])
assert payload['wid'] == writer, payload
status = viewer_status(viewer_url, token)
assert status['title'] == 'SNEAKWRITE_PHASE10_READY', status
assert status.get('authentication', {}).get('required') is False, status

# Same writer + same second-tool profile reuses the same isolated browser.
code, reused = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'sneakwrite',
})
assert code == 200, (code, reused)
assert reused['reused'] is True, reused
assert reused['sessionId'] == created['sessionId'], (created, reused)

# The ownership rule remains generic across tools: one writer cannot smuggle a
# second tool into the already-active browser.
code, cross_tool = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'generic-phase7-smoke',
})
assert code == 409 and cross_tool['code'] == 'WRITER_SESSION_ACTIVE', (code, cross_tool)

code, closed = signed('DELETE', f"/api/sessions/{created['sessionId']}", writer)
assert code == 200 and closed['status'] == 'closed', (code, closed)

# Prove the same provider still launches a different configured profile after
# SneakWrite, with no tool-specific runtime switch or process reset.
other_writer = 'phase10-generic-writer'
code, generic = signed('POST', '/api/sessions', other_writer, {
    'writer_id': other_writer,
    'tool_slug': 'generic-phase7-smoke',
})
assert code == 201, (code, generic)
generic_token, generic_payload, generic_viewer = decode_grant(generic['viewerGrant'])
assert generic_payload['wid'] == other_writer, generic_payload
generic_status = viewer_status(generic_viewer, generic_token)
assert generic_status['title'] == 'Phase 7 Generic Configured Tool', generic_status
code, generic_closed = signed('DELETE', f"/api/sessions/{generic['sessionId']}", other_writer)
assert code == 200 and generic_closed['status'] == 'closed', (code, generic_closed)

code, capacity = signed('GET', '/api/capacity', writer)
assert code == 200, (code, capacity)
assert capacity['workerActiveSessions'] == 0, capacity

print(json.dumps({
    'result': 'PASS',
    'phase': 10,
    'secondTool': 'sneakwrite',
    'secondToolViewerReached': True,
    'sameRuntimeHandlesMultipleProfiles': True,
    'launchOverrideRejected': True,
    'credentialSubmissionRejected': True,
    'sameWriterToolReusePreserved': True,
    'crossToolWriterIsolationPreserved': True,
    'coreToolSpecificBranchingRequired': False,
}))
