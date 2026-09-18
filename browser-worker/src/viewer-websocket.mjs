import { createHash } from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const length = body.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, body]);
}

export function parseViewerProtocols(value = '') {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

export function acceptWebSocketUpgrade(request, socket, protocol) {
  const key = String(request.headers['sec-websocket-key'] || '');
  const version = String(request.headers['sec-websocket-version'] || '');
  if (!key || version !== '13') throw Object.assign(new Error('Invalid WebSocket upgrade.'), { statusCode: 400 });
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    ...(protocol ? [`Sec-WebSocket-Protocol: ${protocol}`] : []),
    '\r\n',
  ].join('\r\n'));
}

export function createWebSocketPeer(socket, { maxMessageBytes = 16 * 1024 } = {}) {
  let buffer = Buffer.alloc(0); let closed = false; let fragments = []; let fragmentOpcode = 0;
  const listeners = { message: new Set(), close: new Set(), pong: new Set() };
  const emit = (name, ...args) => { for (const fn of listeners[name]) { try { fn(...args); } catch {} } };
  const close = (code = 1000, reason = '') => {
    if (closed) return; closed = true;
    const reasonBytes = Buffer.from(String(reason).slice(0, 120)); const payload = Buffer.alloc(2 + reasonBytes.length);
    payload.writeUInt16BE(code, 0); reasonBytes.copy(payload, 2);
    try { socket.write(frame(0x8, payload)); } catch {} try { socket.end(); } catch {}
  };
  const parse = () => {
    while (buffer.length >= 2) {
      const first = buffer[0], second = buffer[1], fin = (first & 0x80) !== 0, opcode = first & 0x0f, masked = (second & 0x80) !== 0;
      let length = second & 0x7f, offset = 2;
      if (!masked) { close(1002, 'Client frames must be masked.'); return; }
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (buffer.length < 10) return; const big = buffer.readBigUInt64BE(2); if (big > BigInt(maxMessageBytes)) { close(1009, 'Message too large.'); return; } length = Number(big); offset = 10; }
      if (length > maxMessageBytes || buffer.length < offset + 4 + length) { if (length > maxMessageBytes) close(1009, 'Message too large.'); return; }
      const mask = buffer.subarray(offset, offset + 4); offset += 4; const payload = Buffer.from(buffer.subarray(offset, offset + length)); buffer = buffer.subarray(offset + length);
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      if (opcode === 0x8) { close(); emit('close'); return; }
      if (opcode === 0x9) { try { socket.write(frame(0xA, payload)); } catch {} continue; }
      if (opcode === 0xA) { emit('pong'); continue; }
      if (opcode === 0x0) { fragments.push(payload); if (fin) { const merged = Buffer.concat(fragments); emit('message', fragmentOpcode, merged); fragments = []; fragmentOpcode = 0; } continue; }
      if (!fin) { fragmentOpcode = opcode; fragments = [payload]; continue; }
      if (opcode === 0x1 || opcode === 0x2) emit('message', opcode, payload); else { close(1003, 'Unsupported frame type.'); return; }
    }
  };
  socket.on('data', (chunk) => { if (closed) return; buffer = Buffer.concat([buffer, chunk]); parse(); });
  socket.on('close', () => { if (!closed) { closed = true; emit('close'); } });
  socket.on('error', () => { if (!closed) { closed = true; emit('close'); } });
  return {
    on(name, fn) { listeners[name]?.add(fn); return () => listeners[name]?.delete(fn); },
    sendJson(value) { if (!closed) socket.write(frame(0x1, Buffer.from(JSON.stringify(value)))); },
    sendBinary(value) { if (!closed) socket.write(frame(0x2, value)); },
    ping() { if (!closed) socket.write(frame(0x9)); }, close,
    get closed() { return closed; },
  };
}
