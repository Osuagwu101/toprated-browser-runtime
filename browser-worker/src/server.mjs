import http from 'node:http';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { buildHealthPayload } from './health.mjs';
import { BrowserSessionController, RUNTIME_PHASE } from './browser-session.mjs';
import { InteractiveAuthWorkerClient } from './interactive-auth-client.mjs';
import { checkAuthentication, normalizeAuthenticationPolicy } from './browser-state.mjs';
import { readBearerToken, resolveViewerSecret, verifyViewerToken } from './viewer-auth.mjs';
import { FixedWindowRateLimiter, enforceRateLimit, normalizeRateLimit } from './rate-limit.mjs';
import { assertAllowedFields, assertNoQuery, readJson } from './request-security.mjs';
import { SessionPolicyStore } from './session-policy-store.mjs';
import { buildViewerHtml } from './viewer-page.mjs';
import { buildNativeHandoffHtml } from './native-page.mjs';
import { NativeSessionCookieStore } from './native-cookie-store.mjs';
import { buildViewerSecurityHeaders } from './viewer-security.mjs';
import { ViewerReconnectTicketStore } from './viewer-reconnect.mjs';
import { acceptWebSocketUpgrade, createWebSocketPeer, parseViewerProtocols } from './viewer-websocket.mjs';

const port = Number(process.env.PORT || 8081);
const browserStateMaxBytes = Number(process.env.BROWSER_STATE_MAX_BYTES || 262144);
if (!Number.isInteger(browserStateMaxBytes) || browserStateMaxBytes < 4096 || browserStateMaxBytes > 1048576) throw new Error('BROWSER_STATE_MAX_BYTES must be an integer between 4096 and 1048576.');
const sessionCreateMaxBytes = browserStateMaxBytes + 65536;
const controller = new BrowserSessionController();
const interactiveAuth = new InteractiveAuthWorkerClient();
const finalizingInteractiveSessions = new Map();
const viewerSecret = resolveViewerSecret();
const workerControlSecret = String(process.env.WORKER_CONTROL_SECRET || '');
if (Buffer.byteLength(workerControlSecret, 'utf8') < 32) throw new Error('WORKER_CONTROL_SECRET must contain at least 32 bytes.');
const sessionAuthenticationPolicies = new SessionPolicyStore({ maxEntries: controller.maxSessions });
const workerControlRateLimiter = new FixedWindowRateLimiter({
  limit: normalizeRateLimit(process.env.WORKER_CONTROL_RATE_LIMIT_PER_MINUTE, 'WORKER_CONTROL_RATE_LIMIT_PER_MINUTE', 600),
  maxBuckets: 1024,
});
const viewerRateLimit = normalizeRateLimit(process.env.VIEWER_RATE_LIMIT_PER_MINUTE, 'VIEWER_RATE_LIMIT_PER_MINUTE', 1200);
const viewerClientRateLimiter = new FixedWindowRateLimiter({
  limit: Math.min(100000, viewerRateLimit * controller.maxSessions),
  maxBuckets: 4096,
});
const viewerSessionRateLimiter = new FixedWindowRateLimiter({ limit: viewerRateLimit, maxBuckets: 4096 });
const viewerReconnectTickets = new ViewerReconnectTicketStore({ maxEntries: Math.max(16, controller.maxSessions * 4) });
const consumedViewerBootstraps = new Map();
const nativeCookies = new NativeSessionCookieStore({ maxEntries: Math.max(32, controller.maxSessions * 4) });
const noVncRoot = resolve(process.env.NOVNC_ROOT || '/usr/share/novnc');

let sessionCreatesInFlight = 0;
let sessionCreatesSettled = Promise.resolve();
let releaseSessionCreates = null;

