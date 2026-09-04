import { existsSync } from 'node:fs';
import { MAX_SUPPORTED_BROWSER_SESSIONS, RUNTIME_PHASE } from './browser-session.mjs';

export function buildHealthPayload(env = process.env) {
  const browserExecutable = env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium';
  const maxSessions = Number(env.MAX_BROWSER_SESSIONS || 3);
  const capacityConfigured = Number.isInteger(maxSessions) && maxSessions >= 1 && maxSessions <= MAX_SUPPORTED_BROWSER_SESSIONS;
  const chromiumInstalled = existsSync(browserExecutable);
  return {
    status: capacityConfigured && chromiumInstalled ? 'ok' : 'degraded',
    service: 'browser-worker',
    phase: RUNTIME_PHASE,
    browserCore: 'generic',
    control: 'cdp',
    lifecycleOwner: 'laravel',
    crashWatchdog: 'process-exit-cleanup',
    viewer: {
      mode: 'restricted-frame-input',
      auth: 'signed-bearer',
      grantIssuer: 'laravel',
      rawCdpExposed: false,
    },
    capacity: {
      maxSessions,
      maxSupportedSessions: MAX_SUPPORTED_BROWSER_SESSIONS,
      configurationValid: capacityConfigured,
    },
    chromium: {
      executable: browserExecutable,
      installed: chromiumInstalled,
    },
  };
}
