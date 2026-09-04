import test from 'node:test';
import assert from 'node:assert/strict';
import { RUNTIME_IDENTITY } from '../src/runtime.js';

test('runtime core is a generic self-hosted Chromium provider', () => {
  assert.equal(RUNTIME_IDENTITY.provider, 'self_hosted');
  assert.equal(RUNTIME_IDENTITY.engine, 'chromium');
  assert.equal(RUNTIME_IDENTITY.controller, 'playwright_cdp');
  assert.equal(RUNTIME_IDENTITY.toolSpecific, false);
});

test('runtime identity contains no tool-specific product names', () => {
  const serialized = JSON.stringify(RUNTIME_IDENTITY).toLowerCase();
  for (const forbidden of ['phrasly', 'sneakwrite', 'stealthwriter']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
