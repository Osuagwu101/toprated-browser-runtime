function httpError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function assertNoQuery(requestUrl) {
  if (requestUrl.search) throw httpError('Protected browser routes do not accept query parameters.', 400, 'REQUEST_QUERY_FORBIDDEN');
}

export function assertAllowedFields(body, allowedFields, message = 'Request contains unsupported fields.') {
  for (const key of Object.keys(body)) {
    if (!allowedFields.includes(key)) throw httpError(message, 422, 'UNSUPPORTED_REQUEST_FIELDS');
  }
}

export async function readJson(request, maxBytes = 16 * 1024) {
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw httpError('Request body is too large.', 413, 'REQUEST_TOO_LARGE');
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > maxBytes) throw httpError('Request body is too large.', 413, 'REQUEST_TOO_LARGE');
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};

  const contentType = String(request.headers['content-type'] || '').trim().toLowerCase();
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    throw httpError('Request bodies must use application/json.', 415, 'UNSUPPORTED_MEDIA_TYPE');
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw httpError('Request body must be valid JSON.', 400, 'MALFORMED_JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError('Request body must be a JSON object.', 400, 'MALFORMED_REQUEST');
  }
  return body;
}
