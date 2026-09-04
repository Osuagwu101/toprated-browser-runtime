import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';

const apiBase = 'http://127.0.0.1:18080';
const workerBase = 'http://127.0.0.1:18081';
const workerControlSecret = process.env.WORKER_CONTROL_SECRET || '';
const viewerSecret = process.env.VIEWER_SIGNING_SECRET || '';
const controlHeaders = { 'x-toprated-worker-secret': workerControlSecret };

async function jsonFetch(url, options = {}, expected = 200) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  assert.equal(response.status, expected, `${url} expected ${expected}, got ${response.status}: ${text}`);
  return { response, body };
}

function htmlData(title, body = '<h1>safe</h1>') {
  return `data:text/html,${encodeURIComponent(`<!doctype html><title>${title}</title>${body}`)}`;
}

function testViewerToken(sessionId, ttlSeconds = 300) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { v: 1, sid: sessionId, iat: now, exp: now + ttlSeconds, jti: randomBytes(12).toString('base64url') };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', viewerSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const api = await fetch(`${apiBase}/api/health`);
    const worker = await fetch(`${workerBase}/health`);
    if (api.ok && worker.ok) break;
  } catch {}
  if (attempt === 39) throw new Error('Runtime health endpoints did not become ready.');
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

const apiHealth = (await jsonFetch(`${apiBase}/api/health`)).body;
const workerHealth = (await jsonFetch(`${workerBase}/health`)).body;
assert.equal(apiHealth.status, 'ok');
assert.equal(apiHealth.service, 'control-plane');
assert.equal(apiHealth.phase, 5);
assert.equal(apiHealth.browser_core, 'generic');
assert.equal(workerHealth.status, 'ok');
assert.equal(workerHealth.service, 'browser-worker');
assert.equal(workerHealth.phase, 5);
assert.equal(workerHealth.lifecycleOwner, 'laravel');
assert.equal(workerHealth.browserCore, 'generic');
assert.equal(workerHealth.viewer.grantIssuer, 'laravel');
assert.equal(workerHealth.viewer.rawCdpExposed, false);
assert.equal(workerHealth.chromium.installed, true);
assert.equal((await fetch(`${workerBase}/browser/status`)).status, 401);

// Phase 2 regression: legacy aliases still prove repeated Chromium start/control/stop when only one browser is active.
for (let cycle = 1; cycle <= 3; cycle += 1) {
  const start = (await jsonFetch(`${workerBase}/browser/start`, {
    method: 'POST', headers: { ...controlHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ url: htmlData(`Lifecycle ${cycle}`) }),
  }, 201)).body;
  assert.equal(start.active, true);
  assert.equal(start.phase, 5);
  assert.equal(start.title, `Lifecycle ${cycle}`);
  assert.equal('viewerGrant' in start, false);
  assert.ok(Number.isInteger(start.pid) && start.pid > 1);

  const nav = (await jsonFetch(`${workerBase}/browser/navigate`, {
    method: 'POST', headers: { ...controlHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ url: htmlData(`Navigate ${cycle}`) }),
  })).body;
  assert.equal(nav.title, `Navigate ${cycle}`);
  assert.equal(nav.readyState, 'complete');
  assert.equal(nav.control, 'cdp');

  const stop = (await jsonFetch(`${workerBase}/browser/stop`, { method: 'POST', headers: controlHeaders })).body;
  assert.equal(stop.active, false);
  assert.equal(stop.cleanup.rootExited, true);
  assert.deepEqual(stop.cleanup.orphanPids, []);
  assert.deepEqual(stop.cleanup.zombiePids, []);
}

// Phase 3 secure-viewer regression remains session-bound and CDP stays private.
const interactiveHtml = `<!doctype html><html><head><title>Viewer Ready</title><style>html,body{margin:0}#name{position:absolute;left:40px;top:40px;width:300px;height:50px}#go{position:absolute;left:40px;top:120px;width:180px;height:50px}.spacer{height:2400px;padding-top:220px}</style></head><body><input id="name" onkeydown="if(event.key==='Enter'){document.title='Typed:'+this.value}"><button id="go" onclick="document.title='Clicked'">Click me</button><div class="spacer">scroll target</div><script>addEventListener('scroll',()=>{if(scrollY>100)document.title='Scrolled:'+Math.round(scrollY)})</script></body></html>`;
const start = (await jsonFetch(`${workerBase}/browser/start`, {
  method: 'POST', headers: { ...controlHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ url: `data:text/html,${encodeURIComponent(interactiveHtml)}` }),
}, 201)).body;
assert.equal(start.title, 'Viewer Ready');
assert.equal(start.viewer, 'restricted');
assert.equal('viewerGrant' in start, false);

