import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const DEFAULT_URL = 'data:text/html,%3Ctitle%3EPhase%202%3C/title%3E%3Ch1%3ESafe%20browser%20test%3C/h1%3E';

export function validateNavigationUrl(value) {
  const raw = String(value || DEFAULT_URL).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw Object.assign(new Error('invalid_navigation_url'), { statusCode: 400 });
  }
  if (!['http:', 'https:', 'data:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('unsupported_navigation_scheme'), { statusCode: 400 });
  }
  if (parsed.protocol === 'data:' && !raw.toLowerCase().startsWith('data:text/html')) {
    throw Object.assign(new Error('data_url_must_be_html'), { statusCode: 400 });
  }
  return raw;
}

export function chromiumPids() {
  const pids = [];
  for (const entry of readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    try {
      const comm = readFileSync(`/proc/${entry.name}/comm`, 'utf8').trim();
      if (comm === 'chromium' || comm === 'chrome') pids.push(Number(entry.name));
    } catch {
      // Process may exit while /proc is scanned.
    }
  }
  return pids.sort((a, b) => a - b);
}

export class BrowserController {
  constructor({ executablePath = process.env.CHROMIUM_PATH || '/usr/bin/chromium' } = {}) {
    this.executablePath = executablePath;
    this.current = null;
    this.lastDisconnect = null;
  }

  status() {
    if (!this.current) {
      return {
        active: false,
        phase: 2,
        provider: 'self_hosted',
        lastDisconnect: this.lastDisconnect,
        chromiumPids: chromiumPids(),
      };
    }
    return {
      active: true,
      phase: 2,
      provider: 'self_hosted',
      sessionId: this.current.sessionId,
      url: this.current.page.url(),
      chromiumPids: chromiumPids(),
    };
  }

  async start(url = DEFAULT_URL) {
    if (this.current) {
      throw Object.assign(new Error('browser_already_active'), { statusCode: 409 });
    }
    if (!existsSync(this.executablePath)) {
      throw Object.assign(new Error('chromium_executable_missing'), { statusCode: 503 });
    }

    const safeUrl = validateNavigationUrl(url);
    let browser;
    try {
      browser = await chromium.launch({
        executablePath: this.executablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      const sessionId = randomUUID();

      this.current = { browser, context, page, sessionId };
      this.lastDisconnect = null;

      browser.on('disconnected', () => {
        if (this.current?.browser === browser) {
          this.current = null;
          this.lastDisconnect = { reason: 'browser_disconnected', at: new Date().toISOString() };
        }
      });

      await page.goto(safeUrl, { waitUntil: 'load', timeout: 10000 });
      return await this.snapshot();
    } catch (error) {
      if (browser) {
        try { await browser.close(); } catch {}
      }
      this.current = null;
      throw error;
    }
  }

  async snapshot() {
    if (!this.current) {
      throw Object.assign(new Error('browser_not_active'), { statusCode: 409 });
    }
    const { page, sessionId } = this.current;
    return {
      active: true,
      phase: 2,
      provider: 'self_hosted',
      sessionId,
      url: page.url(),
      title: await page.title(),
      readyState: await page.evaluate(() => document.readyState),
      chromiumPids: chromiumPids(),
    };
  }

  async navigate(url) {
    if (!this.current) {
      throw Object.assign(new Error('browser_not_active'), { statusCode: 409 });
    }
    const safeUrl = validateNavigationUrl(url);
    await this.current.page.goto(safeUrl, { waitUntil: 'load', timeout: 10000 });
    return await this.snapshot();
  }

  async stop() {
    const session = this.current;
    this.current = null;
    if (session) {
      try { await session.context.close(); } catch {}
      try { await session.browser.close(); } catch {}
    }

    const deadline = Date.now() + 4000;
    let remaining = chromiumPids();
    while (remaining.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      remaining = chromiumPids();
    }

    return {
      active: false,
      phase: 2,
      provider: 'self_hosted',
      sessionId: session?.sessionId || null,
      cleanup: {
        chromiumPids: remaining,
        clean: remaining.length === 0,
      },
    };
  }
}
