import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSessionController, normalizeWarmBrowserSlots, resolveViewerViewport, validateViewerInput } from '../src/browser-session.mjs';

function controllerWithSession() {
  const calls = [];
  const controller = new BrowserSessionController({ maxSessions: 2 });
  controller.sessions.set('test-session', {
    sessionId: 'test-session',
    process: { pid: process.pid, exitCode: null, signalCode: null },
    cdp: { send: async (method, payload) => { calls.push({ method, payload }); return {}; } },
    viewport: { width: 1000, height: 600 },
  });
  return { controller, calls };
}

test('viewer keeps a normal phone viewport without desktop stretching', () => {
  assert.deepEqual(resolveViewerViewport(393, 809), { width: 393, height: 809 });
});

test('viewer preserves desktop aspect ratio within the runtime limit', () => {
  assert.deepEqual(resolveViewerViewport(1920, 1080), { width: 1440, height: 810 });
});

test('warm browser capacity is bounded and disabled by default', () => {
  assert.equal(normalizeWarmBrowserSlots(0, 15), 0);
  assert.equal(normalizeWarmBrowserSlots(2, 15), 2);
  assert.throws(() => normalizeWarmBrowserSlots(4, 15));
});

test('an unexpected active-browser exit requests a warm replacement', async () => {
  const controller = new BrowserSessionController({ maxSessions: 2, warmSlots: 1 });
  controller.sessions.set('crashed-session', { process: { pid: process.pid, exitCode: 0, signalCode: null } });
  controller.cleanupSession = async () => ({ rootExited: true, orphanPids: [], zombiePids: [] });
  let refillCalls = 0;
  controller.scheduleWarmRefill = () => { refillCalls += 1; };

  controller.scheduleUnexpectedExitCleanup('crashed-session');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(controller.sessions.has('crashed-session'), false);
  assert.equal(refillCalls, 1);
});

test('viewer coordinates clamp to the active responsive viewport', () => {
  const viewport = { width: 1000, height: 600 };
  const mouse = validateViewerInput({
    type: 'mouse', event: 'pressed', button: 'left', x: 5000, y: 5000,
  }, viewport);
  assert.equal(mouse.x, 999);
  assert.equal(mouse.y, 599);

  const scroll = validateViewerInput({
    type: 'scroll', x: -10, y: -20, deltaX: 0, deltaY: 4000,
  }, viewport);
  assert.equal(scroll.x, 0);
  assert.equal(scroll.y, 0);
  assert.equal(scroll.deltaY, 2000);
});

test('text batches preserve exact character order for rapid typing', () => {
  const source = Array.from({ length: 1500 }, (_, i) => String.fromCharCode(33 + (i % 90))).join('');
  const accepted = validateViewerInput({ type: 'text', text: source });
  assert.equal(accepted.text, source);
});

test('scroll and shortcut input dispatch immediately on the ordered channel', async () => {
  const { controller, calls } = controllerWithSession();
  await controller.sendViewerInput('test-session', {
    type: 'scroll', x: 10, y: 10, deltaX: 0, deltaY: 120,
  }, { includeMetadata: false });
  await controller.sendViewerInput('test-session', {
    type: 'key', key: 'Tab', code: 'Tab', modifiers: 0,
  }, { includeMetadata: false });

  assert.deepEqual(calls.map((call) => call.method), [
    'Input.dispatchMouseEvent',
    'Input.dispatchKeyEvent',
    'Input.dispatchKeyEvent',
  ]);
});

test('a clean warm browser is claimed before launching a new Chrome process', async () => {
  const calls = [];
  const controller = new BrowserSessionController({ maxSessions: 2, warmSlots: 1 });
  controller.warmSessions.set('warm-session', {
    sessionId: 'warm-session',
    process: { pid: process.pid, exitCode: null, signalCode: null },
    cdp: {
      send: async (method, payload = {}) => {
        calls.push(method);
        if (method === 'Runtime.evaluate' && String(payload.expression).includes('document.readyState')) {
          return { result: { value: 'complete' } };
        }
        if (method === 'Runtime.evaluate') {
          return { result: { value: { url: 'data:text/html,warm', title: '', readyState: 'complete' } } };
        }
        return {};
      },
      close() {},
    },
    userDataDir: '/tmp/toprated-warm-test',
    preserveUserDataDir: true,
    viewport: { width: 1440, height: 900 },
    url: 'data:text/html,warm',
    title: '',
    authenticationRequired: false,
    authenticationVerified: false,
    authorizedStateAllowedHosts: [],
    viewerStreamStop: null,
    profileLease: null,
  });

  const created = await controller.start('data:text/html,%3Ch1%3Ewriter%3C/h1%3E', {
    browserStatePolicy: {}, authentication: { required: false },
  });

  assert.equal(created.sessionId, 'warm-session');
  assert.equal(controller.warmSessions.size, 0);
  assert.equal(controller.sessions.size, 1);
  assert.ok(calls.includes('Page.navigate'));
});
