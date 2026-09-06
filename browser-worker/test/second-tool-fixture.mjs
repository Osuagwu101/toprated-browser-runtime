import http from 'node:http';

const port = Number(process.env.PHASE10_SECOND_TOOL_FIXTURE_PORT || 19092);

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', `http://127.0.0.1:${port}`);

  if (requestUrl.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ status: 'ok', tool: 'sneakwrite' }));
    return;
  }

  if (requestUrl.pathname !== '/app') {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    response.end('not found');
    return;
  }

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <title>SNEAKWRITE_PHASE10_READY</title>
    </head>
    <body>
      <main data-phase10-tool="sneakwrite">
        <h1>SneakWrite Phase 10 deterministic provider fixture</h1>
        <p>This fixture substitutes only network reachability in CI; the committed tool profile retains the real sneakwrite.net destination.</p>
      </main>
    </body>
  </html>`;

  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
  });
  response.end(html);
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'phase10_second_tool_fixture_started', tool: 'sneakwrite', port }));
});
