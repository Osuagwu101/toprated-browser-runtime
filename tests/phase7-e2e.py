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
        with request.urlopen(req, timeout=25) as response:
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


writer = 'phase7-writer'

# Unknown profiles never create a browser.
code, missing = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'does-not-exist',
})
assert code == 404 and missing['code'] == 'TOOL_PROFILE_NOT_FOUND', (code, missing)

# Disabled profiles are explicit configuration, not launchable runtime targets.
code, disabled = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'generic-disabled',
})
assert code == 409 and disabled['code'] == 'TOOL_PROFILE_DISABLED', (code, disabled)

# A caller cannot replace a configured profile destination.
code, override = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'generic-phase7-smoke',
    'launch_url': 'https://example.com/override',
})
assert code == 422 and override['code'] == 'LAUNCH_URL_OVERRIDE_FORBIDDEN', (code, override)

# The configured generic profile launches without a caller-supplied URL.
code, created = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'generic-phase7-smoke',
})
assert code == 201, (code, created)
assert created['status'] == 'active', created
assert created['toolSlug'] == 'generic-phase7-smoke', created
assert created['writerId'] == writer, created
assert created['reused'] is False, created

token, payload, viewer_url = decode_grant(created['viewerGrant'])
assert payload['wid'] == writer, payload
status = viewer_status(viewer_url, token)
assert status['title'] == 'Phase 7 Generic Configured Tool', status

# Same writer/profile reuses the same live browser even when launch_url is omitted.
code, reused = signed('POST', '/api/sessions', writer, {
    'writer_id': writer,
    'tool_slug': 'generic-phase7-smoke',
})
assert code == 200, (code, reused)
assert reused['reused'] is True, reused
assert reused['sessionId'] == created['sessionId'], (created, reused)

code, closed = signed('DELETE', f"/api/sessions/{created['sessionId']}", writer)
assert code == 200 and closed['status'] == 'closed', (code, closed)

print(json.dumps({
    'result': 'PASS',
    'phase': 7,
    'configuredGenericLaunch': True,
    'unknownProfileRejected': True,
    'disabledProfileRejected': True,
    'launchOverrideRejected': True,
    'coreToolSpecificBranchingRequired': False,
}))
