#!/usr/bin/env python3
"""Collect reproducible Phase 12 sizing evidence without claiming production capacity."""

import argparse
import concurrent.futures
import hashlib
import hmac
import json
import os
import platform
import re
import secrets
import statistics
import subprocess
import time
from pathlib import Path
from urllib import error, parse, request

API = os.environ.get('API_BASE', 'http://127.0.0.1:18080')
SERVICE_SECRET = os.environ['RUNTIME_SERVICE_AUTH_SECRET'].encode()
TOOL = os.environ.get('PHASE12_TOOL_SLUG', 'generic-phase12-performance')


def percentile(values, fraction):
    ordered = sorted(values)
    if not ordered:
        return None
    return round(ordered[min(len(ordered) - 1, int((len(ordered) - 1) * fraction))], 2)


def summary(values):
    return {
        'count': len(values),
        'minMs': round(min(values), 2),
        'p50Ms': percentile(values, .50),
        'p95Ms': percentile(values, .95),
        'maxMs': round(max(values), 2),
    }


def timed_http(req, timeout=60, expect_json=True):
    started = time.perf_counter()
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            payload = json.loads(raw or b'{}') if expect_json else raw
            return response.status, payload, (time.perf_counter() - started) * 1000
    except error.HTTPError as exc:
        raw = exc.read()
        payload = json.loads(raw or b'{}') if expect_json else raw
        return exc.code, payload, (time.perf_counter() - started) * 1000


def service(method, path, writer, obj=None):
    body = b'' if obj is None else json.dumps(obj, separators=(',', ':')).encode()
    timestamp = int(time.time())
    nonce = secrets.token_urlsafe(18)
    canonical = '\n'.join([
        method.upper(), path, str(timestamp), nonce, writer,
        hashlib.sha256(body).hexdigest(),
    ]).encode()
    signature = hmac.new(SERVICE_SECRET, canonical, hashlib.sha256).hexdigest()
    headers = {
        'accept': 'application/json',
        'x-toprated-timestamp': str(timestamp),
        'x-toprated-nonce': nonce,
        'x-toprated-signature': signature,
        'x-toprated-writer-id': writer,
    }
    if obj is not None:
        headers['content-type'] = 'application/json'
    req = request.Request(API + path, data=(body if obj is not None else None), headers=headers, method=method.upper())
    return timed_http(req)


def grant_parts(grant):
    parts = parse.urlsplit(grant['url'])
    return parse.urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, '')), parse.unquote(parts.fragment)


def viewer(method, url, token, obj=None, expect_json=True):
    body = None if obj is None else json.dumps(obj, separators=(',', ':')).encode()
    headers = {'authorization': 'Bearer ' + token}
    if body is not None:
        headers['content-type'] = 'application/json'
    return timed_http(request.Request(url, data=body, headers=headers, method=method), expect_json=expect_json)


def parse_bytes(value):
    match = re.fullmatch(r'([0-9.]+)\s*([A-Za-z]+)', value.strip())
    if match is None:
        raise ValueError(f'unrecognized docker memory value: {value!r}')
    number, unit = match.groups()
    multipliers = {'B': 1, 'kB': 1000, 'KiB': 1024, 'MB': 1000**2, 'MiB': 1024**2, 'GB': 1000**3, 'GiB': 1024**3}
    return int(float(number) * multipliers[unit])


def docker_stats():
    command = ['docker', 'stats', '--no-stream', '--format', '{{json .}}']
    for service_name in ('api', 'browser-worker'):
        container_id = subprocess.check_output(['docker', 'compose', 'ps', '-q', service_name], text=True).strip()
        if not container_id:
            raise RuntimeError(f'{service_name} container is unavailable')
        command.append(container_id)
    rows = {}
    for line in subprocess.check_output(command, text=True).splitlines():
        item = json.loads(line)
        used = item['MemUsage'].split('/', 1)[0].strip()
        rows[item['Name']] = {
            'cpuPercent': float(item['CPUPerc'].rstrip('%')),
            'memoryBytes': parse_bytes(used),
            'pids': int(item['PIDs']),
        }
    return rows


def residue():
    script = """const fs=require('node:fs');const chromium=[];for(const p of fs.readdirSync('/proc')){if(!/^\\d+$/.test(p))continue;try{if(fs.readFileSync('/proc/'+p+'/comm','utf8').trim()==='chromium')chromium.push(Number(p))}catch{}}const profiles=fs.readdirSync('/tmp').filter(n=>n.startsWith('toprated-browser-'));console.log(JSON.stringify({chromium,profiles}));"""
    worker = json.loads(subprocess.check_output(['docker', 'compose', 'exec', '-T', 'browser-worker', 'node', '-e', script], text=True))
    api = subprocess.check_output([
        'docker', 'compose', 'exec', '-T', 'api', 'php', '-r',
        '$db=new PDO("sqlite:/srv/runtime-api/storage/data/database.sqlite");echo $db->query("select count(*) from browser_sessions where status in (\'starting\',\'active\',\'closing\')")->fetchColumn();'
    ], text=True).strip()
    return {'chromiumPids': worker['chromium'], 'profiles': worker['profiles'], 'openDatabaseSessions': int(api)}


