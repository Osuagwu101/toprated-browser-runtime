import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAuthenticationPolicy, normalizeBrowserState } from '../src/browser-state.mjs';

test('normalizes bounded shared cookies and storage for an allowed host', () => {
  const result = normalizeBrowserState({
    cookies: [{ name: 'session', value: 'secret-value', domain: '.example.test', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }],
    storage: {
      localStorage: { local: 'one' },
      sessionStorage: { session: 'two' },
    },
  }, { required: true, allowedHosts: ['example.test'] }, 'https://app.example.test/dashboard');

  assert.equal(result.state.cookies[0].domain, 'example.test');
  assert.equal(result.state.storage.localStorage.local, 'one');
  assert.deepEqual(result.allowedHosts, ['example.test']);
});

test('normalizes empty storage arrays emitted by the PHP transport boundary', () => {
  const result = normalizeBrowserState({
    cookies: [{ name: 'session', value: 'secret-value', domain: 'example.test', path: '/' }],
    storage: {
      localStorage: { local: 'one' },
      sessionStorage: [],
    },
  }, { required: true, allowedHosts: ['example.test'] }, 'https://example.test/dashboard');

  assert.equal(result.state.storage.localStorage.local, 'one');
  assert.deepEqual(result.state.storage.sessionStorage, {});
  assert.throws(() => normalizeBrowserState({
    cookies: [{ name: 'session', value: 'secret-value', domain: 'example.test', path: '/' }],
    storage: {
      localStorage: [['unexpected', 'list']],
      sessionStorage: {},
    },
  }, { required: true, allowedHosts: ['example.test'] }, 'https://example.test/dashboard'), /namespace must be an object/);
});

test('rejects cookie state outside the configured tool hosts', () => {
  assert.throws(() => normalizeBrowserState({
    cookies: [{ name: 'session', value: 'value', domain: 'attacker.test', path: '/' }],
    storage: { localStorage: {}, sessionStorage: {} },
  }, { required: true, allowedHosts: ['example.test'] }, 'https://example.test/dashboard'), /outside the configured tool hosts/);
});

test('requires state when the profile requires it', () => {
  assert.throws(() => normalizeBrowserState(null, { required: true, allowedHosts: ['example.test'] }, 'https://example.test/dashboard'), /required/);
});

test('authentication policy remains generic and requires indicators', () => {
  assert.throws(() => normalizeAuthenticationPolicy({ required: true, urlContainsAny: [], selectorsAny: [], timeoutSeconds: 5 }), /no verification indicators/);
  assert.deepEqual(normalizeAuthenticationPolicy({ required: true, urlContainsAny: ['/dashboard'], selectorsAny: ['[data-auth=true]'], timeoutSeconds: 5 }), {
    required: true,
    urlContainsAny: ['/dashboard'],
    selectorsAny: ['[data-auth=true]'],
    timeoutSeconds: 5,
  });
});
