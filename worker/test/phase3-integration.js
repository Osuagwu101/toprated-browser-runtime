import assert from 'node:assert/strict';
import WebSocket from 'ws';

const BASE = process.env.PHASE3_BASE_URL || 'http://127.0.0.1:18081';
const WS_BASE = BASE.replace(/^http/, 'ws');

function dataPage(html) {
  return `data:text/html,${encodeURIComponent(html)}`;
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function waitFor(check, message, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${message}${last instanceof Error ? `: ${last.message}` : ''}`);
}

function connectViewer(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/viewer/ws?token=${encodeURIComponent(token)}`);
    const timer = setTimeout(() => reject(new Error('viewer connect timeout')), 5000);
    let hello = null;
    let frame = false;
    const maybeDone = () => {
      if (hello && frame) {
        clearTimeout(timer);
        resolve({ ws, hello });
      }
    };
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        assert.ok(data.length > 100, 'viewer JPEG frame must contain data');
        frame = true;
        maybeDone();
        return;
      }
      const message = JSON.parse(String(data));
      if (message.type === 'hello') {
        hello = message;
        maybeDone();
      }
    });
    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function snapshotTitle() {
  const { response, body } = await jsonFetch('/browser/snapshot');
  if (!response.ok) return null;
  return body.title;
}

const interactivePage = dataPage(`<!doctype html>
<html><head><title>viewer-ready</title><style>
body{margin:0;font-family:sans-serif;height:3200px;background:#fff}
#clicker{position:absolute;left:80px;top:80px;width:240px;height:80px;font-size:20px}
#writer{position:absolute;left:80px;top:210px;width:360px;height:50px;font-size:20px}
</style></head><body>
<button id="clicker">Click me</button><input id="writer" />
<script>
clicker.addEventListener('click',()=>{document.title='clicked'});
writer.addEventListener('input',()=>{document.title='typed:'+writer.value});
addEventListener('scroll',()=>{document.title='scrolled:'+Math.round(scrollY)});
</script></body></html>`);

try {
  const health = await jsonFetch('/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.phase, 3);
  assert.equal(health.body.viewer, 'restricted_websocket');
  assert.equal(health.body.rawCdpExposed, false);

  const start = await jsonFetch('/browser/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: interactivePage }),
  });
  assert.equal(start.response.status, 201);
  assert.equal(start.body.active, true);
  assert.equal(start.body.phase, 3);
  assert.equal(start.body.viewer.transport, 'restricted_websocket');
  assert.equal(start.body.viewer.rawCdpExposed, false);
  assert.ok(start.body.viewer.token.length >= 32);
  const firstSession = start.body.sessionId;
  const token = start.body.viewer.token;

  const viewerResponse = await fetch(`${BASE}/viewer?token=${encodeURIComponent(token)}`);
  assert.equal(viewerResponse.status, 200);
  assert.match(viewerResponse.headers.get('content-security-policy') || '', /frame-ancestors 'self'/);
  assert.equal(viewerResponse.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(viewerResponse.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(viewerResponse.headers.get('cache-control'), 'no-store, private');
  const viewerSource = await viewerResponse.text();
  assert.doesNotMatch(viewerSource.toLowerCase(), /devtools|remote-debugging|docker|terminal/);

  const badViewer = await fetch(`${BASE}/viewer?token=definitely-invalid`);
  assert.equal(badViewer.status, 401);

  await new Promise((resolve, reject) => {
    const badWs = new WebSocket(`${WS_BASE}/viewer/ws?token=definitely-invalid`);
    const timer = setTimeout(() => reject(new Error('invalid websocket token was not rejected')), 4000);
    badWs.on('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      assert.equal(response.statusCode, 401);
      response.resume();
      resolve();
    });
    badWs.on('open', () => {
      clearTimeout(timer);
      reject(new Error('invalid websocket token unexpectedly connected'));
    });
    badWs.on('error', () => {});
  });

  let connected = await connectViewer(token);
  assert.equal(connected.hello.sessionId, firstSession);
  assert.deepEqual(connected.hello.viewport, { width: 1280, height: 720 });

  connected.ws.send(JSON.stringify({ type: 'mouse', action: 'move', x: 160, y: 120 }));
  connected.ws.send(JSON.stringify({ type: 'mouse', action: 'down', x: 160, y: 120, button: 0 }));
  connected.ws.send(JSON.stringify({ type: 'mouse', action: 'up', x: 160, y: 120, button: 0 }));
  await waitFor(async () => (await snapshotTitle()) === 'clicked', 'mouse click was not delivered');

  connected.ws.send(JSON.stringify({ type: 'mouse', action: 'down', x: 160, y: 235, button: 0 }));
  connected.ws.send(JSON.stringify({ type: 'mouse', action: 'up', x: 160, y: 235, button: 0 }));
  connected.ws.send(JSON.stringify({ type: 'text', text: 'hello' }));
  await waitFor(async () => (await snapshotTitle()) === 'typed:hello', 'keyboard/text input was not delivered');

  connected.ws.send(JSON.stringify({ type: 'wheel', deltaX: 0, deltaY: 900 }));
  await waitFor(async () => String(await snapshotTitle()).startsWith('scrolled:'), 'scroll input was not delivered');

  connected.ws.close();
  await new Promise((resolve) => setTimeout(resolve, 200));
  connected = await connectViewer(token);
  assert.equal(connected.hello.sessionId, firstSession);

  const reconnectedPage = dataPage('<!doctype html><title>reconnected-ok</title><h1>Reconnect OK</h1>');
  connected.ws.send(JSON.stringify({ type: 'navigate', url: reconnectedPage }));
  await waitFor(async () => (await snapshotTitle()) === 'reconnected-ok', 'navigation after reconnect failed');
  connected.ws.close();

  for (const forbidden of ['/json/version', '/json/list', '/devtools/browser/test']) {
    const response = await fetch(`${BASE}${forbidden}`);
    assert.equal(response.status, 404, `${forbidden} must not expose Chromium/CDP`);
  }

  const stopped = await jsonFetch('/browser/stop', { method: 'POST' });
  assert.equal(stopped.response.status, 200);
  assert.equal(stopped.body.active, false);
  assert.equal(stopped.body.cleanup.clean, true);

  const second = await jsonFetch('/browser/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: dataPage('<!doctype html><title>second-session</title>') }),
  });
  assert.equal(second.response.status, 201);
  assert.notEqual(second.body.sessionId, firstSession);
  const oldTokenAgainstNewSession = await fetch(`${BASE}/viewer?token=${encodeURIComponent(token)}`);
  assert.equal(oldTokenAgainstNewSession.status, 401);

  const finalStop = await jsonFetch('/browser/stop', { method: 'POST' });
  assert.equal(finalStop.body.cleanup.clean, true);

  console.log('PHASE3_VIEWER_E2E=PASS');
  console.log('mouse=PASS keyboard_text=PASS scroll=PASS reconnect=PASS navigation=PASS');
  console.log('invalid_token=PASS session_binding=PASS raw_cdp_exposure=NONE cleanup=PASS');
} catch (error) {
  try { await jsonFetch('/browser/stop', { method: 'POST' }); } catch {}
  console.error(error);
  process.exit(1);
}
