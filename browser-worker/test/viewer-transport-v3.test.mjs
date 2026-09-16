import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/viewer-page.mjs', import.meta.url), 'utf8');

test('WebSocket input hot path is ordered and skips legacy per-input metadata refresh', () => {
  assert.match(server, /let inputQueue = Promise\.resolve\(\)/);
  assert.match(server, /inputQueue = inputQueue\.then/);
  assert.match(server, /sessionInput\(route\.sessionId, message\.input, false\)/);
});

test('connection heartbeat revalidates tool authentication', () => {
  assert.match(server, /assertViewerToolAuthentication\(route\.sessionId\).*peer\.ping/s);
  assert.match(server, /15000/);
});

test('large paste is chunked below the runtime text-input bound', () => {
  assert.match(page, /offset\+=1800/);
  assert.match(page, /value\.slice\(offset,offset\+1800\)/);
  assert.match(page, /if\(text\)textInput\(text\)/);
});
