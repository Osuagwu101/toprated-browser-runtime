import { existsSync } from 'node:fs';

export function buildHealthPayload(env = process.env) {
  const browserExecutable = env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium';
  return {
    status: 'ok',
    service: 'browser-worker',
    phase: 4,
    browserCore: 'generic',
    control: 'cdp',
    lifecycleOwner: 'laravel',
    viewer: {
      mode: 'restricted-frame-input',
      auth: 'signed-bearer',
      grantIssuer: 'laravel',
      rawCdpExposed: false,
    },
    chromium: {
      executable: browserExecutable,
      installed: existsSync(browserExecutable),
    },
  };
}
