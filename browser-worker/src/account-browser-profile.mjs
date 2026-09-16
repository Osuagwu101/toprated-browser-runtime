import { mkdirSync, openSync, readFileSync, rmSync, closeSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const PROFILE_ID = /^[a-f0-9]{64}$/;
const STALE_ARTIFACTS = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort'];

export function profileIdFor(toolSlug, accountScope) {
  const tool = String(toolSlug || '').trim().toLowerCase();
  const account = String(accountScope || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{1,191}$/.test(tool) || !(/^[0-9a-f-]{36}$/.test(account) || account === 'legacy')) {
    throw Object.assign(new Error('Account browser profile identity is invalid.'), { statusCode: 422, code: 'PROFILE_IDENTITY_INVALID' });
  }
  return createHash('sha256').update(`${tool}\u0000${account}`, 'utf8').digest('hex');
}

export function profilePath(root, profileId) {
  const safeRoot = resolve(String(root || '/srv/account-browser-profiles'));
  const id = String(profileId || '');
  if (!PROFILE_ID.test(id)) throw Object.assign(new Error('Account browser profile identifier is invalid.'), { statusCode: 422, code: 'PROFILE_ID_INVALID' });
  const path = resolve(safeRoot, id);
  if (!path.startsWith(`${safeRoot}/`)) throw Object.assign(new Error('Account browser profile path is invalid.'), { statusCode: 422, code: 'PROFILE_PATH_INVALID' });
  return path;
}

function leasePath(path) { return join(path, '.toprated-profile-lease'); }

function readLease(path) {
  try {
    const parsed = JSON.parse(readFileSync(leasePath(path), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

export function clearStaleChromeArtifacts(path) {
  for (const artifact of STALE_ARTIFACTS) rmSync(join(path, artifact), { force: true });
}

export class AccountBrowserProfileLease {
  constructor({ root = process.env.ACCOUNT_BROWSER_PROFILE_ROOT || '/srv/account-browser-profiles', toolSlug, accountScope, ttlMs = Number(process.env.ACCOUNT_PROFILE_LEASE_TTL_MS || 30000) } = {}) {
    this.root = resolve(root);
    this.profileId = profileIdFor(toolSlug, accountScope);
    this.path = profilePath(this.root, this.profileId);
    this.ttlMs = Number.isInteger(ttlMs) && ttlMs >= 10000 && ttlMs <= 120000 ? ttlMs : 30000;
    this.owner = randomUUID();
    this.timer = null;
    this.held = false;
  }

  record() { return JSON.stringify({ owner: this.owner, expiresAt: Date.now() + this.ttlMs }); }

  acquire() {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    mkdirSync(this.path, { recursive: true, mode: 0o700 });
    const lock = leasePath(this.path);
    try {
      const fd = openSync(lock, 'wx', 0o600);
      writeFileSync(fd, this.record(), 'utf8');
      closeSync(fd);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = readLease(this.path);
      if (!existing || !Number.isFinite(Number(existing.expiresAt)) || Number(existing.expiresAt) < Date.now()) {
        rmSync(lock, { force: true });
        clearStaleChromeArtifacts(this.path);
        return this.acquire();
      }
      throw Object.assign(new Error('This account browser profile is already in use.'), { statusCode: 409, code: 'ACCOUNT_PROFILE_IN_USE' });
    }
    this.held = true;
    this.timer = setInterval(() => this.renew(), Math.max(3000, Math.floor(this.ttlMs / 3)));
    this.timer.unref();
    return this;
  }

  renew() {
    if (!this.held) return;
    const existing = readLease(this.path);
    if (!existing || existing.owner !== this.owner) {
      this.held = false;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    writeFileSync(leasePath(this.path), this.record(), { encoding: 'utf8', mode: 0o600 });
  }

  release() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const existing = readLease(this.path);
    if (this.held && existing?.owner === this.owner) rmSync(leasePath(this.path), { force: true });
    this.held = false;
  }

  abandon() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Leave the last lease record in place until its bounded expiry. This
    // prevents a second Chrome process from using a profile while uncertain
    // cleanup is still resolving an orphaned browser process.
    this.held = false;
  }
}

export function profileExists(root, toolSlug, accountScope) {
  return existsSync(profilePath(root, profileIdFor(toolSlug, accountScope)));
}
