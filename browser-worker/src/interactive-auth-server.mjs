import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { InteractiveAuthBrowserManager } from './interactive-auth-browser.mjs';
import { BrowserSessionController } from './browser-session.mjs';
import { normalizeAuthenticationPolicy } from './browser-state.mjs';
import { assertAllowedFields, assertNoQuery, readJson } from './request-security.mjs';

const port = Number(process.env.PORT || 8082);
const controlSecret = String(process.env.WORKER_CONTROL_SECRET || '');
if (Buffer.byteLength(controlSecret, 'utf8') < 32) {
  throw new Error('WORKER_CONTROL_SECRET must contain at least 32 bytes.');
}

const manager = new InteractiveAuthBrowserManager();
const validationController = new BrowserSessionController({
  executablePath: process.env.GOOGLE_CHROME_EXECUTABLE || '/usr/bin/google-chrome-stable',
  maxSessions: 1,
  displayMode: 'headless',
});

function headers(extra = {}) {
  return {
    'cache-control': 'no-store, max-age=0',
    pragma: 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extra,
  };
}

function writeJson(response, status, payload) {
  response.writeHead(status, headers({ 'content-type': 'application/json; charset=utf-8' }));
  response.end(JSON.stringify(payload));
}

function authorize(request) {
  const supplied = String(request.headers['x-toprated-worker-secret'] || '');
  const left = Buffer.from(supplied, 'utf8');
  const right = Buffer.from(controlSecret, 'utf8');
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw Object.assign(new Error('Interactive auth worker authorization is required.'), { statusCode: 401 });
  }
}

