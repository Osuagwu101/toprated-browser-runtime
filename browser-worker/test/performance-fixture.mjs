import http from 'node:http';

const port = Number(process.env.PHASE12_FIXTURE_PORT || 19094);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>PHASE12_PERFORMANCE_READY</title>
<style>body{font-family:system-ui;margin:0;background:#f4f6fa;color:#18202c}header{padding:24px;background:#14213d;color:white}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:24px}.card{background:white;border-radius:10px;padding:18px;min-height:110px;box-shadow:0 2px 8px #0002}textarea{width:calc(100% - 48px);height:180px;margin:0 24px 24px;padding:12px}</style></head>
<body data-phase12-ready="true"><header><h1>Generic browser workload</h1><span id="tick">0</span></header><main class="grid">
${Array.from({ length: 24 }, (_, i) => `<section class="card"><h2>Panel ${i + 1}</h2><p>Deterministic local content for browser rendering and input measurement.</p></section>`).join('')}
</main><textarea aria-label="work area">Phase 12 synthetic workload</textarea>
<script>let tick=0;setInterval(()=>{document.querySelector('#tick').textContent=String(++tick)},250)</script></body></html>`;

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ status: 'ok', fixture: 'phase12-performance' }));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(html);
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'phase12_fixture_started', port }));
});
