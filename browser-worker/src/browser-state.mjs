const MAX_COOKIES = 200;
const MAX_STORAGE_ENTRIES = 512;
const MAX_COOKIE_NAME_BYTES = 256;
const MAX_COOKIE_VALUE_BYTES = 16384;
const MAX_STORAGE_KEY_BYTES = 1024;
const MAX_STORAGE_VALUE_BYTES = 32768;

function fail(message, statusCode = 422, code = 'BROWSER_STATE_INVALID') {
  throw Object.assign(new Error(message), { statusCode, code });
}

function byteLength(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

function normalizeHost(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!host || host.length > 253) return '';
  if (/^[0-9a-f:.]+$/i.test(host)) return host;
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(host)) return '';
  return host;
}

function hostMatches(candidate, allowed) {
  const left = normalizeHost(candidate);
  const right = normalizeHost(allowed);
  return Boolean(left && right && (left === right || left.endsWith(`.${right}`)));
}

function normalizeAllowedHosts(policy, launchUrl) {
  const raw = policy?.allowedHosts ?? [];
  if (!Array.isArray(raw) || raw.length > 20) fail('Browser-state host policy is invalid.');
  const hosts = [...new Set(raw.map(normalizeHost))];
  if (hosts.some((host) => !host)) fail('Browser-state host policy is invalid.');

  let parsed;
  try { parsed = new URL(launchUrl); } catch { fail('Stateful launch URL is invalid.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) fail('Stateful launch must use HTTP or HTTPS.');
  if (!hosts.length || !hosts.some((host) => hostMatches(parsed.hostname, host))) fail('Launch host is outside the browser-state host policy.');
  return hosts;
}

function normalizeStorageMap(value) {
  if (value == null || (Array.isArray(value) && value.length === 0)) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Browser storage namespace must be an object.');
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key || byteLength(key) > MAX_STORAGE_KEY_BYTES || typeof item !== 'string' || byteLength(item) > MAX_STORAGE_VALUE_BYTES) fail('Browser storage contains an invalid key or value.');
    out[key] = item;
  }
  return out;
}

export function normalizeBrowserState(browserState, policy = {}, launchUrl) {
  const required = policy?.required === true;
  if (browserState == null) {
    if (required) fail('Authorized browser state is required.');
    return { state: null, allowedHosts: [] };
  }
  if (!browserState || typeof browserState !== 'object' || Array.isArray(browserState)) fail('Authorized browser state must be an object.');

  const allowedHosts = normalizeAllowedHosts(policy, launchUrl);
  const rawCookies = browserState.cookies ?? [];
  if (!Array.isArray(rawCookies) || rawCookies.length > MAX_COOKIES) fail('Authorized cookies must be a bounded array.');
  const cookies = rawCookies.map((cookie) => {
    if (!cookie || typeof cookie !== 'object' || Array.isArray(cookie)) fail('Authorized cookie entries must be objects.');
    const name = cookie.name;
    const value = cookie.value;
    if (typeof name !== 'string' || !name || byteLength(name) > MAX_COOKIE_NAME_BYTES || /[\x00-\x20\x7f;,=]/.test(name)) fail('Authorized cookie contains an invalid name.');
    if (typeof value !== 'string' || byteLength(value) > MAX_COOKIE_VALUE_BYTES) fail('Authorized cookie contains an invalid value.');
    const normalized = { name, value };

    if (cookie.domain != null && cookie.domain !== '') {
      const domain = normalizeHost(cookie.domain);
      if (!domain || !allowedHosts.some((host) => hostMatches(domain, host) || hostMatches(host, domain))) fail('Authorized cookie domain is outside the configured tool hosts.');
      normalized.domain = domain;
    }
    const path = cookie.path == null ? '/' : cookie.path;
    if (typeof path !== 'string' || !path.startsWith('/') || path.length > 2048) fail('Authorized cookie contains an invalid path.');
    normalized.path = path;

    if (cookie.expires != null) {
      const expires = Number(cookie.expires);
      if (!Number.isFinite(expires) || expires < -1 || expires > 32503680000) fail('Authorized cookie contains an invalid expiry.');
      if (expires > 0) normalized.expires = expires;
    }
    for (const flag of ['secure', 'httpOnly']) {
      if (cookie[flag] != null) {
        if (typeof cookie[flag] !== 'boolean') fail('Authorized cookie contains an invalid security flag.');
        normalized[flag] = cookie[flag];
      }
    }
    if (cookie.sameSite != null && cookie.sameSite !== '') {
      const raw = String(cookie.sameSite).toLowerCase();
      const sameSite = raw === 'strict' ? 'Strict' : raw === 'lax' ? 'Lax' : raw === 'none' ? 'None' : null;
      if (!sameSite) fail('Authorized cookie contains an invalid SameSite value.');
      normalized.sameSite = sameSite;
    }
    return normalized;
  });

  const rawStorage = browserState.storage ?? {};
  if (!rawStorage || typeof rawStorage !== 'object' || Array.isArray(rawStorage)) fail('Authorized browser storage must be an object.');
  const localStorage = normalizeStorageMap(rawStorage.localStorage ?? {});
  const sessionStorage = normalizeStorageMap(rawStorage.sessionStorage ?? {});
  if (Object.keys(localStorage).length + Object.keys(sessionStorage).length > MAX_STORAGE_ENTRIES) fail('Authorized browser storage contains too many entries.');
  if (!cookies.length && !Object.keys(localStorage).length && !Object.keys(sessionStorage).length) fail('Authorized browser state is empty.');

  return { state: { cookies, storage: { localStorage, sessionStorage } }, allowedHosts };
}

