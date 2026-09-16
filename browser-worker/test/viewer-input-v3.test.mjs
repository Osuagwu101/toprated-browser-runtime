import test from 'node:test';
import assert from 'node:assert/strict';
import { validateViewerInput } from '../src/browser-session.mjs';

test('viewer coordinates clamp to the active responsive viewport', () => {
  const viewport = { width: 1000, height: 600 };
  const mouse = validateViewerInput({
    type: 'mouse', event: 'pressed', button: 'left', x: 5000, y: 5000,
  }, viewport);
  assert.equal(mouse.x, 999);
  assert.equal(mouse.y, 599);

  const scroll = validateViewerInput({
    type: 'scroll', x: -10, y: -20, deltaX: 0, deltaY: 4000,
  }, viewport);
  assert.equal(scroll.x, 0);
  assert.equal(scroll.y, 0);
  assert.equal(scroll.deltaY, 2000);
});

test('text batches preserve exact character order for rapid typing', () => {
  const source = Array.from({ length: 1500 }, (_, i) => String.fromCharCode(33 + (i % 90))).join('');
  const accepted = validateViewerInput({ type: 'text', text: source });
  assert.equal(accepted.text, source);
});
