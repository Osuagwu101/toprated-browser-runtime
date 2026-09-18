import { createHash, randomBytes } from 'node:crypto';

export class NativeSessionCookieStore {
  constructor({ maxEntries = 128, ttlSeconds = 3600 } = {}) {
    this.maxEntries = Math.max(16, Number(maxEntries) || 128);
    this.ttlSeconds = Math.max(60, Math.min(86400, Number(ttlSeconds) || 3600));
    this.entries = new Map();
  }

  prune(now = Date.now()) {
    for (const [hash, entry] of this.entries.entries()) if (entry.expiresAt <= now) this.entries.delete(hash);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }

  issue(sessionId) {
    this.prune();
    const value = randomBytes(32).toString('base64url');
    this.entries.set(this.hash(value), { sessionId: String(sessionId), expiresAt: Date.now() + this.ttlSeconds * 1000 });
    return value;
  }

  verify(sessionId, value) {
    this.prune();
    const entry = this.entries.get(this.hash(value));
    return !!entry && entry.sessionId === String(sessionId) && entry.expiresAt > Date.now();
  }

  revokeSession(sessionId) {
    for (const [hash, entry] of this.entries.entries()) if (entry.sessionId === String(sessionId)) this.entries.delete(hash);
  }

  hash(value) { return createHash('sha256').update(String(value)).digest('hex'); }
}