export function normalizeAuthenticationPolicy(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Authentication policy is invalid.', 422, 'AUTHENTICATION_POLICY_INVALID');
  const required = value.required === true;
  const urlContainsAny = value.urlContainsAny ?? [];
  const selectorsAny = value.selectorsAny ?? [];
  const timeoutSeconds = value.timeoutSeconds ?? 10;
  if (!Array.isArray(urlContainsAny) || !Array.isArray(selectorsAny) || urlContainsAny.length > 20 || selectorsAny.length > 20) fail('Authentication policy is invalid.', 422, 'AUTHENTICATION_POLICY_INVALID');
  for (const item of [...urlContainsAny, ...selectorsAny]) if (typeof item !== 'string' || !item || item.length > 512) fail('Authentication policy is invalid.', 422, 'AUTHENTICATION_POLICY_INVALID');
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 30) fail('Authentication policy is invalid.', 422, 'AUTHENTICATION_POLICY_INVALID');
  if (required && !urlContainsAny.length && !selectorsAny.length) fail('Authentication policy has no verification indicators.', 422, 'AUTHENTICATION_POLICY_INVALID');
  return { required, urlContainsAny: [...new Set(urlContainsAny)], selectorsAny: [...new Set(selectorsAny)], timeoutSeconds };
}

export async function installBrowserState(cdp, browserState, policy, launchUrl) {
  const { state, allowedHosts } = normalizeBrowserState(browserState, policy, launchUrl);
  if (!state) return { scriptIdentifier: null, injected: false };

  await cdp.send('Network.enable');
  if (state.cookies.length) {
    const origin = new URL(launchUrl).origin;
    const cookies = state.cookies.map((cookie) => {
      const target = { ...cookie };
      if (!target.domain) target.url = origin;
      return target;
    });
    const result = await cdp.send('Network.setCookies', { cookies }, 10000);
    if (result?.success === false) fail('Chromium rejected authorized cookies.');
  }

  const storage = state.storage;
  const source = `(() => {
    const allowedHosts=${JSON.stringify(allowedHosts)};
    const host=String(location.hostname||'').toLowerCase();
    const allowed=allowedHosts.some((candidate)=>host===candidate||host.endsWith('.'+candidate));
    if(!allowed) return;
    const local=${JSON.stringify(storage.localStorage)};
    const session=${JSON.stringify(storage.sessionStorage)};
    try { for(const [key,value] of Object.entries(local)) localStorage.setItem(key,value); } catch {}
    try { for(const [key,value] of Object.entries(session)) sessionStorage.setItem(key,value); } catch {}
  })();`;
  const bootstrap = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
  return { scriptIdentifier: bootstrap?.identifier || null, injected: true };
}

export async function removeBrowserStateBootstrap(cdp, scriptIdentifier) {
  if (!scriptIdentifier) return;
  try { await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptIdentifier }); } catch {}
}

function authenticationExpression(policy) {
  return `(() => {
    const policy=${JSON.stringify({ urlContainsAny: policy.urlContainsAny, selectorsAny: policy.selectorsAny })};
    const href=String(location.href||'');
    const urlOk=!policy.urlContainsAny.length||policy.urlContainsAny.some((needle)=>href.includes(needle));
    let selectorOk=!policy.selectorsAny.length;
    if(policy.selectorsAny.length){
      selectorOk=policy.selectorsAny.some((selector)=>{try{return !!document.querySelector(selector)}catch{return false}});
    }
    return {verified:urlOk&&selectorOk};
  })();`;
}

export async function checkAuthentication(cdp, policyInput = {}) {
  const policy = normalizeAuthenticationPolicy(policyInput);
  if (!policy.required) return { verified: true, required: false };

  try {
    const result = await cdp.send('Runtime.evaluate', {
      expression: authenticationExpression(policy),
      returnByValue: true,
    }, 5000);
    return { verified: result?.result?.value?.verified === true, required: true };
  } catch {
    return { verified: false, required: true };
  }
}

export async function verifyAuthentication(cdp, policyInput = {}) {
  const policy = normalizeAuthenticationPolicy(policyInput);
  if (!policy.required) return { verified: true, required: false };

  const deadline = Date.now() + policy.timeoutSeconds * 1000;
  while (Date.now() <= deadline) {
    const result = await checkAuthentication(cdp, policy);
    if (result.verified === true) return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  fail('Configured authenticated state was not verified.', 409, 'AUTHENTICATION_NOT_VERIFIED');
}
