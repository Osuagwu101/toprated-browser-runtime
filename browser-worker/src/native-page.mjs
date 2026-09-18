function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Dedicated full-page handoff.  Unlike the legacy viewer this is an RFB
 * client connected to the browser's real X display: it does not request JPEG
 * frames or translate writer input through CDP.
 */
export function buildNativeHandoffHtml({ sessionId, nonce }) {
  const safeSessionId = escapeHtml(sessionId);
  const sessionLiteral = JSON.stringify(String(sessionId));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Opening tool…</title><style nonce="${escapeHtml(nonce)}">html,body,#screen{width:100%;height:100%;margin:0;background:#fff;overflow:hidden}#screen{touch-action:none}#notice{position:fixed;z-index:3;left:50%;top:12px;transform:translateX(-50%);padding:8px 12px;border-radius:999px;background:#18212b;color:#fff;font:13px system-ui,-apple-system,sans-serif;box-shadow:0 5px 18px #0003}#notice.ready{opacity:0;pointer-events:none;transition:opacity .2s}</style></head><body><div id="screen"></div><div id="notice">Opening secure tool…</div><script type="module" nonce="${escapeHtml(nonce)}">import RFB from '/native/${safeSessionId}/assets/core/rfb.js';const sid=${sessionLiteral};const base='/native/'+encodeURIComponent(sid);const notice=document.getElementById('notice');const fail=(text)=>{notice.textContent=text;notice.className=''};const grant=location.hash.length>1?decodeURIComponent(location.hash.slice(1)):'';try{if(!grant)throw new Error('This handoff needs a fresh launch.');const authorized=await fetch(base+'/authorize',{method:'POST',headers:{Authorization:'Bearer '+grant},credentials:'same-origin'});if(!authorized.ok)throw new Error('This handoff is no longer authorized.');history.replaceState(null,'',location.pathname);const protocol=location.protocol==='https:'?'wss':'ws';const rfb=new RFB(document.getElementById('screen'),protocol+'://'+location.host+base+'/stream');rfb.scaleViewport=true;rfb.resizeSession=false;rfb.clipViewport=false;rfb.addEventListener('connect',()=>{notice.textContent='Connected';notice.className='ready'});rfb.addEventListener('disconnect',(event)=>{if(!event.detail.clean)fail('Connection interrupted. Reload this page to reconnect.');});}catch(error){fail(error instanceof Error?error.message:'Could not open the secure tool.');}</script></body></html>`;
}
