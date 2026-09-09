import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdminProfileStore, adminProfileIdentifier, normalizeAdminProfileRoot } from '../src/admin-profile-store.mjs';

test('derives opaque stable administrator profile identifiers', () => {
  const first = adminProfileIdentifier('configured-tool');
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, adminProfileIdentifier('configured-tool'));
  assert.notEqual(first, adminProfileIdentifier('configured-tool-two'));
  assert.throws(() => adminProfileIdentifier('../escape'), /invalid/);
});

test('requires a bounded absolute administrator profile root', () => {
  assert.equal(normalizeAdminProfileRoot('/safe/profile-root'), '/safe/profile-root');
  assert.throws(() => normalizeAdminProfileRoot('relative/profiles'), /absolute/);
  assert.throws(() => normalizeAdminProfileRoot('/'), /too broad/);
  assert.throws(() => normalizeAdminProfileRoot('/tmp'), /too broad/);
  assert.throws(() => normalizeAdminProfileRoot('/var/lib'), /too broad/);
});

test('persists profiles, excludes concurrent use, and removes only Chromium runtime residue', () => {
  const root = mkdtempSync(join(tmpdir(), 'toprated-admin-store-test-'));
  try {
    chmodSync(root, 0o755);
    const store = new AdminProfileStore({ root });
    const acquired = store.acquire('configured-tool', 'session-one');
    assert.equal(statSync(root).mode & 0o777, 0o700);
    assert.equal(statSync(acquired.userDataDir).mode & 0o777, 0o700);
    writeFileSync(join(acquired.userDataDir, 'persistent-marker'), 'retained');
    writeFileSync(join(acquired.userDataDir, 'DevToolsActivePort'), '49152\n/devtools/browser/stale');
    mkdirSync(join(acquired.userDataDir, 'SingletonSocket'));
    assert.throws(() => store.acquire('configured-tool', 'session-two'), (error) => error.code === 'ADMIN_PROFILE_IN_USE');
    assert.equal(store.release(acquired.profileId, 'wrong-owner'), false);
    assert.equal(store.release(acquired.profileId, 'session-one'), true);
    assert.equal(store.summary().activeCount, 0);
    assert.equal(store.summary().persistedCount, 1);
    assert.doesNotThrow(() => statSync(join(acquired.userDataDir, 'persistent-marker')));
    assert.throws(() => statSync(join(acquired.userDataDir, 'DevToolsActivePort')));
    assert.throws(() => statSync(join(acquired.userDataDir, 'SingletonSocket')));

    // A worker crash cannot call release. The next process must still discard
    // stale runtime coordination files before launching Chromium.
    writeFileSync(join(acquired.userDataDir, 'DevToolsActivePort'), '49153\n/devtools/browser/stale');
    const afterRestart = new AdminProfileStore({ root }).acquire('configured-tool', 'session-after-restart');
    assert.throws(() => statSync(join(afterRestart.userDataDir, 'DevToolsActivePort')));
    assert.doesNotThrow(() => statSync(join(afterRestart.userDataDir, 'persistent-marker')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
