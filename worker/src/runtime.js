import { execFileSync } from 'node:child_process';

export const RUNTIME_IDENTITY = Object.freeze({
  provider: 'self_hosted',
  engine: 'chromium',
  controller: 'playwright_cdp',
  toolSpecific: false,
});

export function chromiumInfo(executablePath = process.env.CHROMIUM_PATH || '/usr/bin/chromium') {
  try {
    const version = execFileSync(executablePath, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return { available: true, executablePath, version };
  } catch {
    return { available: false, executablePath, version: null };
  }
}

export function healthSnapshot() {
  return {
    status: 'ok',
    service: 'browser-worker',
    phase: 2,
    ...RUNTIME_IDENTITY,
    chromium: chromiumInfo(),
  };
}
