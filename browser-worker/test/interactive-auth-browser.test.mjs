import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInteractiveChromeArgs, assertInteractiveChromeArgs, InteractiveAuthBrowserManager } from '../src/interactive-auth-browser.mjs';
import { AccountBrowserProfileLease, clearStaleChromeArtifacts, profileIdFor, profilePath } from '../src/account-browser-profile.mjs';

const accountA = '11111111-1111-4111-8111-111111111111';
const accountB = '22222222-2222-4222-8222-222222222222';

test('interactive auth Chrome starts without automation or headless flags', () => {
  const args = buildInteractiveChromeArgs({
    userDataDir: '/tmp/profile',
    url: 'https://phrasly.ai/login',
  });
  assert.equal(assertInteractiveChromeArgs(args), true);
  const joined = args.join(' ');
  assert.match(joined, /--user-data-dir=\/tmp\/profile/);
  assert.match(joined, /--password-store=basic/);
  assert.match(joined, /https:\/\/phrasly\.ai\/login/);
  assert.doesNotMatch(joined, /--headless/);
  assert.doesNotMatch(joined, /--remote-debugging-port/);
  assert.doesNotMatch(joined, /--enable-automation/);
  assert.doesNotMatch(joined, /--no-sandbox/);
});

test('interactive auth guard rejects automation-affecting flags', () => {
  for (const forbidden of [
    '--headless=new',
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    '--enable-automation',
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
  ]) {
    assert.throws(
      () => assertInteractiveChromeArgs(['--user-data-dir=/tmp/profile', forbidden, 'https://example.com']),
      /Interactive authentication Chrome must not use/,
    );
  }
});

test('interactive auth manager reports no active sessions before launch', () => {
  const manager = new InteractiveAuthBrowserManager({
    chromeExecutable: '/does/not/exist',
    xvfbExecutable: '/does/not/exist',
    maxSessions: 3,
  });
  assert.deepEqual(manager.listStatus(), {
    activeCount: 0,
    startingCount: 0,
    sessions: [],
  });
});

test('account profiles are deterministic, isolated, and reopen after release', () => {
  const root = mkdtempSync(join(tmpdir(), 'toprated-account-profiles-'));
  try {
    assert.equal(profileIdFor('phrasly', accountA), profileIdFor('phrasly', accountA));
    assert.notEqual(profileIdFor('phrasly', accountA), profileIdFor('phrasly', accountB));
    assert.notEqual(profileIdFor('phrasly', accountA), profileIdFor('chatgpt', accountA));

    const first = new AccountBrowserProfileLease({ root, toolSlug: 'phrasly', accountScope: accountA }).acquire();
    assert.equal(existsSync(profilePath(root, first.profileId)), true);
    assert.throws(
      () => new AccountBrowserProfileLease({ root, toolSlug: 'phrasly', accountScope: accountA }).acquire(),
      /already in use/,
    );
    const separate = new AccountBrowserProfileLease({ root, toolSlug: 'phrasly', accountScope: accountB }).acquire();
    separate.release();
    first.release();
    const reopened = new AccountBrowserProfileLease({ root, toolSlug: 'phrasly', accountScope: accountA }).acquire();
    reopened.release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('stale Chrome artifacts are removed without deleting the profile', () => {
  const root = mkdtempSync(join(tmpdir(), 'toprated-account-profiles-'));
  try {
    const lease = new AccountBrowserProfileLease({ root, toolSlug: 'phrasly', accountScope: accountA }).acquire();
    const durable = join(lease.path, 'Default', 'Cookies');
    mkdirSync(join(lease.path, 'Default'), { recursive: true });
    writeFileSync(durable, 'durable-auth-state', { flag: 'w' });
    for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort']) writeFileSync(join(lease.path, name), 'stale');
    clearStaleChromeArtifacts(lease.path);
    assert.equal(existsSync(durable), true);
    assert.equal(existsSync(join(lease.path, 'SingletonLock')), false);
    lease.release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an expired profile lease is recovered without deleting durable profile data', () => {
  const root = mkdtempSync(join(tmpdir(), 'toprated-account-profiles-'));
  try {
    const id = profileIdFor('phrasly', accountA);
    const path = profilePath(root, id);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'durable-marker'), 'keep');
    writeFileSync(join(path, '.toprated-profile-lease'), JSON.stringify({ owner: 'crashed-worker', expiresAt: Date.now() - 1 }));
    writeFileSync(join(path, 'SingletonLock'), 'stale');
    const recovered = new AccountBrowserProfileLease({ root, toolSlug: 'phrasly', accountScope: accountA }).acquire();
    assert.equal(existsSync(join(path, 'durable-marker')), true);
    assert.equal(existsSync(join(path, 'SingletonLock')), false);
    recovered.release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
