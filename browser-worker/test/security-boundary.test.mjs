import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { FixedWindowRateLimiter, enforceRateLimit, normalizeRateLimit } from '../src/rate-limit.mjs';
import { assertAllowedFields, assertNoQuery, readJson } from '../src/request-security.mjs';
import { SessionPolicyStore } from '../src/session-policy-store.mjs';

function request(body, headers = {}) {
  const stream = new EventEmitter();
  stream.headers = headers;
  stream[Symbol.asyncIterator] = async function* () { if (body !== null) yield Buffer.from(body); };
  return stream;
}

test('fixed-window rate limiting rejects overflow and resets cleanly', () => {
  let now = 1000;
  const limiter = new FixedWindowRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(enforceRateLimit(limiter, 'client').remaining, 1);
  assert.equal(enforceRateLimit(limiter, 'client').remaining, 0);
  assert.throws(() => enforceRateLimit(limiter, 'client'), (error) => error.statusCode === 429 && error.code === 'RATE_LIMITED');
  now = 2000;
  assert.equal(enforceRateLimit(limiter, 'client').remaining, 1);
  assert.equal(normalizeRateLimit('12', 'TEST_LIMIT', 5), 12);
  assert.throws(() => normalizeRateLimit('0', 'TEST_LIMIT', 5), /between 1 and 100000/);
});

test('fixed-window rate limiting bounds subject churn and prunes expired buckets', () => {
  let now = 1000;
  const limiter = new FixedWindowRateLimiter({ limit: 5, windowMs: 1000, maxBuckets: 2, now: () => now });
  assert.equal(enforceRateLimit(limiter, 'client-a').remaining, 4);
  assert.equal(enforceRateLimit(limiter, 'client-b').remaining, 4);
  assert.equal(limiter.buckets.size, 2);
  assert.throws(
    () => enforceRateLimit(limiter, 'client-c'),
    (error) => error.statusCode === 429 && error.code === 'RATE_LIMITED' && error.retryAfterSeconds >= 1,
  );
  assert.equal(limiter.buckets.size, 2);
  now = 2000;
  assert.equal(enforceRateLimit(limiter, 'client-c').remaining, 4);
  assert.equal(limiter.buckets.size, 1);
});

test('session authentication policy state is bounded and stale entries reconcile away', () => {
  const store = new SessionPolicyStore({ maxEntries: 2 });
  store.set('session-a', { required: true });
  store.set('session-b', { required: false });
  assert.equal(store.size, 2);
  assert.throws(
    () => store.set('session-c', { required: true }),
    (error) => error.statusCode === 503 && error.code === 'SESSION_POLICY_CAPACITY',
  );
  assert.equal(store.reconcile(['session-b']), 1);
  assert.equal(store.get('session-a'), undefined);
  assert.deepEqual(store.get('session-b'), { required: false });
  store.set('session-c', { required: true });
  assert.equal(store.size, 2);
  store.clear();
  assert.equal(store.size, 0);
});

test('request boundary rejects query ambiguity and unsupported fields', () => {
  assert.doesNotThrow(() => assertNoQuery(new URL('http://worker/browser/status')));
  assert.throws(() => assertNoQuery(new URL('http://worker/browser/status?debug=1')), (error) => error.code === 'REQUEST_QUERY_FORBIDDEN');
  assert.doesNotThrow(() => assertAllowedFields({ url: 'https://example.test' }, ['url']));
  assert.throws(() => assertAllowedFields({ url: 'https://example.test', secret: 'x' }, ['url']), (error) => error.code === 'UNSUPPORTED_REQUEST_FIELDS');
});

test('JSON boundary accepts objects and rejects wrong media, malformed, array, and oversized bodies', async () => {
  assert.deepEqual(await readJson(request('{"ok":true}', { 'content-type': 'application/json' })), { ok: true });
  await assert.rejects(readJson(request('{"ok":true}', { 'content-type': 'text/plain' })), (error) => error.statusCode === 415);
  await assert.rejects(readJson(request('{', { 'content-type': 'application/json' })), (error) => error.code === 'MALFORMED_JSON');
  await assert.rejects(readJson(request('[]', { 'content-type': 'application/json' })), (error) => error.code === 'MALFORMED_REQUEST');
  await assert.rejects(readJson(request('{"value":"12345"}', { 'content-type': 'application/json' }), 8), (error) => error.statusCode === 413);
});
