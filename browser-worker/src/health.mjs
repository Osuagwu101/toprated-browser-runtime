import { existsSync } from 'node:fs';
import { MAX_SUPPORTED_BROWSER_SESSIONS } from './browser-session.mjs';

export function buildHealthPayload(env = process.env) {
  const browserExecutable = env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium';
  const maxSessions = Number(env.MAX_BROWSER_SESSIONS || 3);
  const capacityConfigured = Number.isInteger(maxSessions) && maxSessions >= 1 && maxSessions <= MAX_SUPPORTED_BROWSER_SESSIONS;
  const chromiumInstalled = existsSync(browserExecutable);
  return {
    status: capacityConfigured && chromiumInstalled ? 'ok' : 'degraded',
    service: 'browser-worker',
    phase: 5,
    browserCore: 'generic',
    control: 'cdp',
    lifecycleOwner: 'laravel',
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
