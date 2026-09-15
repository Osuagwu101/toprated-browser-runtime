const DEFAULT_FRAME_ANCESTORS = ["'self'", "https://topratedseotools.com", "https://www.topratedseotools.com"];

export function resolveViewerFrameAncestors(raw = process.env.VIEWER_FRAME_ANCESTORS ?? "") {
  const values = String(raw).trim() ? String(raw).trim().split(/\s+/) : DEFAULT_FRAME_ANCESTORS;
  const unique = [];
  for (const value of values) {
    if (value === "'self'") {
      if (!unique.includes(value)) unique.push(value);
      continue;
    }
    let url;
    try { url = new URL(value); } catch { throw new Error("VIEWER_FRAME_ANCESTORS contains an invalid origin."); }
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("VIEWER_FRAME_ANCESTORS must contain only 'self' or clean HTTPS origins.");
    }
    const origin = url.origin;
    if (!unique.includes(origin)) unique.push(origin);
  }
  if (!unique.length) throw new Error("VIEWER_FRAME_ANCESTORS must allow at least one trusted origin.");
  return unique;
}

export function buildViewerSecurityHeaders(nonce, rawFrameAncestors = process.env.VIEWER_FRAME_ANCESTORS ?? "") {
  const frameAncestors = resolveViewerFrameAncestors(rawFrameAncestors).join(" ");
  return {
    "content-security-policy": `default-src 'none'; img-src 'self' blob: data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors ${frameAncestors}; base-uri 'none'; form-action 'none'; object-src 'none'`,
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "cross-origin",
  };
}
