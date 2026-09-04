import express from 'express';
import { healthSnapshot } from './runtime.js';
import { BrowserController } from './browser.js';

const app = express();
const port = Number(process.env.PORT || 8081);
const controller = new BrowserController();

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => {
  const snapshot = healthSnapshot();
  res.status(snapshot.chromium.available ? 200 : 503).json(snapshot);
});

app.get('/browser/status', (_req, res) => {
  res.status(200).json(controller.status());
});

app.post('/browser/start', async (req, res, next) => {
  try {
    res.status(201).json(await controller.start(req.body?.url));
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
    res.status(200).json(await controller.stop());
  } catch (error) {
    next(error);
  }
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

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`browser-worker listening on ${port}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`browser-worker shutting down on ${signal}`);
  const timer = setTimeout(() => process.exit(1), 8000);
  timer.unref();
  try {
    await controller.stop();
  } finally {
    server.close(() => process.exit(0));
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
