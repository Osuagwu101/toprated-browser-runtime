import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { installBrowserState, removeBrowserStateBootstrap, verifyAuthentication } from './browser-state.mjs';

const DEFAULT_TEST_URL = 'data:text/html,%3Ctitle%3EPhase%206%20Browser%20Test%3C/title%3E%3Ch1%3ESafe%20test%20page%3C/h1%3E';
export const VIEWPORT_WIDTH = 1440;
export const VIEWPORT_HEIGHT = 900;
export const MAX_SUPPORTED_BROWSER_SESSIONS = 15;
export const RUNTIME_PHASE = 6;

export function validateNavigationUrl(value) {
  const raw = String(value || DEFAULT_TEST_URL).trim();
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('Navigation URL is invalid.'); }
  if (!['http:', 'https:', 'data:'].includes(parsed.protocol)) throw new Error('Navigation URL must use http, https, or data.');
  if (parsed.protocol === 'data:' && !raw.toLowerCase().startsWith('data:text/html')) throw new Error('Only data:text/html URLs are allowed for data navigation.');
  return raw;
}

function numeric(value, field) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw Object.assign(new Error(`${field} must be a finite number.`), { statusCode: 400 });
  return result;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export function validateViewerInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Viewer input must be a JSON object.'), { statusCode: 400 });
  const type = String(input.type || '');
  if (type === 'mouse') {
    const event = String(input.event || '');
    if (!['moved', 'pressed', 'released'].includes(event)) throw Object.assign(new Error('Mouse event must be moved, pressed, or released.'), { statusCode: 400 });
    const button = String(input.button || (event === 'moved' ? 'none' : 'left'));
    if (!['none', 'left', 'middle', 'right'].includes(button)) throw Object.assign(new Error('Mouse button is invalid.'), { statusCode: 400 });
    return { type, event, button, x: clamp(numeric(input.x, 'x'), 0, VIEWPORT_WIDTH - 1), y: clamp(numeric(input.y, 'y'), 0, VIEWPORT_HEIGHT - 1) };
  }
  if (type === 'scroll') return { type, x: clamp(numeric(input.x, 'x'), 0, VIEWPORT_WIDTH - 1), y: clamp(numeric(input.y, 'y'), 0, VIEWPORT_HEIGHT - 1), deltaX: clamp(numeric(input.deltaX ?? 0, 'deltaX'), -2000, 2000), deltaY: clamp(numeric(input.deltaY ?? 0, 'deltaY'), -2000, 2000) };
  if (type === 'text') {
    const text = String(input.text ?? '');
    if (!text || text.length > 2000) throw Object.assign(new Error('Text input must contain between 1 and 2000 characters.'), { statusCode: 400 });
    return { type, text };
  }
  if (type === 'key') {
    const key = String(input.key || ''); const code = String(input.code || ''); const modifiers = Number(input.modifiers || 0);
    if (!key || key.length > 64 || code.length > 64) throw Object.assign(new Error('Keyboard input is invalid.'), { statusCode: 400 });
    if (!Number.isInteger(modifiers) || modifiers < 0 || modifiers > 15) throw Object.assign(new Error('Keyboard modifiers are invalid.'), { statusCode: 400 });
    return { type, key, code, modifiers };
  }
  throw Object.assign(new Error('Viewer input type must be mouse, scroll, text, or key.'), { statusCode: 400 });
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function readProcessState(pid) { try { const status = readFileSync(`/proc/${pid}/status`, 'utf8'); return status.match(/^State:\s+([A-Z])/m)?.[1] || null; } catch { return null; } }
function collectProcessTree(rootPid) {
  const parentMap = new Map(); let entries = [];
  try { entries = readdirSync('/proc', { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name)).map((entry) => Number(entry.name)); } catch { return [rootPid]; }
  for (const pid of entries) {
    try { const status = readFileSync(`/proc/${pid}/status`, 'utf8'); const parent = Number(status.match(/^PPid:\s+(\d+)/m)?.[1] || 0); if (!parentMap.has(parent)) parentMap.set(parent, []); parentMap.get(parent).push(pid); } catch {}
  }
  const result = []; const queue = [rootPid]; const seen = new Set();
  while (queue.length) { const pid = queue.shift(); if (seen.has(pid)) continue; seen.add(pid); result.push(pid); for (const child of parentMap.get(pid) || []) queue.push(child); }
  return result;
}

