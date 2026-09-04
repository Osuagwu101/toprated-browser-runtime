import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHealthPayload } from '../src/health.mjs';

test('health payload remains generic and reflects Phase 5 Laravel ownership', () => {
  const payload = buildHealthPayload({ CHROMIUM_EXECUTABLE: '/bin/sh', MAX_BROWSER_SESSIONS: '3' });
  assert.equal(payload.status, 'ok');
  assert.equal(payload.service, 'browser-worker');
  assert.equal(payload.phase, 5);
  assert.equal(payload.browserCore, 'generic');
  assert.equal(payload.control, 'cdp');
  assert.equal(payload.lifecycleOwner, 'laravel');
  assert.equal(payload.viewer.mode, 'restricted-frame-input');
  assert.equal(payload.viewer.auth, 'signed-bearer');
  assert.equal(payload.viewer.grantIssuer, 'laravel');
  assert.equal(payload.viewer.rawCdpExposed, false);
  assert.equal(payload.capacity.maxSessions, 3);
  assert.equal(payload.capacity.maxSupportedSessions, 15);
  assert.equal(payload.capacity.configurationValid, true);
  assert.equal(payload.chromium.installed, true);
  assert.equal(JSON.stringify(payload).toLowerCase().includes('phrasly'), false);
});

test('health degrades when browser capacity configuration is invalid', () => {
  const payload = buildHealthPayload({ CHROMIUM_EXECUTABLE: '/bin/sh', MAX_BROWSER_SESSIONS: '16' });
  assert.equal(payload.status, 'degraded');
  assert.equal(payload.capacity.configurationValid, false);
});
