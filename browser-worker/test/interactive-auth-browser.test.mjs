import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInteractiveChromeArgs, assertInteractiveChromeArgs, InteractiveAuthBrowserManager } from '../src/interactive-auth-browser.mjs';

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
