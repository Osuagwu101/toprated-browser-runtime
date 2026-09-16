import test from 'node:test';
import assert from 'node:assert/strict';
import { buildViewerHtml } from '../src/viewer-page.mjs';

const html = buildViewerHtml({
  sessionId: '11111111-2222-4333-8444-555555555555',
  nonce: 'unit-test-nonce',
});

test('Viewer UX V3 uses one persistent WebSocket rather than polling screenshots', () => {
  assert.match(html, /new WebSocket/);
  assert.match(html, /\/stream/);
  assert.doesNotMatch(html, /refreshFrame/);
  assert.doesNotMatch(html, /setTimeout\(refreshFrame,250\)/);
  assert.doesNotMatch(html, /\/frame['"]/);
});

test('Viewer UX V3 supports reconnect tickets, responsive viewport and paste', () => {
  assert.match(html, /reconnectTicket/);
  assert.match(html, /sessionStorage\.setItem/);
  assert.match(html, /type:'viewport'/);
  assert.match(html, /addEventListener\('paste'/);
  assert.match(html, /beforeinput/);
});

test('Viewer UX V3 removes the permanent remote-browser header chrome', () => {
  assert.doesNotMatch(html, /<header>/);
  assert.match(html, /#surface\{position:absolute;inset:0/);
  assert.match(html, /#frame\{display:block;width:100%;height:100%/);
});
