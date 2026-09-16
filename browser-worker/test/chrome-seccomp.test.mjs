import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const profileUrl = new URL('../chrome-seccomp.json', import.meta.url);

function allowedSyscalls(profile) {
  const allowed = new Set();
  for (const rule of profile.syscalls || []) {
    if (rule.action !== 'SCMP_ACT_ALLOW') continue;
    for (const name of rule.names || []) allowed.add(name);
  }
  return allowed;
}

test('interactive Chrome seccomp keeps the Linux sandbox primitives available', () => {
  const profile = JSON.parse(readFileSync(profileUrl, 'utf8'));
  const allowed = allowedSyscalls(profile);

  assert.equal(profile.defaultAction, 'SCMP_ACT_ERRNO');
  for (const required of ['clone', 'clone3', 'setns', 'unshare', 'chroot']) {
    assert.equal(allowed.has(required), true, `required Chrome sandbox syscall is blocked: ${required}`);
  }

  for (const forbidden of [
    'bpf',
    'mount',
    'umount2',
    'kexec_load',
    'finit_module',
    'init_module',
    'delete_module',
    'perf_event_open',
    'reboot',
    'swapon',
    'swapoff',
  ]) {
    assert.equal(allowed.has(forbidden), false, `high-risk syscall unexpectedly allowed: ${forbidden}`);
  }
});
