import assert from 'node:assert/strict';

const apiBase = 'http://127.0.0.1:18080';
const workerBase = 'http://127.0.0.1:18081';

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
assert.equal(apiHealth.phase, 3);
assert.equal(apiHealth.browser_core, 'generic');
assert.equal(apiHealth.viewer_layer, 'isolated');
assert.equal(workerHealth.status, 'ok');
assert.equal(workerHealth.service, 'browser-worker');
assert.equal(workerHealth.phase, 3);
assert.equal(workerHealth.browserCore, 'generic');
assert.equal(workerHealth.viewer.rawCdpExposed, false);
assert.equal(workerHealth.chromium.installed, true);

// Phase 2 regression: repeated Chromium start -> navigate -> stop.
for (let cycle = 1; cycle <= 3; cycle += 1) {
  const start = (await jsonFetch(`${workerBase}/browser/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: htmlData(`Lifecycle ${cycle}`) }),
  }, 201)).body;
  assert.equal(start.active, true);
  assert.equal(start.phase, 3);
  assert.equal(start.title, `Lifecycle ${cycle}`);
  assert.equal(start.viewerGrant.rawCdpExposed, false);
  assert.ok(Number.isInteger(start.pid) && start.pid > 1);

  const nav = (await jsonFetch(`${workerBase}/browser/navigate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: htmlData(`Navigate ${cycle}`) }),
  })).body;
  assert.equal(nav.title, `Navigate ${cycle}`);
  assert.equal(nav.readyState, 'complete');
  assert.equal(nav.control, 'cdp');

  const stop = (await jsonFetch(`${workerBase}/browser/stop`, { method: 'POST' })).body;
  assert.equal(stop.active, false);
  assert.equal(stop.cleanup.rootExited, true);
  assert.deepEqual(stop.cleanup.orphanPids, []);
  assert.deepEqual(stop.cleanup.zombiePids, []);
}

// Phase 3 secure viewer regression.
const interactiveHtml = `<!doctype html><html><head><title>Viewer Ready</title><style>html,body{margin:0}#name{position:absolute;left:40px;top:40px;width:300px;height:50px}#go{position:absolute;left:40px;top:120px;width:180px;height:50px}.spacer{height:2400px;padding-top:220px}</style></head><body><input id="name" onkeydown="if(event.key==='Enter'){document.title='Typed:'+this.value}"><button id="go" onclick="document.title='Clicked'">Click me</button><div class="spacer">scroll target</div><script>addEventListener('scroll',()=>{if(scrollY>100)document.title='Scrolled:'+Math.round(scrollY)})</script></body></html>`;
const start = (await jsonFetch(`${workerBase}/browser/start`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: `data:text/html,${encodeURIComponent(interactiveHtml)}` }),
}, 201)).body;
assert.equal(start.title, 'Viewer Ready');
assert.equal(start.viewer, 'restricted');
assert.equal(start.viewerGrant.rawCdpExposed, false);
assert.equal(start.viewerGrant.tokenTransport, 'url-fragment-to-bearer');
assert.ok(start.viewerGrant.url.startsWith(`/viewer/${start.sessionId}#`));
assert.ok(!JSON.stringify(start).includes('webSocketDebuggerUrl'));

const [viewerPath, encodedToken] = start.viewerGrant.url.split('#');
const token = decodeURIComponent(encodedToken);
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

assert.equal((await fetch(`${workerBase}/viewer/${start.sessionId}/frame`)).status, 401);
assert.equal((await fetch(`${workerBase}/viewer/${start.sessionId}/frame`, { headers: { authorization: 'Bearer forged.invalid' } })).status, 401);
const otherSession = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
assert.equal((await fetch(`${workerBase}/viewer/${otherSession}/frame`, { headers: auth })).status, 403);

const frame = await fetch(`${workerBase}/viewer/${start.sessionId}/frame`, { headers: auth });
assert.equal(frame.status, 200);
const frameBytes = new Uint8Array(await frame.arrayBuffer());
assert.ok(frameBytes.length > 2000);
assert.deepEqual([...frameBytes.slice(0, 3)], [255, 216, 255]);

for (const event of ['pressed', 'released']) {
  await jsonFetch(`${workerBase}/viewer/${start.sessionId}/input`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'mouse', event, button: 'left', x: 130, y: 145 }),
  });
}
let status = (await jsonFetch(`${workerBase}/viewer/${start.sessionId}/status`, { headers: auth })).body;
assert.equal(status.title, 'Clicked');

for (const event of ['pressed', 'released']) {
  await jsonFetch(`${workerBase}/viewer/${start.sessionId}/input`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'mouse', event, button: 'left', x: 180, y: 65 }),
  });
}
await jsonFetch(`${workerBase}/viewer/${start.sessionId}/input`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'text', text: 'hello-phase3' }),
});
const keyResult = (await jsonFetch(`${workerBase}/viewer/${start.sessionId}/input`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'key', key: 'Enter', code: 'Enter', modifiers: 0 }),
})).body;
assert.equal(keyResult.title, 'Typed:hello-phase3');

const scrollResult = (await jsonFetch(`${workerBase}/viewer/${start.sessionId}/input`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'scroll', x: 700, y: 450, deltaX: 0, deltaY: 800 }),
})).body;
assert.ok(scrollResult.title.startsWith('Scrolled:'));

for (let reconnect = 1; reconnect <= 3; reconnect += 1) {
  status = (await jsonFetch(`${workerBase}/viewer/${start.sessionId}/status`, { headers: auth })).body;
  assert.equal(status.sessionId, start.sessionId);
  assert.equal(status.pid, start.pid);
  const reconnectFrame = await fetch(`${workerBase}/viewer/${start.sessionId}/frame`, { headers: auth });
  assert.equal(reconnectFrame.status, 200);
}

const shellInput = await fetch(`${workerBase}/viewer/${start.sessionId}/input`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'shell', command: 'id' }),
});
assert.equal(shellInput.status, 400);

const finalStop = (await jsonFetch(`${workerBase}/browser/stop`, { method: 'POST' })).body;
assert.equal(finalStop.cleanup.rootExited, true);
assert.deepEqual(finalStop.cleanup.orphanPids, []);
assert.deepEqual(finalStop.cleanup.zombiePids, []);
assert.equal((await fetch(`${workerBase}/viewer/${start.sessionId}/frame`, { headers: auth })).status, 410);

const finalWorker = (await jsonFetch(`${workerBase}/health`)).body;
const finalBrowser = (await jsonFetch(`${workerBase}/browser/status`)).body;
assert.equal(finalWorker.status, 'ok');
assert.equal(finalWorker.viewer.rawCdpExposed, false);
assert.equal(finalBrowser.active, false);

console.log(JSON.stringify({ result: 'PASS', phase1: true, phase2Cycles: 3, phase3Viewer: true, sessionId: start.sessionId }));