const token = testViewerToken(start.sessionId);
const viewerPath = `/viewer/${start.sessionId}`;
const auth = { authorization: `Bearer ${token}` };
const shell = await fetch(`${workerBase}${viewerPath}`);
assert.equal(shell.status, 200);
const shellHtml = await shell.text();
assert.equal(shell.headers.get('cache-control')?.includes('no-store'), true);
assert.equal(shell.headers.get('referrer-policy'), 'no-referrer');
assert.equal(shell.headers.get('x-frame-options'), 'DENY');
assert.ok(shell.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
assert.equal(shell.headers.has('access-control-allow-origin'), false);
assert.equal(shellHtml.includes(token), false);
assert.equal(shellHtml.includes('location.hash'), true);
assert.equal(shellHtml.includes('sessionStorage'), true);
assert.equal(shellHtml.toLowerCase().includes('websocketdebuggerurl'), false);

assert.equal((await fetch(`${workerBase}${viewerPath}/frame`)).status, 401);
assert.equal((await fetch(`${workerBase}${viewerPath}/frame`, { headers: { authorization: 'Bearer forged.invalid' } })).status, 401);
const otherSession = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
assert.equal((await fetch(`${workerBase}/viewer/${otherSession}/frame`, { headers: auth })).status, 410);

const frame = await fetch(`${workerBase}${viewerPath}/frame`, { headers: auth });
assert.equal(frame.status, 200);
const frameBytes = new Uint8Array(await frame.arrayBuffer());
assert.ok(frameBytes.length > 2000);
assert.deepEqual([...frameBytes.slice(0, 3)], [255, 216, 255]);

for (const event of ['pressed', 'released']) {
  await jsonFetch(`${workerBase}${viewerPath}/input`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'mouse', event, button: 'left', x: 130, y: 145 }),
  });
}
let status = (await jsonFetch(`${workerBase}${viewerPath}/status`, { headers: auth })).body;
assert.equal(status.title, 'Clicked');

for (const event of ['pressed', 'released']) {
  await jsonFetch(`${workerBase}${viewerPath}/input`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'mouse', event, button: 'left', x: 180, y: 65 }),
  });
}
await jsonFetch(`${workerBase}${viewerPath}/input`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'text', text: 'hello-phase3' }),
});
const keyResult = (await jsonFetch(`${workerBase}${viewerPath}/input`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'key', key: 'Enter', code: 'Enter', modifiers: 0 }),
})).body;
assert.equal(keyResult.title, 'Typed:hello-phase3');

const scrollResult = (await jsonFetch(`${workerBase}${viewerPath}/input`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'scroll', x: 700, y: 450, deltaX: 0, deltaY: 800 }),
})).body;
assert.ok(scrollResult.title.startsWith('Scrolled:'));

const shellInput = await fetch(`${workerBase}${viewerPath}/input`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'shell', command: 'id' }),
});
assert.equal(shellInput.status, 400);

const finalStop = (await jsonFetch(`${workerBase}/browser/stop`, { method: 'POST', headers: controlHeaders })).body;
assert.equal(finalStop.cleanup.rootExited, true);
assert.deepEqual(finalStop.cleanup.orphanPids, []);
assert.deepEqual(finalStop.cleanup.zombiePids, []);
assert.equal((await fetch(`${workerBase}${viewerPath}/frame`, { headers: auth })).status, 410);

const finalWorker = (await jsonFetch(`${workerBase}/health`)).body;
const finalBrowser = (await jsonFetch(`${workerBase}/browser/status`, { headers: controlHeaders })).body;
assert.equal(finalWorker.status, 'ok');
assert.equal(finalWorker.phase, 5);
assert.equal(finalWorker.lifecycleOwner, 'laravel');
assert.equal(finalWorker.viewer.grantIssuer, 'laravel');
assert.equal(finalWorker.viewer.rawCdpExposed, false);
assert.equal(finalBrowser.active, false);

console.log(JSON.stringify({ result: 'PASS', phase1: true, phase2Cycles: 3, phase3Viewer: true, currentPhase: 5, sessionId: start.sessionId }));