function beginSessionCreate() {
  if (sessionCreatesInFlight === 0) {
    sessionCreatesSettled = new Promise((resolve) => { releaseSessionCreates = resolve; });
  }
  sessionCreatesInFlight += 1;
}
function endSessionCreate() {
  sessionCreatesInFlight = Math.max(0, sessionCreatesInFlight - 1);
  if (sessionCreatesInFlight === 0 && releaseSessionCreates) {
    const release = releaseSessionCreates;
    releaseSessionCreates = null;
    release();
  }
}
async function waitForSessionCreatesToSettle() {
  while (sessionCreatesInFlight > 0) await sessionCreatesSettled;
}
function pruneSessionAuthenticationPolicies() {
  sessionAuthenticationPolicies.reconcile(controller.listStatus().sessions.map((session) => session.sessionId));
}
const policyPruneTimer = setInterval(pruneSessionAuthenticationPolicies, 60000);
policyPruneTimer.unref();

function commonHeaders(extra = {}) { return { 'cache-control': 'no-store, max-age=0', pragma: 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra }; }
function writeJson(response, statusCode, payload, extraHeaders = {}) { response.writeHead(statusCode, commonHeaders({ 'content-type': 'application/json; charset=utf-8', ...extraHeaders })); response.end(JSON.stringify(payload)); }
function writeViewerHtml(response, html, nonce) { response.writeHead(200, commonHeaders({ 'content-type': 'text/html; charset=utf-8', ...buildViewerSecurityHeaders(nonce) })); response.end(html); }
function matchViewerRoute(pathname) { const match = pathname.match(/^\/viewer\/([0-9a-f-]{36})(?:\/(frame|status|input|stream))?$/i); return match ? { sessionId: match[1], action: match[2] || 'shell' } : null; }
function matchNativeRoute(pathname) { const match = pathname.match(/^\/native\/([0-9a-f-]{36})(?:\/(authorize|stream|assets\/(.+)))?$/i); return match ? { sessionId: match[1], action: match[2] === 'authorize' ? 'authorize' : match[2] === 'stream' ? 'stream' : match[3] ? 'asset' : 'shell', asset: match[3] || '' } : null; }
function matchBrowserSessionRoute(pathname) { const match = pathname.match(/^\/browser\/sessions\/([0-9a-f-]{36})(?:\/(navigate|authorized-state|verify-authentication|finalize-authentication))?$/i); return match ? { sessionId: match[1], action: match[2] || 'status' } : null; }
function authorizeViewer(request, sessionId) { verifyViewerToken(readBearerToken(request.headers.authorization), { sessionId, secret: viewerSecret }); }
function readCookie(request, name) { return String(request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
function nativeCookieName() { return 'trst_native'; }
function nativeCookieHeader(sessionId, value) { return `${nativeCookieName()}=${value}; Path=/native/${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Strict; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}Max-Age=3600`; }
function assertNativeCookie(request, sessionId) { if (!nativeCookies.verify(sessionId, readCookie(request, nativeCookieName()))) throw Object.assign(new Error('Native handoff authorization is required.'), { statusCode: 401 }); }
async function writeNativeAsset(response, asset) {
  const candidate = resolve(noVncRoot, asset);
  if (!candidate.startsWith(noVncRoot + sep)) throw Object.assign(new Error('Native asset was not found.'), { statusCode: 404 });
  const body = await readFile(candidate).catch(() => null);
  if (!body) throw Object.assign(new Error('Native asset was not found.'), { statusCode: 404 });
  const contentType = asset.endsWith('.js') ? 'text/javascript; charset=utf-8' : asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
  response.writeHead(200, commonHeaders({ 'content-type': contentType, 'cross-origin-resource-policy': 'same-origin' })); response.end(body);
}
function consumeViewerBootstrap(token, sessionId) {
  const payload = verifyViewerToken(token, { sessionId, secret: viewerSecret });
  const now = Math.floor(Date.now() / 1000);
  for (const [jti, exp] of consumedViewerBootstraps.entries()) if (Number(exp) <= now) consumedViewerBootstraps.delete(jti);
  const jti = String(payload?.jti || '');
  if (!jti || consumedViewerBootstraps.has(jti)) throw Object.assign(new Error('Viewer bootstrap token was already used.'), { statusCode: 401 });
  consumedViewerBootstraps.set(jti, Number(payload.exp || now));
  return payload;
}
function authorizeViewerUpgrade(request, sessionId) {
  const protocols = parseViewerProtocols(request.headers['sec-websocket-protocol']);
  const bootstrap = protocols.find((value) => value.startsWith('trst-bootstrap.'));
  if (bootstrap) {
    consumeViewerBootstrap(bootstrap.slice('trst-bootstrap.'.length), sessionId);
    return { protocol: bootstrap, reconnectTicket: viewerReconnectTickets.issue(sessionId), mode: 'bootstrap' };
  }
  const reconnect = protocols.find((value) => value.startsWith('trst-ticket.'));
  if (reconnect) {
    const rotated = viewerReconnectTickets.rotate(sessionId, reconnect.slice('trst-ticket.'.length));
    if (!rotated) throw Object.assign(new Error('Viewer reconnect ticket is invalid.'), { statusCode: 401 });
    return { protocol: reconnect, reconnectTicket: rotated, mode: 'reconnect' };
  }
  throw Object.assign(new Error('Viewer WebSocket authorization is required.'), { statusCode: 401 });
}
function authorizeWorkerControl(request) {
  const supplied = String(request.headers['x-toprated-worker-secret'] || '');
  const left = Buffer.from(supplied, 'utf8');
  const right = Buffer.from(workerControlSecret, 'utf8');
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw Object.assign(new Error('Browser worker control authorization is required.'), { statusCode: 401 });
  }
}
function assertPersistentProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Persistent profile is invalid.'), { statusCode: 422, code: 'PROFILE_IDENTITY_INVALID' });
  const fields = Object.keys(value);
  if (fields.length !== 2 || !fields.includes('toolSlug') || !fields.includes('accountScope')) throw Object.assign(new Error('Persistent profile is invalid.'), { statusCode: 422, code: 'PROFILE_IDENTITY_INVALID' });
  const toolSlug = String(value.toolSlug || '').trim();
  const accountScope = String(value.accountScope || '').trim();
  if (!/^[A-Za-z0-9._-]{1,191}$/.test(toolSlug) || !(accountScope === 'legacy' || /^[0-9a-f-]{36}$/i.test(accountScope))) throw Object.assign(new Error('Persistent profile is invalid.'), { statusCode: 422, code: 'PROFILE_IDENTITY_INVALID' });
  return { toolSlug, accountScope };
}
function assertSessionCreateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Browser session request must be a JSON object.'), { statusCode: 400 });
  assertAllowedFields(body, ['url', 'browserState', 'browserStatePolicy', 'authentication', 'persistentProfile', 'nativeTransport'], 'Browser session request contains unsupported fields.');
}
async function refreshLiveToolAuthentication(sessionId) {
  if (!controller.has(sessionId)) return { required: false, verified: false };
  const session = controller.assertSession(sessionId);
  const policy = sessionAuthenticationPolicies.get(sessionId);
  if (!policy || policy.required !== true) return { required: false, verified: true };
  const authentication = await checkAuthentication(session.cdp, policy);
  session.authenticationRequired = authentication.required === true;
  session.authenticationVerified = authentication.verified === true;
  return authentication;
}
async function assertViewerToolAuthentication(sessionId) {
  const authentication = await refreshLiveToolAuthentication(sessionId);
  if (authentication.required === true && authentication.verified !== true) {
    throw Object.assign(
      new Error('This tool is temporarily unavailable while an administrator refreshes authentication.'),
      { statusCode: 423, code: 'TOOL_REAUTH_REQUIRED' },
    );
  }
}
function finalizingStatus(sessionId) {
  const item = finalizingInteractiveSessions.get(sessionId);
  if (!item) return null;
  return {
    active: true,
    sessionId,
    pid: null,
    url: item.launchUrl,
    title: 'Validating administrator authentication',
    viewport: { width: 1440, height: 900 },
    viewer: 'restricted',
    displayMode: 'profile-validation',
    browser: 'google-chrome-stable',
    automationAttached: true,
    authentication: { required: true, verified: false },
  };
}

