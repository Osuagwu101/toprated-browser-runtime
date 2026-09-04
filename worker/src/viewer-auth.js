import { createHash, randomBytes } from 'node:crypto';

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export class ViewerTokenManager {
  constructor({ defaultTtlSeconds = Number(process.env.VIEWER_TOKEN_TTL_SECONDS || 600), now = () => Date.now() } = {}) {
    this.defaultTtlSeconds = Math.max(30, Math.min(3600, Number(defaultTtlSeconds) || 600));
    this.now = now;
    this.tokens = new Map();
  }

  mint(sessionId, ttlSeconds = this.defaultTtlSeconds) {
    if (!sessionId) throw new Error('session_id_required');
    const boundedTtl = Math.max(1, Math.min(3600, Number(ttlSeconds) || this.defaultTtlSeconds));
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = this.now() + boundedTtl * 1000;
    this.tokens.set(tokenHash, { sessionId, expiresAt });
    this.prune();
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  verify(token, sessionId = null) {
    if (!token) return { valid: false, reason: 'missing_token' };
    const record = this.tokens.get(hashToken(token));
    if (!record) return { valid: false, reason: 'invalid_token' };
    if (record.expiresAt <= this.now()) {
      this.tokens.delete(hashToken(token));
      return { valid: false, reason: 'expired_token' };
    }
    if (sessionId && record.sessionId !== sessionId) {
      return { valid: false, reason: 'wrong_session' };
    }
    return { valid: true, sessionId: record.sessionId, expiresAt: record.expiresAt };
  }

  revokeSession(sessionId) {
    for (const [tokenHash, record] of this.tokens.entries()) {
      if (record.sessionId === sessionId) this.tokens.delete(tokenHash);
    }
  }

  prune() {
    const now = this.now();
    for (const [tokenHash, record] of this.tokens.entries()) {
      if (record.expiresAt <= now) this.tokens.delete(tokenHash);
    }
  }
}