class CdpClient {
  constructor(webSocketUrl) { this.webSocketUrl = webSocketUrl; this.socket = null; this.nextId = 1; this.pending = new Map(); this.eventWaiters = new Map(); }
  async connect(timeoutMs = 5000) {
    const socket = new WebSocket(this.webSocketUrl); this.socket = socket;
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('CDP WebSocket connection timed out.')), timeoutMs); socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true }); socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket connection failed.')); }, { once: true }); });
    socket.addEventListener('message', (event) => {
      let message; try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.id && this.pending.has(message.id)) { const { resolve, reject, timer } = this.pending.get(message.id); clearTimeout(timer); this.pending.delete(message.id); if (message.error) reject(new Error(message.error.message || 'CDP command failed.')); else resolve(message.result || {}); return; }
      if (message.method && this.eventWaiters.has(message.method)) { const waiters = this.eventWaiters.get(message.method); this.eventWaiters.delete(message.method); for (const waiter of waiters) { clearTimeout(waiter.timer); waiter.resolve(message.params || {}); } }
    });
    socket.addEventListener('close', () => { for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error('CDP connection closed.')); } this.pending.clear(); });
  }
  send(method, params = {}, timeoutMs = 5000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP connection is not open.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP command timed out: ${method}`)); }, timeoutMs); this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  waitForEvent(method, timeoutMs = 5000) { return new Promise((resolve, reject) => { const timer = setTimeout(() => { const current = this.eventWaiters.get(method) || []; this.eventWaiters.set(method, current.filter((item) => item.resolve !== resolve)); reject(new Error(`CDP event timed out: ${method}`)); }, timeoutMs); const waiters = this.eventWaiters.get(method) || []; waiters.push({ resolve, reject, timer }); this.eventWaiters.set(method, waiters); }); }
  close() { try { this.socket?.close(); } catch {} this.socket = null; }
}

async function waitForDevToolsPort(userDataDir, processRef, timeoutMs = 10000) {
  const portFile = join(userDataDir, 'DevToolsActivePort'); const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (processRef.exitCode !== null || processRef.signalCode !== null) throw new Error(`Chromium exited before CDP became available (code ${processRef.exitCode}, signal ${processRef.signalCode || 'none'}).`); if (existsSync(portFile)) { const [portLine] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/); const port = Number(portLine); if (Number.isInteger(port) && port > 0) return port; } await sleep(50); }
  throw new Error('Chromium did not expose a CDP port in time.');
}
async function findPageTarget(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs; let lastError = null;
  while (Date.now() < deadline) { try { const response = await fetch(`http://127.0.0.1:${port}/json/list`); if (!response.ok) throw new Error(`HTTP ${response.status}`); const targets = await response.json(); const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl); if (page) return page; } catch (error) { lastError = error; } await sleep(50); }
  throw new Error(`No Chromium page target became available${lastError ? `: ${lastError.message}` : '.'}`);
}
function collectProcessGroup(groupId) {
  const result = []; let entries = [];
  try { entries = readdirSync('/proc', { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name)).map((entry) => Number(entry.name)); } catch { return result; }
  for (const pid of entries) {
    try { const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); const tail = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/); if (Number(tail[2]) === groupId) result.push(pid); } catch {}
  }
  return result;
}
function killProcessGroup(groupId, signal) { try { process.kill(-groupId, signal); return true; } catch { return false; } }
async function waitForExit(processRef, timeoutMs) { if (processRef.exitCode !== null || processRef.signalCode !== null) return true; return new Promise((resolve) => { const timer = setTimeout(() => resolve(false), timeoutMs); processRef.once('exit', () => { clearTimeout(timer); resolve(true); }); }); }

export class BrowserSessionController {
  constructor({ executablePath = process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium', maxSessions = Number(process.env.MAX_BROWSER_SESSIONS || 3) } = {}) {
    if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > MAX_SUPPORTED_BROWSER_SESSIONS) throw new Error(`MAX_BROWSER_SESSIONS must be an integer between 1 and ${MAX_SUPPORTED_BROWSER_SESSIONS}.`);
    this.executablePath = executablePath;
    this.maxSessions = maxSessions;
    this.sessions = new Map();
    this.startingCount = 0;
  }

  get status() {
    const snapshot = this.listStatus(); const sessions = snapshot.sessions;
    if (sessions.length === 0) return { active: false, phase: RUNTIME_PHASE, activeCount: 0, maxSessions: this.maxSessions };
    if (sessions.length === 1) return { ...sessions[0], activeCount: 1, maxSessions: this.maxSessions };
    return { active: true, phase: RUNTIME_PHASE, activeCount: sessions.length, maxSessions: this.maxSessions, sessions };
  }

  listStatus() {
    this.pruneExited();
    return { phase: RUNTIME_PHASE, activeCount: this.sessions.size, startingCount: this.startingCount, maxSessions: this.maxSessions, sessions: [...this.sessions.values()].map((session) => this.present(session)) };
  }