async function interactiveStatusOrNull(sessionId) {
  try {
    return await interactiveAuth.status(sessionId);
  } catch (error) {
    if ([404, 410].includes(Number(error?.statusCode || 0))) return null;
    throw error;
  }
}

async function stopSession(sessionId) {
  sessionAuthenticationPolicies.delete(sessionId);
  viewerReconnectTickets.revoke(sessionId);
  if (controller.has(sessionId)) return controller.stop(sessionId);
  if (finalizingInteractiveSessions.has(sessionId)) {
    throw Object.assign(new Error('Administrator authentication is being validated.'), { statusCode: 409 });
  }
  return interactiveAuth.stop(sessionId);
}
async function sessionStatus(sessionId) {
  if (controller.has(sessionId)) {
    await refreshLiveToolAuthentication(sessionId);
    return controller.getStatus(sessionId);
  }
  const finalizing = finalizingStatus(sessionId);
  if (finalizing) return finalizing;
  const interactive = await interactiveStatusOrNull(sessionId);
  if (interactive) return interactive;
  throw Object.assign(new Error('Browser session is closed.'), { statusCode: 410 });
}
async function sessionFrame(sessionId) {
  if (controller.has(sessionId)) return controller.captureFrame(sessionId);
  if (finalizingInteractiveSessions.has(sessionId)) {
    throw Object.assign(new Error('Administrator authentication is being validated.'), { statusCode: 409 });
  }
  return interactiveAuth.frame(sessionId);
}
async function sessionInput(sessionId, body, includeMetadata = true) {
  if (controller.has(sessionId)) return controller.sendViewerInput(sessionId, body, { includeMetadata });
  if (finalizingInteractiveSessions.has(sessionId)) {
    throw Object.assign(new Error('Administrator authentication is being validated.'), { statusCode: 409 });
  }
  return interactiveAuth.input(sessionId, body);
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', 'http://browser-worker.local');
    if (request.method === 'GET' && requestUrl.pathname === '/health') return writeJson(response, 200, buildHealthPayload());

    pruneSessionAuthenticationPolicies();
    const clientAddress = String(request.socket.remoteAddress || 'unknown');
    const viewerRoute = matchViewerRoute(requestUrl.pathname);
    const nativeRoute = matchNativeRoute(requestUrl.pathname);
    if (requestUrl.pathname.startsWith('/browser/')) {
      assertNoQuery(requestUrl);
      enforceRateLimit(workerControlRateLimiter, clientAddress);
      authorizeWorkerControl(request);
    }
    if (viewerRoute) {
      assertNoQuery(requestUrl);
      enforceRateLimit(viewerClientRateLimiter, clientAddress);
      enforceRateLimit(viewerSessionRateLimiter, `${clientAddress}:${viewerRoute.sessionId}`);
    }
    if (nativeRoute) {
      if (requestUrl.search) throw Object.assign(new Error('Native handoff query parameters are not allowed.'), { statusCode: 400 });
      enforceRateLimit(viewerClientRateLimiter, clientAddress);
      enforceRateLimit(viewerSessionRateLimiter, `${clientAddress}:${nativeRoute.sessionId}`);
    }

    // Session-scoped lifecycle API used by Laravel. Sensitive browser state is accepted only on this private, authenticated creation path and is never logged or returned.
    if (request.method === 'GET' && requestUrl.pathname === '/browser/sessions') {
      await waitForSessionCreatesToSettle();
      const automated = controller.listStatus();
      let interactive = { activeCount: 0, startingCount: 0, sessions: [] };
      try {
        interactive = await interactiveAuth.sessions();
      } catch (error) {
        console.error(JSON.stringify({
          event: 'interactive_auth_worker_unavailable',
          code: String(error?.code || 'INTERACTIVE_AUTH_WORKER_UNAVAILABLE'),
        }));
      }
      const finalizing = [...finalizingInteractiveSessions.keys()].map((sessionId) => finalizingStatus(sessionId));
      return writeJson(response, 200, {
        ...automated,
        activeCount: automated.activeCount + Number(interactive.activeCount || 0) + finalizing.length,
        startingCount: automated.startingCount + Number(interactive.startingCount || 0),
        sessions: [...automated.sessions, ...(interactive.sessions || []), ...finalizing],
      });
    }
    if (request.method === 'POST' && requestUrl.pathname === '/browser/interactive-auth-sessions') {
      const body = await readJson(request, 64 * 1024);
      assertAllowedFields(body, ['url', 'toolSlug', 'accountScope']);
      if (!body.url || !body.toolSlug || !body.accountScope) throw Object.assign(new Error('url, toolSlug and accountScope are required.'), { statusCode: 400 });
      beginSessionCreate();
      try {
        return writeJson(response, 201, await interactiveAuth.start(body.url, assertPersistentProfile({ toolSlug: body.toolSlug, accountScope: body.accountScope })));
      } finally {
        endSessionCreate();
      }
    }
    if (request.method === 'POST' && requestUrl.pathname === '/browser/sessions') {
      const body = await readJson(request, sessionCreateMaxBytes);
      assertSessionCreateBody(body);
      const authenticationPolicy = normalizeAuthenticationPolicy(body.authentication || {});
      const persistentProfile = body.persistentProfile ? assertPersistentProfile(body.persistentProfile) : null;
      beginSessionCreate();
      try {
        const created = await controller.start(body.url, {
          browserState: body.browserState,
          browserStatePolicy: body.browserStatePolicy,
          authentication: authenticationPolicy,
          nativeTransport: body.nativeTransport === true,
          ...(persistentProfile ? {
            persistentProfile: {
              root: process.env.ACCOUNT_BROWSER_PROFILE_ROOT || process.env.AUTH_BROWSER_PROFILE_ROOT || '/srv/account-browser-profiles',
              ...persistentProfile,
            },
            executablePath: process.env.GOOGLE_CHROME_EXECUTABLE || '/usr/bin/google-chrome-stable',
          } : {}),
        });
        sessionAuthenticationPolicies.set(created.sessionId, authenticationPolicy);
        writeJson(response, 201, created);
        return;
      } finally {
        endSessionCreate();
      }
    }
    const browserSessionRoute = matchBrowserSessionRoute(requestUrl.pathname);
    if (browserSessionRoute) {
      const { sessionId, action } = browserSessionRoute;
      if (request.method === 'GET' && action === 'status') {
        return writeJson(response, 200, await sessionStatus(sessionId));
      }
      if (request.method === 'GET' && action === 'authorized-state') {
        if (!controller.has(sessionId)) throw Object.assign(new Error('Interactive authentication must be finalized before browser state is exported.'), { statusCode: 409 });
        return writeJson(response, 200, await controller.exportAuthorizedState(sessionId));
      }
      if (request.method === 'POST' && action === 'verify-authentication') {
        if (!controller.has(sessionId)) throw Object.assign(new Error('Interactive authentication is verified only during finalization.'), { statusCode: 409 });
        const body = await readJson(request, 64 * 1024);
        assertAllowedFields(body, ['authentication']);
        const authenticationPolicy = normalizeAuthenticationPolicy(body.authentication || {});
        return writeJson(response, 200, await controller.verifyAuthentication(sessionId, authenticationPolicy));
      }
      if (request.method === 'POST' && action === 'finalize-authentication') {
        if (controller.has(sessionId) || finalizingInteractiveSessions.has(sessionId)) {
          throw Object.assign(new Error('This browser session is not available for interactive authentication finalization.'), { statusCode: 409 });
        }
        const body = await readJson(request, 64 * 1024);
        assertAllowedFields(body, ['authentication', 'browserStatePolicy', 'launchUrl']);
        const authenticationPolicy = normalizeAuthenticationPolicy(body.authentication || {});
        if (!body.launchUrl) throw Object.assign(new Error('launchUrl is required.'), { statusCode: 400 });

        const validationPolicy = {
          required: false,
          allowedHosts: Array.isArray(body.browserStatePolicy?.allowedHosts)
            ? body.browserStatePolicy.allowedHosts
            : [],
        };
        finalizingInteractiveSessions.set(sessionId, { launchUrl: body.launchUrl });
        try {
          const finalized = await interactiveAuth.finalize(sessionId, {
            authentication: authenticationPolicy,
            browserStatePolicy: validationPolicy,
            launchUrl: body.launchUrl,
          });
          if (finalized?.authentication?.required !== true || finalized?.authentication?.verified !== true) {
            throw Object.assign(new Error('Authenticated profile did not pass fresh-browser validation.'), {
              statusCode: 409,
              code: 'AUTHENTICATION_NOT_VERIFIED',
            });
          }
          return writeJson(response, 200, finalized);
        } finally {
          finalizingInteractiveSessions.delete(sessionId);
        }
      }
      if (request.method === 'POST' && action === 'navigate') {
        const body = await readJson(request);
        assertAllowedFields(body, ['url']);
        if (!body.url) throw Object.assign(new Error('url is required.'), { statusCode: 400 });
        return writeJson(response, 200, await controller.navigate(sessionId, body.url));
      }
      if (request.method === 'DELETE' && action === 'status') return writeJson(response, 200, await stopSession(sessionId));
    }

    // Legacy single-session aliases preserve completed Phase 1-3 regression coverage.
    if (request.method === 'GET' && requestUrl.pathname === '/browser/status') return writeJson(response, 200, controller.status);
    if (request.method === 'POST' && requestUrl.pathname === '/browser/start') {
      const body = await readJson(request);
      assertAllowedFields(body, ['url']);
      beginSessionCreate();
      try {
        const created = await controller.start(body.url);
        writeJson(response, 201, created);
        return;
      } finally {
        endSessionCreate();
      }
    }
    if (request.method === 'POST' && requestUrl.pathname === '/browser/navigate') { const body = await readJson(request); assertAllowedFields(body, ['url']); if (!body.url) throw Object.assign(new Error('url is required.'), { statusCode: 400 }); return writeJson(response, 200, await controller.navigateOnly(body.url)); }
    if (request.method === 'POST' && requestUrl.pathname === '/browser/stop') return writeJson(response, 200, await controller.stopOnly());

    if (viewerRoute) {
      const { sessionId, action } = viewerRoute;
      if (request.method === 'GET' && action === 'shell') { await sessionStatus(sessionId); const nonce = randomBytes(18).toString('base64'); return writeViewerHtml(response, buildViewerHtml({ sessionId, nonce }), nonce); }
      authorizeViewer(request, sessionId);
      await assertViewerToolAuthentication(sessionId);
      if (request.method === 'GET' && action === 'status') return writeJson(response, 200, await sessionStatus(sessionId));
      if (request.method === 'GET' && action === 'frame') { const frame = await sessionFrame(sessionId); response.writeHead(200, commonHeaders({ 'content-type': 'image/jpeg', 'content-length': String(frame.length), 'cross-origin-resource-policy': 'same-origin' })); response.end(frame); return; }
      if (request.method === 'POST' && action === 'input') { const body = await readJson(request, 8 * 1024); return writeJson(response, 200, await sessionInput(sessionId, body)); }
    }
    if (nativeRoute) {
      const { sessionId, action, asset } = nativeRoute;
      if (request.method === 'GET' && action === 'shell') {
        await sessionStatus(sessionId);
        const nonce = randomBytes(18).toString('base64');
        return writeViewerHtml(response, buildNativeHandoffHtml({ sessionId, nonce }), nonce);
      }
      if (request.method === 'GET' && action === 'asset') return writeNativeAsset(response, asset);
      if (request.method === 'POST' && action === 'authorize') {
        authorizeViewer(request, sessionId);
        await assertViewerToolAuthentication(sessionId);
        const cookie = nativeCookies.issue(sessionId);
        response.writeHead(204, commonHeaders({ 'set-cookie': nativeCookieHeader(sessionId, cookie) })); response.end(); return;
      }
    }
    writeJson(response, 404, { status: 'not_found' });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    const safeCode = ['BROWSER_STATE_INVALID', 'AUTHENTICATION_POLICY_INVALID', 'AUTHENTICATION_NOT_VERIFIED', 'TOOL_REAUTH_REQUIRED', 'INTERACTIVE_AUTH_LAUNCH_FAILED', 'BROWSER_LAUNCH_FAILED', 'BROWSER_NAVIGATION_FAILED', 'BROWSER_NAVIGATION_TIMEOUT', 'ACCOUNT_PROFILE_IN_USE', 'PROFILE_IDENTITY_INVALID', 'RATE_LIMITED', 'REQUEST_QUERY_FORBIDDEN', 'REQUEST_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE', 'MALFORMED_JSON', 'MALFORMED_REQUEST', 'UNSUPPORTED_REQUEST_FIELDS'].includes(String(error?.code || '')) ? String(error.code) : null;
    const extraHeaders = statusCode === 429 && error?.retryAfterSeconds ? { 'retry-after': String(error.retryAfterSeconds) } : {};
    writeJson(response, statusCode, { status: 'error', ...(safeCode ? { code: safeCode } : {}), message: statusCode >= 500 ? 'Browser worker operation failed.' : String(error.message || 'Request failed.'), ...(process.env.NODE_ENV === 'production' || statusCode < 500 ? {} : { detail: String(error.message || error) }) }, extraHeaders);
  }
});


