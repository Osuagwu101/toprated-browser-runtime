import http from 'node:http';

const port = Number(process.env.PHASE8_AUTH_FIXTURE_PORT || 19091);
let expectedCookieValue = 'ok';

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  if (requestUrl.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (requestUrl.pathname === '/invalidate') {
    expectedCookieValue = 'renewed';
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ status: 'invalidated' }));
    return;
  }

  if (requestUrl.pathname === '/logged-out') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, max-age=0' });
    response.end('<!doctype html><html><head><title>PHASE8_SIGNED_OUT</title></head><body><div data-phase8-authenticated="false">Signed out</div></body></html>');
    return;
  }

  if (requestUrl.pathname === '/login') {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>ADMIN_PROFILE_CHECKING</title></head><body>
    <button id="admin-login" style="position:absolute;left:20px;top:20px;width:220px;height:80px">Complete administrator authentication</button>
    <script>
      function profileDatabase() {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open('toprated-admin-profile', 1);
          request.onupgradeneeded = () => request.result.createObjectStore('approval');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      async function readApproval() {
        const database = await profileDatabase();
        return new Promise((resolve, reject) => {
          const request = database.transaction('approval').objectStore('approval').get('approved');
          request.onsuccess = () => resolve(request.result === true);
          request.onerror = () => reject(request.error);
        });
      }
      async function writeApproval() {
        const database = await profileDatabase();
        return new Promise((resolve, reject) => {
          const request = database.transaction('approval', 'readwrite').objectStore('approval').put(true, 'approved');
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      }
      readApproval().then((approved) => {
        const cookieCurrent = document.cookie.split(';').map((value) => value.trim()).includes('phase8-auth=${expectedCookieValue}');
        if (approved && cookieCurrent) {
          location.replace('/dashboard?profile_reused=1');
          return;
        }
        document.title = approved ? 'ADMIN_PROFILE_EXPIRED' : 'ADMIN_PROFILE_FIRST_RUN';
      }).catch(() => { document.title = 'ADMIN_PROFILE_FIRST_RUN'; });
      document.getElementById('admin-login').addEventListener('click', async () => {
        document.cookie = 'phase8-auth=${expectedCookieValue}; path=/; Max-Age=86400; SameSite=Lax';
        localStorage.setItem('phase8-local', 'shared-state-local');
        sessionStorage.setItem('phase8-session', 'shared-state-session');
        await writeApproval();
        location.href = '/dashboard';
      });
    </script>
    </body></html>`;

    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
    });
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
  <input id="writer-marker" style="position:absolute;left:20px;top:120px;width:220px;height:50px" aria-label="writer marker">
  <button id="save-writer-marker" style="position:absolute;left:20px;top:190px;width:220px;height:50px">Save writer marker</button>
  <script>
    const cookieOk = document.cookie.split(';').map(v => v.trim()).includes('phase8-auth=${expectedCookieValue}');
    const localOk = localStorage.getItem('phase8-local') === 'shared-state-local';
    const sessionOk = sessionStorage.getItem('phase8-session') === 'shared-state-session';
    const writerMarker = localStorage.getItem('phase8-writer-isolation') || '';
    const authenticated = cookieOk && localOk;
    document.title = authenticated
      ? (writerMarker ? 'WRITER_MARKER:' + writerMarker : (new URLSearchParams(location.search).get('profile_reused') === '1' ? 'ADMIN_PROFILE_REUSED_AUTHENTICATED' : 'PHASE8_AUTHENTICATED'))
      : 'PHASE8_UNAUTHENTICATED';
    const marker = document.createElement('div');
    marker.setAttribute('data-phase8-authenticated', authenticated ? 'true' : 'false');
    marker.textContent = authenticated
      ? 'Authenticated shared state accepted; session storage present=' + sessionOk
      : 'Authentication state missing';
    document.getElementById('app').appendChild(marker);
    document.getElementById('writer-marker').value = writerMarker;
    document.getElementById('save-writer-marker').addEventListener('click', () => {
      const value = document.getElementById('writer-marker').value;
      localStorage.setItem('phase8-writer-isolation', value);
      document.title = 'WRITER_MARKER:' + value;
    });
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
