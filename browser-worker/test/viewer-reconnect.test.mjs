import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewerReconnectTicketStore } from '../src/viewer-reconnect.mjs';

test('viewer reconnect tickets rotate and old tickets cannot be replayed', () => {
  const store = new ViewerReconnectTicketStore({ maxEntries: 4 });
  const first = store.issue('session-a');
  assert.ok(first.length >= 40);
  const second = store.rotate('session-a', first);
  assert.ok(second);
  assert.notEqual(second, first);
  assert.equal(store.rotate('session-a', first), null);
  const third = store.rotate('session-a', second);
  assert.ok(third);
});

test('viewer reconnect tickets are bound to one session and can be revoked', () => {
  const store = new ViewerReconnectTicketStore();
  const ticket = store.issue('session-a');
  assert.equal(store.rotate('session-b', ticket), null);
  assert.equal(store.has('session-a'), true);
  store.revoke('session-a');
  assert.equal(store.has('session-a'), false);
  assert.equal(store.rotate('session-a', ticket), null);
});