server.on('upgrade', async (request, socket) => {
  let peer = null;
  let stopStream = null;
  let heartbeat = null;
  try {
    const requestUrl = new URL(request.url || '/', 'http://browser-worker.local');
    const nativeRoute = matchNativeRoute(requestUrl.pathname);
    if (nativeRoute?.action === 'stream') {
      if (requestUrl.search) throw Object.assign(new Error('Native handoff query parameters are not allowed.'), { statusCode: 400 });
      const clientAddress = String(request.socket.remoteAddress || 'unknown');
      enforceRateLimit(viewerClientRateLimiter, clientAddress);
      enforceRateLimit(viewerSessionRateLimiter, `${clientAddress}:${nativeRoute.sessionId}`);
      assertNativeCookie(request, nativeRoute.sessionId);
      await sessionStatus(nativeRoute.sessionId);
      await assertViewerToolAuthentication(nativeRoute.sessionId);
      const vncPort = controller.nativeVncPort(nativeRoute.sessionId);
      acceptWebSocketUpgrade(request, socket, '');
      peer = createWebSocketPeer(socket, { maxMessageBytes: 2 * 1024 * 1024 });
      const vnc = net.connect({ host: '127.0.0.1', port: vncPort });
      vnc.on('data', (data) => { if (!peer.closed) peer.sendBinary(data); });
      vnc.on('error', () => { if (!peer.closed) peer.close(1011, 'Native browser connection failed.'); });
      vnc.on('close', () => { if (!peer.closed) peer.close(1001, 'Native browser connection closed.'); });
      peer.on('message', (opcode, payload) => { if (opcode === 0x2 && !vnc.destroyed) vnc.write(payload); });
      peer.on('close', () => { try { vnc.end(); } catch {} });
      return;
    }
    const route = matchViewerRoute(requestUrl.pathname);
    if (!route || route.action !== 'stream') throw Object.assign(new Error('Viewer WebSocket route was not found.'), { statusCode: 404 });
    assertNoQuery(requestUrl);
    const clientAddress = String(request.socket.remoteAddress || 'unknown');
    enforceRateLimit(viewerClientRateLimiter, clientAddress);
    enforceRateLimit(viewerSessionRateLimiter, `${clientAddress}:${route.sessionId}`);
    await sessionStatus(route.sessionId);
    await assertViewerToolAuthentication(route.sessionId);
    const authorization = authorizeViewerUpgrade(request, route.sessionId);
    acceptWebSocketUpgrade(request, socket, authorization.protocol);
    peer = createWebSocketPeer(socket, { maxMessageBytes: 16 * 1024 });
    let lastPong = Date.now();
    let inputQueue = Promise.resolve();
    peer.on('pong', () => { lastPong = Date.now(); });
    const initialStatus = await sessionStatus(route.sessionId);
    peer.sendJson({ type: 'ready', sessionId: route.sessionId, reconnectTicket: authorization.reconnectTicket, viewport: initialStatus.viewport, displayMode: initialStatus.displayMode });

    peer.on('message', (opcode, payload) => {
      if (opcode !== 0x1 || peer.closed) return;
      inputQueue = inputQueue.then(async () => {
        const message = JSON.parse(payload.toString('utf8'));
        if (message?.type === 'input') {
          await sessionInput(route.sessionId, message.input, false);
          return;
        }
        if (message?.type === 'viewport' && controller.has(route.sessionId)) {
          const viewport = await controller.resizeViewerViewport(route.sessionId, message.width, message.height);
          peer.sendJson({ type: 'viewport', viewport });
        }
      }).catch((error) => {
        if (!peer.closed) peer.sendJson({ type: 'error', code: String(error?.code || 'VIEWER_INPUT_FAILED'), message: Number(error?.statusCode || 500) >= 500 ? 'Viewer operation failed.' : String(error?.message || 'Viewer operation failed.') });
        if ([401, 403, 410, 423].includes(Number(error?.statusCode || 0))) peer.close(1008, 'Viewer authorization ended.');
      });
    });

    if (controller.has(route.sessionId)) {
      stopStream = await controller.openViewerStream(route.sessionId, (frame) => { if (!peer.closed) peer.sendBinary(frame); });
    } else {
      let active = true;
      stopStream = async () => { active = false; };
      void (async () => {
        while (active && !peer.closed) {
          try {
            await assertViewerToolAuthentication(route.sessionId);
            const frame = await sessionFrame(route.sessionId);
            if (!peer.closed) peer.sendBinary(frame);
          } catch (error) {
            if ([404, 410].includes(Number(error?.statusCode || 0))) viewerReconnectTickets.revoke(route.sessionId);
            if (!peer.closed) peer.sendJson({ type: 'error', code: String(error?.code || 'VIEWER_STREAM_FAILED'), message: Number(error?.statusCode || 500) >= 500 ? 'Viewer stream failed.' : String(error?.message || 'Viewer stream failed.') });
            if ([401, 403, 410, 423].includes(Number(error?.statusCode || 0))) { peer.close(1008, 'Viewer session ended.'); break; }
          }
          await new Promise((resolve) => setTimeout(resolve, 75));
        }
      })();
    }

    heartbeat = setInterval(() => {
      if (peer.closed) return;
      if (Date.now() - lastPong > 45000) { peer.close(1001, 'Viewer heartbeat timed out.'); return; }
      void assertViewerToolAuthentication(route.sessionId).then(() => peer.ping()).catch((error) => {
        if (!peer.closed) peer.sendJson({ type: 'error', code: String(error?.code || 'VIEWER_AUTH_CHECK_FAILED'), message: Number(error?.statusCode || 500) >= 500 ? 'Viewer authentication check failed.' : String(error?.message || 'Viewer authentication check failed.') });
        peer.close(1008, 'Viewer authorization ended.');
      });
    }, 15000);
    heartbeat.unref?.();
    peer.on('close', () => { if (heartbeat) clearInterval(heartbeat); if (stopStream) void stopStream(); });
  } catch (error) {
    if (heartbeat) clearInterval(heartbeat);
    if (stopStream) { try { await stopStream(); } catch {} }
    if (peer && !peer.closed) peer.close(1008, 'Viewer connection rejected.');
    else {
      const status = Number(error?.statusCode || 500);
      const reason = status === 404 ? 'Not Found' : status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : status === 429 ? 'Too Many Requests' : 'Bad Request';
      try { socket.write(`HTTP/1.1 ${status >= 400 && status < 600 ? status : 400} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch {}
      try { socket.destroy(); } catch {}
    }
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'worker_started', port, phase: RUNTIME_PHASE, control: 'cdp', viewer: 'restricted', lifecycleOwner: 'laravel', viewerGrantIssuer: 'laravel', crashWatchdog: 'process-exit-cleanup', browserState: 'ephemeral-private-control-plane' }));
  controller.scheduleWarmRefill();
});
let shuttingDown = false;
async function shutdown(signal) { if (shuttingDown) return; shuttingDown = true; clearInterval(policyPruneTimer); console.log(JSON.stringify({ event: 'worker_stopping', signal })); const forceTimer = setTimeout(() => process.exit(1), 12000); forceTimer.unref(); try { await controller.stopAll(); sessionAuthenticationPolicies.clear(); } catch (error) { console.error(JSON.stringify({ event: 'browser_cleanup_failed', message: String(error.message || error) })); } server.close(() => process.exit(0)); }
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