function matchSession(pathname) {
  const match = pathname.match(/^\/internal\/sessions\/([0-9a-f-]{36})(?:\/(frame|input|prepare|finalize))?$/i);
  return match ? { sessionId: match[1], action: match[2] || 'status' } : null;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://interactive-auth-worker.local');
    if (request.method === 'GET' && url.pathname === '/health') {
      return writeJson(response, 200, {
        status: 'ok',
        service: 'interactive-auth-worker',
        browser: 'google-chrome-stable',
        automationAttachedDuringAuth: false,
      });
    }

    assertNoQuery(url);
    authorize(request);

    if (request.method === 'GET' && url.pathname === '/internal/sessions') {
      return writeJson(response, 200, manager.listStatus());
    }
    if (request.method === 'POST' && url.pathname === '/internal/sessions') {
      const body = await readJson(request, 64 * 1024);
      assertAllowedFields(body, ['url', 'toolSlug', 'accountScope']);
      if (!body.url || !body.toolSlug || !body.accountScope) throw Object.assign(new Error('url, toolSlug and accountScope are required.'), { statusCode: 400 });
      return writeJson(response, 201, await manager.start(body.url, body));
    }

    const sessionRoute = matchSession(url.pathname);
    if (sessionRoute) {
      const { sessionId, action } = sessionRoute;
      if (request.method === 'GET' && action === 'status') {
        return writeJson(response, 200, manager.status(sessionId));
      }
      if (request.method === 'GET' && action === 'frame') {
        const frame = await manager.frame(sessionId);
        response.writeHead(200, headers({
          'content-type': 'image/jpeg',
          'content-length': String(frame.length),
        }));
        response.end(frame);
        return;
      }
      if (request.method === 'POST' && action === 'input') {
        const body = await readJson(request, 8 * 1024);
        return writeJson(response, 200, await manager.input(sessionId, body));
      }
      if (request.method === 'POST' && action === 'prepare') {
        const body = await readJson(request, 1024);
        assertAllowedFields(body, []);
        return writeJson(response, 200, await manager.prepareForValidation(sessionId));
      }
      if (request.method === 'POST' && action === 'finalize') {
        const body = await readJson(request, 128 * 1024);
        assertAllowedFields(body, ['authentication', 'browserStatePolicy', 'launchUrl']);
        if (!body.launchUrl) throw Object.assign(new Error('launchUrl is required.'), { statusCode: 400 });

        const authenticationPolicy = normalizeAuthenticationPolicy(body.authentication || {});
        const configuredHosts = Array.isArray(body.browserStatePolicy?.allowedHosts)
          ? body.browserStatePolicy.allowedHosts
          : [];
        const prepared = await manager.prepareForValidation(sessionId);
        let validationSessionId = null;
        let finalized = null;
        try {
          // Reopen the human-authenticated profile in a fresh validation
          // process, but do not restore Chrome's prior tab/session graph.
          // Validation should be deterministic: start cleanly, navigate to the
          // configured tool launch URL, verify the authenticated state there,
          // and then retain that same durable profile for writer sessions.
          const validated = await validationController.start(body.launchUrl, {
            persistentProfile: {
              root: process.env.ACCOUNT_BROWSER_PROFILE_ROOT || process.env.AUTH_BROWSER_PROFILE_ROOT || '/srv/account-browser-profiles',
              toolSlug: prepared?.profile?.toolSlug,
              accountScope: prepared?.profile?.accountScope,
            },
            executablePath: process.env.GOOGLE_CHROME_EXECUTABLE || '/usr/bin/google-chrome-stable',
            restoreLastSession: false,
            passwordStore: 'basic',
            browserStatePolicy: {
              required: false,
              allowedHosts: configuredHosts,
            },
            authentication: authenticationPolicy,
          });
          validationSessionId = validated.sessionId;
          if (validated?.authentication?.required !== true || validated?.authentication?.verified !== true) {
            throw Object.assign(new Error('Authenticated profile did not pass fresh-browser validation.'), {
              statusCode: 409,
              code: 'AUTHENTICATION_NOT_VERIFIED',
            });
          }
          console.log(JSON.stringify({
            event: 'interactive_auth_validated',
            sessionId,
            browser: 'google-chrome-stable',
            browserVersion: prepared?.browserVersion || 'unknown',
            validationLocation: 'interactive-auth-worker',
          }));
          finalized = {
            authentication: validated.authentication,
            profileValidation: {
              verified: true,
              persistent: true,
              browser: 'google-chrome-stable',
              browserVersion: prepared?.browserVersion || 'unknown',
              validationLocation: 'interactive-auth-worker',
            },
          };
        } finally {
          if (validationSessionId) {
            try {
              const stopped = await validationController.stop(validationSessionId);
              console.log(JSON.stringify({
                event: 'interactive_auth_validation_closed',
                sessionId,
                cleanup: {
                  rootExited: stopped?.cleanup?.rootExited === true,
                  orphanCount: Array.isArray(stopped?.cleanup?.orphanPids) ? stopped.cleanup.orphanPids.length : -1,
                  zombieCount: Array.isArray(stopped?.cleanup?.zombiePids) ? stopped.cleanup.zombiePids.length : -1,
                },
              }));
            } catch {
              console.error(JSON.stringify({ event: 'interactive_auth_validation_close_failed', sessionId }));
            }
          }
        }
        // Do not acknowledge administrator approval until the temporary
        // validation Chrome has fully shut down. Otherwise a writer can race
        // its still-held account-profile lease immediately after this HTTP
        // response is received.
        return writeJson(response, 200, finalized);
      }
      if (request.method === 'DELETE' && action === 'status') {
        return writeJson(response, 200, await manager.stop(sessionId));
      }
    }

    return writeJson(response, 404, { status: 'not_found' });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    const safeCode = [
      'INTERACTIVE_AUTH_LAUNCH_FAILED',
      'AUTHENTICATION_NOT_VERIFIED',
      'AUTHENTICATION_POLICY_INVALID',
      'BROWSER_STATE_INVALID',
      'BROWSER_LAUNCH_FAILED',
      'BROWSER_NAVIGATION_FAILED',
      'BROWSER_NAVIGATION_TIMEOUT',
      'RATE_LIMITED',
      'REQUEST_QUERY_FORBIDDEN',
      'REQUEST_TOO_LARGE',
      'UNSUPPORTED_MEDIA_TYPE',
      'MALFORMED_JSON',
      'MALFORMED_REQUEST',
      'UNSUPPORTED_REQUEST_FIELDS',
    ].includes(String(error?.code || '')) ? String(error.code) : null;

    return writeJson(response, statusCode, {
      status: 'error',
      ...(safeCode ? { code: safeCode } : {}),
      message: statusCode >= 500 ? 'Interactive authentication worker operation failed.' : String(error?.message || 'Request failed.'),
    });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({
    event: 'interactive_auth_worker_started',
    port,
    browser: 'google-chrome-stable',
    automationAttachedDuringAuth: false,
  }));
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ event: 'interactive_auth_worker_stopping', signal }));
  const force = setTimeout(() => process.exit(1), 12000);
  force.unref();
  try { await validationController.stopAll(); } catch {}
  try { await manager.stopAll(); } catch {}
  server.close(() => process.exit(0));
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
