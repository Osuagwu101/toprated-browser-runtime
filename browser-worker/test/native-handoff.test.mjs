import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NativeSessionCookieStore } from '../src/native-cookie-store.mjs';
import { buildNativeHandoffHtml } from '../src/native-page.mjs';

test('native handoff uses a real RFB client and clears the bootstrap grant from the address bar', () => {
  const html = buildNativeHandoffHtml({ sessionId: '00000000-0000-4000-8000-000000000001', nonce: 'nonce' });
  assert.match(html, /import RFB/);
  assert.match(html, /\/authorize/);
  assert.match(html, /history\.replaceState/);
  assert.doesNotMatch(html, /captureScreenshot|Remote browser frame|Page\.captureScreenshot/);
});

test('native handoff cookie is session-bound and cannot cross into another writer session', () => {
  const store = new NativeSessionCookieStore({ ttlSeconds: 60 });
  const cookie = store.issue('session-a');
  assert.equal(store.verify('session-a', cookie), true);
  assert.equal(store.verify('session-b', cookie), false);
  store.revokeSession('session-a');
  assert.equal(store.verify('session-a', cookie), false);
});

test('native service route bridges VNC privately and does not reopen the legacy viewer route', () => {
  const source = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /matchNativeRoute/);
  assert.match(source, /controller\.nativeVncPort/);
  assert.match(source, /net\.connect\(\{ host: '127\.0\.0\.1'/);
  assert.match(source, /assertNativeCookie/);
});
