import http from 'node:http';

const port = Number(process.env.ISOLATION_FIXTURE_PORT || 19090);

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  if (requestUrl.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  const marker = requestUrl.searchParams.get('marker');
  const markerLiteral = JSON.stringify(marker);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>isolation-fixture</title></head><body><script>
    const before = {
      cookie: document.cookie,
      local: localStorage.getItem('phase5-marker'),
      session: sessionStorage.getItem('phase5-marker')
    };
    const marker = ${markerLiteral};
    if (marker !== null) {
      document.cookie = 'phase5-marker=' + encodeURIComponent(marker) + '; Path=/';
      localStorage.setItem('phase5-marker', marker);
      sessionStorage.setItem('phase5-marker', marker);
    }
    const after = {
      cookie: document.cookie,
      local: localStorage.getItem('phase5-marker'),
      session: sessionStorage.getItem('phase5-marker')
    };
    document.title = 'ISO:' + encodeURIComponent(JSON.stringify({before, after}));
  </script><h1>Phase 5 isolation fixture</h1></body></html>`;

  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'set-cookie': 'fixture=shared-origin; Path=/; SameSite=Lax',
  });
  response.end(html);
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'phase5_fixture_started', port }));
});
