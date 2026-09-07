import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSessionController, RUNTIME_PHASE, normalizeBrowserDisplayMode, normalizeBrowserNavigationTimeoutMs, validateNavigationUrl, validateViewerInput } from '../src/browser-session.mjs';

test('accepts deterministic HTML data pages and normal web URLs', () => {
  assert.equal(validateNavigationUrl('https://example.com/'), 'https://example.com/');
  assert.equal(validateNavigationUrl('http://example.com/test'), 'http://example.com/test');
  assert.equal(validateNavigationUrl('data:text/html,%3Ctitle%3ETest%3C/title%3E'), 'data:text/html,%3Ctitle%3ETest%3C/title%3E');
});

test('rejects unsupported navigation schemes', () => {
  assert.throws(() => validateNavigationUrl('file:///etc/passwd'), /http, https, or data/);
  assert.throws(() => validateNavigationUrl('javascript:alert(1)'), /http, https, or data/);
  assert.throws(() => validateNavigationUrl('data:text/plain,hello'), /data:text\/html/);
});

test('normalizes restricted mouse and scroll input to the viewer viewport', () => {
  assert.deepEqual(validateViewerInput({ type: 'mouse', event: 'pressed', button: 'left', x: -20, y: 9999 }), {
    type: 'mouse', event: 'pressed', button: 'left', x: 0, y: 899,
  });
  assert.deepEqual(validateViewerInput({ type: 'scroll', x: 2000, y: -5, deltaX: 9000, deltaY: -9000 }), {
    type: 'scroll', x: 1439, y: 0, deltaX: 2000, deltaY: -2000,
  });
});

test('accepts bounded text and keyboard input and rejects unsupported input types', () => {
  assert.deepEqual(validateViewerInput({ type: 'text', text: 'hello' }), { type: 'text', text: 'hello' });
  assert.deepEqual(validateViewerInput({ type: 'key', key: 'Enter', code: 'Enter', modifiers: 0 }), {
    type: 'key', key: 'Enter', code: 'Enter', modifiers: 0,
  });
  assert.throws(() => validateViewerInput({ type: 'shell', command: 'id' }), /must be mouse, scroll, text, or key/);
  assert.throws(() => validateViewerInput({ type: 'text', text: 'x'.repeat(2001) }), /between 1 and 2000/);
});

test('accepts only the supported generic browser display modes', () => {
  assert.equal(normalizeBrowserDisplayMode(undefined), 'headless');
  assert.equal(normalizeBrowserDisplayMode('virtual-display'), 'virtual-display');
  assert.throws(() => normalizeBrowserDisplayMode('stealth'), /headless or virtual-display/);
});

test('bounds the generic browser navigation readiness timeout', () => {
  assert.equal(normalizeBrowserNavigationTimeoutMs(undefined), 45000);
  assert.equal(normalizeBrowserNavigationTimeoutMs('60000'), 60000);
  assert.throws(() => normalizeBrowserNavigationTimeoutMs('4999'), /between 5000 and 120000/);
  assert.throws(() => normalizeBrowserNavigationTimeoutMs('120001'), /between 5000 and 120000/);
});

test('Phase 6 retains configurable capacity bounded to the blueprint target', () => {
  assert.equal(RUNTIME_PHASE, 6);
  const controller = new BrowserSessionController({ executablePath: '/does/not/exist', maxSessions: 3 });
  assert.deepEqual(controller.listStatus(), {
    phase: 6,
    activeCount: 0,
    startingCount: 0,
    maxSessions: 3,
    sessions: [],
  });
  assert.throws(() => new BrowserSessionController({ maxSessions: 0 }), /between 1 and 15/);
  assert.throws(() => new BrowserSessionController({ maxSessions: 16 }), /between 1 and 15/);
});