  present(session) {
    return {
      active: true,
      phase: RUNTIME_PHASE,
      sessionId: session.sessionId,
      pid: session.process.pid,
      url: session.url,
      title: session.title,
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      viewer: 'restricted',
      authentication: { required: session.authenticationRequired === true, verified: session.authenticationVerified === true },
    };
  }
  isProcessAlive(session) { return session.process.exitCode === null && session.process.signalCode === null && existsSync(`/proc/${session.process.pid}`); }
  pruneExited() { for (const [sessionId, session] of this.sessions.entries()) if (!this.isProcessAlive(session)) this.scheduleUnexpectedExitCleanup(sessionId); }
  scheduleUnexpectedExitCleanup(sessionId) {
    const session = this.sessions.get(sessionId); if (!session) return;
    this.sessions.delete(sessionId);
    void this.cleanupSession(session).then((cleanup) => console.log(JSON.stringify({ event: 'browser_crash_reaped', sessionId, cleanup }))).catch((error) => console.error(JSON.stringify({ event: 'browser_crash_cleanup_failed', sessionId, message: String(error.message || error) })));
  }
  assertSession(sessionId) {
    const id = String(sessionId || ''); const session = this.sessions.get(id);
    if (!session) throw Object.assign(new Error('Browser session is closed.'), { statusCode: 410 });
    if (!this.isProcessAlive(session)) { this.scheduleUnexpectedExitCleanup(id); throw Object.assign(new Error('Browser session is closed.'), { statusCode: 410 }); }
    return session;
  }
  getStatus(sessionId) { return this.present(this.assertSession(sessionId)); }
  onlySessionId() { this.pruneExited(); if (this.sessions.size === 0) throw Object.assign(new Error('No browser session is active.'), { statusCode: 409 }); if (this.sessions.size !== 1) throw Object.assign(new Error('Legacy single-session operation is ambiguous while multiple browser sessions are active.'), { statusCode: 409 }); return this.sessions.keys().next().value; }

