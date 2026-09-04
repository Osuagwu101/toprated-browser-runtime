import express from 'express';
import { healthSnapshot } from './runtime.js';

const app = express();
const port = Number(process.env.PORT || 8081);

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => {
  const snapshot = healthSnapshot();
  res.status(snapshot.chromium.available ? 200 : 503).json(snapshot);
});

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`browser-worker listening on ${port}`);
});
