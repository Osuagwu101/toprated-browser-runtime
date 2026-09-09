import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const PROFILE_SLUG = /^[A-Za-z0-9._-]{1,191}$/;
const TRANSIENT_RUNTIME_FILES = new Set(['DevToolsActivePort', 'SingletonCookie', 'SingletonLock', 'SingletonSocket']);

function removeTransientRuntimeFiles(userDataDir) {
  if (!existsSync(userDataDir)) return;
  for (const name of readdirSync(userDataDir)) {
    if (TRANSIENT_RUNTIME_FILES.has(name)) rmSync(join(userDataDir, name), { force: true, recursive: true });
  }
}

function fail(message, statusCode = 422, code = 'ADMIN_PROFILE_INVALID') {
  throw Object.assign(new Error(message), { statusCode, code });
}

export function normalizeAdminProfileRoot(value) {
  const raw = String(value || '/var/lib/toprated-browser-runtime/admin-profiles').trim();
  if (!isAbsolute(raw)) fail('ADMIN_PROFILE_ROOT must be an absolute path.', 503, 'ADMIN_PROFILE_CONFIG_INVALID');
  const normalized = resolve(raw);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2 || ['/', '/tmp', '/var', '/var/lib', '/srv', '/opt', '/usr', '/etc', '/home', '/root'].includes(normalized)) {
    fail('ADMIN_PROFILE_ROOT is too broad.', 503, 'ADMIN_PROFILE_CONFIG_INVALID');
  }
  return normalized;
}

export function adminProfileIdentifier(toolSlug) {
  const slug = String(toolSlug || '').trim();
  if (!PROFILE_SLUG.test(slug)) fail('Administrator profile tool slug is invalid.');
  return createHash('sha256').update(`toprated-admin-profile-v1\0${slug}`, 'utf8').digest('hex');
}

export class AdminProfileStore {
  constructor({ root = process.env.ADMIN_PROFILE_ROOT } = {}) {
    this.root = normalizeAdminProfileRoot(root);
    this.activeProfiles = new Map();
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const rootStat = lstatSync(this.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('ADMIN_PROFILE_ROOT must be a real directory.', 503, 'ADMIN_PROFILE_CONFIG_INVALID');
    chmodSync(this.root, 0o700);
  }

  acquire(toolSlug, ownerId) {
    const profileId = adminProfileIdentifier(toolSlug);
    const owner = String(ownerId || '').trim();
    if (!owner) fail('Administrator profile owner identity is required.');
    if (this.activeProfiles.has(profileId)) {
      fail('Administrator profile is already active.', 409, 'ADMIN_PROFILE_IN_USE');
    }

    const userDataDir = join(this.root, profileId);
    mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
    const profileStat = lstatSync(userDataDir);
    if (!profileStat.isDirectory() || profileStat.isSymbolicLink()) fail('Administrator profile path is invalid.', 503, 'ADMIN_PROFILE_CONFIG_INVALID');
    chmodSync(userDataDir, 0o700);
    removeTransientRuntimeFiles(userDataDir);
    this.activeProfiles.set(profileId, owner);
    return { profileId, userDataDir };
  }

  release(profileId, ownerId) {
    const key = String(profileId || '');
    const owner = String(ownerId || '');
    if (!key || this.activeProfiles.get(key) !== owner) return false;
    const userDataDir = join(this.root, key);
    removeTransientRuntimeFiles(userDataDir);
    this.activeProfiles.delete(key);
    return true;
  }

  isActive(profileId) {
    return this.activeProfiles.has(String(profileId || ''));
  }

  summary() {
    let persistedCount = 0;
    try {
      persistedCount = readdirSync(this.root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)).length;
    } catch {}
    return {
      persistence: 'durable-operator-only',
      activeCount: this.activeProfiles.size,
      persistedCount,
    };
  }
}
