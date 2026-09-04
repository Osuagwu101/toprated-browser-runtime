import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewerTokenManager } from '../src/viewer-auth.js';

function makeClock(start = 1_700_000_000_000) {
  let now = start;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

test('viewer token is scoped to one session', () => {
  const clock = makeClock();
  const manager = new ViewerTokenManager({ defaultTtlSeconds: 60, now: clock.now });
  const minted = manager.mint('session-a');
  assert.equal(manager.verify(minted.token, 'session-a').valid, true);
  assert.deepEqual(manager.verify(minted.token, 'session-b'), { valid: false, reason: 'wrong_session' });
});

test('viewer token expires and is removed', () => {
  const clock = makeClock();
  const manager = new ViewerTokenManager({ defaultTtlSeconds: 60, now: clock.now });
  const minted = manager.mint('session-a', 1);
  clock.advance(1001);
  assert.deepEqual(manager.verify(minted.token, 'session-a'), { valid: false, reason: 'expired_token' });
  assert.deepEqual(manager.verify(minted.token, 'session-a'), { valid: false, reason: 'invalid_token' });
});

test('revoking a session invalidates all of its tokens', () => {
  const manager = new ViewerTokenManager();
  const a = manager.mint('session-a');
  const b = manager.mint('session-a');
  manager.revokeSession('session-a');
  assert.equal(manager.verify(a.token).valid, false);
  assert.equal(manager.verify(b.token).valid, false);
});
