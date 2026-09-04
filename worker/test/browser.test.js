import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserController, validateNavigationUrl } from '../src/browser.js';

test('navigation URL validator accepts supported schemes', () => {
  assert.equal(validateNavigationUrl('https://example.com/'), 'https://example.com/');
  assert.equal(validateNavigationUrl('http://example.com/'), 'http://example.com/');
  assert.match(validateNavigationUrl('data:text/html,%3Ctitle%3ETest%3C/title%3E'), /^data:text\/html/);
});

test('navigation URL validator rejects unsupported schemes', () => {
  assert.throws(() => validateNavigationUrl('file:///etc/passwd'), /unsupported_navigation_scheme/);
  assert.throws(() => validateNavigationUrl('javascript:alert(1)'), /unsupported_navigation_scheme/);
  assert.throws(() => validateNavigationUrl('data:text/plain,hello'), /data_url_must_be_html/);
});

test('missing Chromium executable fails closed and leaves controller inactive', async () => {
  const controller = new BrowserController({ executablePath: '/definitely/not/chromium' });
  await assert.rejects(controller.start('data:text/html,%3Ctitle%3ETest%3C/title%3E'), /chromium_executable_missing/);
  assert.equal(controller.status().active, false);
});