def start_one(level, repeat, index):
    writer = f'phase12-l{level}-r{repeat}-w{index}'
    code, payload, elapsed = service('POST', '/api/sessions', writer, {'writer_id': writer, 'tool_slug': TOOL})
    if code != 201 or payload.get('status') != 'active':
        raise AssertionError((code, payload))
    viewer_url, token = grant_parts(payload['viewerGrant'])
    return {'writer': writer, 'sessionId': payload['sessionId'], 'viewerUrl': viewer_url, 'token': token, 'startupMs': elapsed}


def exercise(session):
    results = {'statusMs': [], 'frameMs': [], 'inputMs': [], 'frameBytes': []}
    for cycle in range(3):
        code, payload, elapsed = viewer('GET', session['viewerUrl'] + '/status', session['token'])
        if code != 200 or payload.get('active') is not True:
            raise AssertionError((code, payload))
        results['statusMs'].append(elapsed)
        code, frame, elapsed = viewer('GET', session['viewerUrl'] + '/frame', session['token'], expect_json=False)
        if code != 200 or len(frame) < 1000:
            raise AssertionError((code, len(frame)))
        results['frameMs'].append(elapsed)
        results['frameBytes'].append(len(frame))
        code, payload, elapsed = viewer('POST', session['viewerUrl'] + '/input', session['token'], {
            'type': 'scroll', 'x': 500, 'y': 400, 'deltaX': 0, 'deltaY': 120 + cycle,
        })
        if code != 200 or payload.get('inputAccepted') is not True:
            raise AssertionError((code, payload))
        results['inputMs'].append(elapsed)
    return results


def close_one(session):
    code, payload, elapsed = service('DELETE', f"/api/sessions/{session['sessionId']}", session['writer'])
    if code != 200 or payload.get('status') != 'closed':
        raise AssertionError((code, payload))
    return elapsed


def run_level(level, repeat):
    batch_started = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=level) as pool:
        sessions = list(pool.map(lambda i: start_one(level, repeat, i), range(level)))
    batch_start_ms = (time.perf_counter() - batch_started) * 1000
    active_stats = [docker_stats()]
    with concurrent.futures.ThreadPoolExecutor(max_workers=level) as pool:
        exercised = list(pool.map(exercise, sessions))
    active_stats.append(docker_stats())
    cleanup_started = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=level) as pool:
        close_ms = list(pool.map(close_one, sessions))
    cleanup_batch_ms = (time.perf_counter() - cleanup_started) * 1000
    clean = residue()
    if clean['chromiumPids'] or clean['profiles'] or clean['openDatabaseSessions']:
        raise AssertionError({'cleanupResidue': clean})
    return {
        'level': level,
        'repeat': repeat,
        'batchStartupMs': round(batch_start_ms, 2),
        'startup': summary([s['startupMs'] for s in sessions]),
        'status': summary([v for result in exercised for v in result['statusMs']]),
        'frame': summary([v for result in exercised for v in result['frameMs']]),
        'input': summary([v for result in exercised for v in result['inputMs']]),
        'frameBytesMedian': int(statistics.median(v for result in exercised for v in result['frameBytes'])),
        'cleanupBatchMs': round(cleanup_batch_ms, 2),
        'cleanupRequest': summary(close_ms),
        'resourceSamples': active_stats,
        'cleanupResidue': clean,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--levels', default='1,3,5')
    parser.add_argument('--repeats', type=int, default=2)
    parser.add_argument('--output', default='artifacts/phase12-performance.json')
    args = parser.parse_args()
    levels = [int(value) for value in args.levels.split(',')]
    if not levels or min(levels) < 1 or max(levels) > 15 or args.repeats < 2:
        raise SystemExit('levels must be 1..15 and repeats must be at least 2')
    capacity_code, capacity, _ = service('GET', '/api/capacity', 'phase12-capacity-probe')
    if capacity_code != 200 or capacity.get('effectiveMaxSessions', 0) < max(levels):
        raise AssertionError((capacity_code, capacity))
    evidence = {
        'schemaVersion': 1,
        'phase': 12,
        'result': 'PASS',
        'scope': 'reproducible-ci-sizing-baseline',
        'capacityClaim': 'none-phase18-required',
        'environment': {
            'os': platform.platform(),
            'architecture': platform.machine(),
            'logicalCpuCount': os.cpu_count(),
            'memoryTotalBytes': int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemTotal:'))) * 1024,
            'dockerVersion': subprocess.check_output(['docker', 'version', '--format', '{{.Server.Version}}'], text=True).strip(),
        },
        'configuredMaxSessions': capacity['effectiveMaxSessions'],
        'baselineResources': docker_stats(),
        'runs': [],
    }
    for level in levels:
        for repeat in range(1, args.repeats + 1):
            print(f'phase12 level={level} repeat={repeat}/{args.repeats}', flush=True)
            evidence['runs'].append(run_level(level, repeat))
    evidence['finalResidue'] = residue()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps({'result': 'PASS', 'phase': 12, 'levels': levels, 'repeats': args.repeats, 'artifact': str(output)}))


if __name__ == '__main__':
    main()
