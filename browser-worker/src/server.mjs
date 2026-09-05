import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { buildHealthPayload } from './health.mjs';
import { BrowserSessionController, RUNTIME_PHASE } from './browser-session.mjs';
import { readBearerToken, resolveViewerSecret, verifyViewerToken } from './viewer-auth.mjs';
import { buildViewerHtml } from './viewer-page.mjs';

const port = Number(process.env.PORT || 8081);
const browserStateMaxBytes = Number(process.env.BROWSER_STATE_MAX_BYTES || 262144);
if (!Number.isInteger(browserStateMaxBytes) || browserStateMaxBytes < 4096 || browserStateMaxBytes > 1048576) throw new Error('BROWSER_STATE_MAX_BYTES must be an integer between 4096 and 1048576.');
const sessionCreateMaxBytes = browserStateMaxBytes + 65536;
const controller = new BrowserSessionController();
const viewerSecret = resolveViewerSecret();
const workerControlSecret = String(process.env.WORKER_CONTROL_SECRET || '');
if (Buffer.byteLength(workerControlSecret, 'utf8') < 32) throw new Error('WORKER_CONTROL_SECRET must contain at least 32 bytes.');

function commonHeaders(extra = {}) { return { 'cache-control': 'no-store, max-age=0', pragma: 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra }; }
function writeJson(response, statusCode, payload) { response.writeHead(statusCode, commonHeaders({ 'content-type': 'application/json; charset=utf-8' })); response.end(JSON.stringify(payload)); }
function writeViewerHtml(response, html, nonce) { response.writeHead(200, commonHeaders({ 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `default-src 'none'; img-src 'self' blob: data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`, 'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin', 'x-frame-options': 'DENY' })); response.end(html); }
async function readJson(request, maxBytes = 16 * 1024) { let body = ''; for await (const chunk of request) { body += String(chunk); if (Buffer.byteLength(body) > maxBytes) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 }); } if (!body.trim()) return {}; try { return JSON.parse(body); } catch { throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }); } }
function matchViewerRoute(pathname) { const match = pathname.match(/^\/viewer\/([0-9a-f-]{36})(?:\/(frame|status|input))?$/i); return match ? { sessionId: match[1], action: match[2] || 'shell' } : null; }
function matchBrowserSessionRoute(pathname) { const match = pathname.match(/^\/browser\/sessions\/([0-9a-f-]{36})(?:\/(navigate))?$/i); return match ? { sessionId: match[1], action: match[2] || 'status' } : null; }
function authorizeViewer(request, sessionId) { controller.assertSession(sessionId); verifyViewerToken(readBearerToken(request.headers.authorization), { sessionId, secret: viewerSecret }); }
function authorizeWorkerControl(request) {
  const supplied = String(request.headers['x-toprated-worker-secret'] || '');
  const left = Buffer.from(supplied, 'utf8');
  const right = Buffer.from(workerControlSecret, 'utf8');
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw Object.assign(new Error('Browser worker control authorization is required.'), { statusCode: 401 });
  }
}
function assertSessionCreateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Browser session request must be a JSON object.'), { statusCode: 400 });
  const allowed = new Set(['url', 'browserState', 'browserStatePolicy', 'authentication']);
  for (const key of Object.keys(body)) if (!allowed.has(key)) throw Object.assign(new Error('Browser session request contains unsupported fields.'), { statusCode: 422 });
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', 'http://browser-worker.local');
    if (request.method === 'GET' && requestUrl.pathname === '/health') return writeJson(response, 200, buildHealthPayload());

    if (requestUrl.pathname.startsWith('/browser/')) authorizeWorkerControl(request);

    // Session-scoped lifecycle API used by Laravel. Sensitive browser state is accepted only on this private, authenticated creation path and is never logged or returned.
    if (request.method === 'GET' && requestUrl.pathname === '/browser/sessions') return writeJson(response, 200, controller.listStatus());
    if (request.method === 'POST' && requestUrl.pathname === '/browser/sessions') {
      const body = await readJson(request, sessionCreateMaxBytes);
      assertSessionCreateBody(body);
      return writeJson(response, 201, await controller.start(body.url, {
        browserState: body.browserState,
        browserStatePolicy: body.browserStatePolicy,
        authentication: body.authentication,
      }));
    }
    const browserSessionRoute = matchBrowserSessionRoute(requestUrl.pathname);
    if (browserSessionRoute) {
      const { sessionId, action } = browserSessionRoute;
      if (request.method === 'GET' && action === 'status') return writeJson(response, 200, controller.getStatus(sessionId));
      if (request.method === 'POST' && action === 'navigate') {
        const body = await readJson(request);
        if (!body.url) throw Object.assign(new Error('url is required.'), { statusCode: 400 });
        return writeJson(response, 200, await controller.navigate(sessionId, body.url));
      }
      if (request.method === 'DELETE' && action === 'status') return writeJson(response, 200, await controller.stop(sessionId));
    }

    // Legacy single-session aliases preserve completed Phase 1-3 regression coverage.
    if (request.method === 'GET' && requestUrl.pathname === '/browser/status') return writeJson(response, 200, controller.status);
    if (request.method === 'POST' && requestUrl.pathname === '/browser/start') {
      const body = await readJson(request);
      return writeJson(response, 201, await controller.start(body.url));
    }
    if (request.method === 'POST' && requestUrl.pathname === '/browser/navigate') { const body = await readJson(request); if (!body.url) throw Object.assign(new Error('url is required.'), { statusCode: 400 }); return writeJson(response, 200, await controller.navigateOnly(body.url)); }
    if (request.method === 'POST' && requestUrl.pathname === '/browser/stop') return writeJson(response, 200, await controller.stopOnly());

    const viewerRoute = matchViewerRoute(requestUrl.pathname);
    if (viewerRoute) {
      const { sessionId, action } = viewerRoute;
      if (request.method === 'GET' && action === 'shell') { controller.assertSession(sessionId); const nonce = randomBytes(18).toString('base64'); return writeViewerHtml(response, buildViewerHtml({ sessionId, nonce }), nonce); }
      authorizeViewer(request, sessionId);
      if (request.method === 'GET' && action === 'status') return writeJson(response, 200, await controller.refreshMetadata(sessionId));
      if (request.method === 'GET' && action === 'frame') { const frame = await controller.captureFrame(sessionId); response.writeHead(200, commonHeaders({ 'content-type': 'image/jpeg', 'content-length': String(frame.length), 'cross-origin-resource-policy': 'same-origin' })); response.end(frame); return; }
      if (request.method === 'POST' && action === 'input') { const body = await readJson(request, 8 * 1024); return writeJson(response, 200, await controller.sendViewerInput(sessionId, body)); }
    }
    writeJson(response, 404, { status: 'not_found' });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    const safeCode = ['BROWSER_STATE_INVALID', 'AUTHENTICATION_POLICY_INVALID', 'AUTHENTICATION_NOT_VERIFIED'].includes(String(error?.code || '')) ? String(error.code) : null;
    writeJson(response, statusCode, { status: 'error', ...(safeCode ? { code: safeCode } : {}), message: statusCode >= 500 ? 'Browser worker operation failed.' : String(error.message || 'Request failed.'), ...(process.env.NODE_ENV === 'production' || statusCode < 500 ? {} : { detail: String(error.message || error) }) });
  }
});
server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'worker_started', port, phase: RUNTIME_PHASE, control: 'cdp', viewer: 'restricted', lifecycleOwner: 'laravel', viewerGrantIssuer: 'laravel', crashWatchdog: 'process-exit-cleanup', browserState: 'ephemeral-private-control-plane' })));
let shuttingDown = false;
async function shutdown(signal) { if (shuttingDown) return; shuttingDown = true; console.log(JSON.stringify({ event: 'worker_stopping', signal })); const forceTimer = setTimeout(() => process.exit(1), 12000); forceTimer.unref(); try { await controller.stopAll(); } catch (error) { console.error(JSON.stringify({ event: 'browser_cleanup_failed', message: String(error.message || error) })); } server.close(() => process.exit(0)); }
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
