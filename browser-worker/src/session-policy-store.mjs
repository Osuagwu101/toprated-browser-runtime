export class SessionPolicyStore {
  constructor({ maxEntries = 15 } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 1000) {
      throw new Error('Session policy maxEntries must be an integer between 1 and 1000.');
    }
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  set(sessionId, policy) {
    const key = String(sessionId || '');
    if (!key) throw new Error('Session policy requires a session id.');
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      throw Object.assign(new Error('Session policy capacity is exhausted.'), { statusCode: 503, code: 'SESSION_POLICY_CAPACITY' });
    }
    this.entries.set(key, policy);
  }

  get(sessionId) {
    return this.entries.get(String(sessionId || ''));
  }

  delete(sessionId) {
    return this.entries.delete(String(sessionId || ''));
  }

  reconcile(liveSessionIds) {
    const live = new Set([...liveSessionIds].map((id) => String(id)));
    for (const key of this.entries.keys()) {
      if (!live.has(key)) this.entries.delete(key);
    }
    return this.entries.size;
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}
