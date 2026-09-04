import { WebSocketServer, WebSocket } from 'ws';
import { validateNavigationUrl } from './browser.js';

const VIEWPORT = Object.freeze({ width: 1280, height: 720 });

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function mouseButton(value) {
  return ['left', 'middle', 'right'].includes(value) ? value : ['left', 'middle', 'right'][Number(value)] || 'left';
}

export class ViewerHub {
  constructor({ controller, tokenManager, frameIntervalMs = Number(process.env.VIEWER_FRAME_INTERVAL_MS || 250) }) {
    this.controller = controller;
    this.tokenManager = tokenManager;
    this.frameIntervalMs = Math.max(100, Math.min(2000, Number(frameIntervalMs) || 250));
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    this.connections = new Set();
    this.wss.on('connection', (socket, request, auth) => this.onConnection(socket, request, auth));
  }

  handleUpgrade(request, socket, head) {
    let parsed;
    try {
      parsed = new URL(request.url, 'http://viewer.local');
    } catch {
      socket.destroy();
      return;
    }
    if (parsed.pathname !== '/viewer/ws') {
      socket.destroy();
      return;
    }

    const current = this.controller.current;
    if (!current) {
      this.rejectUpgrade(socket, 409, 'browser_not_active');
      return;
    }

    const token = parsed.searchParams.get('token');
    const auth = this.tokenManager.verify(token, current.sessionId);
    if (!auth.valid) {
      this.rejectUpgrade(socket, 401, auth.reason);
      return;
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request, { ...auth, token });
    });
  }

  rejectUpgrade(socket, status, reason) {
    const text = JSON.stringify({ error: reason });
    socket.write(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Conflict'}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(text)}\r\nConnection: close\r\n\r\n${text}`);
    socket.destroy();
  }

  onConnection(socket, _request, auth) {
    const connection = { socket, sessionId: auth.sessionId, closed: false };
    this.connections.add(connection);

    const current = this.controller.current;
    if (!current || current.sessionId !== auth.sessionId) {
      socket.close(4409, 'session_unavailable');
      return;
    }

    socket.send(JSON.stringify({
      type: 'hello',
      sessionId: auth.sessionId,
      viewport: VIEWPORT,
      url: current.page.url(),
      expiresAt: new Date(auth.expiresAt).toISOString(),
    }));

    socket.on('message', async (payload, isBinary) => {
      if (isBinary) return;
      try {
        const message = JSON.parse(String(payload));
        await this.handleInput(connection, message);
      } catch (error) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'error', error: String(error?.message || 'invalid_input') }));
        }
      }
    });

    socket.on('close', () => {
      connection.closed = true;
      this.connections.delete(connection);
    });

    socket.on('error', () => {});
    void this.stream(connection);
  }

  async stream(connection) {
    while (!connection.closed && connection.socket.readyState === WebSocket.OPEN) {
      const current = this.controller.current;
      if (!current || current.sessionId !== connection.sessionId) {
        connection.socket.close(4409, 'session_ended');
        break;
      }

      try {
        const frame = await current.page.screenshot({ type: 'jpeg', quality: 65, animations: 'disabled' });
        if (connection.socket.readyState === WebSocket.OPEN) connection.socket.send(frame, { binary: true });
      } catch {
        connection.socket.close(1011, 'frame_capture_failed');
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, this.frameIntervalMs));
    }
  }

  async handleInput(connection, message) {
    const current = this.controller.current;
    if (!current || current.sessionId !== connection.sessionId) throw new Error('session_unavailable');
    const page = current.page;

    switch (message?.type) {
      case 'mouse': {
        const x = clamp(message.x, 0, VIEWPORT.width);
        const y = clamp(message.y, 0, VIEWPORT.height);
        if (message.action === 'move') await page.mouse.move(x, y);
        else if (message.action === 'down') await page.mouse.down({ button: mouseButton(message.button) });
        else if (message.action === 'up') await page.mouse.up({ button: mouseButton(message.button) });
        else throw new Error('invalid_mouse_action');
        return;
      }
      case 'wheel':
        await page.mouse.wheel(clamp(message.deltaX, -4000, 4000), clamp(message.deltaY, -4000, 4000));
        return;
      case 'key': {
        const key = String(message.key || '');
        if (!key || key.length > 64) throw new Error('invalid_key');
        if (message.action === 'down') await page.keyboard.down(key);
        else if (message.action === 'up') await page.keyboard.up(key);
        else if (message.action === 'press') await page.keyboard.press(key);
        else throw new Error('invalid_key_action');
        return;
      }
      case 'text': {
        const text = String(message.text || '');
        if (!text || text.length > 4096) throw new Error('invalid_text');
        await page.keyboard.insertText(text);
        return;
      }
      case 'navigate': {
        const url = validateNavigationUrl(message.url);
        await page.goto(url, { waitUntil: 'load', timeout: 15000 });
        if (connection.socket.readyState === WebSocket.OPEN) {
          connection.socket.send(JSON.stringify({ type: 'navigation', url: page.url(), title: await page.title() }));
        }
        return;
      }
      case 'ping':
        if (connection.socket.readyState === WebSocket.OPEN) connection.socket.send(JSON.stringify({ type: 'pong' }));
        return;
      default:
        throw new Error('unsupported_viewer_message');
    }
  }

  closeSession(sessionId) {
    for (const connection of [...this.connections]) {
      if (connection.sessionId === sessionId) {
        connection.closed = true;
        try { connection.socket.close(1000, 'session_closed'); } catch {}
        this.connections.delete(connection);
      }
    }
  }

  closeAll() {
    for (const connection of [...this.connections]) {
      connection.closed = true;
      try { connection.socket.close(1001, 'server_shutdown'); } catch {}
    }
    this.connections.clear();
    this.wss.close();
  }
}
