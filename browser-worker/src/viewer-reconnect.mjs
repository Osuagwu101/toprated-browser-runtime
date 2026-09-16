import { createHash, randomBytes } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('base64url');
}

export class ViewerReconnectTicketStore {
  constructor({ maxEntries = 64 } = {}) {
    this.maxEntries = Math.max(1, Number(maxEntries) || 64);
    this.entries = new Map();
  }

  issue(sessionId) {
    const sid = String(sessionId || '');
    if (!sid) throw new Error('sessionId is required for a viewer reconnect ticket.');
    if (!this.entries.has(sid) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest) this.entries.delete(oldest);
    }
    const ticket = randomBytes(32).toString('base64url');
    this.entries.delete(sid);
    this.entries.set(sid, { hash: digest(ticket), issuedAt: Date.now() });
    return ticket;
  }

  rotate(sessionId, suppliedTicket) {
    const sid = String(sessionId || '');
    const entry = this.entries.get(sid);
    if (!entry || entry.hash !== digest(suppliedTicket)) return null;
    return this.issue(sid);
  }

  revoke(sessionId) { this.entries.delete(String(sessionId || '')); }
  has(sessionId) { return this.entries.has(String(sessionId || '')); }
  clear() { this.entries.clear(); }
}
