import http from 'node:http';

const port = Number(process.env.PHASE8_AUTH_FIXTURE_PORT || 19091);

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  if (requestUrl.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (requestUrl.pathname === '/admin-login') {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>ADMIN_LOGIN</title></head><body>
    <button id="approve" style="position:absolute;left:100px;top:100px;width:260px;height:100px">Approve identity</button>
    <script>
      document.getElementById('approve').addEventListener('click', () => {
        document.cookie = 'phase8-auth=ok; Path=/; SameSite=Lax';
        localStorage.setItem('phase8-local', 'shared-state-local');
        sessionStorage.setItem('phase8-session', 'shared-state-session');
        location.href = '/dashboard';
      });
    </script></body></html>`;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, max-age=0' });
    response.end(html);
    return;
  }

  if (requestUrl.pathname !== '/dashboard') {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    response.end('not found');
    return;
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>PHASE8_UNAUTHENTICATED</title></head><body>
  <main id="app"></main>
  <script>
    const cookieOk = document.cookie.split(';').map(v => v.trim()).includes('phase8-auth=ok');
    const localOk = localStorage.getItem('phase8-local') === 'shared-state-local';
    const sessionOk = sessionStorage.getItem('phase8-session') === 'shared-state-session';
    const authenticated = cookieOk && localOk && sessionOk;
    document.title = authenticated ? 'PHASE8_AUTHENTICATED' : 'PHASE8_UNAUTHENTICATED';
    const marker = document.createElement('div');
    marker.setAttribute('data-phase8-authenticated', authenticated ? 'true' : 'false');
    marker.textContent = authenticated ? 'Authenticated shared state accepted' : 'Authentication state missing';
    document.getElementById('app').appendChild(marker);
  </script>
  </body></html>`;

  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
  });
  response.end(html);
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'phase8_auth_fixture_started', port }));
});
