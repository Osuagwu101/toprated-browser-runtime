import json
import os
import time
from urllib import error, request

WORKER = os.environ.get('WORKER_BASE', 'http://127.0.0.1:18081')
WORKER_SECRET = os.environ['WORKER_CONTROL_SECRET']


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
        raise AssertionError((exc.code, expected, payload)) from exc


def wait_absent(session_id, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        sessions = worker_json('GET', '/browser/sessions')['sessions']
        if all(item['sessionId'] != session_id for item in sessions):
            return
        time.sleep(0.1)
    raise AssertionError(f'orphan worker session was not reaped: {session_id}')


for index in range(12):
    created = worker_json(
        'POST',
        '/browser/sessions',
        {'url': f'data:text/html,%3Ctitle%3Erace-{index}%3C/title%3E'},
        expected=201,
    )
    session_id = created['sessionId']
    assert created['active'] is True, created
    wait_absent(session_id)
    print(f'orphan_create_reap_iteration={index + 1}/12 status=pass')

print('phase6_orphan_create_reaper_race=pass')