  async start(url = DEFAULT_TEST_URL, options = {}) {
    this.pruneExited();
    if (this.sessions.size + this.startingCount >= this.maxSessions) throw Object.assign(new Error('Browser worker capacity is full.'), { statusCode: 429 });
    if (!existsSync(this.executablePath)) throw new Error(`Chromium executable not found: ${this.executablePath}`);
    this.startingCount += 1;
    const safeUrl = validateNavigationUrl(url);
    const userDataDir = mkdtempSync(join(tmpdir(), 'toprated-browser-'));
    const browserProcess = spawn(this.executablePath, ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-crash-reporter','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,`--user-data-dir=${userDataDir}`,'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
    let stderr = ''; browserProcess.stderr?.on('data', (chunk) => { if (stderr.length < 12000) stderr += String(chunk); });
    let sessionId = null;
    try {
      const port = await waitForDevToolsPort(userDataDir, browserProcess);
      const target = await findPageTarget(port);
      const cdp = new CdpClient(target.webSocketDebuggerUrl);
      await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT, deviceScaleFactor: 1, mobile: false });
      sessionId = randomUUID();
      this.sessions.set(sessionId, {
        sessionId,
        process: browserProcess,
        userDataDir,
        port,
        cdp,
        url: 'about:blank',
        title: '',
        authenticationRequired: options?.authentication?.required === true,
        authenticationVerified: false,
      });
      browserProcess.once('exit', () => { if (sessionId && this.sessions.has(sessionId)) this.scheduleUnexpectedExitCleanup(sessionId); });

      const bootstrap = await installBrowserState(cdp, options?.browserState, options?.browserStatePolicy || {}, safeUrl);
      try {
        await this.navigate(sessionId, safeUrl);
      } finally {
        await removeBrowserStateBootstrap(cdp, bootstrap.scriptIdentifier);
      }
      const authentication = await verifyAuthentication(cdp, options?.authentication || {});
      const session = this.assertSession(sessionId);
      session.authenticationRequired = authentication.required === true;
      session.authenticationVerified = authentication.verified === true;
      return this.getStatus(sessionId);
    } catch (error) {
      if (sessionId && this.sessions.has(sessionId)) { try { await this.stop(sessionId); } catch {} }
      else { if (!killProcessGroup(browserProcess.pid, 'SIGKILL')) { try { browserProcess.kill('SIGKILL'); } catch {} } await waitForExit(browserProcess, 2000); rmSync(userDataDir, { recursive: true, force: true }); }
      const detail = stderr.trim().slice(-1500);
      const wrapped = new Error(detail ? `${error.message} Chromium: ${detail}` : error.message);
      if (error?.statusCode) wrapped.statusCode = error.statusCode;
      if (error?.code) wrapped.code = error.code;
      throw wrapped;
    } finally { this.startingCount -= 1; }
  }

  async refreshMetadata(sessionId) {
    const session = this.assertSession(sessionId);
    const evaluation = await session.cdp.send('Runtime.evaluate', { expression: '({title: document.title, url: location.href, readyState: document.readyState})', returnByValue: true });
    const value = evaluation.result?.value || {}; session.url = String(value.url || session.url || 'about:blank'); session.title = String(value.title || '');
    return { ...this.present(session), readyState: String(value.readyState || '') };
  }
  async navigate(sessionId, url) { const session = this.assertSession(sessionId); const safeUrl = validateNavigationUrl(url); const loadEvent = session.cdp.waitForEvent('Page.loadEventFired', 10000); const result = await session.cdp.send('Page.navigate', { url: safeUrl }, 10000); if (result.errorText) throw new Error(`Chromium navigation failed: ${result.errorText}`); await loadEvent; return { ...(await this.refreshMetadata(sessionId)), control: 'cdp' }; }
  async navigateOnly(url) { return this.navigate(this.onlySessionId(), url); }
  async captureFrame(sessionId) { const session = this.assertSession(sessionId); const result = await session.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 72, fromSurface: true, captureBeyondViewport: false }, 10000); if (!result.data) throw new Error('Chromium did not return a viewer frame.'); return Buffer.from(result.data, 'base64'); }
  async sendViewerInput(sessionId, input) {
    const session = this.assertSession(sessionId); const normalized = validateViewerInput(input);
    if (normalized.type === 'mouse') { const type = normalized.event === 'moved' ? 'mouseMoved' : normalized.event === 'pressed' ? 'mousePressed' : 'mouseReleased'; await session.cdp.send('Input.dispatchMouseEvent', { type, x: normalized.x, y: normalized.y, button: normalized.button, clickCount: normalized.event === 'moved' ? 0 : 1 }); }
    else if (normalized.type === 'scroll') { await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: normalized.x, y: normalized.y, deltaX: normalized.deltaX, deltaY: normalized.deltaY }); await sleep(60); }
    else if (normalized.type === 'text') await session.cdp.send('Input.insertText', { text: normalized.text });
    else if (normalized.type === 'key') { const params = { key: normalized.key, code: normalized.code, modifiers: normalized.modifiers }; await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params }); await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params }); await sleep(30); }
    return { inputAccepted: true, ...(await this.refreshMetadata(sessionId)) };
  }

  async cleanupSession(session) {
    const rootPid = session.process.pid;
    const trackedPids = [...new Set([...collectProcessTree(rootPid), ...collectProcessGroup(rootPid)])];
    session.cdp.close();
    if (!killProcessGroup(rootPid, 'SIGTERM')) { try { session.process.kill('SIGTERM'); } catch {} }
    let rootExited = await waitForExit(session.process, 5000); let groupPids = collectProcessGroup(rootPid);
    if (!rootExited || groupPids.length) { if (!killProcessGroup(rootPid, 'SIGKILL')) { try { session.process.kill('SIGKILL'); } catch {} } rootExited = await waitForExit(session.process, 2000); }
    await sleep(250); groupPids = collectProcessGroup(rootPid);
    let orphanPids = [...new Set([...trackedPids.filter((pid) => existsSync(`/proc/${pid}`)), ...groupPids])];
    if (orphanPids.length) { killProcessGroup(rootPid, 'SIGKILL'); for (const pid of orphanPids) { try { process.kill(pid, 'SIGKILL'); } catch {} } await sleep(250); }
    groupPids = collectProcessGroup(rootPid); orphanPids = [...new Set([...trackedPids.filter((pid) => existsSync(`/proc/${pid}`)), ...groupPids])];
    const zombiePids = orphanPids.filter((pid) => readProcessState(pid) === 'Z');
    rmSync(session.userDataDir, { recursive: true, force: true });
    return { rootExited, orphanPids, zombiePids };
  }
  async stop(sessionId) { const id = String(sessionId || ''); const session = this.sessions.get(id); if (!session) return { active: false, phase: RUNTIME_PHASE, sessionId: id || null, cleanup: { rootExited: true, orphanPids: [], zombiePids: [] } }; this.sessions.delete(id); const pid = session.process.pid; const cleanup = await this.cleanupSession(session); return { active: false, phase: RUNTIME_PHASE, sessionId: id, pid, cleanup }; }
  async stopOnly() { this.pruneExited(); if (this.sessions.size === 0) return { active: false, phase: RUNTIME_PHASE, cleanup: { rootExited: true, orphanPids: [], zombiePids: [] } }; return this.stop(this.onlySessionId()); }
  async stopAll() { const results = []; for (const sessionId of [...this.sessions.keys()]) results.push(await this.stop(sessionId)); return results; }
}
