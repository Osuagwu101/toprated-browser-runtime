const baseUrl = String(process.env.INTERACTIVE_AUTH_WORKER_URL || 'http://interactive-auth-worker:8082').replace(/\/$/, '');
const controlSecret = String(process.env.WORKER_CONTROL_SECRET || '');
if (Buffer.byteLength(controlSecret, 'utf8') < 32) {
  throw new Error('WORKER_CONTROL_SECRET must contain at least 32 bytes.');
}

async function request(method, path, body, { binary = false, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        Accept: binary ? 'image/jpeg' : 'application/json',
        'X-Toprated-Worker-Secret': controlSecret,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });

    if (binary) {
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw workerError(response.status, payload);
      }
      return Buffer.from(await response.arrayBuffer());
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw workerError(response.status, payload);
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error('Interactive authentication worker request timed out.'), {
        statusCode: 503,
        code: 'INTERACTIVE_AUTH_WORKER_UNAVAILABLE',
      });
    }
    if (error?.statusCode) throw error;
    throw Object.assign(new Error('Interactive authentication worker is unavailable.'), {
      statusCode: 503,
      code: 'INTERACTIVE_AUTH_WORKER_UNAVAILABLE',
    });
  } finally {
    clearTimeout(timer);
  }
}

function workerError(status, payload) {
  const code = typeof payload?.code === 'string' ? payload.code : (
    status === 404 ? 'INTERACTIVE_AUTH_SESSION_MISSING'
      : status === 410 ? 'INTERACTIVE_AUTH_SESSION_GONE'
        : status === 429 ? 'INTERACTIVE_AUTH_CAPACITY_FULL'
          : 'INTERACTIVE_AUTH_WORKER_ERROR'
  );
  return Object.assign(new Error(String(payload?.message || 'Interactive authentication worker rejected the operation.')), {
    statusCode: status,
    code,
  });
}

export class InteractiveAuthWorkerClient {
  health() { return request('GET', '/health', undefined, { timeoutMs: 5000 }); }
  sessions() { return request('GET', '/internal/sessions', undefined, { timeoutMs: 5000 }); }
  start(url) { return request('POST', '/internal/sessions', { url }, { timeoutMs: 30000 }); }
  status(sessionId) { return request('GET', `/internal/sessions/${encodeURIComponent(sessionId)}`, undefined, { timeoutMs: 5000 }); }
  frame(sessionId) { return request('GET', `/internal/sessions/${encodeURIComponent(sessionId)}/frame`, undefined, { binary: true, timeoutMs: 10000 }); }
  input(sessionId, body) { return request('POST', `/internal/sessions/${encodeURIComponent(sessionId)}/input`, body, { timeoutMs: 10000 }); }
  prepare(sessionId) { return request('POST', `/internal/sessions/${encodeURIComponent(sessionId)}/prepare`, {}, { timeoutMs: 15000 }); }
  finalize(sessionId, body) { return request('POST', `/internal/sessions/${encodeURIComponent(sessionId)}/finalize`, body, { timeoutMs: 180000 }); }
  stop(sessionId) { return request('DELETE', `/internal/sessions/${encodeURIComponent(sessionId)}`, undefined, { timeoutMs: 10000 }); }
  cleanupProfile(profileId) { return request('DELETE', `/internal/profiles/${encodeURIComponent(profileId)}`, undefined, { timeoutMs: 10000 }); }
}
