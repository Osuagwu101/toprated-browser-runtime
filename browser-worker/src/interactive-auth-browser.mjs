import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH, validateNavigationUrl, validateViewerInput } from './browser-session.mjs';

const DISPLAY_MIN = 90;
const DISPLAY_MAX = 190;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function commandBuffer(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 12 * 1024 * 1024, ...options, encoding: null }, (error, stdout, stderr) => {
      if (error) {
        const detail = Buffer.isBuffer(stderr) ? stderr.toString('utf8').trim() : String(stderr || '').trim();
        reject(new Error(detail ? `${command} failed: ${detail.slice(-500)}` : `${command} failed.`));
        return;
      }
      resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || ''));
    });
  });
}

function processAlive(processRef) {
  return Boolean(processRef && processRef.exitCode === null && processRef.signalCode === null);
}

async function stopProcessGroup(processRef, graceMs = 2500) {
  if (!processRef || !processAlive(processRef)) return true;
  try { process.kill(-processRef.pid, 'SIGTERM'); } catch {}
  const exited = await new Promise((resolve) => {
    if (!processAlive(processRef)) return resolve(true);
    const timer = setTimeout(() => resolve(false), graceMs);
    processRef.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
  if (exited) return true;
  try { process.kill(-processRef.pid, 'SIGKILL'); } catch {}
  await sleep(150);
  return !processAlive(processRef);
}

function chromeWindowReady(display) {
  try {
    const output = execFileSync('/usr/bin/xdotool', ['search', '--onlyvisible', '--class', 'google-chrome'], {
      env: { ...process.env, DISPLAY: display },
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    });
    return String(output || '').trim() !== '';
  } catch {
    return false;
  }
}

export function buildInteractiveChromeArgs({ userDataDir, url }) {
  return [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-crash-reporter',
    `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,
    `--user-data-dir=${userDataDir}`,
    url,
  ];
}

export function assertInteractiveChromeArgs(args) {
  const joined = args.join(' ');
  for (const forbidden of [
    '--headless',
    '--remote-debugging-port',
    '--remote-debugging-address',
    '--enable-automation',
    '--disable-blink-features',
    '--no-sandbox',
  ]) {
    if (joined.includes(forbidden)) {
      throw new Error(`Interactive authentication Chrome must not use ${forbidden}.`);
    }
  }
  return true;
}

function xdotoolKey(input) {
  const key = String(input.key || '');
  const code = String(input.code || '');
  const direct = new Map([
    ['Enter', 'Return'],
    ['Tab', 'Tab'],
    ['Backspace', 'BackSpace'],
    ['Escape', 'Escape'],
    ['Delete', 'Delete'],
    ['ArrowUp', 'Up'],
    ['ArrowDown', 'Down'],
    ['ArrowLeft', 'Left'],
    ['ArrowRight', 'Right'],
    ['Home', 'Home'],
    ['End', 'End'],
    ['PageUp', 'Page_Up'],
    ['PageDown', 'Page_Down'],
    [' ', 'space'],
  ]);
  let result = direct.get(key) || direct.get(code) || '';
  if (!result && /^Key[A-Z]$/.test(code)) result = code.slice(3).toLowerCase();
  if (!result && /^Digit[0-9]$/.test(code)) result = code.slice(5);
  if (!result && /^F(?:[1-9]|1[0-2])$/.test(key)) result = key;
  if (!result) return '';

  const modifiers = Number(input.modifiers || 0);
  const prefix = [
    modifiers & 2 ? 'ctrl' : '',
    modifiers & 1 ? 'alt' : '',
    modifiers & 4 ? 'super' : '',
    modifiers & 8 ? 'shift' : '',
  ].filter(Boolean);
  return [...prefix, result].join('+');
}

export class InteractiveAuthBrowserManager {
  constructor({
    chromeExecutable = process.env.GOOGLE_CHROME_EXECUTABLE || '/usr/bin/google-chrome-stable',
    xvfbExecutable = process.env.XVFB_EXECUTABLE || '/usr/bin/Xvfb',
    profileRoot = process.env.AUTH_BROWSER_PROFILE_ROOT || tmpdir(),
    maxSessions = Number(process.env.MAX_BROWSER_SESSIONS || 3),
    automationController,
  } = {}) {
    this.chromeExecutable = chromeExecutable;
    this.xvfbExecutable = xvfbExecutable;
    this.profileRoot = profileRoot;
    this.maxSessions = maxSessions;
    this.automationController = automationController;
    this.sessions = new Map();
    this.startingCount = 0;
  }

  has(sessionId) { return this.sessions.has(String(sessionId || '')); }

  listStatus() {
    this.pruneExited();
    return {
      activeCount: this.sessions.size,
      startingCount: this.startingCount,
      sessions: [...this.sessions.values()].map((session) => this.present(session)),
    };
  }

  present(session) {
    return {
      active: true,
      sessionId: session.sessionId,
      pid: session.chrome.pid,
      url: session.url,
      title: 'Interactive administrator authentication',
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      viewer: 'restricted',
      displayMode: 'interactive-auth',
      browser: 'google-chrome-stable',
      automationAttached: false,
      authentication: { required: false, verified: false },
    };
  }

  assertSession(sessionId) {
    const session = this.sessions.get(String(sessionId || ''));
    if (!session) throw Object.assign(new Error('Browser session is closed.'), { statusCode: 410 });
    if (!processAlive(session.chrome) || !processAlive(session.xvfb)) {
      this.sessions.delete(session.sessionId);
      void this.cleanup(session);
      throw Object.assign(new Error('Browser session is closed.'), { statusCode: 410 });
    }
    return session;
  }

  status(sessionId) { return this.present(this.assertSession(sessionId)); }

  allocateDisplay() {
    const used = new Set([...this.sessions.values()].map((session) => session.display));
    for (let value = DISPLAY_MIN; value <= DISPLAY_MAX; value += 1) {
      const display = `:${value}`;
      if (!used.has(display) && !existsSync(`/tmp/.X11-unix/X${value}`)) return display;
    }
    throw Object.assign(new Error('No virtual display is available for interactive authentication.'), { statusCode: 429 });
  }

  async start(url) {
    this.pruneExited();
    if (this.sessions.size + this.startingCount >= this.maxSessions) {
      throw Object.assign(new Error('Browser worker capacity is full.'), { statusCode: 429 });
    }
    if (!existsSync(this.chromeExecutable)) throw new Error(`Google Chrome executable not found: ${this.chromeExecutable}`);
    if (!existsSync(this.xvfbExecutable)) throw new Error(`Xvfb executable not found: ${this.xvfbExecutable}`);
    if (!existsSync('/usr/bin/xdotool')) throw new Error('xdotool is required for interactive authentication.');
    if (!existsSync('/usr/bin/import')) throw new Error('ImageMagick import is required for interactive authentication.');

    const safeUrl = validateNavigationUrl(url);
    if (!safeUrl.startsWith('https://') && !safeUrl.startsWith('http://')) {
      throw Object.assign(new Error('Interactive authentication requires an HTTP or HTTPS URL.'), { statusCode: 422 });
    }

    this.startingCount += 1;
    const sessionId = randomUUID();
    const display = this.allocateDisplay();
    const profilePrefix = join(this.profileRoot, 'toprated-auth-');
    const userDataDir = mkdtempSync(profilePrefix);
    const xvfb = spawn(this.xvfbExecutable, [display, '-screen', '0', `${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}x24`, '-nolisten', 'tcp', '-noreset'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true,
    });
    let chrome = null;
    let stderr = '';

    try {
      const socketPath = `/tmp/.X11-unix/X${display.slice(1)}`;
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !existsSync(socketPath)) {
        if (!processAlive(xvfb)) throw new Error('Xvfb exited before the display became ready.');
        await sleep(50);
      }
      if (!existsSync(socketPath)) throw new Error('Xvfb display did not become ready.');

      const args = buildInteractiveChromeArgs({ userDataDir, url: safeUrl });
      assertInteractiveChromeArgs(args);
      chrome = spawn(this.chromeExecutable, args, {
        env: {
          ...process.env,
          DISPLAY: display,
          HOME: userDataDir,
          XDG_CONFIG_HOME: join(userDataDir, '.config'),
          XDG_CACHE_HOME: join(userDataDir, '.cache'),
        },
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: true,
      });
      chrome.stderr?.on('data', (chunk) => { if (stderr.length < 12000) stderr += String(chunk); });

      const chromeDeadline = Date.now() + 15000;
      while (Date.now() < chromeDeadline) {
        if (!processAlive(chrome)) throw new Error('Google Chrome exited before its window became ready.');
        if (chromeWindowReady(display)) break;
        await sleep(150);
      }
      if (!chromeWindowReady(display)) throw new Error('Google Chrome window did not become ready.');

      const session = { sessionId, display, userDataDir, url: safeUrl, chrome, xvfb };
      this.sessions.set(sessionId, session);
      chrome.once('exit', () => {
        if (!this.sessions.has(sessionId)) return;
        this.sessions.delete(sessionId);
        void this.cleanup(session);
      });

      console.log(JSON.stringify({
        event: 'interactive_auth_started',
        sessionId,
        browser: 'google-chrome-stable',
        automationAttached: false,
        displayMode: 'xvfb-headed',
      }));
      return this.present(session);
    } catch (error) {
      if (chrome) await stopProcessGroup(chrome);
      await stopProcessGroup(xvfb);
      rmSync(userDataDir, { recursive: true, force: true });
      const detail = stderr.trim().slice(-800);
      console.error(JSON.stringify({ event: 'interactive_auth_start_failed', code: 'INTERACTIVE_AUTH_LAUNCH_FAILED' }));
      throw Object.assign(new Error(detail ? `${error.message} Chrome: ${detail}` : error.message), {
        statusCode: error?.statusCode || 500,
        code: 'INTERACTIVE_AUTH_LAUNCH_FAILED',
      });
    } finally {
      this.startingCount -= 1;
    }
  }

  async frame(sessionId) {
    const session = this.assertSession(sessionId);
    return commandBuffer('/usr/bin/import', ['-display', session.display, '-window', 'root', 'jpeg:-'], {
      env: { ...process.env, DISPLAY: session.display },
    });
  }

  async input(sessionId, rawInput) {
    const session = this.assertSession(sessionId);
    const input = validateViewerInput(rawInput);
    const env = { ...process.env, DISPLAY: session.display };
    const run = (args) => commandBuffer('/usr/bin/xdotool', args, { env });

    if (input.type === 'mouse') {
      await run(['mousemove', '--sync', String(Math.round(input.x)), String(Math.round(input.y))]);
      if (input.event === 'pressed') await run(['mousedown', input.button === 'right' ? '3' : input.button === 'middle' ? '2' : '1']);
      if (input.event === 'released') await run(['mouseup', input.button === 'right' ? '3' : input.button === 'middle' ? '2' : '1']);
    } else if (input.type === 'scroll') {
      const verticalClicks = Math.min(12, Math.max(1, Math.round(Math.abs(input.deltaY) / 120)));
      if (Math.abs(input.deltaY) > 1) {
        for (let index = 0; index < verticalClicks; index += 1) await run(['click', input.deltaY > 0 ? '5' : '4']);
      }
    } else if (input.type === 'text') {
      await run(['type', '--clearmodifiers', '--delay', '0', '--', input.text]);
    } else if (input.type === 'key') {
      const key = xdotoolKey(input);
      if (!key) throw Object.assign(new Error('Keyboard key is not supported by the interactive authentication viewer.'), { statusCode: 400 });
      await run(['key', '--clearmodifiers', key]);
    }

    return { accepted: true };
  }

  async finalize(sessionId, { authentication, browserStatePolicy, launchUrl }) {
    if (!this.automationController) throw new Error('Interactive authentication finalization is not configured.');
    const session = this.assertSession(sessionId);

    // Authentication is intentionally human-only until this point. Chrome is
    // closed cleanly before CDP is ever attached to the authenticated profile.
    const chromeExited = await stopProcessGroup(session.chrome, 5000);
    if (!chromeExited) throw new Error('Interactive authentication Chrome did not close cleanly.');
    this.sessions.delete(sessionId);

    let automationSessionId = null;
    try {
      const validationPolicy = {
        required: false,
        allowedHosts: Array.isArray(browserStatePolicy?.allowedHosts) ? browserStatePolicy.allowedHosts : [],
      };
      const validated = await this.automationController.start(launchUrl, {
        userDataDir: session.userDataDir,
        preserveUserDataDir: true,
        browserStatePolicy: validationPolicy,
        authentication,
      });
      automationSessionId = validated.sessionId;
      if (validated?.authentication?.required !== true || validated?.authentication?.verified !== true) {
        throw Object.assign(new Error('Authenticated profile did not pass fresh-browser validation.'), {
          statusCode: 409,
          code: 'AUTHENTICATION_NOT_VERIFIED',
        });
      }
      const browserState = await this.automationController.exportAuthorizedState(automationSessionId);
      console.log(JSON.stringify({
        event: 'interactive_auth_validated',
        sessionId,
        validationBrowserSessionId: automationSessionId,
        browser: 'google-chrome-stable',
      }));
      return {
        authentication: validated.authentication,
        browserState,
        profileValidation: { verified: true, browser: 'google-chrome-stable' },
      };
    } finally {
      if (automationSessionId) {
        try { await this.automationController.stop(automationSessionId); } catch {}
      }
      await stopProcessGroup(session.xvfb);
      rmSync(session.userDataDir, { recursive: true, force: true });
    }
  }

  async stop(sessionId) {
    const session = this.sessions.get(String(sessionId || ''));
    if (!session) {
      return { active: false, sessionId: String(sessionId || ''), cleanup: { rootExited: true, orphanPids: [], zombiePids: [] } };
    }
    this.sessions.delete(session.sessionId);
    const clean = await this.cleanup(session);
    return {
      active: false,
      sessionId: session.sessionId,
      cleanup: {
        rootExited: clean,
        orphanPids: [],
        zombiePids: [],
      },
    };
  }

  async cleanup(session) {
    const chromeExited = await stopProcessGroup(session.chrome);
    const xvfbExited = await stopProcessGroup(session.xvfb);
    rmSync(session.userDataDir, { recursive: true, force: true });
    return chromeExited && xvfbExited;
  }

  async stopAll() {
    const results = [];
    for (const sessionId of [...this.sessions.keys()]) results.push(await this.stop(sessionId));
    return results;
  }

  pruneExited() {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (processAlive(session.chrome) && processAlive(session.xvfb)) continue;
      this.sessions.delete(sessionId);
      void this.cleanup(session);
    }
  }
}
