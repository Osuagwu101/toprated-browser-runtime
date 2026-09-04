import http from 'node:http';
import express from 'express';
import { healthSnapshot } from './runtime.js';
import { BrowserController } from './browser.js';
import { ViewerTokenManager } from './viewer-auth.js';
import { ViewerHub } from './viewer.js';
import { viewerHtml } from './viewer-page.js';

const app = express();
const port = Number(process.env.PORT || 8081);
const controller = new BrowserController();
const tokenManager = new ViewerTokenManager();
const viewerHub = new ViewerHub({ controller, tokenManager });

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => {
  const snapshot = healthSnapshot();
  res.status(snapshot.chromium.available ? 200 : 503).json(snapshot);
});

app.get('/browser/status', (_req, res) => {
  res.status(200).json(controller.status());
});

app.get('/browser/snapshot', async (_req, res, next) => {
  try {
    res.status(200).json(await controller.snapshot());
  } catch (error) {
    next(error);
  }
});

function viewerResult(req, session) {
  const minted = tokenManager.mint(session.sessionId);
  const viewerUrl = `${req.protocol}://${req.get('host')}/viewer?token=${encodeURIComponent(minted.token)}`;
  return {
    ...session,
    viewer: {
      url: viewerUrl,
      token: minted.token,
      expiresAt: minted.expiresAt,
      transport: 'restricted_websocket',
      rawCdpExposed: false,
    },
  };
}

app.post('/browser/start', async (req, res, next) => {
  try {
    const session = await controller.start(req.body?.url);
    res.status(201).json(viewerResult(req, session));
  } catch (error) {
    next(error);
  }
});

app.post('/browser/viewer-token', async (req, res, next) => {
  try {
    const session = await controller.snapshot();
    res.status(201).json(viewerResult(req, session).viewer);
  } catch (error) {
    next(error);
  }
});

app.post('/browser/navigate', async (req, res, next) => {
  try {
    if (!req.body?.url) return res.status(400).json({ error: 'url_required' });
    res.status(200).json(await controller.navigate(req.body.url));
  } catch (error) {
    next(error);
  }
});

app.post('/browser/stop', async (_req, res, next) => {
  try {
    const sessionId = controller.current?.sessionId || null;
    if (sessionId) {
      viewerHub.closeSession(sessionId);
      tokenManager.revokeSession(sessionId);
    }
    res.status(200).json(await controller.stop());
  } catch (error) {
    next(error);
  }
});

app.get('/viewer', (req, res) => {
  const current = controller.current;
  if (!current) return res.status(409).json({ error: 'browser_not_active' });
  const auth = tokenManager.verify(req.query?.token, current.sessionId);
  if (!auth.valid) return res.status(401).json({ error: auth.reason });

  res.set({
    'Cache-Control': 'no-store, private',
    'Pragma': 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self' ws: wss:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
  });
  res.type('html').status(200).send(viewerHtml());
});

app.use((error, _req, res, _next) => {
  const status = Number(error?.statusCode || 500);
  const message = String(error?.message || 'browser_operation_failed');
  res.status(status).json({
    error: status >= 500 ? 'browser_operation_failed' : message,
    ...(process.env.NODE_ENV === 'production' || status < 500 ? {} : { detail: message }),
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

const server = http.createServer(app);
server.on('upgrade', (request, socket, head) => viewerHub.handleUpgrade(request, socket, head));
server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'browser_worker_started', port, phase: 3, viewer: 'restricted_websocket' }));
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: 'browser_worker_stopping', signal }));
  const timer = setTimeout(() => process.exit(1), 8000);
  timer.unref();
  try {
    viewerHub.closeAll();
    const sessionId = controller.current?.sessionId || null;
    if (sessionId) tokenManager.revokeSession(sessionId);
    await controller.stop();
  } finally {
    server.close(() => process.exit(0));
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
