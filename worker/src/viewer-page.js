export function viewerHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Secure Browser Viewer</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:#0b1020;color:#e8edf7;overflow:hidden}
#bar{height:52px;display:flex;gap:8px;align-items:center;padding:8px;background:#141b2d;border-bottom:1px solid #28324b}
#status{font-size:12px;min-width:92px;color:#aab6d3}#address{flex:1;background:#0b1020;border:1px solid #35415e;color:#fff;border-radius:8px;padding:9px 11px}
button{background:#263451;color:#fff;border:1px solid #415273;border-radius:8px;padding:9px 12px;cursor:pointer}button:hover{background:#314162}
#screenWrap{position:absolute;top:52px;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;background:#05070d;overflow:hidden}
#screen{max-width:100%;max-height:100%;user-select:none;-webkit-user-drag:none;outline:none;cursor:default}
#pasteBox{width:190px;background:#0b1020;border:1px solid #35415e;color:#fff;border-radius:8px;padding:9px}
</style>
</head>
<body>
<div id="bar">
  <span id="status">Connecting…</span>
  <input id="address" aria-label="Address" placeholder="https://example.com" />
  <button id="go" type="button">Go</button>
  <input id="pasteBox" aria-label="Paste text" placeholder="Paste text here" />
  <button id="paste" type="button">Send text</button>
</div>
<div id="screenWrap"><img id="screen" tabindex="0" alt="Remote browser" /></div>
<script>
(() => {
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  const status = document.getElementById('status');
  const screen = document.getElementById('screen');
  const address = document.getElementById('address');
  const pasteBox = document.getElementById('pasteBox');
  let socket = null;
  let objectUrl = null;
  let reconnectTimer = null;
  const viewport = { width: 1280, height: 720 };

  function setStatus(text){ status.textContent = text; }
  function send(payload){ if(socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload)); }
  function connect(){
    clearTimeout(reconnectTimer);
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(scheme + '//' + location.host + '/viewer/ws?token=' + encodeURIComponent(token || ''));
    socket.binaryType = 'blob';
    socket.onopen = () => setStatus('Connected');
    socket.onclose = () => { setStatus('Reconnecting…'); reconnectTimer = setTimeout(connect, 800); };
    socket.onerror = () => setStatus('Connection error');
    socket.onmessage = (event) => {
      if(typeof event.data === 'string'){
        try {
          const message = JSON.parse(event.data);
          if(message.type === 'hello'){
            viewport.width = message.viewport.width;
            viewport.height = message.viewport.height;
            if(message.url) address.value = message.url;
          }
          if(message.type === 'navigation' && message.url) address.value = message.url;
        } catch {}
        return;
      }
      if(objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(event.data);
      screen.src = objectUrl;
    };
  }

  function coords(event){
    const rect = screen.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(viewport.width, (event.clientX - rect.left) * viewport.width / Math.max(rect.width, 1))),
      y: Math.max(0, Math.min(viewport.height, (event.clientY - rect.top) * viewport.height / Math.max(rect.height, 1)))
    };
  }

  screen.addEventListener('mousedown', (event) => { screen.focus(); send({type:'mouse',action:'down',...coords(event),button:event.button}); event.preventDefault(); });
  screen.addEventListener('mouseup', (event) => { send({type:'mouse',action:'up',...coords(event),button:event.button}); event.preventDefault(); });
  let lastMove = 0;
  screen.addEventListener('mousemove', (event) => { const now=performance.now(); if(now-lastMove<35) return; lastMove=now; send({type:'mouse',action:'move',...coords(event)}); });
  screen.addEventListener('wheel', (event) => { send({type:'wheel',deltaX:event.deltaX,deltaY:event.deltaY}); event.preventDefault(); }, {passive:false});
  screen.addEventListener('keydown', (event) => { send({type:'key',action:'down',key:event.key}); event.preventDefault(); });
  screen.addEventListener('keyup', (event) => { send({type:'key',action:'up',key:event.key}); event.preventDefault(); });
  document.getElementById('go').addEventListener('click', () => send({type:'navigate',url:address.value}));
  address.addEventListener('keydown', (event) => { if(event.key==='Enter'){ send({type:'navigate',url:address.value}); address.blur(); screen.focus(); } });
  document.getElementById('paste').addEventListener('click', () => { if(pasteBox.value){ send({type:'text',text:pasteBox.value}); pasteBox.value=''; screen.focus(); } });

  if(!token){ setStatus('Missing token'); return; }
  connect();
})();
</script>
</body>
</html>`;
}
