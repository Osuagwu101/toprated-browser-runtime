import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

export class ViewerTokenManager {
  constructor({
    defaultTtlSeconds = Number(process.env.VIEWER_TOKEN_TTL_SECONDS || 600),
    now = () => Date.now(),
    secret = process.env.VIEWER_SIGNING_SECRET || randomBytes(32).toString('base64url'),
  } = {}) {
    this.defaultTtlSeconds = Math.max(30, Math.min(3600, Number(defaultTtlSeconds) || 600));
    this.now = now;
    this.secret = String(secret);
    this.active = new Map();
  }

  sign(payloadPart) {
    return createHmac('sha256', this.secret).update(payloadPart).digest('base64url');
  }

  mint(sessionId, ttlSeconds = this.defaultTtlSeconds) {
    if (!sessionId) throw new Error('session_id_required');
    const boundedTtl = Math.max(1, Math.min(3600, Number(ttlSeconds) || this.defaultTtlSeconds));
    const expiresAt = this.now() + boundedTtl * 1000;
    const jti = randomBytes(18).toString('base64url');
    const payloadPart = encodeJson({ sid: sessionId, exp: expiresAt, jti });
    const token = `${payloadPart}.${this.sign(payloadPart)}`;
    this.active.set(jti, { sessionId, expiresAt });
    this.prune();
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  verify(token, sessionId = null) {
    if (!token) return { valid: false, reason: 'missing_token' };
    const [payloadPart, signature, extra] = String(token).split('.');
    if (!payloadPart || !signature || extra) return { valid: false, reason: 'invalid_token' };

    const expected = this.sign(payloadPart);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
      return { valid: false, reason: 'invalid_signature' };
    }

    let payload;
    try {
      payload = decodeJson(payloadPart);
    } catch {
      return { valid: false, reason: 'invalid_token' };
    }

    const record = this.active.get(payload.jti);
    if (!record || record.sessionId !== payload.sid || record.expiresAt !== payload.exp) {
      return { valid: false, reason: 'invalid_token' };
    }
    if (record.expiresAt <= this.now()) {
      this.active.delete(payload.jti);
      return { valid: false, reason: 'expired_token' };
    }
    if (sessionId && record.sessionId !== sessionId) {
      return { valid: false, reason: 'wrong_session' };
    }

    return { valid: true, sessionId: record.sessionId, expiresAt: record.expiresAt };
  }

  revokeSession(sessionId) {
    for (const [jti, record] of this.active.entries()) {
      if (record.sessionId === sessionId) this.active.delete(jti);
    }
  }

  prune() {
    const now = this.now();
    for (const [jti, record] of this.active.entries()) {
      if (record.expiresAt <= now) this.active.delete(jti);
    }
  }
}
