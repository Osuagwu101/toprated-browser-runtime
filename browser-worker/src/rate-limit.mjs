function httpError(message, statusCode, code, retryAfterSeconds) {
  return Object.assign(new Error(message), { statusCode, code, retryAfterSeconds });
}

export function normalizeRateLimit(value, name, fallback) {
  const limit = Number(value || fallback);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000) {
    throw new Error(`${name} must be an integer between 1 and 100000.`);
  }
  return limit;
}

export class FixedWindowRateLimiter {
  constructor({ limit, windowMs = 60000, maxBuckets = 4096, now = () => Date.now() } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Rate limit must be a positive integer.');
    if (!Number.isInteger(windowMs) || windowMs < 1000) throw new Error('Rate limit window must be at least one second.');
    if (!Number.isInteger(maxBuckets) || maxBuckets < 1 || maxBuckets > 100000) throw new Error('Rate limit maxBuckets must be an integer between 1 and 100000.');
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxBuckets = maxBuckets;
    this.now = now;
    this.buckets = new Map();
  }

  pruneExpired(now) {
    for (const [key, bucket] of this.buckets.entries()) {
      if (now < bucket.startedAt || now - bucket.startedAt >= this.windowMs) this.buckets.delete(key);
    }
  }

  capacityRetryAfter(now) {
    let earliestExpiry = Infinity;
    for (const bucket of this.buckets.values()) earliestExpiry = Math.min(earliestExpiry, bucket.startedAt + this.windowMs);
    return Number.isFinite(earliestExpiry)
      ? Math.max(1, Math.ceil((earliestExpiry - now) / 1000))
      : Math.max(1, Math.ceil(this.windowMs / 1000));
  }

  hit(subject) {
    const key = String(subject || 'unknown');
    const now = this.now();
    this.pruneExpired(now);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxBuckets) {
        return { allowed: false, remaining: 0, retryAfterSeconds: this.capacityRetryAfter(now) };
      }
      bucket = { startedAt: now, hits: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.hits += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.startedAt + this.windowMs - now) / 1000));
    return { allowed: bucket.hits <= this.limit, remaining: Math.max(0, this.limit - bucket.hits), retryAfterSeconds };
  }
}

export function enforceRateLimit(limiter, subject) {
  const result = limiter.hit(subject);
  if (!result.allowed) {
    throw httpError('Browser worker request rate limit exceeded.', 429, 'RATE_LIMITED', result.retryAfterSeconds);
  }
  return result;
}
